/* wcagcheck.eu front end. No dependencies, no build step. */

import { runAxeScan } from './axe-runner.js';
import { mergeResults } from './merge.js';
import { IN_FORCE, STANDARD_VERSIONS } from './criteria.js';

const form = document.getElementById('scan-form');
const field = document.getElementById('url');
const go = document.getElementById('go');
const sweep = document.getElementById('sweep');
const results = document.getElementById('results');
const message = document.getElementById('message');

function text(value) {
  return String(value ?? '');
}

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = text(content);
  return node;
}

function showMessage(title, detail) {
  message.replaceChildren();
  if (!title) return;
  const box = el('div', 'notice');
  box.append(el('p', 'notice__title', title));
  if (detail) box.append(el('p', null, detail));
  message.append(box);
}

function figure(value, label, variant) {
  const wrap = el('div', `tally__figure tally__figure--${variant}`);
  // Reversed in CSS so the number reads first but the label is the accessible name.
  wrap.append(el('span', 'tally__label', label));
  wrap.append(el('span', 'tally__num', value));
  return wrap;
}

function renderScope(scope, truncated) {
  const box = el('section', 'scope');
  box.append(el('h2', null, 'Scope of this check'));
  box.append(el('p', null, `Checked against ${scope.standard}, mapped to ${scope.mappedTo}.`));
  if (truncated) {
    box.append(el('p', null, 'The page was larger than 2.5 MB, so only the first part was read.'));
  }
  box.append(el('p', null, 'Not covered by this check:'));
  const list = el('ul');
  for (const item of scope.notCovered) list.append(el('li', null, item));
  box.append(list);
  return box;
}

/**
 * Draws a merged result. Every judgement about what was found lives in
 * merge.js, where it is testable; this function only puts it on the page.
 */
function renderMerged(axeResult, staticResult, requested) {
  const merged = mergeResults(axeResult, staticResult, requested);
  results.replaceChildren();

  const tally = el('div', 'tally');
  const subject = el('div', 'tally__subject');
  const heading = el('h2', 'entry__title');
  heading.append(el('span', 'visually-hidden', 'Results for '));
  heading.append(document.createTextNode(merged.subject));
  subject.append(heading);
  subject.append(el('p', 'tally__url', merged.url));
  tally.append(subject);
  for (const f of merged.figures) tally.append(figure(f.value, f.label, f.variant));
  results.append(tally);

  for (const f of merged.requirements) results.append(renderAxeEntry(f, 'serious'));
  for (const f of merged.notYetRequired) results.append(renderAxeEntry(f, 'minor'));
  for (const f of merged.bestPractices) results.append(renderAxeEntry(f, 'minor'));
  for (const f of merged.incomplete) results.append(renderAxeEntry(f, 'moderate'));

  results.append(renderConformance(merged.conformance));
  results.append(renderScope(merged.scope, merged.truncated));

  // Only meaningful on paper, where the surrounding page is gone and the sheet
  // has to say for itself what it is and when it was made.
  const stamp = el('p', 'print-only report__stamp',
    `Automated check by wcagcheck.eu · ${new Date().toLocaleString('en-GB', {
      dateStyle: 'long', timeStyle: 'short',
    })} · not a conformance audit`);
  results.append(stamp);
}

// A closed <details> cannot be opened by CSS, so the conformance table would
// print as a one-line summary — the most valuable part of the report, missing.
window.addEventListener('beforeprint', () => {
  for (const d of document.querySelectorAll('details')) d.dataset.wasOpen = String(d.open), (d.open = true);
});
window.addEventListener('afterprint', () => {
  for (const d of document.querySelectorAll('details')) d.open = d.dataset.wasOpen === 'true';
});

const STATUS_LABEL = {
  'does-not-support': 'Does not support',
  'partially-supports': 'Partially supports',
  'supports': 'No failures detected',
  'not-applicable': 'Not present on this page',
  'cannot-determine': 'Could not be decided',
  'not-tested': 'Not checked — needs a person',
};

/**
 * Every clause 9 requirement, including the ones automation never examined.
 *
 * Collapsed by default: fifty rows would bury the findings, which are what
 * someone came for. Open, it is the part no other free scanner produces.
 */
function renderConformance({ rows, summary }) {
  const box = el('details', 'conformance');
  const untested = summary['not-tested'];

  const head = el('summary', 'conformance__summary');
  head.append(el('span', 'conformance__title', `All ${rows.length} EN 301 549 requirements`));
  head.append(el('span', 'conformance__hint',
    `${rows.length - untested} examined by automation · ${untested} need a person`));
  box.append(head);

  box.append(el('p', 'conformance__caveat',
    'These are automated results. "No failures detected" means nothing the machine ' +
    'could check went wrong on this page — not that the requirement is met. Roughly ' +
    'two thirds of accessibility requirements can only be judged by a person, and ' +
    'they are listed here rather than quietly left out.'));

  const table = el('table', 'conformance__table');
  const caption = el('caption', 'visually-hidden',
    `EN 301 549 ${IN_FORCE} clause 9 requirements and what the automated check found for each`);
  table.append(caption);

  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  for (const [label, cls] of [['Clause', 'col-clause'], ['Requirement', ''], ['Level', 'col-level'], ['Result', '']]) {
    const th = el('th', cls || null, label);
    th.scope = 'col';
    hrow.append(th);
  }
  thead.append(hrow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = el('tr', `conformance__row conformance__row--${row.status}`);
    const clause = el('th', 'conformance__clause', row.clause);
    clause.scope = 'row';
    tr.append(clause);
    tr.append(el('td', null, row.name));
    tr.append(el('td', 'conformance__level', row.level));
    tr.append(el('td', 'conformance__status', STATUS_LABEL[row.status]));
    tbody.append(tr);
  }
  table.append(tbody);

  const scroller = el('div', 'conformance__scroll');
  scroller.append(table);
  box.append(scroller);
  return box;
}

/** One finding as a ledger entry. */
function renderAxeEntry(finding, severity) {
  const entry = el('article', `entry entry--${severity}`);

  // A finding with no clause is not necessarily unmapped: it may be a real
  // WCAG 2.2 criterion the standard in force has not adopted yet, in which case
  // the criterion number is the honest thing to show.
  const marker = finding.en301549 || (finding.arrivesIn ? finding.wcag : finding.id);

  // "9.4.1.2" alone is announced as a string of digits, so it needs a spoken
  // prefix — but not via aria-label. A <p> has an implicit role of paragraph,
  // which prohibits an accessible name; our own scanner flagged this page for
  // it. Visually hidden text does the same job within the spec.
  const clause = el('p', 'entry__clause');
  const spoken = finding.en301549
    ? 'EN 301 549 clause '
    : finding.arrivesIn
      ? 'WCAG success criterion '
      : null;
  if (spoken) clause.append(el('span', 'visually-hidden', spoken));
  clause.append(document.createTextNode(marker));
  entry.append(clause);

  const body = el('div', 'entry__body');
  const head = el('div', 'entry__head');
  head.append(el('h3', 'entry__title', finding.help));
  head.append(el('p', 'entry__count', finding.nodes === 1 ? '1 element' : `${finding.nodes} elements`));
  body.append(head);
  body.append(el('p', 'entry__meta', [
    finding.impact,
    finding.wcag
      ? `WCAG ${finding.wcag}${finding.criterionName ? ` ${finding.criterionName}` : ''}`
      : 'Best practice',
    finding.level ? `Level ${finding.level}` : null,
  ].filter(Boolean).join(' · ')));

  if (finding.arrivesIn) {
    body.append(el('p', 'entry__pending',
      `A real WCAG 2.2 failure, but not yet a legal requirement: EN 301 549 ${IN_FORCE} restates ` +
      `WCAG ${STANDARD_VERSIONS[IN_FORCE].wcag} and has no clause for it. It becomes one when ` +
      `${finding.arrivesIn} is cited in the Official Journal.`));
  }

  if (finding.examples?.length) {
    const list = el('ul', 'entry__samples');
    for (const sample of finding.examples) list.append(el('li', null, sample));
    body.append(list);
  }
  entry.append(body);
  return entry;
}

const belowResults = [...document.querySelectorAll('.explain, .foot')];
let reservedForDeepLink = false;

function setBusy(busy) {
  go.disabled = busy;
  go.textContent = busy ? 'Scanning' : 'Scan';
  sweep.hidden = !busy;
  results.setAttribute('aria-busy', String(busy));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const value = field.value.trim();
  if (!value) {
    showMessage('Enter a page address first.', 'For example: https://example.ro/contact');
    field.focus();
    return;
  }

  showMessage(null);
  setBusy(true);

  try {
    // Both engines run: axe cannot see document-level rules inside a shadow
    // root, and the static scan covers exactly those. Neither is a fallback.
    const [axeOutcome, staticOutcome] = await Promise.allSettled([
      runAxeScan(value),
      fetch(`/api/scan?url=${encodeURIComponent(value)}`).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Static scan failed.');
        return body;
      }),
    ]);

    if (axeOutcome.status === 'rejected' && staticOutcome.status === 'rejected') {
      results.replaceChildren();
      showMessage("That page couldn't be scanned", axeOutcome.reason.message);
      return;
    }

    renderMerged(
      axeOutcome.status === 'fulfilled' ? axeOutcome.value : null,
      staticOutcome.status === 'fulfilled' ? staticOutcome.value : null,
      value
    );
    results.tabIndex = -1;
    results.focus();
  } catch {
    results.replaceChildren();
    showMessage('The scan could not be completed', 'Check your connection and try again.');
  } finally {
    setBusy(false);
    // Restored once the report is on the page, by which point it has pushed
    // them well below the fold anyway.
    if (reservedForDeepLink) {
      reservedForDeepLink = false;
      for (const below of belowResults) below.hidden = false;
    }
  }
});

// Deep link support: /?url=... runs the scan on load, which makes results shareable.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  field.value = preset;
  // A scan the visitor did not click starts a layout shift that counts against
  // the page: findings drop in and shove the explainer and footer down. Layout
  // shift is only scored for elements inside the viewport, so reserving the
  // space up front pushes those two below the fold before anything moves, and
  // the fill-in happens in space that was already claimed.
  // A scan the visitor did not click shoves everything below the findings down
  // as they arrive, which is scored against the page as layout shift. Taking
  // the explainer and footer out of flow first means the findings grow into
  // empty space with nothing beneath them to move. Hiding them costs nothing:
  // both sit below the fold at this point, and only shifts inside the viewport
  // are scored.
  reservedForDeepLink = true;
  for (const below of belowResults) below.hidden = true;
  form.requestSubmit();
}
