/**
 * The EN 301 549 clause 9 requirement inventory, keyed by standard version.
 *
 * Clause 9 numbers its web requirements to match WCAG, so a clause is the
 * criterion prefixed with "9." — but only for criteria the standard actually
 * contains, and *which* criteria those are depends on the version:
 *
 *   v3.2.1  (March 2021)  imports WCAG 2.1 A/AA  — 50 requirements
 *   v4.1.1  (draft V4.1.0 Nov 2025)  imports WCAG 2.2 A/AA  — 55 requirements
 *
 * v3.2.1 is the version cited in the Official Journal, so it is the one in
 * force. Deriving "9." + criterion unconditionally was producing citations to
 * clauses that do not exist: axe's target-size rule carries the wcag258 tag and
 * runs under our wcag22aa selection, so the tool reported "EN 301 549 clause
 * 9.2.5.8" against a standard that has no such clause.
 *
 * IN_FORCE is a constant and not a date on purpose. v4.1.1 is widely expected
 * to be cited around October 2026, but every source for that timing is
 * secondary. Flip it when the Official Journal citation is confirmed, not when
 * a calendar says so — citing a standard that has not been harmonised yet is
 * the same class of error in the other direction.
 *
 * Clause 9 also contains 9.5 (Non-interference) and 9.6 (WCAG conformance
 * requirements), which are not per-criterion and so are not listed here.
 *
 * Source: W3C normative texts at w3.org/TR/WCAG21 and w3.org/TR/WCAG22.
 */

// number, official name, level, in WCAG 2.1, in WCAG 2.2.
// Every criterion that has been Level A or AA in 2.0, 2.1 or 2.2. Names are the
// current WCAG 2.2 spelling, which is what should be cited going forward —
// WCAG 2.0 rendered 1.4.4 as "Resize text" and 2.2 renders it "Resize Text".
const CRITERIA = [
  ['1.1.1',  'Non-text Content',                                 'A',  true,  true],
  ['1.2.1',  'Audio-only and Video-only (Prerecorded)',          'A',  true,  true],
  ['1.2.2',  'Captions (Prerecorded)',                           'A',  true,  true],
  ['1.2.3',  'Audio Description or Media Alternative (Prerecorded)', 'A', true, true],
  ['1.2.4',  'Captions (Live)',                                  'AA', true,  true],
  ['1.2.5',  'Audio Description (Prerecorded)',                  'AA', true,  true],
  ['1.3.1',  'Info and Relationships',                           'A',  true,  true],
  ['1.3.2',  'Meaningful Sequence',                              'A',  true,  true],
  ['1.3.3',  'Sensory Characteristics',                          'A',  true,  true],
  ['1.3.4',  'Orientation',                                      'AA', true,  true],
  ['1.3.5',  'Identify Input Purpose',                           'AA', true,  true],
  ['1.4.1',  'Use of Color',                                     'A',  true,  true],
  ['1.4.2',  'Audio Control',                                    'A',  true,  true],
  ['1.4.3',  'Contrast (Minimum)',                               'AA', true,  true],
  ['1.4.4',  'Resize Text',                                      'AA', true,  true],
  ['1.4.5',  'Images of Text',                                   'AA', true,  true],
  ['1.4.10', 'Reflow',                                           'AA', true,  true],
  ['1.4.11', 'Non-text Contrast',                                'AA', true,  true],
  ['1.4.12', 'Text Spacing',                                     'AA', true,  true],
  ['1.4.13', 'Content on Hover or Focus',                        'AA', true,  true],
  ['2.1.1',  'Keyboard',                                         'A',  true,  true],
  ['2.1.2',  'No Keyboard Trap',                                 'A',  true,  true],
  ['2.1.4',  'Character Key Shortcuts',                          'A',  true,  true],
  ['2.2.1',  'Timing Adjustable',                                'A',  true,  true],
  ['2.2.2',  'Pause, Stop, Hide',                                'A',  true,  true],
  ['2.3.1',  'Three Flashes or Below Threshold',                 'A',  true,  true],
  ['2.4.1',  'Bypass Blocks',                                    'A',  true,  true],
  ['2.4.2',  'Page Titled',                                      'A',  true,  true],
  ['2.4.3',  'Focus Order',                                      'A',  true,  true],
  ['2.4.4',  'Link Purpose (In Context)',                        'A',  true,  true],
  ['2.4.5',  'Multiple Ways',                                    'AA', true,  true],
  ['2.4.6',  'Headings and Labels',                              'AA', true,  true],
  ['2.4.7',  'Focus Visible',                                    'AA', true,  true],
  ['2.4.11', 'Focus Not Obscured (Minimum)',                     'AA', false, true],
  ['2.5.1',  'Pointer Gestures',                                 'A',  true,  true],
  ['2.5.2',  'Pointer Cancellation',                             'A',  true,  true],
  ['2.5.3',  'Label in Name',                                    'A',  true,  true],
  ['2.5.4',  'Motion Actuation',                                 'A',  true,  true],
  ['2.5.7',  'Dragging Movements',                               'AA', false, true],
  ['2.5.8',  'Target Size (Minimum)',                            'AA', false, true],
  ['3.1.1',  'Language of Page',                                 'A',  true,  true],
  ['3.1.2',  'Language of Parts',                                'AA', true,  true],
  ['3.2.1',  'On Focus',                                         'A',  true,  true],
  ['3.2.2',  'On Input',                                         'A',  true,  true],
  ['3.2.3',  'Consistent Navigation',                            'AA', true,  true],
  ['3.2.4',  'Consistent Identification',                        'AA', true,  true],
  ['3.2.6',  'Consistent Help',                                  'A',  false, true],
  ['3.3.1',  'Error Identification',                             'A',  true,  true],
  ['3.3.2',  'Labels or Instructions',                           'A',  true,  true],
  ['3.3.3',  'Error Suggestion',                                 'AA', true,  true],
  ['3.3.4',  'Error Prevention (Legal, Financial, Data)',        'AA', true,  true],
  ['3.3.7',  'Redundant Entry',                                  'A',  false, true],
  ['3.3.8',  'Accessible Authentication (Minimum)',              'AA', false, true],
  // The only success criterion ever removed. WCAG 2.2 dropped it, and W3C
  // annotated 2.0 and 2.1 to say it should be considered always satisfied for
  // HTML — so v3.2.1 still contains the clause, but nothing can fail it.
  ['4.1.1',  'Parsing',                                          'A',  true,  false],
  ['4.1.2',  'Name, Role, Value',                                'A',  true,  true],
  ['4.1.3',  'Status Messages',                                  'AA', true,  true],
];

export const STANDARD_VERSIONS = {
  'v3.2.1': { wcag: '2.1', inForce: true, published: 'March 2021' },
  'v4.1.1': { wcag: '2.2', inForce: false, published: 'draft V4.1.0, November 2025' },
};

/** The version cited in the Official Journal. See the note above before changing. */
export const IN_FORCE = 'v3.2.1';

const PRESENT_AT = { 'v3.2.1': 3, 'v4.1.1': 4 };

const BY_NUMBER = new Map(CRITERIA.map((row) => [row[0], row]));

function contains(row, version) {
  const index = PRESENT_AT[version];
  return index === undefined ? false : row[index];
}

/** Every clause 9 requirement in a given version, in specification order. */
export function inventoryFor(version = IN_FORCE) {
  return CRITERIA.filter((row) => contains(row, version)).map(([number, name, level]) => ({
    number,
    name,
    level,
    clause: `9.${number}`,
  }));
}

/** The clause number for a criterion, or null if that version has no such clause. */
export function clauseFor(number, version = IN_FORCE) {
  const row = BY_NUMBER.get(number);
  if (!row || !contains(row, version)) return null;
  return `9.${number}`;
}

/**
 * Describes a criterion relative to the version in force.
 *
 * `arrivesIn` is the point of the whole module: a WCAG 2.2 criterion that is a
 * genuine failure but is not yet an EN 301 549 requirement is neither a
 * requirement failure nor a best practice, and reporting it as either would be
 * wrong in opposite directions.
 */
export function criterionFor(number, version = IN_FORCE) {
  const row = BY_NUMBER.get(number);
  if (!row) return null;
  const [, name, level] = row;
  if (contains(row, version)) {
    return { number, name, level, clause: `9.${number}`, arrivesIn: null };
  }
  const pending = Object.keys(STANDARD_VERSIONS).find(
    (v) => v !== version && contains(row, v)
  );
  return { number, name, level, clause: null, arrivesIn: pending ?? null };
}
