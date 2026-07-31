import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleScan } from '../src/scan.js';

/** Serves `html` for any outbound fetch, so rule tests are deterministic. */
function servePage(html, init = {}) {
  const stub = vi.fn(async () =>
    new Response(html, {
      status: init.status ?? 200,
      headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' },
    })
  );
  vi.stubGlobal('fetch', stub);
  return stub;
}

const REDIRECT_ORIGIN = 'https://example.com/';

/**
 * Serves a 302 to `location`, then `then`.
 *
 * This mock deliberately honours the `redirect` init option the way the runtime
 * does. A mock that always hands back the raw 302 makes the SSRF test useless:
 * the guard would appear to work even with `redirect: 'follow'`, because the
 * scanner would still get a chance to inspect the hop. Emulating `follow` means
 * the mock resolves the redirect itself and the scanner never sees it — which is
 * exactly the bug being guarded against.
 */
function serveRedirect(
  location,
  then = '<html lang="en"><head><title>x</title></head><body><main><h1>x</h1></main></body></html>'
) {
  const finalPage = () => new Response(then, { headers: { 'content-type': 'text/html' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init = {}) => {
      let url = typeof input === 'string' ? input : input.url;

      for (let hop = 0; hop < 5; hop++) {
        if (url !== REDIRECT_ORIGIN) return finalPage();

        if (init.redirect === 'follow') {
          url = new URL(location, url).toString();
          continue;
        }
        return new Response(null, { status: 302, headers: { location } });
      }
      return finalPage();
    })
  );
}

async function scan(html, target = 'https://example.com/') {
  servePage(html);
  const res = await handleScan(new Request(`https://wcagcheck.eu/api/scan?url=${encodeURIComponent(target)}`));
  return { status: res.status, body: await res.json() };
}

const ids = (body) => body.issues.map((i) => i.id);

// A page with none of the document-level problems, so single-rule fixtures
// don't trip unrelated checks.
const wrap = (inner) =>
  `<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main><h1>Heading</h1>${inner}</main></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('document-level rules', () => {
  it('flags a page with no title, lang, main or h1', async () => {
    const { body } = await scan('<!doctype html><html><body><p>bare</p></body></html>');
    expect(ids(body)).toEqual(
      expect.arrayContaining(['missing-title', 'html-missing-lang', 'no-main-landmark', 'no-h1'])
    );
  });

  it('accepts a well-formed page', async () => {
    const { body } = await scan(wrap('<p>fine</p>'));
    expect(body.issues).toEqual([]);
    expect(body.summary.totalOccurrences).toBe(0);
  });

  // Regression: the title selector used to match <svg><title>, so an inline icon
  // satisfied the page-title check and corrupted the accessible-name stack.
  it('does not accept an svg title as the page title', async () => {
    const html =
      '<!doctype html><html lang="en"><head></head><body><main><h1>h</h1>' +
      '<svg><title>Icon label</title></svg></main></body></html>';
    const { body } = await scan(html);
    expect(ids(body)).toContain('missing-title');
    expect(body.pageTitle).toBeNull();
  });
});

describe('accessible names', () => {
  it('flags a link with no text', async () => {
    const { body } = await scan(wrap('<a href="/x"><svg></svg></a>'));
    expect(ids(body)).toContain('link-no-name');
  });

  // Regression: names were only read from direct text children, so real markup
  // like <button><span>Menu</span></button> reported as unnamed.
  it('reads a name from nested markup', async () => {
    const { body } = await scan(wrap('<button><span>Menu</span></button>'));
    expect(ids(body)).not.toContain('button-no-name');
  });

  // Regression: this is how w3.org labels its search button, and it was a false
  // positive until descendant labels were considered.
  it('accepts a descendant aria-label as the name', async () => {
    const { body } = await scan(wrap('<button><svg aria-label="Search"></svg></button>'));
    expect(ids(body)).not.toContain('button-no-name');
  });

  it('accepts an image alt as a link name', async () => {
    const { body } = await scan(wrap('<a href="/"><img src="logo.png" alt="Home"></a>'));
    expect(ids(body)).not.toContain('link-no-name');
  });

  it('flags vague link text', async () => {
    const { body } = await scan(wrap('<a href="/x">click here</a>'));
    expect(ids(body)).toContain('link-vague-text');
  });
});

describe('images and forms', () => {
  it('flags a missing alt but not an empty decorative one', async () => {
    const { body } = await scan(wrap('<img src="a.png"><img src="b.png" alt="">'));
    const missing = body.issues.find((i) => i.id === 'img-missing-alt');
    expect(missing.count).toBe(1);
  });

  it('flags alt text that is only a filename', async () => {
    const { body } = await scan(wrap('<img src="a.png" alt="hero-image.png">'));
    expect(ids(body)).toContain('img-alt-is-filename');
  });

  it('flags an unlabelled field and accepts a labelled one', async () => {
    const { body } = await scan(
      wrap('<input type="text" name="a"><label for="b">Name</label><input type="text" id="b">')
    );
    expect(body.issues.find((i) => i.id === 'control-no-label').count).toBe(1);
  });

  it('resolves a label that appears after its field', async () => {
    const { body } = await scan(wrap('<input type="text" id="late"><label for="late">Later</label>'));
    expect(ids(body)).not.toContain('control-no-label');
  });
});

describe('other rules', () => {
  it('flags a viewport that blocks zoom', async () => {
    const html =
      '<!doctype html><html lang="en"><head><title>t</title>' +
      '<meta name="viewport" content="width=device-width, user-scalable=no"></head>' +
      '<body><main><h1>h</h1></main></body></html>';
    const { body } = await scan(html);
    expect(ids(body)).toContain('viewport-blocks-zoom');
  });

  it('flags a positive tabindex', async () => {
    const { body } = await scan(wrap('<div tabindex="3">c</div>'));
    expect(ids(body)).toContain('positive-tabindex');
  });

  it('flags a skipped heading level', async () => {
    const { body } = await scan(wrap('<h2>two</h2><h4>four</h4>'));
    expect(ids(body)).toContain('heading-skip');
  });

  it('flags an untitled iframe', async () => {
    const { body } = await scan(wrap('<iframe src="https://example.com"></iframe>'));
    expect(ids(body)).toContain('iframe-no-title');
  });

  it('ignores a single-row table but flags a headerless data table', async () => {
    const layout = await scan(wrap('<table><tr><td>only</td></tr></table>'));
    expect(ids(layout.body)).not.toContain('table-no-header');

    const data = await scan(wrap('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>'));
    expect(ids(data.body)).toContain('table-no-header');
  });

  it('maps every finding to a WCAG criterion and an EN 301 549 clause', async () => {
    const { body } = await scan(wrap('<img src="a.png">'));
    for (const issue of body.issues) {
      expect(issue.wcag).toMatch(/^\d+\.\d+\.\d+$/);
      expect(issue.en301549).toBe(`9.${issue.wcag}`);
      expect(issue.remedy).toBeTruthy();
    }
  });
});

// SC 4.1.1 Parsing was removed in WCAG 2.2, and W3C annotated it in 2.0 and 2.1
// as "should be considered as always satisfied for any content using HTML or
// XML". axe moved both of its duplicate-id rules to the wcag2a-obsolete tag for
// the same reason. A duplicate id is only a real failure when it breaks a
// reference, and then what it breaks is the accessible name — 4.1.2.
describe('duplicate ids', () => {
  it('ignores a duplicate id that nothing references', async () => {
    const { body } = await scan(wrap('<p id="dup">a</p><p id="dup">b</p>'));
    expect(ids(body)).not.toContain('duplicate-id');
  });

  it('flags a duplicate id that a label points at', async () => {
    const { body } = await scan(
      wrap('<label for="dup">Name</label><input id="dup"><input id="dup">')
    );
    expect(ids(body)).toContain('duplicate-id');
  });

  it('flags a duplicate id referenced by aria-labelledby', async () => {
    const { body } = await scan(
      wrap('<span id="dup">Label</span><span id="dup">Other</span><button aria-labelledby="dup">x</button>')
    );
    expect(ids(body)).toContain('duplicate-id');
  });

  // aria-labelledby takes a space-separated list, so a naive whole-value lookup
  // would miss every reference after the first.
  it('reads every id in a space-separated reference list', async () => {
    const { body } = await scan(
      wrap('<span id="a">A</span><span id="dup">B</span><span id="dup">C</span>' +
        '<button aria-labelledby="a dup">x</button>')
    );
    expect(ids(body)).toContain('duplicate-id');
  });

  it('cites 4.1.2, not the retired 4.1.1', async () => {
    const { body } = await scan(
      wrap('<label for="dup">Name</label><input id="dup"><input id="dup">')
    );
    const finding = body.issues.find((i) => i.id === 'duplicate-id');
    expect(finding.wcag).toBe('4.1.2');
    expect(finding.en301549).toBe('9.4.1.2');
  });
});

describe('request handling', () => {
  it('rejects a missing url', async () => {
    const res = await handleScan(new Request('https://wcagcheck.eu/api/scan'));
    expect(res.status).toBe(400);
  });

  it('rejects a private address', async () => {
    const res = await handleScan(
      new Request('https://wcagcheck.eu/api/scan?url=http%3A%2F%2F127.0.0.1%2F')
    );
    expect(res.status).toBe(400);
  });

  // Regression: redirects used to be followed by the runtime, so only the first
  // URL was ever validated and a public host could bounce us to loopback.
  it('refuses a redirect into a private address', async () => {
    serveRedirect('http://169.254.169.254/latest/meta-data/');
    const res = await handleScan(
      new Request('https://wcagcheck.eu/api/scan?url=https%3A%2F%2Fexample.com%2F')
    );
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toMatch(/private address/i);
  });

  it('follows a redirect to another public address', async () => {
    serveRedirect('https://elsewhere.example/final');
    const res = await handleScan(
      new Request('https://wcagcheck.eu/api/scan?url=https%3A%2F%2Fexample.com%2F')
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe('https://elsewhere.example/final');
  });

  it('rejects a non-HTML response', async () => {
    servePage('{}', { contentType: 'application/json' });
    const res = await handleScan(
      new Request('https://wcagcheck.eu/api/scan?url=https%3A%2F%2Fexample.com%2Ffeed.json')
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/non-HTML|application\/json/i);
  });

  it('explains a 403 as bot protection rather than a tool failure', async () => {
    servePage('', { status: 403 });
    const res = await handleScan(
      new Request('https://wcagcheck.eu/api/scan?url=https%3A%2F%2Fexample.com%2F')
    );
    expect((await res.json()).error).toMatch(/refuses automated requests/i);
  });
});
