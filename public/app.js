/* wcagcheck.eu front end. No dependencies, no build step. */

import { runAxeScan } from './axe-runner.js';

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
  box.append(el('p', null, 'Not covered by a static check:'));
  const list = el('ul');
  for (const item of scope.notCovered) list.append(el('li', null, item));
  box.append(list);
  return box;
}

/** The four static rules axe cannot evaluate inside a shadow root. */
const DOCUMENT_LEVEL_RULES = new Set([
  'missing-title', 'html-missing-lang', 'no-h1', 'no-main-landmark',
]);

function renderMerged(axeResult, staticResult, requested) {
  results.replaceChildren();

  const documentFindings = (staticResult?.issues ?? []).filter((i) => DOCUMENT_LEVEL_RULES.has(i.id));
  const requirements = [
    ...documentFindings.map((i) => ({
      id: i.id, help: i.title, helpUrl: null, impact: i.impact,
      wcag: i.wcag, en301549: i.en301549, level: i.wcagLevel,
      nodes: i.count, examples: i.examples ?? [],
    })),
    ...(axeResult?.requirements ?? []),
  ];
  const bestPractices = axeResult?.bestPractices ?? [];
  const incomplete = axeResult?.incomplete ?? [];

  const tally = el('div', 'tally');
  const subject = el('div', 'tally__subject');
  const heading = el('h2', 'entry__title');
  heading.append(el('span', 'visually-hidden', 'Results for '));
  heading.append(document.createTextNode(staticResult?.pageTitle || axeResult?.finalUrl || requested));
  subject.append(heading);
  subject.append(el('p', 'tally__url', axeResult?.finalUrl || staticResult?.url || requested));
  tally.append(subject);

  if (requirements.length === 0 && incomplete.length === 0) {
    tally.append(figure('0', 'issues found', 'clear'));
  } else {
    if (requirements.length) tally.append(figure(requirements.length, 'requirement failures', 'serious'));
    if (bestPractices.length) tally.append(figure(bestPractices.length, 'best practice', 'minor'));
    if (incomplete.length) tally.append(figure(incomplete.length, 'needs review', 'moderate'));
  }
  results.append(tally);

  for (const f of requirements) results.append(renderAxeEntry(f, 'serious'));
  for (const f of bestPractices) results.append(renderAxeEntry(f, 'minor'));
  for (const f of incomplete) results.append(renderAxeEntry(f, 'moderate'));

  const notCovered = [
    'Content built by JavaScript — scripts are never executed, by design',
    'The roughly two thirds of WCAG criteria that need human judgement',
  ];
  if (!axeResult) notCovered.unshift('Element-level checks — the in-browser engine could not run on this page');
  else if (axeResult.contrastScope !== 'visible-area') notCovered.unshift('Colour contrast — it could not be measured on this page');
  else notCovered.unshift('Colour contrast below the area that fits on screen');
  if (!staticResult) notCovered.unshift('Page-level checks such as title and language');

  results.append(renderScope({
    standard: axeResult ? `${axeResult.engine}, WCAG 2.2 A/AA plus best practices` : 'static HTML checks only',
    mappedTo: 'EN 301 549 clause 9 (the standard the European Accessibility Act refers to)',
    notCovered,
  }, Boolean(axeResult?.truncated || staticResult?.truncated)));
}

/** One finding as a ledger entry. */
function renderAxeEntry(finding, severity) {
  const entry = el('article', `entry entry--${severity}`);
  const clause = el('p', 'entry__clause', finding.en301549 || finding.id);
  if (finding.en301549) clause.setAttribute('aria-label', `EN 301 549 clause ${finding.en301549}`);
  entry.append(clause);

  const body = el('div', 'entry__body');
  const head = el('div', 'entry__head');
  head.append(el('h3', 'entry__title', finding.help));
  head.append(el('p', 'entry__count', finding.nodes === 1 ? '1 element' : `${finding.nodes} elements`));
  body.append(head);
  body.append(el('p', 'entry__meta', [
    finding.impact,
    finding.wcag ? `WCAG ${finding.wcag}` : 'Best practice',
    finding.level ? `Level ${finding.level}` : null,
  ].filter(Boolean).join(' · ')));

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
