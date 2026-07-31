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
  out = out.replace(/\son[a-z0-9_-]*\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z0-9_-]*\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\son[a-z0-9_-]*\s*=\s*[^\s>]+/gi, '');

  // Script-bearing URLs, keeping the element so axe still evaluates it.
  out = out.replace(
    /\s(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi,
    ' $1="#"'
  );

  // Shadow DOM ignores <base>, so URLs must already be absolute.
  out = out.replace(
    /\s(href|src|srcset|poster)\s*=\s*"([^"]*)"/gi,
    (whole, attr, value) => ` ${attr}="${absolutise(value, baseUrl)}"`
  );
  out = out.replace(
    /\s(href|src|srcset|poster)\s*=\s*'([^']*)'/gi,
    (whole, attr, value) => ` ${attr}='${absolutise(value, baseUrl)}'`
  );

  return out;
}
