# wcagcheck.eu

Free accessibility check for EU websites. Runs two engines against a page and
reports each finding with its **EN 301 549 clause 9** reference — the standard the
European Accessibility Act actually points at.

## Why this framing

Lighthouse and WAVE already give you a score. Neither tells a shop owner in Cluj or
Rotterdam *which clause of European law* their site is failing. That translation is
the product.

## Stack

A Cloudflare Worker with static assets. Cloudflare's current guidance is to start
new projects on Workers rather than Pages, so this skips Pages entirely.

- **`public/`** — static site, no framework and no build step
- **`src/index.js`** — Worker entry. Assets are served first, so `fetch()` only
  sees paths with no matching file; that's how `/api/*` routes with no explicit
  route config
- **`src/scan.js`** — the static scanner. Uses **`HTMLRewriter`**, native to the
  Workers runtime, streaming and Rust-backed, so a scan stays inside the free
  tier's CPU budget
- **`src/fetch-html.js`** — returns a target page's raw HTML for client-side
  analysis. Reuses `normaliseUrl` and `fetchFollowingSafely` from `scan.js`, so it
  inherits the same host guard rather than becoming a softer path to the same
  place
- **`public/axe-runner.js`** — runs axe-core in the visitor's browser
- **`public/sanitise.js`** — prepares third-party HTML for rendering in our origin
- **`public/merge.js`** — decides what a scan found, given both engines' output.
  Pure, and unit-tested; rendering makes no decisions
- **Zero runtime dependencies.** `wrangler` and `axe-core` are dev dependencies;
  axe is vendored into `public/vendor/` as a static asset, never imported

## How a scan works

Both engines run as peers on every scan. Neither is a fallback.

```
URL submitted
   ├── GET /api/scan   → 20 static rules, server-side, streaming HTMLRewriter
   └── GET /api/fetch  → raw HTML → sanitise → open shadow root → axe-core
                                                        ↓
                              merge.js reconciles both, keyed on EN 301 549 clause
```

**Why both.** axe runs against a shadow root, which has no `<html>` or `<head>`, so
document-level rules cannot apply there — a page with no `lang` attribute produces
no `html-has-lang` finding. The static rules `missing-title`, `html-missing-lang`,
`no-h1` and `no-main-landmark` cover exactly that blind spot. While axe is running,
only those four are merged in; the other sixteen overlap with axe rules and would
report the same problem twice. If axe fails, all twenty are shown instead.

**Why a shadow root and not an iframe.** axe cannot traverse into a sandboxed
frame: its cross-frame support requires axe running *inside* the frame, which needs
`allow-scripts`, which would let sandboxed content escape into our origin. Measured
— passing `frame.contentDocument` throws, and the context forms axe does accept
find only `frame-title`.

**Why the analysis stage is visible.** axe only judges colour contrast for content
genuinely on screen. Off-screen content comes back `inapplicable`; near-transparent
content comes back `incomplete`. The stage must also stay in the accessibility tree
— `aria-hidden="true"` on it took dedeman.ro from 11 violations to 0 with 84 rules
inapplicable, reporting a broken page as clean.

## Checks

About 95 axe-core rules covering WCAG 2.2 A/AA plus best practices, and 20 static
rules. Findings that carry a WCAG success criterion are reported as EN 301 549
requirements; rules tagged only `best-practice` are reported separately rather than
inflating the compliance count. Results axe could not decide are their own
category and are never counted as passes.

The clause is derived from axe's own `wcagNNN` tags rather than a lookup table, so
there is nothing to fall out of date when axe adds rules.

The 20 static rules cover images, structure, forms, links and buttons, page
metadata, media, zoom, tables and frames. Accessible names are computed from
descendants, so an icon-only button labelled by a child `<svg aria-label>` is not a
false positive; the page-title check is scoped to `head > title` so inline
`<svg><title>` elements don't satisfy it.

### Deliberately out of scope

- **Content built by JavaScript.** Scripts are never executed. This is a security
  decision, not a limitation to fix — see the shadow-root note above
- **Colour contrast below the fold.** Only what fits on screen yields a verdict,
  which is why the result reports `contrastScope: 'visible-area'` rather than
  implying whole-page coverage
- **The roughly two thirds of WCAG criteria that need human judgement**

The UI states all of this rather than implying a complete audit.

## Fetch behaviour

The scanner identifies itself honestly:

```
Mozilla/5.0 (compatible; wcagcheck.eu/1.0; +https://wcagcheck.eu)
```

This was measured, not assumed. Browser-spoofing user-agents were tested against
seven sites: they recovered nothing and actively lost `w3.org` (200 → 403), which
rejects requests claiming to be Chrome while fingerprinting otherwise. Sites that
return 403/429 do so on IP and TLS fingerprint, which no header changes.

Expect roughly 60% of large retail sites to be scannable; the rest sit behind
Akamai-class bot protection. Small business sites — the actual audience — are far
less likely to. Note that `wrangler dev` proxies outbound fetches through the local
machine, so local success rates overstate production.

Requests to loopback, private ranges and non-HTTP schemes are refused, at every
redirect hop rather than only the first, so the scanner cannot be pointed at
internal infrastructure.

## Security

Rendering third-party HTML in our own origin means the browser gives us no
isolation. Two things stand in the way:

1. **`public/sanitise.js`** removes every attribute matching `/^on/i` by pattern
   rather than by a list of known handler names, along with script-bearing URLs and
   auto-loading embeds. `innerHTML` never executes `<script>`, but handler
   attributes fire unprompted
2. **`Content-Security-Policy` in `public/_headers`** sets `script-src 'self'` with
   no `'unsafe-inline'`, so a handler attribute that survived the sanitiser still
   cannot fire. Passive directives are deliberately wide, because the target's
   stylesheets and fonts must load or contrast is measured against an unstyled page

The second exists because the first failed once: `<img src="x"/onerror="…">`
survived and fired, since HTML accepts a solidus as an attribute separator and the
pattern required whitespace.

## Local development

```sh
npm install
npm run dev                                        # http://localhost:8787
npm test
curl 'http://localhost:8787/api/scan?url=example.com' | jq
```

Tests run inside workerd via `@cloudflare/vitest-pool-workers`, so `HTMLRewriter`
is the real thing rather than a shim.

## Deploy

Connected to Cloudflare Workers Builds. Every push to `main` deploys.

- Build command: **none**
- Deploy command: **`npx wrangler deploy`**
- Config lives in `wrangler.toml`; the assets binding serves `public/`

## Verification

- `w3.org/WAI` returns **0 issues** from the static scan — the correct result, and
  the control that caught two false-positive bugs during development
- Lighthouse: **100** on accessibility, best practices, SEO and agentic browsing,
  zero failed audits. A tool that grades accessibility should pass its own standard
- axe loads only on scan, never on page load — it is 572 KB, and loading it eagerly
  is the usual cause of that Lighthouse score dropping

## Notes

- `research/` holds the Google Keyword Planner exports (13,262 keywords) behind the
  decision to build this. Reference only, never served
- Nothing about a scanned site is stored. Reports are generated per request
- axe-core is MPL-2.0 and is shipped unmodified with its licence header intact,
  alongside `public/vendor/LICENSE-axe-core.txt`
