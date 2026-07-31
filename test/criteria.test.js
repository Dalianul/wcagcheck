import { describe, it, expect } from 'vitest';
import {
  IN_FORCE,
  STANDARD_VERSIONS,
  inventoryFor,
  clauseFor,
  criterionFor,
} from '../public/criteria.js';

// This inventory is rendered to users as legal reference material. The counts
// below are derived from the W3C normative texts: WCAG 2.1 carries 50 Level
// A/AA criteria (30 A + 20 AA), WCAG 2.2 carries 55 (31 A + 24 AA) — 2.2 added
// six and removed one. If a count here changes, either the data is wrong or a
// standard moved, and both warrant a human looking.

const count = (version, level) =>
  inventoryFor(version).filter((c) => c.level === level).length;

describe('the version in force', () => {
  it('is v3.2.1, whose clause 9 imports WCAG 2.1', () => {
    expect(IN_FORCE).toBe('v3.2.1');
    expect(STANDARD_VERSIONS[IN_FORCE].wcag).toBe('2.1');
  });

  // v4.1.1 is expected to be cited in the Official Journal around October 2026.
  // The switch is deliberately a constant and not a date: the tool must not
  // start citing a standard that has not actually been harmonised yet.
  it('knows about v4.1.1 without treating it as binding', () => {
    expect(STANDARD_VERSIONS['v4.1.1'].wcag).toBe('2.2');
    expect(STANDARD_VERSIONS['v4.1.1'].inForce).toBe(false);
    expect(STANDARD_VERSIONS[IN_FORCE].inForce).toBe(true);
  });
});

describe('inventory completeness', () => {
  it('lists 50 requirements for v3.2.1', () => {
    expect(inventoryFor('v3.2.1')).toHaveLength(50);
    expect(count('v3.2.1', 'A')).toBe(30);
    expect(count('v3.2.1', 'AA')).toBe(20);
  });

  it('lists 55 requirements for v4.1.1', () => {
    expect(inventoryFor('v4.1.1')).toHaveLength(55);
    expect(count('v4.1.1', 'A')).toBe(31);
    expect(count('v4.1.1', 'AA')).toBe(24);
  });

  it('never includes a Level AAA criterion', () => {
    for (const version of Object.keys(STANDARD_VERSIONS)) {
      for (const c of inventoryFor(version)) {
        expect(['A', 'AA']).toContain(c.level);
      }
    }
  });

  it('gives every requirement a name and a clause', () => {
    for (const c of inventoryFor('v3.2.1')) {
      expect(c.name).toBeTruthy();
      expect(c.clause).toBe(`9.${c.number}`);
      expect(c.number).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('has no duplicate criterion numbers', () => {
    const numbers = inventoryFor('v4.1.1').map((c) => c.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

describe('what changed between the two versions', () => {
  // The six WCAG 2.2 additions are the whole reason this module is
  // version-keyed rather than a flat list.
  it('adds exactly the six criteria WCAG 2.2 introduced', () => {
    const before = new Set(inventoryFor('v3.2.1').map((c) => c.number));
    const added = inventoryFor('v4.1.1')
      .map((c) => c.number)
      .filter((n) => !before.has(n));
    expect(added.sort()).toEqual(['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8']);
  });

  // The only success criterion ever removed across 2.0 -> 2.1 -> 2.2.
  it('drops 4.1.1 Parsing, which v3.2.1 still contains', () => {
    expect(clauseFor('4.1.1', 'v3.2.1')).toBe('9.4.1.1');
    expect(clauseFor('4.1.1', 'v4.1.1')).toBeNull();
  });
});

describe('clauseFor', () => {
  it('prefixes the criterion with 9, matching clause 9 numbering', () => {
    expect(clauseFor('1.4.3')).toBe('9.1.4.3');
    expect(clauseFor('1.4.10')).toBe('9.1.4.10');
    expect(clauseFor('4.1.2')).toBe('9.4.1.2');
  });

  // The live defect this module exists to fix: axe's target-size rule is tagged
  // wcag258 and sits inside our runOnly, so the tool was citing "9.2.5.8" — a
  // clause that does not exist in the standard actually in force.
  it('refuses to invent a clause for a WCAG 2.2-only criterion', () => {
    expect(clauseFor('2.5.8')).toBeNull();
    expect(clauseFor('2.5.8', 'v4.1.1')).toBe('9.2.5.8');
  });

  it('returns null for a criterion that is not Level A or AA at all', () => {
    expect(clauseFor('1.4.6')).toBeNull();   // AAA
    expect(clauseFor('9.9.9')).toBeNull();   // not a criterion
  });
});

describe('criterionFor', () => {
  it('describes a criterion the standard in force already covers', () => {
    expect(criterionFor('1.4.3')).toEqual({
      number: '1.4.3',
      name: 'Contrast (Minimum)',
      level: 'AA',
      clause: '9.1.4.3',
      arrivesIn: null,
    });
  });

  // This is the distinction no competitor makes: a real WCAG 2.2 failure that
  // is not yet an EN 301 549 requirement.
  it('names the version a 2.2-only criterion is waiting on', () => {
    expect(criterionFor('2.5.8')).toEqual({
      number: '2.5.8',
      name: 'Target Size (Minimum)',
      level: 'AA',
      clause: null,
      arrivesIn: 'v4.1.1',
    });
  });

  it('reports a criterion the in-force version has but 2.2 dropped', () => {
    const parsing = criterionFor('4.1.1');
    expect(parsing.clause).toBe('9.4.1.1');
    expect(parsing.arrivesIn).toBeNull();
  });

  it('returns null for anything outside Level A and AA', () => {
    expect(criterionFor('1.4.6')).toBeNull();
    expect(criterionFor('nonsense')).toBeNull();
  });
});
