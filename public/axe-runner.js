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

import { classify } from './en301549.js';
import { sanitiseForAnalysis } from './sanitise.js';

const AXE_URL = '/vendor/axe.min.js';
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
 */
function buildStage(html, finalUrl) {
  const stage = document.createElement('div');
  stage.dataset.role = 'analysis-stage';
  stage.style.cssText =
    'position:fixed;top:0;left:0;z-index:9998;' +
    `width:min(${STAGE_WIDTH}px,100vw);height:100vh;overflow:hidden;` +
    'background:#fff;opacity:1;pointer-events:none;';

  const host = document.createElement('div');
  host.style.cssText = `width:${STAGE_WIDTH}px;`;
  stage.append(host);
  document.body.append(stage);

  host.attachShadow({ mode: 'open' }).innerHTML = sanitiseForAnalysis(html, finalUrl);
  return { stage, host };
}

function toFinding(result) {
  const meta = classify(result.tags);
  return {
    id: result.id,
    help: result.help,
    helpUrl: result.helpUrl,
    impact: result.impact ?? null,
    wcag: meta.wcag,
    en301549: meta.en301549,
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
  const { stage, host } = buildStage(payload.html, payload.finalUrl);

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

    return {
      finalUrl: payload.finalUrl,
      engine: AXE_VERSION,
      truncated: Boolean(payload.truncated),
      contrastScope: contrastEvaluated ? 'visible-area' : 'not-assessed',
      requirements: violations.filter((f) => f.en301549),
      bestPractices: violations.filter((f) => !f.en301549),
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
