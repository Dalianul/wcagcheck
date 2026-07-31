/**
 * Decides what a scan actually found, from the two engines' raw output.
 *
 * Pure on purpose. This logic used to live inside the DOM-rendering function,
 * where nothing could test it — the suite runs in workerd, which has no DOM —
 * and it shipped three separate defects, each one a case where the page told a
 * visitor their site was fine when it was not. Keeping the judgement here and
 * the rendering in app.js means the judgement is testable.
 *
 * Rendering reads the result and draws it. It makes no decisions of its own.
 */

import { IN_FORCE, STANDARD_VERSIONS } from './criteria.js';
import { conformanceTable, summarise } from './conformance.js';

/** The four static rules axe cannot evaluate inside a shadow root. */
export const DOCUMENT_LEVEL_RULES = new Set([
  'missing-title', 'html-missing-lang', 'no-h1', 'no-main-landmark',
]);

/** Puts a static finding into the same shape as an axe one, so rendering has one case. */
function fromStatic(issue) {
  return {
    id: issue.id,
    help: issue.title,
    helpUrl: null,
    impact: issue.impact,
    wcag: issue.wcag,
    en301549: issue.en301549,
    level: issue.wcagLevel,
    nodes: issue.count,
    examples: issue.examples ?? [],
  };
}

export function mergeResults(axeResult, staticResult, requested) {
  const axeRan = Boolean(axeResult);

  // While axe is running, only the document-level rules are taken from the
  // static scan — the other sixteen overlap with axe rules and would report the
  // same problem twice under two names. When axe could not run there is nothing
  // to double-report against, so every static finding is shown instead of
  // throwing away sixteen rules' worth of real results.
  const staticFindings = (staticResult?.issues ?? []).filter(
    (i) => !axeRan || DOCUMENT_LEVEL_RULES.has(i.id)
  );

  // Two of the four document-level rules — no h1, no main landmark — are best
  // practice rather than requirements, and the static scan says which.
  const requirements = [
    ...staticFindings.filter((i) => !i.bestPractice).map(fromStatic),
    ...(axeResult?.requirements ?? []),
  ];
  // Real WCAG 2.2 failures that the version of EN 301 549 in force does not yet
  // contain. Counting them as requirement failures overstates the law; filing
  // them under best practice understates the finding.
  const notYetRequired = axeResult?.notYetRequired ?? [];
  const bestPractices = [
    ...staticFindings.filter((i) => i.bestPractice).map(fromStatic),
    ...(axeResult?.bestPractices ?? []),
  ];
  // Never folded into passes or requirements: axe could not decide these.
  const incomplete = axeResult?.incomplete ?? [];

  return {
    subject: staticResult?.pageTitle || axeResult?.finalUrl || requested,
    url: axeResult?.finalUrl || staticResult?.url || requested,
    requirements,
    notYetRequired,
    bestPractices,
    incomplete,
    figures: tally({ axeRan, requirements, notYetRequired, bestPractices, incomplete }),
    conformance: (() => {
      const rows = conformanceTable(axeResult, staticResult);
      return { rows, summary: summarise(rows) };
    })(),
    scope: {
      standard: axeRan
        ? `${axeResult.engine}, WCAG 2.2 A/AA plus best practices`
        : 'static HTML checks only',
      mappedTo:
        `EN 301 549 ${IN_FORCE} clause 9 — the version cited in the Official Journal, ` +
        `which restates WCAG ${STANDARD_VERSIONS[IN_FORCE].wcag}`,
      notCovered: notCovered(axeResult, staticResult),
    },
    truncated: Boolean(axeResult?.truncated || staticResult?.truncated),
  };
}

/**
 * The headline numbers.
 *
 * A clean zero is the single most damaging thing this tool can get wrong, so it
 * is stated only when both engines ran and there is genuinely nothing to
 * report — not merely nothing in the categories we happened to check. An axe
 * failure means roughly 95 checks never happened; best-practice findings mean
 * something was found.
 */
function tally({ axeRan, requirements, notYetRequired, bestPractices, incomplete }) {
  if (
    axeRan &&
    !requirements.length &&
    !notYetRequired.length &&
    !bestPractices.length &&
    !incomplete.length
  ) {
    return [{ value: '0', label: 'issues found', variant: 'clear' }];
  }

  const figures = [];
  if (requirements.length) {
    figures.push({ value: requirements.length, label: 'requirement failures', variant: 'serious' });
  } else if (axeRan) {
    // Worth saying out loud rather than omitting: "nothing the law requires
    // failed" is the sentence the visitor came for, and a missing figure does
    // not say it.
    figures.push({ value: '0', label: 'requirement failures', variant: 'clear' });
  }
  if (notYetRequired.length) {
    figures.push({ value: notYetRequired.length, label: 'not yet required', variant: 'minor' });
  }
  if (bestPractices.length) {
    figures.push({ value: bestPractices.length, label: 'best practice', variant: 'minor' });
  }
  if (incomplete.length) {
    figures.push({ value: incomplete.length, label: 'needs review', variant: 'moderate' });
  }
  if (!axeRan) {
    figures.push({ value: '—', label: 'element checks did not run', variant: 'moderate' });
  }
  return figures;
}

function notCovered(axeResult, staticResult) {
  const items = [
    'Content built by JavaScript — scripts are never executed, by design',
    'The roughly two thirds of WCAG criteria that need human judgement',
  ];
  if (!axeResult) {
    items.unshift('Element-level checks — the in-browser engine could not run on this page');
  } else if (axeResult.contrastScope !== 'visible-area') {
    items.unshift('Colour contrast — it could not be measured on this page');
  } else {
    items.unshift('Colour contrast below the area that fits on screen');
  }
  if (!staticResult) items.unshift('Page-level checks such as title and language');
  return items;
}
