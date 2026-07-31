import { describe, it, expect } from 'vitest';
import { mergeResults } from '../public/merge.js';

// This logic has produced three shipped defects, every one of them a case where
// the page told a visitor their site was fine when it was not. It was untested
// because it lived inside a DOM-rendering function and the suite runs in
// workerd. These tests exist so the next one fails here instead of in front of
// a user.

const axeFinding = (over = {}) => ({
  id: 'color-contrast',
  help: 'Elements must meet minimum colour contrast ratio thresholds',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
  impact: 'serious',
  wcag: '1.4.3',
  en301549: '9.1.4.3',
  level: 'AA',
  nodes: 3,
  examples: ['<p class="x">hi</p>'],
  ...over,
});

const axeResult = (over = {}) => ({
  finalUrl: 'https://example.com/',
  engine: 'axe-core 4.12.1',
  truncated: false,
  contrastScope: 'visible-area',
  requirements: [],
  notYetRequired: [],
  bestPractices: [],
  incomplete: [],
  counts: { violations: 0, incomplete: 0, passes: 40, inapplicable: 50 },
  ...over,
});

const pendingFinding = (over = {}) =>
  axeFinding({
    id: 'target-size',
    help: 'Touch targets must have sufficient size and space',
    wcag: '2.5.8',
    criterionName: 'Target Size (Minimum)',
    en301549: null,
    arrivesIn: 'v4.1.1',
    level: 'AA',
    ...over,
  });

const staticIssue = (id, over = {}) => ({
  id,
  title: `Title for ${id}`,
  impact: 'moderate',
  count: 1,
  examples: [],
  wcag: '1.3.1',
  wcagLevel: 'A',
  en301549: '9.1.3.1',
  remedy: 'Do the thing.',
  ...over,
});

const staticResult = (issues, over = {}) => ({
  url: 'https://example.com/',
  pageTitle: 'Example Domain',
  truncated: false,
  issues,
  ...over,
});

const labels = (merged) => merged.figures.map((f) => f.label);
const ids = (list) => list.map((f) => f.id);

describe('which static findings are merged in', () => {
  // The other sixteen static rules overlap with axe rules and would report the
  // same problem twice under two different names.
  it('takes only the document-level rules while axe is running', () => {
    const merged = mergeResults(
      axeResult({ requirements: [axeFinding()] }),
      staticResult([staticIssue('no-h1'), staticIssue('img-missing-alt')]),
      'example.com'
    );
    expect(ids(merged.requirements)).toEqual(['no-h1', 'color-contrast']);
  });

  // Regression: the filter used to be unconditional, so an axe failure silently
  // discarded sixteen rules' worth of findings that had genuinely run.
  it('takes every static finding when axe could not run', () => {
    const merged = mergeResults(
      null,
      staticResult([staticIssue('no-h1'), staticIssue('img-missing-alt')]),
      'example.com'
    );
    expect(ids(merged.requirements)).toEqual(['no-h1', 'img-missing-alt']);
  });

  it('carries the EN clause and level across from the static shape', () => {
    const merged = mergeResults(null, staticResult([staticIssue('no-h1')]), 'example.com');
    expect(merged.requirements[0]).toMatchObject({
      en301549: '9.1.3.1',
      wcag: '1.3.1',
      level: 'A',
      help: 'Title for no-h1',
      nodes: 1,
    });
  });
});

describe('the tally, which is the part that can lie', () => {
  it('shows a clean zero only when both engines ran and found nothing', () => {
    const merged = mergeResults(axeResult(), staticResult([]), 'example.com');
    expect(merged.figures).toEqual([{ value: '0', label: 'issues found', variant: 'clear' }]);
  });

  // Regression: a failed axe run left ~95 checks unperformed, and the page still
  // printed a green zero, which reads as a pass.
  it('never shows a clean zero when axe did not run', () => {
    const merged = mergeResults(null, staticResult([]), 'example.com');
    expect(labels(merged)).not.toContain('issues found');
    expect(labels(merged)).toContain('element checks did not run');
  });

  // Regression: best practices were left out of the clean-zero condition, so a
  // page with only best-practice findings printed a green "0 issues found" with
  // the findings listed directly underneath it.
  it('does not call a page clean when best-practice findings exist', () => {
    const merged = mergeResults(
      axeResult({ bestPractices: [axeFinding({ id: 'region', en301549: null, wcag: null })] }),
      staticResult([]),
      'example.com'
    );
    expect(labels(merged)).not.toContain('issues found');
    expect(merged.figures).toContainEqual({ value: 1, label: 'best practice', variant: 'minor' });
    // Still says plainly that nothing legally required failed — that is the
    // sentence the visitor actually came for.
    expect(merged.figures).toContainEqual({ value: '0', label: 'requirement failures', variant: 'clear' });
  });

  it('does not call a page clean when axe could not decide something', () => {
    const merged = mergeResults(
      axeResult({ incomplete: [axeFinding()] }),
      staticResult([]),
      'example.com'
    );
    expect(labels(merged)).not.toContain('issues found');
    expect(merged.figures).toContainEqual({ value: 1, label: 'needs review', variant: 'moderate' });
  });

  it('counts requirement failures, not occurrences', () => {
    const merged = mergeResults(
      axeResult({ requirements: [axeFinding(), axeFinding({ id: 'link-name' })] }),
      staticResult([staticIssue('no-h1')]),
      'example.com'
    );
    expect(merged.figures[0]).toEqual({ value: 3, label: 'requirement failures', variant: 'serious' });
  });
});

// The distinction no competitor makes. EN 301 549 v3.2.1 imports WCAG 2.1, so a
// WCAG 2.2-only failure is real but is not yet an EU legal requirement.
// Reporting it as a requirement failure overstates the law; burying it in best
// practices understates the finding.
describe('WCAG 2.2 failures that are not yet EN 301 549 requirements', () => {
  it('keeps them out of both requirements and best practices', () => {
    const merged = mergeResults(
      axeResult({ notYetRequired: [pendingFinding()] }),
      staticResult([]),
      'example.com'
    );
    expect(merged.requirements).toEqual([]);
    expect(merged.bestPractices).toEqual([]);
    expect(ids(merged.notYetRequired)).toEqual(['target-size']);
  });

  it('does not let one make the page look clean', () => {
    const merged = mergeResults(
      axeResult({ notYetRequired: [pendingFinding()] }),
      staticResult([]),
      'example.com'
    );
    expect(labels(merged)).not.toContain('issues found');
    expect(merged.figures).toContainEqual({ value: 1, label: 'not yet required', variant: 'minor' });
    expect(merged.figures).toContainEqual({ value: '0', label: 'requirement failures', variant: 'clear' });
  });

  it('does not count toward the requirement-failure figure', () => {
    const merged = mergeResults(
      axeResult({ requirements: [axeFinding()], notYetRequired: [pendingFinding()] }),
      staticResult([]),
      'example.com'
    );
    expect(merged.figures[0]).toEqual({ value: 1, label: 'requirement failures', variant: 'serious' });
  });

  it('says in the scope note which standard version is being applied', () => {
    const merged = mergeResults(axeResult(), staticResult([]), 'example.com');
    expect(merged.scope.mappedTo).toMatch(/v3\.2\.1/);
  });
});

describe('incomplete is never a pass', () => {
  it('keeps incomplete out of requirements and best practices', () => {
    const merged = mergeResults(
      axeResult({ incomplete: [axeFinding({ id: 'color-contrast' })] }),
      staticResult([]),
      'example.com'
    );
    expect(merged.requirements).toEqual([]);
    expect(merged.bestPractices).toEqual([]);
    expect(ids(merged.incomplete)).toEqual(['color-contrast']);
  });
});

describe('what the report says it did not check', () => {
  it('names the engine failure when axe did not run', () => {
    const merged = mergeResults(null, staticResult([]), 'example.com');
    expect(merged.scope.notCovered.join(' ')).toMatch(/in-browser engine could not run/i);
    expect(merged.scope.standard).toBe('static HTML checks only');
  });

  it('names the page-level gap when the static scan did not run', () => {
    const merged = mergeResults(axeResult(), null, 'example.com');
    expect(merged.scope.notCovered.join(' ')).toMatch(/title and language/i);
  });

  it('limits the contrast claim to the visible area when contrast was assessed', () => {
    const merged = mergeResults(axeResult({ contrastScope: 'visible-area' }), staticResult([]), 'x.com');
    expect(merged.scope.notCovered.join(' ')).toMatch(/below the area that fits on screen/i);
  });

  it('says contrast was not measured at all when axe never evaluated it', () => {
    const merged = mergeResults(axeResult({ contrastScope: 'not-assessed' }), staticResult([]), 'x.com');
    expect(merged.scope.notCovered.join(' ')).toMatch(/could not be measured/i);
  });

  it('reports truncation from either engine', () => {
    expect(mergeResults(axeResult({ truncated: true }), staticResult([]), 'x.com').truncated).toBe(true);
    expect(mergeResults(axeResult(), staticResult([], { truncated: true }), 'x.com').truncated).toBe(true);
    expect(mergeResults(axeResult(), staticResult([]), 'x.com').truncated).toBe(false);
  });
});

describe('what the report is about', () => {
  it('prefers the page title, then the resolved url, then what was typed', () => {
    expect(mergeResults(axeResult(), staticResult([]), 'typed').subject).toBe('Example Domain');
    expect(mergeResults(axeResult(), staticResult([], { pageTitle: null }), 'typed').subject)
      .toBe('https://example.com/');
    expect(mergeResults(null, null, 'typed').subject).toBe('typed');
  });

  it('prefers the url axe actually landed on', () => {
    const merged = mergeResults(
      axeResult({ finalUrl: 'https://example.com/en/' }),
      staticResult([]),
      'example.com'
    );
    expect(merged.url).toBe('https://example.com/en/');
  });
});
