/**
 * WCAG / EN 301 549 static accessibility scan.
 *
 * Runs in a Cloudflare Worker on the free tier. Uses HTMLRewriter (native,
 * streaming, Rust-backed) instead of a DOM library so we stay well inside the
 * Workers CPU budget and ship zero runtime dependencies.
 *
 * Deliberate limitation: no JavaScript is executed and no styles are resolved,
 * so colour contrast, focus order and keyboard traps are out of scope. The UI
 * says so plainly rather than implying a full audit.
 */

const MAX_BYTES = 2_500_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_EXAMPLES = 5;

// EN 301 549 clause 9 numbers its web requirements to match WCAG success
// criteria, so 1.1.1 -> 9.1.1.1. That mapping is what makes the report cite
// the standard the EAA actually points at.
const RULES = {
  'img-missing-alt':      { impact: 'serious',  wcag: '1.1.1', level: 'A',  title: 'Images without alt text' },
  'img-alt-is-filename':  { impact: 'moderate', wcag: '1.1.1', level: 'A',  title: 'Alt text looks like a filename' },
  'input-image-no-alt':   { impact: 'serious',  wcag: '1.1.1', level: 'A',  title: 'Image buttons without alt text' },
  'area-missing-alt':     { impact: 'serious',  wcag: '1.1.1', level: 'A',  title: 'Image map areas without alt text' },
  'html-missing-lang':    { impact: 'serious',  wcag: '3.1.1', level: 'A',  title: 'Page language not declared' },
  'missing-title':        { impact: 'serious',  wcag: '2.4.2', level: 'A',  title: 'Page has no title' },
  'link-no-name':         { impact: 'serious',  wcag: '2.4.4', level: 'A',  title: 'Links with no readable text' },
  'link-vague-text':      { impact: 'minor',    wcag: '2.4.4', level: 'A',  title: 'Non-descriptive link text' },
  'button-no-name':       { impact: 'serious',  wcag: '4.1.2', level: 'A',  title: 'Buttons with no accessible name' },
  'control-no-label':     { impact: 'serious',  wcag: '3.3.2', level: 'A',  title: 'Form fields without labels' },
  'iframe-no-title':      { impact: 'serious',  wcag: '4.1.2', level: 'A',  title: 'Frames without a title' },
  'duplicate-id':         { impact: 'moderate', wcag: '4.1.1', level: 'A',  title: 'Duplicate id attributes' },
  'positive-tabindex':    { impact: 'moderate', wcag: '2.4.3', level: 'A',  title: 'Positive tabindex values' },
  'viewport-blocks-zoom': { impact: 'serious',  wcag: '1.4.4', level: 'AA', title: 'Zoom disabled by viewport meta' },
  'media-no-captions':    { impact: 'serious',  wcag: '1.2.2', level: 'A',  title: 'Video or audio without captions' },
  'media-autoplay':       { impact: 'moderate', wcag: '1.4.2', level: 'A',  title: 'Media plays automatically' },
  'no-main-landmark':     { impact: 'moderate', wcag: '1.3.1', level: 'A',  title: 'No main landmark' },
  'no-h1':                { impact: 'moderate', wcag: '1.3.1', level: 'A',  title: 'Page has no h1 heading' },
  'heading-skip':         { impact: 'moderate', wcag: '1.3.1', level: 'A',  title: 'Heading levels skipped' },
  'table-no-header':      { impact: 'moderate', wcag: '1.3.1', level: 'A',  title: 'Data table without header cells' },
};

const REMEDY = {
  'img-missing-alt': 'Add alt="" to decorative images and a short description to meaningful ones. Screen readers announce the filename otherwise.',
  'img-alt-is-filename': 'Replace the filename with a description of what the image conveys.',
  'input-image-no-alt': 'Give <input type="image"> an alt attribute describing the action it performs.',
  'area-missing-alt': 'Every <area> in an image map needs alt text describing its destination.',
  'html-missing-lang': 'Add lang to the <html> element, e.g. <html lang="ro">, so screen readers use the right pronunciation.',
  'missing-title': 'Add a unique, descriptive <title>. It is the first thing announced and what shows in search results.',
  'link-no-name': 'Give the link readable text, or an aria-label. Icon-only links need an accessible name.',
  'link-vague-text': 'Replace "click here" and "read more" with text that makes sense out of context.',
  'button-no-name': 'Add text inside the button, or an aria-label. Icon-only buttons are unusable without one.',
  'control-no-label': 'Associate a <label for="..."> with each field, or use aria-label. Placeholder text is not a label.',
  'iframe-no-title': 'Add a title attribute describing the embedded content, e.g. title="Cookie settings".',
  'duplicate-id': 'Make every id unique. Duplicates break label associations and aria references.',
  'positive-tabindex': 'Use tabindex="0" or none at all. Positive values create a tab order that fights the visual one.',
  'viewport-blocks-zoom': 'Remove user-scalable=no and any maximum-scale below 2. Users must be able to zoom to 200%.',
  'media-no-captions': 'Add a <track kind="captions"> element. Prerecorded video with audio requires captions.',
  'media-autoplay': 'Remove autoplay, or provide a visible control to stop it within the first three seconds.',
  'no-main-landmark': 'Wrap the primary content in <main> so users can skip straight to it.',
  'no-h1': 'Add one <h1> describing the page. It anchors the heading outline users navigate by.',
  'heading-skip': 'Do not jump levels (h2 straight to h4). The outline is how screen reader users scan a page.',
  'table-no-header': 'Add <th> cells (and scope) to data tables so each cell can be related to its header.',
};

const VAGUE_LINK_TEXT = new Set([
  'click here', 'here', 'read more', 'more', 'more info', 'more information',
  'link', 'this', 'this link', 'details', 'continue', 'go', 'download',
  'learn more', 'see more', 'info',
]);

const FILENAME_ALT = /\.(jpe?g|png|gif|svg|webp|avif|bmp|ico)$/i;

const MAX_REDIRECTS = 5;

/**
 * True if the host must not be fetched.
 *
 * Parses addresses numerically rather than pattern-matching the string. A regex
 * over hostnames misses too much: URL.hostname keeps the brackets on IPv6 so
 * /::1$/ never matches "[::1]", a trailing dot defeats an anchored "localhost$",
 * and IPv4-mapped IPv6 smuggles a v4 address through v6 syntax.
 */
export function isBlockedHost(rawHost) {
  let host = rawHost.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);

  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) reduces to the embedded v4 address.
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) host = mapped[1];

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (v4.slice(1).some((n) => Number(n) > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;            // this/private/loopback
    if (a === 169 && b === 254) return true;                       // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;              // private
    if (a === 192 && b === 168) return true;                       // private
    if (a === 100 && b >= 64 && b <= 127) return true;             // CGNAT
    if (a === 192 && b === 0) return true;                         // protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true;          // benchmarking
    if (a >= 224) return true;                                     // multicast + reserved
    return false;
  }

  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;              // unspecified/loopback
    if (/^f[cd]/.test(host)) return true;                          // fc00::/7 unique local
    if (/^fe[89ab]/.test(host)) return true;                       // fe80::/10 link-local
    return false;
  }

  // A bare label with no dot is not a public domain (also catches decimal and
  // hex integer IP forms like 2130706433 and 0x7f000001).
  if (!host.includes('.')) return true;
  return false;
}

export function normaliseUrl(raw) {
  if (!raw) throw new Error('Provide a url parameter.');
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('That does not look like a valid web address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https addresses can be scanned.');
  }
  // Refuse loopback and private ranges so the scanner cannot be pointed inward.
  if (isBlockedHost(parsed.hostname)) {
    throw new Error('That address is not a public website, so it cannot be checked.');
  }
  // A pasted fragment is never sent to the server; drop it so the reported
  // URL matches what was actually fetched.
  parsed.hash = '';
  return parsed;
}

/** Collects findings, capping stored examples so a bad page cannot balloon the response. */
function createReport() {
  const found = new Map();
  return {
    add(ruleId, example) {
      let entry = found.get(ruleId);
      if (!entry) {
        entry = { count: 0, examples: [] };
        found.set(ruleId, entry);
      }
      entry.count += 1;
      if (example && entry.examples.length < MAX_EXAMPLES) {
        entry.examples.push(example.length > 160 ? example.slice(0, 157) + '...' : example);
      }
    },
    finalise() {
      const issues = [];
      for (const [ruleId, entry] of found) {
        const rule = RULES[ruleId];
        if (!rule) continue;
        issues.push({
          id: ruleId,
          title: rule.title,
          impact: rule.impact,
          count: entry.count,
          examples: entry.examples,
          wcag: rule.wcag,
          wcagLevel: rule.level,
          en301549: `9.${rule.wcag}`,
          remedy: REMEDY[ruleId],
        });
      }
      const order = { serious: 0, moderate: 1, minor: 2 };
      issues.sort((a, b) => order[a.impact] - order[b.impact] || b.count - a.count);
      return issues;
    },
  };
}

function describeElement(tag, attrs) {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== '')
    .slice(0, 3)
    .map(([k, v]) => `${k}="${v}"`);
  return `<${tag}${parts.length ? ' ' + parts.join(' ') : ''}>`;
}

// Identify honestly. Measured against browser-spoofing UAs on 7 sites: spoofing
// recovered nothing and actively lost w3.org (200 -> 403), which rejects requests
// claiming to be Chrome while fingerprinting otherwise. Sites that block us
// (403/429) do so on IP and TLS fingerprint, which no header can change.
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; wcagcheck.eu/1.0; +https://wcagcheck.eu)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9,ro;q=0.8,de;q=0.7',
};

/**
 * Fetches a URL, following redirects one hop at a time and re-checking the host
 * at every hop.
 *
 * Letting the runtime follow redirects would mean only the first URL is ever
 * validated: a public address is free to redirect to loopback or a link-local
 * metadata address afterwards, and the request that actually goes out is not the
 * one that was checked.
 */
export async function fetchFollowingSafely(startUrl, signal) {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current.toString(), {
      redirect: 'manual',
      signal,
      headers: FETCH_HEADERS,
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');
    if (!isRedirect || !location) return { response, finalUrl: current };

    let next;
    try {
      next = new URL(location, current);
    } catch {
      throw new Error('The site redirected to an address that could not be understood.');
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new Error('The site redirected to a non-web address, which cannot be followed.');
    }
    if (isBlockedHost(next.hostname)) {
      throw new Error('The site redirected to a private address, which cannot be checked.');
    }
    next.hash = '';
    current = next;
  }
  throw new Error(`The site redirected more than ${MAX_REDIRECTS} times. Give the final address directly.`);
}

async function scan(parsedUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  let finalUrl;
  try {
    ({ response, finalUrl } = await fetchFollowingSafely(parsedUrl, controller.signal));
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(
        'The site took longer than 20 seconds to respond. Try again, or try a lighter page on the same site.'
      );
    }
    // Our own redirect diagnostics are already user-facing; keep them.
    if (/redirect/i.test(err.message)) throw err;
    throw new Error('Could not reach that address. Check the spelling and that the site is public.');
  }
  clearTimeout(timer);

  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      throw new Error(
        'The site refuses automated requests, so it cannot be checked from here. ' +
          'Sites behind strict bot protection need an audit run from a real browser on your own machine.'
      );
    }
    if (response.status === 429) {
      throw new Error('The site is rate-limiting requests right now. Wait a minute and try again.');
    }
    if (response.status === 404) {
      throw new Error('That page does not exist (404). Check the path after the domain name.');
    }
    // 511 and 520-527 are gateway-level rejections, not the origin failing.
    // Reporting them as "the site is broken" sends people to debug the wrong
    // thing — emag.ro returns 511 to us while serving browsers normally.
    if (response.status === 511 || (response.status >= 520 && response.status <= 527)) {
      throw new Error(
        `The site is blocking automated requests at its gateway (HTTP ${response.status}). ` +
          'It loads normally in a browser, so this is not a fault on the site.'
      );
    }
    if (response.status >= 500) {
      throw new Error(`The site itself is erroring (HTTP ${response.status}). Nothing to check yet.`);
    }
    throw new Error(`The site returned HTTP ${response.status}. Nothing to check.`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('html')) {
    throw new Error(`That address returned ${contentType.split(';')[0] || 'a non-HTML file'}. Point it at a web page.`);
  }

  const report = createReport();

  // Document-level state, filled during the single streaming pass.
  const state = {
    hasTitle: false,
    titleText: '',
    inPageTitle: false,
    hasLang: false,
    hasMain: false,
    h1Count: 0,
    lastHeadingLevel: 0,
    seenIds: new Set(),
    // Stack of elements whose accessible name we are accumulating text for.
    nameStack: [],
    labelledInputs: new Set(),
    pendingControls: [],
    tableStack: [],
  };

  /** Pushes an element we need the inner text of, and evaluates it on close. */
  function trackName(el, tag, attrs, evaluate) {
    const frame = { tag, attrs, text: '', hasLabelledChild: false };
    state.nameStack.push(frame);
    el.onEndTag(() => {
      const popped = state.nameStack.pop();
      if (popped) evaluate(popped);
    });
  }

  function accessibleName(frame) {
    return (
      frame.attrs['aria-label'] ||
      frame.attrs['aria-labelledby'] ||
      frame.attrs['title'] ||
      frame.text.trim() ||
      (frame.hasLabelledChild ? 'image' : '')
    );
  }

  const rewriter = new HTMLRewriter()
    .on('*', {
      // A link or button gets its accessible name from everything inside it, so
      // a descendant carrying aria-label/title/alt (typically an svg icon) names
      // the ancestor. Without this, icon-only controls read as unnamed.
      element(el) {
        const top = state.nameStack[state.nameStack.length - 1];
        if (!top) return;
        const tag = el.tagName.toLowerCase();
        if (tag === 'a' || tag === 'button') return;
        if (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt')) {
          top.hasLabelledChild = true;
        }
      },
      // Text is accumulated for whatever we are currently naming. Matching on
      // '*' rather than the control itself is what picks up nested markup such
      // as <button><span>Menu</span></button>.
      text(chunk) {
        if (state.inPageTitle) state.titleText += chunk.text;
        const top = state.nameStack[state.nameStack.length - 1];
        if (top && chunk.text) top.text += chunk.text;
      },
    })
    .on('html', {
      element(el) {
        const lang = el.getAttribute('lang');
        state.hasLang = Boolean(lang && lang.trim());
      },
    })
    // Scoped to head: an inline <svg><title> is a label, not the page title.
    .on('head > title', {
      element(el) {
        state.hasTitle = true;
        state.inPageTitle = true;
        el.onEndTag(() => {
          state.inPageTitle = false;
        });
      },
    })
    .on('meta[name="viewport"]', {
      element(el) {
        const content = (el.getAttribute('content') || '').toLowerCase();
        const noScale = /user-scalable\s*=\s*(no|0)/.test(content);
        const maxScale = content.match(/maximum-scale\s*=\s*([\d.]+)/);
        if (noScale || (maxScale && parseFloat(maxScale[1]) < 2)) {
          report.add('viewport-blocks-zoom', `<meta name="viewport" content="${content}">`);
        }
      },
    })
    .on('img', {
      element(el) {
        const alt = el.getAttribute('alt');
        const src = el.getAttribute('src') || '';
        const role = (el.getAttribute('role') || '').toLowerCase();
        const hidden = el.getAttribute('aria-hidden') === 'true';

        if (alt === null && !hidden && role !== 'presentation' && role !== 'none') {
          report.add('img-missing-alt', describeElement('img', { src }));
        } else if (alt && FILENAME_ALT.test(alt.trim())) {
          report.add('img-alt-is-filename', describeElement('img', { alt, src }));
        }
        // An image with real alt text can supply a parent link's name.
        const top = state.nameStack[state.nameStack.length - 1];
        if (top && alt && alt.trim()) top.hasLabelledChild = true;
      },
    })
    .on('input[type="image"]', {
      element(el) {
        const alt = el.getAttribute('alt');
        if (!alt || !alt.trim()) {
          report.add('input-image-no-alt', describeElement('input', { type: 'image', src: el.getAttribute('src') || '' }));
        }
      },
    })
    .on('area', {
      element(el) {
        const alt = el.getAttribute('alt');
        if (!alt || !alt.trim()) {
          report.add('area-missing-alt', describeElement('area', { href: el.getAttribute('href') || '' }));
        }
      },
    })
    .on('a', {
      element(el) {
        const attrs = {
          href: el.getAttribute('href'),
          'aria-label': el.getAttribute('aria-label'),
          'aria-labelledby': el.getAttribute('aria-labelledby'),
          title: el.getAttribute('title'),
        };
        // Anchors used purely as targets are not links; skip them.
        if (attrs.href === null) return;
        trackName(el, 'a', attrs, (frame) => {
          const name = accessibleName(frame);
          if (!name) {
            report.add('link-no-name', describeElement('a', { href: frame.attrs.href || '' }));
          } else if (VAGUE_LINK_TEXT.has(name.trim().toLowerCase().replace(/[.>→\s]+$/, ''))) {
            report.add('link-vague-text', `<a href="${frame.attrs.href || ''}">${name.trim()}</a>`);
          }
        });
      },
    })
    .on('button', {
      element(el) {
        const attrs = {
          type: el.getAttribute('type'),
          'aria-label': el.getAttribute('aria-label'),
          'aria-labelledby': el.getAttribute('aria-labelledby'),
          title: el.getAttribute('title'),
        };
        trackName(el, 'button', attrs, (frame) => {
          if (!accessibleName(frame)) {
            report.add('button-no-name', describeElement('button', { type: frame.attrs.type || '' }));
          }
        });
      },
    })
    .on('label', {
      element(el) {
        const target = el.getAttribute('for');
        if (target) state.labelledInputs.add(target);
      },
    })
    .on('input, select, textarea', {
      element(el) {
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return;
        if (el.getAttribute('aria-hidden') === 'true') return;

        const hasDirectLabel =
          el.getAttribute('aria-label') ||
          el.getAttribute('aria-labelledby') ||
          el.getAttribute('title');
        if (hasDirectLabel) return;

        // <label for> may appear after the control, so resolve these at the end.
        state.pendingControls.push({
          id: el.getAttribute('id'),
          describe: describeElement(el.tagName.toLowerCase(), {
            type: type || null,
            name: el.getAttribute('name'),
          }),
        });
      },
    })
    .on('iframe', {
      element(el) {
        const title = el.getAttribute('title');
        const hidden = el.getAttribute('aria-hidden') === 'true';
        if (!hidden && (!title || !title.trim())) {
          report.add('iframe-no-title', describeElement('iframe', { src: el.getAttribute('src') || '' }));
        }
      },
    })
    .on('[id]', {
      element(el) {
        const id = el.getAttribute('id');
        if (!id) return;
        if (state.seenIds.has(id)) {
          report.add('duplicate-id', `id="${id}"`);
        } else {
          state.seenIds.add(id);
        }
      },
    })
    .on('[tabindex]', {
      element(el) {
        const value = parseInt(el.getAttribute('tabindex'), 10);
        if (Number.isFinite(value) && value > 0) {
          report.add('positive-tabindex', describeElement(el.tagName.toLowerCase(), { tabindex: String(value) }));
        }
      },
    })
    .on('main, [role="main"]', {
      element() {
        state.hasMain = true;
      },
    })
    .on('h1, h2, h3, h4, h5, h6', {
      element(el) {
        const level = parseInt(el.tagName.slice(1), 10);
        if (level === 1) state.h1Count += 1;
        if (state.lastHeadingLevel && level > state.lastHeadingLevel + 1) {
          report.add('heading-skip', `h${state.lastHeadingLevel} followed by h${level}`);
        }
        state.lastHeadingLevel = level;
      },
    })
    .on('video, audio', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (el.hasAttribute('autoplay')) {
          report.add('media-autoplay', describeElement(tag, { src: el.getAttribute('src') || '' }));
        }
        state.tableStack.push({ media: tag, hasTrack: false });
        el.onEndTag(() => {
          const frame = state.tableStack.pop();
          if (frame && !frame.hasTrack) {
            report.add('media-no-captions', `<${frame.media}> with no <track kind="captions">`);
          }
        });
      },
    })
    .on('track', {
      element(el) {
        const kind = (el.getAttribute('kind') || '').toLowerCase();
        const frame = state.tableStack[state.tableStack.length - 1];
        if (frame && (kind === 'captions' || kind === 'subtitles')) frame.hasTrack = true;
      },
    })
    .on('table', {
      element(el) {
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') return;
        const frame = { rows: 0, hasHeader: false };
        state.tableStack.push(frame);
        el.onEndTag(() => {
          const popped = state.tableStack.pop();
          // Single-row tables are usually layout, not data. Don't cry wolf.
          if (popped && !popped.hasHeader && popped.rows > 1) {
            report.add('table-no-header', `<table> with ${popped.rows} rows and no <th>`);
          }
        });
      },
    })
    .on('th', {
      element() {
        for (let i = state.tableStack.length - 1; i >= 0; i--) {
          if ('hasHeader' in state.tableStack[i]) {
            state.tableStack[i].hasHeader = true;
            break;
          }
        }
      },
    })
    .on('tr', {
      element() {
        for (let i = state.tableStack.length - 1; i >= 0; i--) {
          if ('rows' in state.tableStack[i]) {
            state.tableStack[i].rows += 1;
            break;
          }
        }
      },
    });

  // Consume the stream so the handlers actually run, with a size ceiling.
  const transformed = rewriter.transform(response);
  const reader = transformed.body.getReader();
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }

  // Document-level conclusions, only valid once the whole pass is done.
  state.titleText = state.titleText.trim();
  if (!state.hasTitle || !state.titleText) report.add('missing-title', null);
  if (!state.hasLang) report.add('html-missing-lang', '<html> without a lang attribute');
  if (!state.hasMain) report.add('no-main-landmark', null);
  if (state.h1Count === 0) report.add('no-h1', null);
  for (const control of state.pendingControls) {
    if (!control.id || !state.labelledInputs.has(control.id)) {
      report.add('control-no-label', control.describe);
    }
  }

  const issues = report.finalise();
  const counts = { serious: 0, moderate: 0, minor: 0 };
  for (const issue of issues) counts[issue.impact] += issue.count;

  return {
    url: finalUrl.toString(),
    scannedAt: new Date().toISOString(),
    pageTitle: state.titleText || null,
    bytesScanned: bytes,
    truncated,
    summary: {
      issueTypes: issues.length,
      totalOccurrences: counts.serious + counts.moderate + counts.minor,
      serious: counts.serious,
      moderate: counts.moderate,
      minor: counts.minor,
      checksRun: Object.keys(RULES).length,
    },
    issues,
    scope: {
      standard: 'WCAG 2.2 A/AA criteria detectable in static HTML',
      mappedTo: 'EN 301 549 clause 9 (the standard referenced by the European Accessibility Act)',
      notCovered: [
        'Colour contrast (needs rendered styles)',
        'Keyboard traps and focus order (needs a real browser)',
        'Content injected by JavaScript',
        'Video audio-description quality',
      ],
    },
  };
}

export async function handleScan(request) {
  const target = new URL(request.url).searchParams.get('url');
  const json = (body, status) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
      },
    });

  let parsed;
  try {
    parsed = normaliseUrl(target);
  } catch (err) {
    return json({ error: err.message }, 400);
  }

  try {
    return json(await scan(parsed), 200);
  } catch (err) {
    return json({ error: err.message, url: parsed.toString() }, 502);
  }
}
