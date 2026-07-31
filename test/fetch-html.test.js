import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleFetchHtml } from '../src/fetch-html.js';

function servePage(html, init = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(html, {
        status: init.status ?? 200,
        headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' },
      })
    )
  );
}

/**
 * Serves a body generated lazily, `chunkSize` bytes at a time, up to `totalBytes`.
 *
 * Generating chunks in a `pull` callback (rather than enqueuing them all up
 * front) means bytes only come into existence when the reader actually asks
 * for them. That makes the returned getter a genuine measure of how much of
 * the body handleFetchHtml consumed before it stopped — a static string or an
 * eagerly-filled stream couldn't tell an early cancel from a full drain.
 */
function serveStream(totalBytes, chunkSize) {
  const encoder = new TextEncoder();
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - sent);
      controller.enqueue(encoder.encode('a'.repeat(size)));
      sent += size;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    )
  );
  return () => sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const url = (target) =>
  new Request(`https://wcagcheck.eu/api/fetch?url=${encodeURIComponent(target)}`);

describe('handleFetchHtml', () => {
  it('returns the raw html and the final url', async () => {
    const html = '<!doctype html><html lang="en"><body>café</body></html>';
    servePage(html);
    const res = await handleFetchHtml(url('https://example.com/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.html).toBe(html);
    expect(body.finalUrl).toBe('https://example.com/');
    // 'é' is one UTF-16 code unit but two UTF-8 bytes, so this only holds if
    // `bytes` is a real byte count rather than html.length (the bug this
    // replaced, which this fixture would silently pass under since the two
    // numbers only diverge on non-ASCII input).
    expect(body.bytes).toBe(new TextEncoder().encode(html).byteLength);
  });

  it('rejects a missing url', async () => {
    const res = await handleFetchHtml(new Request('https://wcagcheck.eu/api/fetch'));
    expect(res.status).toBe(400);
  });

  // Same guard as /api/scan — this endpoint must not become an SSRF bypass.
  it('rejects a private address', async () => {
    const res = await handleFetchHtml(url('http://169.254.169.254/'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a public website/i);
  });

  it('rejects a non-HTML response', async () => {
    servePage('{}', { contentType: 'application/json' });
    const res = await handleFetchHtml(url('https://example.com/x.json'));
    expect(res.status).toBe(502);
  });

  it('explains a 403 as bot protection', async () => {
    servePage('', { status: 403 });
    const res = await handleFetchHtml(url('https://example.com/'));
    expect((await res.json()).error).toMatch(/refuses automated requests/i);
  });

  // Regression: a 511 from a site blocking us was being reported as the site
  // being broken, which sends people to debug the wrong thing.
  it('describes a 511 as a gateway block naming the browser behaviour', async () => {
    servePage('', { status: 511 });
    const res = await handleFetchHtml(url('https://example.com/'));
    // Read the body once — a Response body cannot be consumed twice.
    const { error } = await res.json();
    expect(error).toMatch(/gateway/i);
    expect(error).toMatch(/loads normally in a browser/i);
  });

  // Same upstream condition, same wording — the two endpoints must not
  // contradict each other about why a plain 500 happened.
  it('describes a plain 500 the same way scan.js does', async () => {
    servePage('', { status: 500 });
    const res = await handleFetchHtml(url('https://example.com/'));
    const { error } = await res.json();
    expect(error).toBe('The site itself is erroring (HTTP 500). Nothing to check yet.');
  });

  // The byte cap must stop the read itself, not just slice the result
  // afterwards — otherwise an unbounded response is fully buffered in memory
  // before the cap ever applies.
  it('stops reading early and truncates a response larger than the byte cap', async () => {
    const CAP = 2_500_000;
    const getSent = serveStream(CAP * 4, 500_000);
    const res = await handleFetchHtml(url('https://example.com/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.html.length).toBeLessThanOrEqual(CAP);
    expect(body.bytes).toBeLessThanOrEqual(CAP);
    // Proves the reader was cancelled early rather than draining the full
    // 10 MB body before truncating.
    expect(getSent()).toBeLessThan(CAP * 2);
  });
});
