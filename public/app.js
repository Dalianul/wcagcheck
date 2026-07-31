/* wcagcheck.eu front end. No dependencies, no build step. */

const form = document.getElementById('scan-form');
const field = document.getElementById('url');
const go = document.getElementById('go');
const sweep = document.getElementById('sweep');
const results = document.getElementById('results');
const message = document.getElementById('message');

const SEVERITY_LABEL = { serious: 'Serious', moderate: 'Moderate', minor: 'Minor' };

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

function renderTally(data) {
  const { summary } = data;
  const tally = el('div', 'tally');

  const subject = el('div', 'tally__subject');
  const heading = el('h2', 'entry__title');
  heading.append(el('span', 'visually-hidden', 'Results for '));
  heading.append(document.createTextNode(data.pageTitle || 'Untitled page'));
  subject.append(heading);
  subject.append(el('p', 'tally__url', data.url));
  tally.append(subject);

  if (summary.totalOccurrences === 0) {
    tally.append(figure('0', 'issues found', 'clear'));
  } else {
    if (summary.serious) tally.append(figure(summary.serious, 'serious', 'serious'));
    if (summary.moderate) tally.append(figure(summary.moderate, 'moderate', 'moderate'));
    if (summary.minor) tally.append(figure(summary.minor, 'minor', 'minor'));
  }
  return tally;
}

function renderEntry(issue) {
  const entry = el('article', `entry entry--${issue.impact}`);

  const clause = el('p', 'entry__clause', issue.en301549);
  clause.setAttribute('aria-label', `EN 301 549 clause ${issue.en301549}`);
  entry.append(clause);

  const body = el('div', 'entry__body');

  const head = el('div', 'entry__head');
  head.append(el('h3', 'entry__title', issue.title));
  head.append(el('p', 'entry__count', issue.count === 1 ? '1 occurrence' : `${issue.count} occurrences`));
  body.append(head);

  body.append(
    el(
      'p',
      'entry__meta',
      `${SEVERITY_LABEL[issue.impact]} · WCAG ${issue.wcag} · Level ${issue.wcagLevel}`
    )
  );

  if (issue.remedy) body.append(el('p', 'entry__remedy', issue.remedy));

  if (issue.examples && issue.examples.length) {
    const list = el('ul', 'entry__samples');
    for (const sample of issue.examples) list.append(el('li', null, sample));
    body.append(list);
  }

  entry.append(body);
  return entry;
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

function render(data) {
  results.replaceChildren();
  results.append(renderTally(data));

  if (data.issues.length === 0) {
    const box = el('section', 'scope');
    box.append(el('h2', null, 'Nothing machine-detectable found'));
    box.append(
      el(
        'p',
        null,
        'None of the 20 static checks failed on this page. That clears the automated bar; the requirements that need a human reviewer are listed below.'
      )
    );
    results.append(box);
  } else {
    for (const issue of data.issues) results.append(renderEntry(issue));
  }

  results.append(renderScope(data.scope, data.truncated));
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
    const response = await fetch(`/api/scan?url=${encodeURIComponent(value)}`);
    const data = await response.json();

    if (!response.ok) {
      results.replaceChildren();
      showMessage("That page couldn't be scanned", data.error || 'Try a different address.');
      return;
    }
    render(data);
    // Move focus to the results region so keyboard users land on the findings
    // instead of having to tab back through the form.
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
