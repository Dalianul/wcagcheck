/**
 * Derives WCAG and EN 301 549 references from axe-core rule tags.
 *
 * axe tags every rule with its success criterion as `wcag<major><minor><number>`
 * — wcag111, wcag412, wcag1410 — and its conformance level separately as
 * wcag2a / wcag21aa / wcag22aa. EN 301 549 clause 9 numbers its web requirements
 * to match WCAG, so the clause is the criterion prefixed with "9.".
 *
 * Deriving it this way means there is no mapping table to fall out of date when
 * axe adds rules.
 */

// Ordered lowest-to-highest so the first match is the binding level.
const LEVEL_TAGS = [
  ['A', ['wcag2a', 'wcag21a', 'wcag22a']],
  ['AA', ['wcag2aa', 'wcag21aa', 'wcag22aa']],
  ['AAA', ['wcag2aaa', 'wcag21aaa', 'wcag22aaa']],
];

// Requires at least three digits after "wcag", which excludes level tags such
// as wcag2a and wcag21aa.
const CRITERION_TAG = /^wcag(\d)(\d)(\d+)$/;

export function criterionFromTags(tags) {
  for (const tag of tags || []) {
    const match = CRITERION_TAG.exec(tag);
    if (!match) continue;
    const wcag = `${match[1]}.${match[2]}.${match[3]}`;
    return { wcag, en301549: `9.${wcag}` };
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

export function classify(tags) {
  const criterion = criterionFromTags(tags);
  return {
    wcag: criterion ? criterion.wcag : null,
    en301549: criterion ? criterion.en301549 : null,
    level: levelFromTags(tags),
    bestPractice: isBestPractice(tags),
  };
}
