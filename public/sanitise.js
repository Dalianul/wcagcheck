/**
 * Prepares third-party HTML for rendering inside our own origin.
 *
 * We render scanned pages in an open shadow root so axe can traverse them,
 * which means the browser gives us no isolation — sanitisation is the only
 * barrier, not a second layer.
 *
 * The threat model is deliberately narrow: the HTML is inserted once via
 * innerHTML, no script ever executes (innerHTML does not run <script>), no link
 * is activated, and the subtree is removed immediately. What remains is content
 * that acts on its own — event-handler attributes and auto-loading embeds. So
 * every attribute matching /^on/i is removed, by pattern rather than by a list
 * of known handler names, which is what makes the removal complete for that
 * class rather than a guess at today's vocabulary.
 *
 * Style elements and accessibility attributes are preserved deliberately:
 * stripping them would silently change the very results we are measuring.
 */

const VOID_OR_PAIRED_REMOVED = ['script', 'iframe', 'object', 'embed', 'noscript', 'template'];

function stripElement(html, tag) {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
  const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
  return html.replace(paired, '').replace(selfClosing, '');
}

/**
 * Rewrites a srcset list, which is comma-separated candidates each optionally
 * followed by a descriptor: "a.png 1x, b.png 2x".
 *
 * Passing the whole list to absolutise() percent-encoded the spaces and commas
 * into a single bogus URL, so responsive images silently stopped resolving.
 */
function absolutiseSrcset(value, baseUrl) {
  return value
    .split(',')
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return '';
      const [url, ...descriptors] = trimmed.split(/\s+/);
      return [absolutise(url, baseUrl), ...descriptors].join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

/** Rewrites a relative URL against the scanned page's address. */
function absolutise(value, baseUrl) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^(https?:|data:|mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

export function sanitiseForAnalysis(html, baseUrl) {
  let out = String(html);

  for (const tag of VOID_OR_PAIRED_REMOVED) out = stripElement(out, tag);

  // Anything that navigates or reloads on its own.
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');

  // Every event-handler attribute, quoted or bare, any case.
  //
  // The separator class is [\s/]+ and not \s+ because HTML accepts a solidus
  // between attributes: after a quoted value, and directly after the tag name,
  // `/` is a separator rather than part of the value. Requiring whitespace let
  // <img src="x.png"/onerror="..."> through, and it fired — verified in Chrome,
  // four variants of it. Unquoted values are unaffected either way, since there
  // `/` is a legitimate value character and no second attribute is parsed.
  out = out.replace(/[\s/]+on[a-z0-9_-]*\s*=\s*"[^"]*"/gi, ' ');
  out = out.replace(/[\s/]+on[a-z0-9_-]*\s*=\s*'[^']*'/gi, ' ');
  out = out.replace(/[\s/]+on[a-z0-9_-]*\s*=\s*[^\s>]+/gi, ' ');

  // Script-bearing URLs, keeping the element so axe still evaluates it.
  out = out.replace(
    /\s(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi,
    ' $1="#"'
  );

  // Shadow DOM ignores <base>, so URLs must already be absolute.
  const rewrite = (attr, value) =>
    attr.toLowerCase() === 'srcset' ? absolutiseSrcset(value, baseUrl) : absolutise(value, baseUrl);

  out = out.replace(
    /\s(href|src|srcset|poster)\s*=\s*"([^"]*)"/gi,
    (_match, attr, value) => ` ${attr}="${rewrite(attr, value)}"`
  );
  out = out.replace(
    /\s(href|src|srcset|poster)\s*=\s*'([^']*)'/gi,
    (_match, attr, value) => ` ${attr}='${rewrite(attr, value)}'`
  );

  return out;
}
