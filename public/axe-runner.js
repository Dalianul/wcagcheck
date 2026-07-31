/**
 * Runs axe-core in the visitor's browser against a fetched page.
 *
 * The page HTML is injected into a same-origin frame rather than analysed as a
 * string, because axe needs a real DOM with layout — colour contrast in
 * particular reports "outsideViewport" for anything not laid out, so the frame
 * is sized to its content height before the run.
 *
 * The frame is sandboxed with allow-same-origin and deliberately NOT
 * allow-scripts. Those two together let sandboxed content remove its own
 * sandbox, which would execute arbitrary third-party JavaScript in our origin.
 * The cost is that script-rendered content is invisible to the scan.
 */

import { classify } from './en301549.js';

const AXE_URL = '/vendor/axe.min.js';
const AXE_VERSION = 'axe-core 4.12.1';
const MAX_EXAMPLES = 5;
const FRAME_MIN_HEIGHT = 800;
const FRAME_MAX_HEIGHT = 15000;
const FRAME_WIDTH = 1280;

let axeLoading = null;

/** Loads axe once, on first scan. Never on page load — it is ~600 KB. */
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

/** Injects <base> so relative stylesheet and image URLs resolve against the target. */
function withBase(html, finalUrl) {
  const base = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${base}</head>`);
  return `<head>${base}</head>${html}`;
}

function buildFrame(html, finalUrl) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'Analysis frame';
  // Rendered, but pushed out of sight. display:none would remove layout and
  // every contrast check would come back as incomplete.
  frame.style.cssText =
    `position:absolute;left:-10000px;top:0;width:${FRAME_WIDTH}px;` +
    `height:${FRAME_MIN_HEIGHT}px;border:0;visibility:visible;`;
  frame.srcdoc = withBase(html, finalUrl);
  document.body.append(frame);

  return new Promise((resolve, reject) => {
    // The frame is already in the DOM at this point, and the caller's
    // try/finally only starts once this promise resolves. So a frame that never
    // fires load has to clean up after itself here, or it is orphaned.
    const failed = setTimeout(() => {
      frame.remove();
      reject(new Error('The page took too long to render for analysis.'));
    }, 20000);
    frame.addEventListener('load', () => {
      clearTimeout(failed);
      resolve(frame);
    });
  });
}

/** Grows the frame to its content height so contrast checks are in-viewport. */
function fitToContent(frame) {
  try {
    const doc = frame.contentDocument;
    const height = Math.max(
      FRAME_MIN_HEIGHT,
      Math.min(FRAME_MAX_HEIGHT, doc.documentElement.scrollHeight || 0)
    );
    frame.style.height = `${height}px`;
  } catch {
    // Same-origin access should always work for srcdoc; if it doesn't, the
    // default height still yields useful non-contrast results.
  }
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
      const html = node.html || '';
      return html.length > 200 ? `${html.slice(0, 197)}...` : html;
    }),
  };
}

export async function runAxeScan(target) {
  const response = await fetch(`/api/fetch?url=${encodeURIComponent(target)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'That page could not be fetched.');

  const axe = await loadAxe();
  const frame = await buildFrame(payload.html, payload.finalUrl);
  fitToContent(frame);

  try {
    const results = await axe.run(frame.contentDocument, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      resultTypes: ['violations', 'incomplete'],
    });

    const violations = results.violations.map(toFinding);
    return {
      finalUrl: payload.finalUrl,
      engine: AXE_VERSION,
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
    frame.remove();
  }
}
