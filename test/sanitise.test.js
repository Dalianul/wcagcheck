import { describe, it, expect } from 'vitest';
import { sanitiseForAnalysis } from '../public/sanitise.js';

const base = 'https://example.com/shop/page';

describe('sanitiseForAnalysis — things that execute', () => {
  it('removes script elements and their contents', () => {
    const out = sanitiseForAnalysis('<p>a</p><script>window.x=1</script><p>b</p>', base);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/window\.x/);
  });

  // The vector that fires with no interaction at all.
  it('removes onerror', () => {
    const out = sanitiseForAnalysis('<img src="missing.png" onerror="window.x=1" alt="a">', base);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toMatch(/alt="a"/);
  });

  it('removes every on* handler regardless of name or case', () => {
    const out = sanitiseForAnalysis(
      '<div ONCLICK="a()" onMouseOver=\'b()\' onfocus=c() onanything="d()">x</div>', base
    );
    expect(out).not.toMatch(/on[a-z]+\s*=/i);
  });

  // Regression: the separator class was \s, but HTML also accepts a solidus
  // between attributes. Every one of these fired in Chrome before the fix.
  it('removes a handler separated by a solidus after a quoted value', () => {
    const out = sanitiseForAnalysis('<img src="x.png"/onerror="window.f=1" alt="a">', base);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toMatch(/alt="a"/);
  });

  it('removes a handler separated by a solidus with an unquoted value', () => {
    const out = sanitiseForAnalysis('<img src="x.png"/onerror=window.f=1 alt="a">', base);
    expect(out).not.toMatch(/onerror/i);
  });

  it('removes a handler placed directly after the tag name', () => {
    const out = sanitiseForAnalysis('<img/onerror="window.f=1" src="x.png" alt="a">', base);
    expect(out).not.toMatch(/onerror/i);
  });

  it('removes a solidus-separated handler after a single-quoted value', () => {
    const out = sanitiseForAnalysis("<img src='x.png'/onerror='window.f=1' alt='a'>", base);
    expect(out).not.toMatch(/onerror/i);
  });

  it('removes javascript: urls but keeps the element', () => {
    const out = sanitiseForAnalysis('<a href="javascript:alert(1)">click</a>', base);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toMatch(/<a /);
  });

  it('removes auto-loading embedded content', () => {
    const out = sanitiseForAnalysis('<iframe src="x"></iframe><object data="y"></object><embed src="z">', base);
    expect(out).not.toMatch(/<iframe|<object|<embed/i);
  });

  it('removes meta refresh', () => {
    const out = sanitiseForAnalysis('<meta http-equiv="refresh" content="0;url=http://evil.test">', base);
    expect(out).not.toMatch(/http-equiv/i);
  });
});

describe('sanitiseForAnalysis — things axe needs kept', () => {
  it('keeps style elements, because contrast depends on them', () => {
    const out = sanitiseForAnalysis('<style>.a{color:#999;background:#fff}</style><p class="a">x</p>', base);
    expect(out).toMatch(/<style>/);
    expect(out).toMatch(/color:#999/);
  });

  it('keeps accessibility attributes', () => {
    const html = '<button aria-label="Close" aria-expanded="false" role="button" tabindex="0"></button>';
    const out = sanitiseForAnalysis(html, base);
    for (const attr of ['aria-label="Close"', 'aria-expanded="false"', 'role="button"', 'tabindex="0"']) {
      expect(out).toContain(attr);
    }
  });

  it('keeps alt, label association and lang', () => {
    const html = '<html lang="ro"><img src="a.png" alt=""><label for="x">N</label><input id="x"></html>';
    const out = sanitiseForAnalysis(html, base);
    expect(out).toMatch(/lang="ro"/);
    expect(out).toMatch(/alt=""/);
    expect(out).toMatch(/for="x"/);
  });
});

// Contrast is judged from the target's own stylesheets, so anything that stops
// one loading corrupts the headline measurement rather than merely degrading it.
describe('sanitiseForAnalysis — making the target\'s stylesheets actually load', () => {
  // Observed on otto.de and mediamarkt.de: a crossorigin stylesheet is fetched
  // in CORS mode, the target's server sends no Access-Control-Allow-Origin for
  // us, and the stylesheet silently never applies. Without the attribute it is
  // an ordinary no-CORS load, which works cross-origin — getComputedStyle does
  // not need the CSSOM to be readable.
  it('removes crossorigin from a stylesheet link but keeps the link', () => {
    const out = sanitiseForAnalysis(
      '<link rel="stylesheet" href="/a.css" crossorigin="anonymous">', base
    );
    expect(out).not.toMatch(/crossorigin/i);
    expect(out).toContain('rel="stylesheet"');
    expect(out).toContain('https://example.com/a.css');
  });

  it('removes a bare crossorigin attribute with no value', () => {
    const out = sanitiseForAnalysis('<link rel="stylesheet" href="/a.css" crossorigin>', base);
    expect(out).not.toMatch(/crossorigin/i);
    expect(out).toContain('rel="stylesheet"');
  });

  // Subresource integrity requires CORS mode, so dropping crossorigin while
  // leaving integrity would turn a working stylesheet into a failing one.
  it('removes integrity alongside it, which would otherwise force CORS back on', () => {
    const out = sanitiseForAnalysis(
      '<link rel="stylesheet" href="/a.css" integrity="sha384-abc" crossorigin="anonymous">', base
    );
    expect(out).not.toMatch(/integrity/i);
    expect(out).not.toMatch(/crossorigin/i);
  });

  it('leaves a plain stylesheet link otherwise intact', () => {
    const out = sanitiseForAnalysis('<link rel="stylesheet" href="/a.css" media="screen">', base);
    expect(out).toContain('media="screen"');
    expect(out).toContain('rel="stylesheet"');
  });
});

// These can never execute — the CSP blocks them and nothing would import them
// — but they still make the visitor's browser fetch scripts from the scanned
// site's CDN, which is traffic we have no business causing.
describe('sanitiseForAnalysis — script preloads', () => {
  it('drops a module preload', () => {
    const out = sanitiseForAnalysis('<link rel="modulepreload" href="/m.js"><p>x</p>', base);
    expect(out).not.toMatch(/modulepreload/i);
    expect(out).toContain('<p>x</p>');
  });

  it('drops a script preload', () => {
    const out = sanitiseForAnalysis('<link rel="preload" as="script" href="/s.js">', base);
    expect(out).not.toMatch(/preload/i);
  });

  it('keeps a style preload, which is a stylesheet and affects contrast', () => {
    const out = sanitiseForAnalysis('<link rel="preload" as="style" href="/a.css">', base);
    expect(out).toMatch(/as="style"/);
  });
});

describe('sanitiseForAnalysis — url resolution', () => {
  // Shadow DOM ignores <base>, so relative URLs must be absolute before
  // insertion or the target's stylesheets never load and contrast is wrong.
  it('absolutises relative stylesheet and image urls', () => {
    const out = sanitiseForAnalysis(
      '<link rel="stylesheet" href="/css/main.css"><img src="../img/a.png" alt="a">', base
    );
    expect(out).toContain('https://example.com/css/main.css');
    expect(out).toContain('https://example.com/img/a.png');
  });

  // Regression: the whole list was handed to the single-URL resolver, which
  // percent-encoded the spaces and commas into one bogus URL.
  it('absolutises each srcset candidate and keeps its descriptor', () => {
    const out = sanitiseForAnalysis('<img srcset="a.png 1x, sub/b.png 2x" alt="a">', base);
    expect(out).toContain('https://example.com/shop/a.png 1x');
    expect(out).toContain('https://example.com/shop/sub/b.png 2x');
    expect(out).not.toContain('%20');
  });

  it('leaves absolute and data urls alone', () => {
    const out = sanitiseForAnalysis(
      '<img src="https://cdn.test/a.png" alt="a"><img src="data:image/gif;base64,AA" alt="b">', base
    );
    expect(out).toContain('https://cdn.test/a.png');
    expect(out).toContain('data:image/gif;base64,AA');
  });
});
