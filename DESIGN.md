---
name: wcagcheck.eu
description: Free EN 301 549 / WCAG 2.2 accessibility checker; one hand-written stylesheet, ink on paper, colour reserved for severity.
colors:
  ink: "#12203a"
  ink-soft: "#4a5670"
  ink-hover: "#0a1628"
  paper: "#fbfbf9"
  paper-sunk: "#f2f2ee"
  rule: "#d5d8e0"
  rule-strong: "#b4b9c6"
  serious: "#a51b12"
  moderate: "#7a4e00"
  minor: "#4a5670"
  pass: "#14573a"
  print-ink: "#000000"
  print-paper: "#ffffff"
typography:
  body:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  hero-title:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "clamp(2.125rem, 6.5vw, 3.75rem)"
    fontWeight: 680
    lineHeight: 1.04
    letterSpacing: "-0.025em"
  page-title:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "clamp(1.875rem, 5vw, 3rem)"
    fontWeight: 680
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  lede:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "clamp(1.0625rem, 1.8vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.6
  section-heading:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "1.5rem"
    letterSpacing: "-0.02em"
  entry-title:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    letterSpacing: "-0.01em"
  prose-heading:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "1.375rem"
    letterSpacing: "-0.015em"
  card-heading:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "1rem"
  small:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "0.9375rem"
  lede-page:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "clamp(1.0625rem, 1.6vw, 1.1875rem)"
  caption:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
  field:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "clamp(0.9375rem, 2vw, 1.125rem)"
  button-label:
    fontFamily: "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "clamp(0.9375rem, 2vw, 1.0625rem)"
    fontWeight: 640
  label:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0.08em"
  meta:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    letterSpacing: "0.07em"
  figure:
    fontFamily: "ui-monospace, \"SF Mono\", SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "clamp(1.75rem, 4.5vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
spacing:
  gutter: "clamp(1.25rem, 4vw, 3rem)"
  measure: "68rem"
  prose-measure: "64ch"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "0 clamp(1.25rem, 3.5vw, 2.25rem)"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.paper}"
  skip-link:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "0.75rem 1rem"
  field-probe:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "clamp(1rem, 2.5vw, 1.5rem)"
  notice:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-soft}"
    padding: "1rem 1.25rem"
  sample-chip:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-soft}"
    padding: "0.375rem 0.625rem"
  scope-box:
    textColor: "{colors.ink-soft}"
    padding: "1.5rem"
---

# Design System: wcagcheck.eu

## Overview

Source of truth: `public/styles.css`, the one stylesheet that all seven pages link (`index.html`, `404.html`,
`accessibility-statement-eaa.html`, `automated-accessibility-testing.html`, `wcag-2-2-en-301-549.html`,
`de/bfsg.html`). This file mirrors it and loses any disagreement. There is no build step, no CSS framework and no
component library: pages are hand-written HTML with BEM-style class names (`block__element`,
`block--modifier`), and the results report is built at runtime by `public/app.js` using the same classes.

The stylesheet's own header comment states the palette rule: "diagnostic instrument, not a landing page.
Palette is deliberately narrow: ink on paper, with colour reserved for severity so it carries meaning rather than
decoration."

UI language is English; `de/bfsg.html` is German (`lang="de"`) with the same classes. Single light theme: the
stylesheet has no dark mode and no `color-scheme` or `prefers-color-scheme` rule.

`public/dev/fixture.html` is a test fixture for the scanner and is not part of this system.

## Colors

Everything is defined once as custom properties on `:root` in `public/styles.css` and consumed through `var(--...)`.
Hex values in the frontmatter are exactly those.

### Neutral
- **ink** (`--ink`, #12203a): body text, headings, the 2px field border, the 3px focus outline, the primary button
  and skip-link background, the sweep bead, the tally's top rule.
- **ink-soft** (`--ink-soft`, #4a5670): secondary text (ledes, eyebrows, meta lines, captions, footer), disabled
  button background.
- **paper** (`--paper`, #fbfbf9): page background; text on `ink` surfaces.
- **paper-sunk** (`--paper-sunk`, #f2f2ee): recessed fills: `.notice`, `.entry__samples li`, the `.sweep` track.
- **rule** (`--rule`, #d5d8e0): hairline dividers and container borders (`1px solid`).
- **rule-strong** (`--rule-strong`, #b4b9c6): heavier accents: the quoted-law and pending-note left borders, the
  probe focus halo, the input placeholder.

### Severity
Used only for meaning, never decoration (`public/styles.css` header comment).
- **serious** (`--serious`, #a51b12): requirement failures (`.entry--serious .entry__clause`), the `.notice` left
  border, "does not support" status, the serious tally figure.
- **moderate** (`--moderate`, #7a4e00): "could not be decided" results, partial support.
- **minor** (`--minor`, #4a5670): not-yet-required and best-practice findings. Same value as `ink-soft`, kept as its
  own token.
- **pass** (`--pass`, #14573a): "supports" status, the clear tally figure.

### One-off literal
- **ink-hover** (#0a1628): hover background of `.probe__go`, written as a literal at `public/styles.css:188`, not a
  token. Listed here so the hover state is recorded; do not reuse it elsewhere.

### Print
- **print-paper** (#ffffff) and **print-ink** (#000000): literals in `@media print` (`public/styles.css:676`, lines
  692 and 749) for the page background, text and the report-stamp rule. Print also hides screen chrome.

### Named Rules
**The Contrast-Checked Rule.** Each severity colour is contrast-checked against `--paper` "since a tool that grades
contrast has no business failing it" (comment at `public/styles.css:13`). Measured here against `--paper`: ink 15.7:1,
ink-soft and minor 7.1:1, serious 7.3:1, moderate 7.0:1, pass 8.3:1.

**The Words-Too Rule.** Colour is never the only carrier of a verdict: the conformance table's status column says it
in words as well (comment at `public/styles.css:461`).

## Typography

System font stacks only; no web fonts, no `@font-face`.

**Sans (`--sans`):** `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`: body and headings.
**Mono (`--mono`):** `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`: the instrument voice:
URL field, eyebrows, labels, clause numbers, counts, table headers, sample snippets, footer.

Body is 1.0625rem / 1.6 with `font-feature-settings: "tnum" 1` (tabular figures). Weights are non-standard variable
steps (680 titles, 660/650 entry and notice titles, 640 button and summary, 620 guide links); a system font that does
not support the axis renders the nearest step. Letter-spacing is negative on large sans (-0.025em titles) and
positive on uppercase mono (0.04em to 0.08em).

### Hierarchy
- **hero-title** (680, `clamp(2.125rem, 6.5vw, 3.75rem)`, 1.04): `.hero__title`, max 30ch, `text-wrap: balance`.
- **page-title** (680, `clamp(1.875rem, 5vw, 3rem)`, 1.08): `.page__title` on long-form pages, max 24ch.
- **lede** (`clamp(1.0625rem, 1.8vw, 1.25rem)` on `.hero__lede`), **lede-page**
  (`clamp(1.0625rem, 1.6vw, 1.1875rem)` on `.page__lede`), `ink-soft`, max 58ch.
- **section-heading** (`.explain h2`, 1.5rem, browser-default bold).
- **prose-heading** (1.375rem, -0.015em) is `.prose h2`; **card-heading** (1rem) is `.explain h3`.
- **entry-title** (650, 1.125rem): `.entry__title`, also the results heading.
- **small** (0.9375rem): `.conformance__table`, `.versions`, `.sources`, `.entry__pending`, `.page__caveat`.
- **caption** (mono 0.8125rem): `.tally__url`, `.entry__count`, `.conformance__level`.
- **field** (mono, `clamp(0.9375rem, 2vw, 1.125rem)`): `.probe__field`. **button-label** (640,
  `clamp(0.9375rem, 2vw, 1.0625rem)`): `.probe__go`.
- **label** (mono 0.75rem, 0.08em, uppercase): `.hero__eyebrow`, `.guides h3`, `.scope h2`, `.bar`.
- **meta** (mono 0.6875rem, 0.07 to 0.08em, uppercase): `.entry__meta`, `.tally__label`, table `thead th`.
- **figure** (mono 600, `clamp(1.75rem, 4.5vw, 2.5rem)`): `.tally__num`.
- Reading measure: `.prose` is capped at 64ch, remedies and pending notes at 62ch.

## Layout

One centred column: `.shell` is `max-width: var(--measure)` (68rem) with `padding-inline: var(--gutter)`
(`clamp(1.25rem, 4vw, 3rem)`). Every page uses the same skeleton: `.skip` link, `.bar` header, `main#main`, `.foot`.
Vertical rhythm is set per block with `clamp()` padding (for example `.hero`, `.page`, `.explain`) and rem margins
(0.5, 0.75, 1, 1.25, 1.5, 2, 2.5rem recur); there is no named spacing scale.

Grids: `.explain__grid` and `.guides ul` use `repeat(auto-fit, minmax(15rem | 18rem, 1fr))`. `.entry` is a two-column
grid (`7.5rem 1fr`, gap `0.5rem 2rem`). The only breakpoint is `max-width: 34rem`: `.probe` stacks the button under
the field and `.entry` becomes one column.

Wide data stays inside its own box: `.conformance__scroll` has `overflow-x: auto` so the table scrolls there rather
than pushing the page sideways (comment at `public/styles.css:420`). Long strings use `overflow-wrap: anywhere`
(`.tally__url`, `.entry__samples li`).

## Elevation & Depth

Flat. No drop shadows; depth is rules and recessed fills (`paper-sunk`). The single `box-shadow` is the focus halo
on the URL field (`.probe:focus-within`, `0 0 0 3px var(--rule-strong)`). Heavy rules (`2px solid var(--ink)`) mark
the primary containers: `.probe` border, `.tally` top edge.

## Shapes

Square. The stylesheet sets no `border-radius` anywhere. Borders are 1px `rule` for containers and table rows, 2px
`ink` for the field and tally, and a 2px to 4px left border as the marker on callouts (`.notice` 4px `serious`,
`.entry__pending` 2px `rule-strong`, `.prose blockquote` 3px `rule-strong`). The site icon (`public/favicon.svg`) has
a 4px corner on a 32px tile, which is the only rounded shape.

## Components

Class names as used in `public/index.html` and the markup built by `public/app.js`.

### Buttons
- `.probe__go` (the only button): `ink` fill, `paper` text, weight 640, no radius, horizontal padding
  `clamp(1.25rem, 3.5vw, 2.25rem)`, 2px `ink` left border (top border when stacked under 34rem).
- Hover: background `#0a1628` (literal, see Colors). Disabled while scanning: `ink-soft` fill, `cursor: progress`.
- `.skip`: same `ink` / `paper` pair, positioned off-screen at `left: -9999px` and moved to `left: 0` on focus.

### Inputs / Fields
- `.probe` wraps the URL field and the button in a two-column grid with a 2px `ink` border and `paper` background.
  `.probe__field` is borderless and transparent, mono, `clamp(0.9375rem, 2vw, 1.125rem)`, padding
  `clamp(1rem, 2.5vw, 1.5rem)`. Its label is `.hero__eyebrow` on a `<label>`.
- Focus: the field's own outline is removed and the 3px `rule-strong` halo is drawn on the wrapper
  (`.probe:focus-within`). Measured: `rule-strong` on `paper` is 1.9:1, so both this halo and the placeholder
  (`::placeholder`, `public/styles.css:166`) sit below the 4.5:1 / 3:1 thresholds that the Contrast-Checked Rule
  applies to the severity colours. This is current behaviour, recorded rather than endorsed.
- Scan progress: `.sweep` track (`paper-sunk`, 2px) with `.sweep__bead` (`ink`, 35% wide) animating `sweep 1.1s`;
  under `prefers-reduced-motion` it stops and becomes a static 40% opacity bar.

### Focus (global)
`:focus-visible` is `outline: 3px solid var(--ink); outline-offset: 2px`. `#results:focus` removes the outline on
purpose: the region is focused programmatically after a scan so keyboard users land on the findings, and it is not a
control (comment at `public/styles.css:52`).

### Notices
`.notice` with `.notice__title`: `paper-sunk` fill, 4px `serious` left border, padding `1rem 1.25rem`, body text
`ink-soft`. Rendered into `#message` (`role="alert"`).

### Ledger (results)
The signature element. `.tally` (2px `ink` top rule, 1px `rule` bottom) holds the subject and `.tally__figure`
counts, coloured by `--serious`, `--moderate`, `--minor`, `--pass` modifiers. Each finding is an `article.entry`
with `entry--serious | entry--moderate | entry--minor` colouring only the clause number (`.entry__clause`, mono, 600).
Inside: `.entry__head` (`.entry__title` + `.entry__count`), `.entry__meta`, optional `.entry__pending` (2px
`rule-strong` left border, set apart because "the distinction is the point, not a footnote"), and `.entry__samples`
(mono snippet chips on `paper-sunk`). Bottom border 1px `rule`, padding-block 1.75rem.

### Conformance table
`details.conformance` (1px `rule` border) with `.conformance__summary`, then `.conformance__scroll` >
`.conformance__table`. Cells padded `0.5rem 0.75rem` with a 1px `rule` top border; headers are meta style. Status text
colour is set by `.conformance__row--<status>` (see Words-Too Rule). Collapsed by default; opened for print by a
`beforeprint` handler in `public/app.js`.

### Scope disclosure
`.scope`: 1px `rule` border, padding 1.5rem, mono uppercase `h2`, `ink-soft` body.

### Navigation
`.bar` header: 1px `rule` bottom border, mono 0.75rem uppercase; `.bar__mark` is the bold `ink` wordmark (a link on
all pages except `index.html`), `.bar__standard` is `ink-soft`. `.guides` is a 1px-ruled list of internal links in an
auto-fit grid; `a` is `ink`, weight 620. Footer is `.foot` (1px `rule` top, mono 0.75rem, `ink-soft`, links `ink`).

### Long-form pages
`.page` > `.page__title`, `.page__lede`, `.prose` (64ch measure: "one measure for everything readable", comment at
`public/styles.css:590`), `.versions` data table (mono uppercase headers, 1px `rule` row tops), `.sources` list,
`.page__caveat` (top rule, 0.9375rem, `ink-soft`). Quoted legislation is a `blockquote` with a 3px `rule-strong` left
border.

### Utilities
`.visually-hidden` (clip-based) is used for spoken prefixes such as "EN 301 549 clause " before a clause number and
for table captions. `.print-only` is `display: none` on screen.

### Analysis stage (script-built)
`public/axe-runner.js` builds a temporary full-viewport overlay while a scan runs, styled with inline `cssText`
literals: white (`#fff`) stage, and a banner in `#12203a` on `#fbfbf9`, system-ui 600 0.8125rem. These repeat the
`ink` and `paper` values. `public/axe-runner.js:51` forbids `aria-hidden`, `hidden`, `inert` or `display:none` on the
stage because it silently disables contrast checks.

## Do's and Don'ts

### Do:
- **Do** use colour only to carry severity or verdict, and pair it with words (`public/styles.css` header comment and
  line 461).
- **Do** contrast-check any new severity colour against `--paper` before adding it (`public/styles.css:13`).
- **Do** keep wide tables scrolling inside their own box (`public/styles.css:420`).
- **Do** keep a screen-reader prefix on bare clause numbers (`public/app.js`, comment in `renderAxeEntry`).

### Don't:
- **Don't** add `aria-hidden`, `hidden`, `inert` or `display:none` to the analysis stage (`public/axe-runner.js:51`).
- **Don't** outline `#results` on focus; it is a programmatic focus target, not a control
  (`public/styles.css:52`).
