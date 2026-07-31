/**
 * Runs axe-core in the visitor's browser against a fetched page.
 *
 * The page renders in an OPEN SHADOW ROOT, not an iframe. axe cannot traverse
 * into a sandboxed frame — its cross-frame support requires axe running inside
 * the frame, which needs allow-scripts, which would let sandboxed content escape
 * into our origin. A shadow root is the only container axe can see into that also
 * keeps the target's CSS off our page.
 *
 * The stage is rendered VISIBLY during the scan because axe cannot judge colour
 * contrast otherwise: off-screen content is reported inapplicable and
 * near-transparent content comes back incomplete. Only what is genuinely on
 * screen yields a contrast verdict, which is why contrastScope says
 * 'visible-area' instead of implying whole-page coverage.
 */

import { classify, criterionFromTags } from './en301549.js';
import { sanitiseForAnalysis } from './sanitise.js';

// The version lives in the filename so the immutable cache header in
// public/_headers is a promise we can actually keep: a bump changes the URL
// rather than silently serving a year-old bundle to returning visitors.
const AXE_URL = '/vendor/axe-4.12.1.min.js';
const AXE_VERSION = 'axe-core 4.12.1';
const MAX_EXAMPLES = 5;
const STAGE_WIDTH = 1280;
const RENDER_SETTLE_MS = 350;

let axeLoading = null;

/** Loads axe once, on first scan. Never on page load — it is ~570 KB. */
function loadAxe() {
  if (window.axe) return Promise.resolve(window.axe);
  if (axeLoading) return axeLoading;
  axeLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = AXE_URL;
    script.onload = () => (window.axe ? resolve(window.axe) : reject(new Error('axe failed to initialise')));
    script.onerror = () => reject(new Error('Could not load the analysis engine.'));
    document.head.append(script);
  });
  return axeLoading;
}

/**
 * Builds the visible stage the scanned page renders into.
 *
 * Deliberately on screen and opaque: hiding it or fading it out silently
 * disables every contrast check.
 *
 * DO NOT ADD aria-hidden, hidden, inert, OR display:none TO THIS STAGE.
 *
 * It looks like decorative scaffolding that ought to be hidden from assistive
 * technology, and hiding it is silently catastrophic: axe only evaluates
 * elements that are in the accessibility tree, so aria-hidden="true" here took
 * dedeman.ro from 11 violations and 34 passes to 0 violations and 84
 * inapplicable. The tool reported a broken page as clean. Measured, not
 * theorised.
 *
 * The consequence we accept: for the second or so that a scan runs, the scanned
 * page's content is exposed to assistive technology on our own page. The results
 * region is an aria-live region and announces the scan, and the stage is removed
 * as soon as axe returns.
 *
 * It carries a banner because without one it is indistinguishable from having
 * navigated to the scanned site: the address bar says wcagcheck.eu and the
 * screen is somebody else's homepage. The banner is our own markup and sits
 * outside the element axe is given, so it is never part of the results.
 */
function buildStage(html, finalUrl) {
  // Render at the viewport's own width rather than a fixed 1280. Contrast is
  // only judged for what is genuinely inside the viewport, so on a phone a
  // 1280px stage measured the left quarter of a desktop layout and clipped the
  // rest off screen. Matching the viewport renders the layout the visitor's own
  // device would get, entirely visible, which is both more coverage and a more
  // relevant answer.
  const width = Math.min(STAGE_WIDTH, document.documentElement.clientWidth);

  const stage = document.createElement('div');
  stage.dataset.role = 'analysis-stage';
  stage.style.cssText =
    'position:fixed;top:0;left:0;z-index:9998;' +
    'width:100vw;height:100vh;overflow:hidden;' +
    'background:#fff;opacity:1;pointer-events:none;' +
    'display:flex;flex-direction:column;';

  const banner = document.createElement('p');
  banner.style.cssText =
    'flex:0 0 auto;margin:0;padding:0.625rem 1rem;background:#12203a;color:#fbfbf9;' +
    'font:600 0.8125rem/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
  let host_name = finalUrl;
  try { host_name = new URL(finalUrl).hostname; } catch { /* keep the raw value */ }
  banner.textContent = `Measuring colour contrast on ${host_name} — rendering it here, not visiting it`;

  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;flex:1 1 auto;overflow:hidden;`;

  stage.append(banner, host);
  document.body.append(stage);

  host.attachShadow({ mode: 'open' }).innerHTML = sanitiseForAnalysis(html, finalUrl);
  return { stage, host, width };
}

function toFinding(result) {
  const meta = classify(result.tags);
  return {
    id: result.id,
    help: result.help,
    helpUrl: result.helpUrl,
    impact: result.impact ?? null,
    wcag: meta.wcag,
    criterionName: meta.name,
    en301549: meta.en301549,
    // Set when the criterion is real but the standard in force has no clause
    // for it yet. See criteria.js.
    arrivesIn: meta.arrivesIn,
    level: meta.level,
    nodes: result.nodes.length,
    examples: result.nodes.slice(0, MAX_EXAMPLES).map((node) => {
      const snippet = node.html || '';
      return snippet.length > 200 ? `${snippet.slice(0, 197)}...` : snippet;
    }),
  };
}

export async function runAxeScan(target) {
  const response = await fetch(`/api/fetch?url=${encodeURIComponent(target)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'That page could not be fetched.');

  const axe = await loadAxe();
  const { stage, host, width } = buildStage(payload.html, payload.finalUrl);

  try {
    // Let the target's stylesheets settle, or contrast reads an unstyled page.
    await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));

    const results = await axe.run(host, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    });

    const violations = results.violations.map(toFinding);
    const contrastEvaluated = [...results.violations, ...results.passes, ...results.incomplete].some(
      (r) => r.id === 'color-contrast'
    );

    // Per-criterion tallies across all four buckets, which is what the
    // conformance table needs. The findings list only ever sees violations, so
    // passes and inapplicable would otherwise be thrown away — and those are
    // exactly what distinguishes "nothing failed" from "never examined".
    const byCriterion = {};
    const tallyBucket = (bucket, list) => {
      for (const result of list) {
        const wcag = criterionFromTags(result.tags);
        if (!wcag) continue;
        byCriterion[wcag] ??= { violations: 0, passes: 0, incomplete: 0, inapplicable: 0 };
        byCriterion[wcag][bucket] += 1;
      }
    };
    tallyBucket('violations', results.violations);
    tallyBucket('passes', results.passes);
    tallyBucket('incomplete', results.incomplete);
    tallyBucket('inapplicable', results.inapplicable);

    return {
      finalUrl: payload.finalUrl,
      engine: AXE_VERSION,
      truncated: Boolean(payload.truncated),
      contrastScope: contrastEvaluated ? 'visible-area' : 'not-assessed',
      // The layout the page was measured at. A phone and a laptop see different
      // layouts of the same site, so a contrast result is only meaningful
      // alongside the width it was taken at.
      renderedWidth: width,
      byCriterion,
      requirements: violations.filter((f) => f.en301549),
      // A genuine WCAG 2.2 failure with no clause in the version in force is
      // neither of the other two things.
      notYetRequired: violations.filter((f) => !f.en301549 && f.arrivesIn),
      bestPractices: violations.filter((f) => !f.en301549 && !f.arrivesIn),
      // Never folded into passes: axe could not decide these.
      incomplete: results.incomplete.map(toFinding),
      counts: {
        violations: results.violations.length,
        incomplete: results.incomplete.length,
        passes: results.passes.length,
        inapplicable: results.inapplicable.length,
      },
    };
  } finally {
    stage.remove();
  }
}
