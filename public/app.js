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

  results.append(renderScope(merged.scope, merged.truncated));
}

/** One finding as a ledger entry. */
function renderAxeEntry(finding, severity) {
  const entry = el('article', `entry entry--${severity}`);

  // A finding with no clause is not necessarily unmapped: it may be a real
  // WCAG 2.2 criterion the standard in force has not adopted yet, in which case
  // the criterion number is the honest thing to show.
  const marker = finding.en301549 || (finding.arrivesIn ? finding.wcag : finding.id);
  const clause = el('p', 'entry__clause', marker);
  if (finding.en301549) clause.setAttribute('aria-label', `EN 301 549 clause ${finding.en301549}`);
  else if (finding.arrivesIn) clause.setAttribute('aria-label', `WCAG success criterion ${finding.wcag}`);
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
  }
});

// Deep link support: /?url=... runs the scan on load, which makes results shareable.
const preset = new URLSearchParams(location.search).get('url');
if (preset) {
  field.value = preset;
  form.requestSubmit();
}
