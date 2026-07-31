# wcagcheck.eu

Free accessibility check for EU websites. Scans a page's HTML against the WCAG 2.2
Level A/AA criteria that are detectable statically, and reports each finding with
its **EN 301 549 clause 9** reference — the standard the European Accessibility Act
actually points at.

## Why this framing

Lighthouse and WAVE already give you a score. Neither tells a shop owner in Cluj or
Rotterdam *which clause of European law* their site is failing. That translation is
the product.

## Stack

A Cloudflare Worker with static assets. Cloudflare's current guidance is to start
new projects on Workers rather than Pages, so this skips Pages entirely.

- **`public/`** — static site, no framework and no build step
- **`src/index.js`** — Worker entry. Assets are served first, so `fetch()` only
  sees paths with no matching file; that's how `/api/scan` routes with no explicit
  route config
- **`src/scan.js`** — the scanner. Uses **`HTMLRewriter`**, native to the Workers
  runtime, streaming and Rust-backed, so a scan stays inside the free tier's CPU
  budget
- **Zero runtime dependencies.** `wrangler` is a dev dependency only

## Checks

20 rules, each mapped to a WCAG success criterion and its EN 301 549 clause:

| Area | Rules |
|---|---|
| Images | missing alt, filename-as-alt, image buttons, image maps |
| Structure | no `h1`, skipped heading levels, no `main` landmark |
| Forms | unlabelled fields |
| Links & buttons | no accessible name, vague link text |
| Page | missing `title`, missing `lang`, duplicate `id`, positive `tabindex` |
| Media | missing captions, autoplay |
| Zoom | viewport blocking zoom |
| Tables | data table without header cells |
| Frames | `iframe` without title |

Accessible names are computed from descendants, so an icon-only button labelled by
a child `<svg aria-label>` is not a false positive. The page-title check is scoped
to `head > title` so inline `<svg><title>` elements don't satisfy it.

### Deliberately out of scope

Static analysis cannot see rendered styles or run scripts, so colour contrast,
focus order, keyboard traps and JS-injected content are not covered. The UI states
this rather than implying a complete audit.

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
less likely to.

Requests to loopback, private ranges and non-HTTP schemes are refused, so the
scanner cannot be pointed at internal infrastructure.

## Local development

```sh
npm install
npm run dev                                        # http://localhost:8787
curl 'http://localhost:8787/api/scan?url=example.com' | jq
```

## Deploy

Connected to Cloudflare Workers Builds. Every push to `main` deploys.

- Build command: **none**
- Deploy command: **`npx wrangler deploy`**
- Config lives in `wrangler.toml`; the assets binding serves `public/`

## Verification

- `w3.org/WAI` returns **0 issues** — the correct result, and the control that
  caught two false-positive bugs during development
- Lighthouse: **100** on accessibility, best practices, SEO and agentic browsing,
  zero failed audits. A tool that grades accessibility should pass its own standard

## Notes

- `research/` holds the Google Keyword Planner exports (13,262 keywords) behind the
  decision to build this. Reference only, never served
- Nothing about a scanned site is stored. Reports are generated per request
