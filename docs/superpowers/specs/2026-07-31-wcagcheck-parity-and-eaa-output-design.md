# wcagcheck.eu — detection parity and EAA-shaped output

**Date:** 2026-07-31
**Status:** approved, not yet implemented

## Why

The tool is live with 20 static HTML checks and scores 100 on Lighthouse, but it is
detectably thinner than the field: WAVE runs 200+ checks, axe-core about 100, and
it cannot judge colour contrast at all — the most common real-world failure. The
EN 301 549 clause-mapping angle it was built on is already occupied by inclly,
accessi.org and tabnav.

Two things have to be true for "better than the competition" to be honest:
detection has to reach parity, and the output has to do something nobody else
does. This design does both, at €0.

It is also the last substantial work planned on this project. After it ships, the
project is left alone to accumulate search traffic while attention moves to the
next shot.

## Non-goals

Stated plainly so they aren't quietly attempted later:

- **Ranking first page.** WebAIM has twenty years of domain authority. Technical
  SEO can be flawless and this still takes 6–18 months, or never. No plan here
  promises a ranking.
- **Executing JavaScript on scanned pages.** Deliberately out of scope; see the
  security decision below.
- **Fixing the egress-block problem.** 42% of large sites reject Cloudflare Worker
  IPs (403/429/511). Solving it needs paid Browser Rendering or a different
  egress, which is not justified on this project.
- **Multi-page crawling.** Single page only.
- **Monetisation.** Nothing is sold. No accounts, no payments.

## Architecture

### Detection moves to the visitor's browser

```
URL submitted
      │
      ▼
Worker  GET /api/fetch?url=…        ← existing SSRF guard, unchanged
      │  returns { html, finalUrl, contentType }
      ▼
Client constructs a same-origin frame
      │  <iframe sandbox="allow-same-origin" srcdoc="…">
      │  <base href="{finalUrl}"> injected so CSS and images resolve
      │  height set from contentDocument.documentElement.scrollHeight,
      │  read from the parent after load — same-origin makes this
      │  possible without scripts inside the frame
      ▼
Client lazy-loads /vendor/axe.min.js       ← only on first scan, then cached
      │
      ▼
axe.run(frame.contentDocument, { runOnly: [wcag2a, wcag2aa, wcag21a,
                                           wcag21aa, wcag22aa] })
      │
      ▼
Derive EN 301 549 clause from each rule's WCAG tag
      │
      ▼
Render: conformance table · findings ledger · statement draft
```

The scan compute runs on the visitor's machine, so this stays inside the
Cloudflare free tier with no server-side browser. It also uses the same engine as
axe DevTools and most CI pipelines, so results are comparable to what a developer
would get locally rather than being a homegrown approximation.

### Security decision: no `allow-scripts`

The frame is sandboxed with `allow-same-origin` and **not** `allow-scripts`.
Those two together permit sandboxed content to remove its own sandbox, which
would be a cross-site scripting hole on wcagcheck.eu — we would be executing
arbitrary third-party JavaScript in our own origin.

The cost is that JavaScript-rendered content stays invisible. That is the correct
trade and it will be stated in the UI, not hidden.

### The mapping is derived, not hand-maintained

axe-core tags every rule with its WCAG success criterion, e.g. `wcag111`,
`wcag412`, `wcag1410`. Parsing `^wcag(\d)(\d)(\d+)$` yields `1.1.1`, `4.1.2`,
`1.4.10`, and the EN 301 549 clause is that number prefixed with `9.` — because
clause 9 numbers its web requirements to match WCAG. Conformance level comes from
the `wcag2a` / `wcag2aa` / `wcag21aa` / `wcag22aa` tags.

So there is no mapping table to drift out of date. Two consequences worth
designing for:

- Rules tagged only `best-practice`, with no `wcagNNN` tag, are **not** EN 301 549
  requirements. They get reported in a separate section labelled as best practice
  rather than inflating the compliance count. Competitors blur this; we won't.
- A test asserts every rule axe returns either resolves to a well-formed clause or
  is explicitly classified as best-practice. A new axe version adding an untagged
  rule fails the suite rather than silently mis-reporting.

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/scan.js` | Existing 20 static rules. Becomes the JSON API and the no-JavaScript fallback. Unchanged behaviour. | HTMLRewriter |
| `src/fetch-html.js` | Returns raw HTML plus the final URL for client-side analysis. Reuses `isBlockedHost` and the manual redirect follower. | — |
| `public/axe-runner.js` | Builds the frame, loads axe, runs it, returns normalised findings. Knows nothing about rendering. | axe-core |
| `public/en301549.js` | Tag → clause/level derivation, and the clause 9 requirement inventory. Pure functions. | — |
| `public/statement.js` | Builds the draft accessibility statement from a conformance result. Pure. | — |
| `public/report.js` | Renders conformance table, findings, statement. Knows nothing about scanning. | the three above |

Each is independently testable and none reaches into another's internals.

## Output: what nobody else produces

### 1. EN 301 549 clause 9 conformance table

Every clause 9 web requirement is listed — not only the ones that failed — with
one of:

Derived from axe's four result buckets (`violations`, `passes`, `incomplete`,
`inapplicable`) for the rules carrying that clause's tag:

- **Does not support** — every relevant rule is in `violations` with no passes
- **Partially supports** — the clause has both `violations` and `passes`, or any
  `incomplete` results alongside passes
- **Supports** — only `passes`, nothing in `violations` or `incomplete`
- **Not applicable** — only `inapplicable`; no relevant content on the page
- **Not tested — requires human review** — no axe rule carries this clause's tag
  at all, so automation never examined it

That last row is the differentiator. Roughly two thirds of WCAG criteria cannot be
judged by any automated tool, and every free scanner quietly omits them, which
lets a clean scan read as compliance. Showing the full inventory with honest
"cannot decide" markers is more useful *and* more truthful than a score, and it is
the format a VPAT or a regulator actually expects.

### 2. Draft accessibility statement

The EAA requires publishing an accessibility statement. No free scanner generates
one. Pre-filled from the scan:

- conformance status (fully / partially / non-conformant)
- the list of known non-accessible content, derived from violations
- the assessment date and method ("automated scan, DD Month YYYY")
- placeholders the operator must complete: feedback contact, enforcement body
- an explicit note that the automated portion covers only part of the
  requirements

Copy-to-clipboard. Clearly labelled a draft requiring human completion — it must
not imply legal sufficiency.

### 3. Printable report

A print stylesheet so the browser's Save-as-PDF produces a clean document.
No server-side PDF generation.

## SEO

The homepage alone will never rank. What can rank is long-tail criterion pages.

- **One static page per criterion checked** (~20), each carrying the WCAG number,
  the EN 301 549 clause, a plain-language explanation of who it affects, and
  failing and passing code examples. Linked from every matching finding.
- **German translations of the highest-value pages**, with `hreflang` pairs.
  German is the only measured market: `bfsg` at 5,000/mo with competition index
  26, `barrierefreie website` at 5,000/mo index 48.
- **JSON-LD**: `SoftwareApplication` on the homepage, `FAQPage` where there is a
  genuine Q&A.
- Sitemap regenerated to include every new page.

## Testing

Existing 60 tests stay. Added:

- **Clause derivation** — table-driven over the tag forms, including the
  three-digit case (`wcag1410` → `1.4.10`), and the best-practice classification.
- **axe integration** — fixture pages with known violations, asserting the
  expected rule IDs surface and resolve to the right clauses. Runs in workerd
  where possible; frame-dependent paths run in Chrome via the existing
  chrome-devtools setup.
- **Conformance table completeness** — every clause 9 requirement appears exactly
  once, and no clause is silently dropped.
- **Statement generation** — a partially-conformant result produces a statement
  containing the non-accessible content list and no unfilled placeholder markers.
- **Regression guard** — the "incomplete" contrast results must never be counted
  as passes.

Every new test is mutation-checked: reintroduce the bug, confirm the suite fails.
This is not optional — it is the step that caught a worthless SSRF test earlier in
this project.

## Risks

| Risk | Handling |
|---|---|
| Contrast reported as "incomplete" for off-viewport elements | Size the frame to content height; surface incomplete results explicitly rather than as passes |
| axe-core is ~600 KB | Lazy-load on first scan only; never on page load, so Lighthouse stays at 100 |
| Target CSS fails to load in the frame (CSP, hotlink protection) | Contrast degrades to "incomplete", which is reported honestly; other rules unaffected |
| Visitor's browser fetches the scanned site's assets | Disclosed in the UI |
| A new axe version changes rule tags | Completeness test fails loudly |
| MPL-2.0 obligations | Ship `axe.min.js` unmodified with its licence header intact; attribute and link to source |

## Sequencing

1. Client-side axe detection with clause derivation, replacing the rendered report
2. Conformance table and accessibility statement
3. Criterion content pages, German translations, JSON-LD, sitemap

Each step ships independently and leaves the site working.
