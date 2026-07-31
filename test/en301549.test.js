import { describe, it, expect } from 'vitest';
import {
  criterionFromTags,
  levelFromTags,
  isBestPractice,
  classify,
} from '../public/en301549.js';

describe('criterionFromTags', () => {
  it('derives a single-digit criterion', () => {
    expect(criterionFromTags(['cat.text-alternatives', 'wcag2a', 'wcag111']))
      .toEqual({ wcag: '1.1.1', en301549: '9.1.1.1' });
  });

  it('derives a two-digit third component', () => {
    expect(criterionFromTags(['wcag21aa', 'wcag1410']))
      .toEqual({ wcag: '1.4.10', en301549: '9.1.4.10' });
  });

  it('derives 4.1.2', () => {
    expect(criterionFromTags(['wcag2a', 'wcag412']))
      .toEqual({ wcag: '4.1.2', en301549: '9.4.1.2' });
  });

  // Level tags must never be mistaken for criterion tags.
  it('returns null when only level tags are present', () => {
    expect(criterionFromTags(['cat.aria', 'wcag2a', 'wcag21aa'])).toBeNull();
  });

  it('returns null for a best-practice-only rule', () => {
    expect(criterionFromTags(['cat.semantics', 'best-practice'])).toBeNull();
  });

  it('returns null for an empty tag list', () => {
    expect(criterionFromTags([])).toBeNull();
  });
});

describe('levelFromTags', () => {
  it('reads level A', () => {
    expect(levelFromTags(['wcag2a', 'wcag111'])).toBe('A');
  });

  it('reads level AA', () => {
    expect(levelFromTags(['wcag21aa', 'wcag1410'])).toBe('AA');
  });

  it('reads level AAA', () => {
    expect(levelFromTags(['wcag2aaa', 'wcag146'])).toBe('AAA');
  });

  it('prefers the lowest level when several are tagged', () => {
    expect(levelFromTags(['wcag2a', 'wcag21aa'])).toBe('A');
  });

  it('returns null when no level tag exists', () => {
    expect(levelFromTags(['best-practice'])).toBeNull();
  });
});

describe('isBestPractice', () => {
  it('is true for the best-practice tag', () => {
    expect(isBestPractice(['cat.semantics', 'best-practice'])).toBe(true);
  });

  it('is false for a tagged requirement', () => {
    expect(isBestPractice(['wcag2a', 'wcag111'])).toBe(false);
  });
});

describe('classify', () => {
  it('classifies a requirement', () => {
    expect(classify(['cat.text-alternatives', 'wcag2a', 'wcag111'])).toEqual({
      wcag: '1.1.1',
      en301549: '9.1.1.1',
      level: 'A',
      bestPractice: false,
    });
  });

  // A best-practice rule must not be reported as an EN 301 549 requirement.
  it('classifies a best practice with no clause', () => {
    expect(classify(['cat.semantics', 'best-practice'])).toEqual({
      wcag: null,
      en301549: null,
      level: null,
      bestPractice: true,
    });
  });
});
