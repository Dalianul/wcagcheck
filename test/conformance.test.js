import { describe, it, expect } from 'vitest';
import { conformanceTable, summarise, STATUS } from '../public/conformance.js';
import { inventoryFor, IN_FORCE } from '../public/criteria.js';

// The table's whole reason to exist is the rows automation cannot judge. Every
// free scanner lists only what failed, which lets a clean scan read as
// compliance. Listing all 50 requirements with honest "not tested" markers is
// less flattering and more truthful, so the tests below care as much about what
// the table refuses to claim as about what it asserts.

const axe = (byCriterion) => ({ byCriterion });

const staticOk = (issues = []) => ({ issues });

const rowFor = (rows, number) => rows.find((r) => r.number === number);

describe('shape', () => {
  it('has one row per requirement in the version in force, in specification order', () => {
    const rows = conformanceTable(axe({}), null);
    expect(rows).toHaveLength(inventoryFor(IN_FORCE).length);
    expect(rows.map((r) => r.number)).toEqual(inventoryFor(IN_FORCE).map((c) => c.number));
  });

  it('carries the name, level and clause from the inventory', () => {
    const rows = conformanceTable(axe({}), null);
    expect(rowFor(rows, '1.4.3')).toMatchObject({
      name: 'Contrast (Minimum)',
      level: 'AA',
      clause: '9.1.4.3',
    });
  });
});

describe('status derived from axe result buckets', () => {
  const status = (counts) =>
    rowFor(conformanceTable(axe({ '1.4.3': counts }), null), '1.4.3').status;

  it('failures with nothing passing does not support', () => {
    expect(status({ violations: 2, passes: 0, incomplete: 0, inapplicable: 0 })).toBe(STATUS.FAIL);
  });

  it('failures alongside passes partially supports', () => {
    expect(status({ violations: 1, passes: 4, incomplete: 0, inapplicable: 0 })).toBe(STATUS.PARTIAL);
  });

  it('passes with nothing else supports', () => {
    expect(status({ violations: 0, passes: 3, incomplete: 0, inapplicable: 0 })).toBe(STATUS.PASS);
  });

  it('only inapplicable means the page has no such content', () => {
    expect(status({ violations: 0, passes: 0, incomplete: 0, inapplicable: 2 })).toBe(STATUS.NOT_APPLICABLE);
  });

  // Undecided results must never be laundered into a pass — this is the single
  // most load-bearing rule in the file.
  it('undecided results alongside passes only partially supports', () => {
    expect(status({ violations: 0, passes: 5, incomplete: 1, inapplicable: 0 })).toBe(STATUS.PARTIAL);
  });

  it('undecided results with nothing passing cannot be determined', () => {
    expect(status({ violations: 0, passes: 0, incomplete: 1, inapplicable: 0 })).toBe(STATUS.UNDECIDED);
  });

  it('no result at all means automation never examined it', () => {
    expect(rowFor(conformanceTable(axe({}), null), '1.4.3').status).toBe(STATUS.NOT_TESTED);
  });

  // A criterion can arrive carrying an all-zero bucket rather than being absent
  // altogether. Same conclusion, different code path — and without this the
  // second path is unreachable from the suite, so nothing guards it.
  it('an all-zero result is also never examined, not a pass', () => {
    expect(status({ violations: 0, passes: 0, incomplete: 0, inapplicable: 0 })).toBe(STATUS.NOT_TESTED);
  });
});

describe('what the static scan contributes', () => {
  // The static scanner checks title and lang on every page, so their absence
  // from the findings is a genuine pass rather than an absence of evidence.
  it('marks page title as supported when the static scan did not flag it', () => {
    const rows = conformanceTable(null, staticOk([]));
    expect(rowFor(rows, '2.4.2').status).toBe(STATUS.PASS);
    expect(rowFor(rows, '3.1.1').status).toBe(STATUS.PASS);
  });

  it('marks page title as failing when the static scan flagged it', () => {
    const rows = conformanceTable(null, staticOk([{ id: 'missing-title', wcag: '2.4.2', count: 1 }]));
    expect(rowFor(rows, '2.4.2').status).toBe(STATUS.FAIL);
  });

  // axe cannot see document-level rules inside a shadow root, so without the
  // static scan these two would read as never examined.
  it('fills the gap axe has for document-level criteria', () => {
    const rows = conformanceTable(axe({}), staticOk([]));
    expect(rowFor(rows, '3.1.1').status).toBe(STATUS.PASS);
  });

  // It cannot tell "every image had alt text" from "there were no images", so
  // it must not claim either.
  it('does not infer a pass for element-level criteria it cannot scope', () => {
    const rows = conformanceTable(null, staticOk([]));
    expect(rowFor(rows, '1.1.1').status).toBe(STATUS.NOT_TESTED);
  });

  it('still records a static failure for an element-level criterion', () => {
    const rows = conformanceTable(null, staticOk([{ id: 'img-missing-alt', wcag: '1.1.1', count: 3 }]));
    expect(rowFor(rows, '1.1.1').status).toBe(STATUS.FAIL);
  });

  it('combines a static failure with axe passes on the same criterion', () => {
    const rows = conformanceTable(
      axe({ '1.1.1': { violations: 0, passes: 6, incomplete: 0, inapplicable: 0 } }),
      staticOk([{ id: 'img-missing-alt', wcag: '1.1.1', count: 1 }])
    );
    expect(rowFor(rows, '1.1.1').status).toBe(STATUS.PARTIAL);
  });
});

describe('the honesty the table exists for', () => {
  it('leaves most requirements unjudged when nothing ran', () => {
    const rows = conformanceTable(null, null);
    expect(rows.every((r) => r.status === STATUS.NOT_TESTED)).toBe(true);
  });

  // A real scan of a real page leaves a large majority untested, because
  // automation cannot judge most of WCAG. If this ever inverts, the table has
  // started claiming more than it knows.
  it('reports a majority untested even on a thoroughly scanned page', () => {
    const byCriterion = {};
    for (const c of inventoryFor(IN_FORCE).slice(0, 12)) {
      byCriterion[c.number] = { violations: 0, passes: 2, incomplete: 0, inapplicable: 0 };
    }
    const rows = conformanceTable(axe(byCriterion), staticOk([]));
    const untested = rows.filter((r) => r.status === STATUS.NOT_TESTED).length;
    expect(untested).toBeGreaterThan(rows.length / 2);
  });

  it('never reports a status outside the known set', () => {
    const known = new Set(Object.values(STATUS));
    for (const row of conformanceTable(axe({}), staticOk([]))) {
      expect(known.has(row.status)).toBe(true);
    }
  });
});

describe('summarise', () => {
  it('counts every row exactly once', () => {
    const rows = conformanceTable(
      axe({
        '1.4.3': { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        '1.1.1': { violations: 0, passes: 2, incomplete: 0, inapplicable: 0 },
        '2.4.4': { violations: 0, passes: 0, incomplete: 0, inapplicable: 1 },
      }),
      staticOk([])
    );
    const s = summarise(rows);
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    expect(total).toBe(rows.length);
    expect(s[STATUS.FAIL]).toBe(1);
    expect(s[STATUS.NOT_APPLICABLE]).toBe(1);
  });
});
