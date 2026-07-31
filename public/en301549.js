/**
 * Derives WCAG and EN 301 549 references from axe-core rule tags.
 *
 * axe tags every rule with its success criterion as `wcag<major><minor><number>`
 * — wcag111, wcag412, wcag1410 — and its conformance level separately as
 * wcag2a / wcag21aa / wcag22aa. Reading the criterion from the tag means there
 * is no rule-to-clause table to fall out of date when axe adds rules.
 *
 * The clause itself is NOT derived here, because "9." + criterion is only true
 * for criteria the standard in force actually contains. criteria.js owns that,
 * per standard version. Deriving it unconditionally had the tool citing clause
 * 9.2.5.8 — axe's target-size rule is tagged wcag258 and runs under our
 * wcag22aa selection, but EN 301 549 v3.2.1 has no such clause.
 */

import { criterionFor } from './criteria.js';

// Ordered lowest-to-highest so the first match is the binding level.
const LEVEL_TAGS = [
  ['A', ['wcag2a', 'wcag21a', 'wcag22a']],
  ['AA', ['wcag2aa', 'wcag21aa', 'wcag22aa']],
  ['AAA', ['wcag2aaa', 'wcag21aaa', 'wcag22aaa']],
];

// Requires at least three digits after "wcag", which excludes level tags such
// as wcag2a and wcag21aa.
const CRITERION_TAG = /^wcag(\d)(\d)(\d+)$/;

/** The WCAG success criterion a rule is tagged with, e.g. "1.4.3". */
export function criterionFromTags(tags) {
  for (const tag of tags || []) {
    const match = CRITERION_TAG.exec(tag);
    if (!match) continue;
    return `${match[1]}.${match[2]}.${match[3]}`;
  }
  return null;
}

export function levelFromTags(tags) {
  const present = new Set(tags || []);
  for (const [level, candidates] of LEVEL_TAGS) {
    if (candidates.some((tag) => present.has(tag))) return level;
  }
  return null;
}

export function isBestPractice(tags) {
  return (tags || []).includes('best-practice');
}

/**
 * What a finding is, in the terms the report uses.
 *
 * `arrivesIn` carries the distinction the rest of the field collapses: a
 * genuine WCAG 2.2 failure that is not yet an EN 301 549 requirement is neither
 * a requirement failure nor a best practice, and calling it either is wrong in
 * opposite directions.
 *
 * Level and name come from the inventory rather than the tags where we have
 * them, since the inventory is transcribed from the W3C normative text.
 */
export function classify(tags) {
  const wcag = criterionFromTags(tags);
  const criterion = wcag ? criterionFor(wcag) : null;
  return {
    wcag,
    name: criterion ? criterion.name : null,
    en301549: criterion ? criterion.clause : null,
    arrivesIn: criterion ? criterion.arrivesIn : null,
    level: criterion ? criterion.level : levelFromTags(tags),
    bestPractice: isBestPractice(tags),
  };
}
