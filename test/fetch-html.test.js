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

afterEach(() => {
  vi.unstubAllGlobals();
});

const url = (target) =>
  new Request(`https://wcagcheck.eu/api/fetch?url=${encodeURIComponent(target)}`);

describe('handleFetchHtml', () => {
  it('returns the raw html and the final url', async () => {
    servePage('<!doctype html><html lang="en"><body>hi</body></html>');
    const res = await handleFetchHtml(url('https://example.com/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.html).toContain('<body>hi</body>');
    expect(body.finalUrl).toBe('https://example.com/');
    expect(body.bytes).toBeGreaterThan(0);
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
  it('describes a 511 as a block, not an origin error', async () => {
    servePage('', { status: 511 });
    const res = await handleFetchHtml(url('https://example.com/'));
    // Read the body once — a Response body cannot be consumed twice.
    const { error } = await res.json();
    expect(error).toMatch(/blocking|refuses/i);
    expect(error).not.toMatch(/itself is erroring/i);
  });
});
