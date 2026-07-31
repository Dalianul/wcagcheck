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

Deliberately boring, so it runs free and never breaks:

- **Static HTML/CSS/JS** in `public/` — no framework, no build step
- **One Cloudflare Pages Function** in `functions/api/scan.js`
- **`HTMLRewriter`** for parsing — native to the Workers runtime, streaming and
  Rust-backed, so a scan stays inside the free tier's CPU budget
- **Zero npm dependencies**

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

### Deliberately out of scope

Static analysis cannot see rendered styles or run scripts, so colour contrast,
focus order, keyboard traps and JS-injected content are not covered. The UI says
so on the page rather than implying a complete audit.

## Local development

```sh
npx wrangler pages dev public          # serves public/ + functions/
curl 'http://localhost:8788/api/scan?url=example.com' | jq
```

## Deploy

Cloudflare Pages, connected to this repo. Every push to `main` deploys.

- Build command: **none**
- Build output directory: **`public`**
- Functions are picked up automatically from `functions/`

## Notes

- `research/` holds the Google Keyword Planner exports (13,262 keywords) behind the
  decision to build this. Kept for reference, not used at runtime.
- Nothing about a scanned site is stored. Reports are generated per request.
