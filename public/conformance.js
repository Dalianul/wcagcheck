/**
 * Builds the EN 301 549 clause 9 conformance table.
 *
 * Every requirement in the version in force gets a row — not only the ones that
 * failed. That is the whole point. A scanner that lists failures and stops lets
 * a clean result read as compliance, when in truth most of WCAG cannot be
 * judged by any automated tool. Listing all fifty requirements and marking the
 * ones automation never examined is less flattering and considerably more
 * honest, and it is the shape a VPAT or a regulator expects.
 *
 * A status here describes what the automated checks found. It is not a
 * conformance claim: "supports" means nothing failed the checks that ran, not
 * that the requirement is met. The UI has to say so next to the table.
 */

import { IN_FORCE, inventoryFor } from './criteria.js';

export const STATUS = {
  FAIL: 'does-not-support',
  PARTIAL: 'partially-supports',
  PASS: 'supports',
  NOT_APPLICABLE: 'not-applicable',
  UNDECIDED: 'cannot-determine',
  NOT_TESTED: 'not-tested',
};

/**
 * Static rules the scanner evaluates on every page, so their absence from the
 * findings is a genuine pass.
 *
 * Deliberately only these two. For an element-level rule the scanner cannot
 * tell "every image had alt text" from "there were no images" — axe separates
 * those with its inapplicable bucket and the static pass has no equivalent —
 * so inferring a pass from silence would be inventing evidence.
 */
const STATIC_ALWAYS_EVALUATED = {
  'missing-title': '2.4.2',
  'html-missing-lang': '3.1.1',
};

const emptyCounts = () => ({ violations: 0, passes: 0, incomplete: 0, inapplicable: 0 });

/** Folds both engines into one per-criterion count. */
function gather(axeResult, staticResult) {
  const counts = new Map();
  const at = (number) => {
    if (!counts.has(number)) counts.set(number, emptyCounts());
    return counts.get(number);
  };

  for (const [number, bucket] of Object.entries(axeResult?.byCriterion ?? {})) {
    Object.assign(at(number), { ...emptyCounts(), ...bucket });
  }

  if (staticResult) {
    const flagged = new Set();
    for (const issue of staticResult.issues ?? []) {
      if (!issue.wcag) continue;
      at(issue.wcag).violations += issue.count ?? 1;
      flagged.add(issue.id);
    }
    for (const [ruleId, number] of Object.entries(STATIC_ALWAYS_EVALUATED)) {
      if (!flagged.has(ruleId)) at(number).passes += 1;
    }
  }

  return counts;
}

function statusFrom(counts) {
  if (!counts) return STATUS.NOT_TESTED;
  const { violations, passes, incomplete, inapplicable } = counts;
  if (violations > 0) return passes > 0 ? STATUS.PARTIAL : STATUS.FAIL;
  // Undecided is never laundered into a pass. axe could not reach a verdict,
  // and saying so is the only defensible thing to do with that.
  if (incomplete > 0) return passes > 0 ? STATUS.PARTIAL : STATUS.UNDECIDED;
  if (passes > 0) return STATUS.PASS;
  if (inapplicable > 0) return STATUS.NOT_APPLICABLE;
  return STATUS.NOT_TESTED;
}

export function conformanceTable(axeResult, staticResult, version = IN_FORCE) {
  const counts = gather(axeResult, staticResult);
  return inventoryFor(version).map((requirement) => ({
    ...requirement,
    status: statusFrom(counts.get(requirement.number)),
    counts: counts.get(requirement.number) ?? emptyCounts(),
  }));
}

export function summarise(rows) {
  const totals = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  for (const row of rows) totals[row.status] += 1;
  return totals;
}
