# Client-Side axe Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise detection from 20 static rules to axe-core's ~100 rules including colour contrast, by running axe in the visitor's browser against a same-origin sandboxed frame, with every finding carrying its derived EN 301 549 clause.

**Architecture:** The Worker gains `/api/fetch` returning a target page's raw HTML (reusing the existing SSRF guard and manual redirect follower). The client injects that HTML into an `<iframe sandbox="allow-same-origin" srcdoc>` with a `<base href>` so stylesheets resolve, sizes the frame to content height so contrast checks aren't skipped as out-of-viewport, lazy-loads a vendored `axe.min.js`, runs axe against the frame document, and derives each finding's WCAG criterion and EN 301 549 clause from axe's own `wcagNNN` tags. The existing `/api/scan` endpoint and its 20 rules remain untouched as the JSON API and the no-JavaScript fallback.

**Tech Stack:** Cloudflare Workers (static assets binding), vanilla ES modules with no build step, axe-core 4.12.1 vendored, vitest 4 via `@cloudflare/vitest-pool-workers` running in workerd.

## Global Constraints

- **Zero runtime dependencies.** axe-core is vendored as a static asset, never imported into the Worker. `axe-core` in `package.json` is a devDependency used only to sync the file.
- **No build step.** `public/` is served as-is. No bundler, no transpilation.
- **The frame gets `sandbox="allow-same-origin"` and never `allow-scripts`.** Together those allow sandboxed content to escape the sandbox, which is an XSS hole on our own origin. JS-rendered content stays undetected as a consequence.
- **`incomplete` axe results are never counted as passes.** They are surfaced as their own category.
- **Rules with no `wcagNNN` tag are labelled best practice**, not EN 301 549 requirements.
- **Lighthouse must stay at 100** for accessibility, best practices and SEO. axe must therefore load only on scan, never on page load.
- **axe-core is MPL-2.0.** Ship `axe.min.js` byte-for-byte unmodified with its licence header intact, alongside `LICENSE-axe-core.txt`, and link to the upstream source.
- **Existing 60 tests must keep passing.** Run the full suite in every verification step.
- **Every new test is mutation-checked:** reintroduce the bug, confirm the suite fails, restore.

---

## File Structure

| File | Responsibility |
|---|---|
| `public/vendor/axe.min.js` | Vendored axe-core 4.12.1, unmodified. Created by npm script. |
| `public/vendor/LICENSE-axe-core.txt` | MPL-2.0 text for the vendored file. |
| `public/en301549.js` | Pure functions: axe tag array → WCAG criterion, EN clause, conformance level, best-practice classification. No DOM. |
| `public/axe-runner.js` | Builds the sandboxed frame, loads axe, runs it, returns normalised findings. No rendering. |
| `public/app.js` | Modified: orchestrates fetch → axe-runner → render. |
| `src/fetch-html.js` | Worker handler returning `{ html, finalUrl }`. Reuses scan.js validation. |
| `src/scan.js` | Modified: export `normaliseUrl` and `fetchFollowingSafely`; correct the misleading 5xx message. |
| `src/index.js` | Modified: route `/api/fetch`. |
| `public/dev/fixture.html` | Fixture page with known violations, `noindex`, for browser verification. |
| `test/en301549.test.js` | Clause derivation tests. |
| `test/fetch-html.test.js` | Endpoint tests. |

---

### Task 1: Vendor axe-core

**Files:**
- Create: `public/vendor/axe.min.js` (generated)
- Create: `public/vendor/LICENSE-axe-core.txt` (generated)
- Modify: `package.json`
- Modify: `public/robots.txt`

**Interfaces:**
- Consumes: nothing
- Produces: `/vendor/axe.min.js` served as a static asset, exposing a global `axe` object with `axe.run(context, options)` returning a Promise.

- [ ] **Step 1: Add axe-core as a devDependency at an exact version**

```bash
npm install -D --save-exact axe-core@4.12.1
```

- [ ] **Step 2: Add the sync script to `package.json`**

Add to the `scripts` object, keeping existing entries:

```json
"sync:axe": "mkdir -p public/vendor && cp node_modules/axe-core/axe.min.js public/vendor/axe.min.js && cp node_modules/axe-core/LICENSE public/vendor/LICENSE-axe-core.txt"
```

- [ ] **Step 3: Run it and verify the licence header survived**

```bash
npm run sync:axe
head -c 400 public/vendor/axe.min.js
ls -l public/vendor/
```

Expected: `axe.min.js` present, roughly 550–700 KB, and the first bytes contain a comment naming axe-core with its version and `Mozilla Public License`. If the header is absent, stop — we may not redistribute it stripped.

- [ ] **Step 4: Confirm the vendored version matches the pin**

```bash
grep -o 'axe-core@\?4\.12\.1\|"4\.12\.1"' public/vendor/axe.min.js | head -2
node -e "console.log(require('./node_modules/axe-core/package.json').version)"
```

Expected: `4.12.1` from the second command; the first should find the version string in the bundle.

- [ ] **Step 5: Keep crawlers out of the vendor and dev directories**

In `public/robots.txt`, add these two lines directly below the existing `Disallow: /api/` line:

```
Disallow: /vendor/
Disallow: /dev/
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json public/vendor public/robots.txt
git commit -m "Vendor axe-core 4.12.1 as a static asset

Pinned exactly and copied from node_modules by npm run sync:axe, so the
runtime keeps zero dependencies and there is still no build step. Shipped
unmodified with its MPL-2.0 header and licence file as that licence
requires. Crawlers are kept out of /vendor/."
```

---

### Task 2: EN 301 549 clause derivation

**Files:**
- Create: `public/en301549.js`
- Test: `test/en301549.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `criterionFromTags(tags: string[]) → { wcag: string, en301549: string } | null` — null when no `wcagNNN` tag exists
  - `levelFromTags(tags: string[]) → 'A' | 'AA' | 'AAA' | null`
  - `isBestPractice(tags: string[]) → boolean`
  - `classify(tags: string[]) → { wcag, en301549, level, bestPractice }`

- [ ] **Step 1: Write the failing test**

Create `test/en301549.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/en301549.test.js
```

Expected: FAIL — `Failed to load .../public/en301549.js` or "does not provide an export named".

- [ ] **Step 3: Write the implementation**

Create `public/en301549.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run
```

Expected: PASS, all tests including the pre-existing 60.

- [ ] **Step 5: Mutation-check the level-tag exclusion**

The single most fragile assumption is that a level tag like `wcag21aa` is not
mistaken for a criterion. What actually protects that is the **`$` anchor**, not
the `+` quantifier — verified before writing this step:

Measured against the real tag set, not reasoned about — **both single-change
mutations are no-ops, and only the combined one bites:**

| Pattern | Matches |
|---|---|
| `^wcag(\d)(\d)(\d+)$` — shipped | `wcag111`, `wcag1410` |
| `^wcag(\d)(\d)(\d+)` — drop anchor only | `wcag111`, `wcag1410` — *no-op* |
| `^wcag(\d)(\d)(\d*)$` — quantifier only | `wcag111`, `wcag1410` — *no-op* |
| `^wcag(\d)(\d)(\d*)` — **both** | `wcag21aa`, `wcag22aa`, `wcag111`, `wcag1410` |

The reason both single changes fail to break anything: `wcag21aa` ends in
letters, so the second `(\d)` plus either the `$` anchor or the `+` quantifier
is enough to reject it on its own. Only removing *both* guards lets `(\d*)`
match zero digits and the pattern stop before `aa`.

So apply both changes together. Back up, edit, run:

```bash
cp public/en301549.js /tmp/en.bak.js
# in public/en301549.js change
#   /^wcag(\d)(\d)(\d+)$/   to   /^wcag(\d)(\d)(\d*)/
npx vitest run test/en301549.test.js
```

Expected: FAIL on "returns null when only level tags are present", because
`wcag21aa` now yields the malformed criterion `2.1.`.

Restore and confirm green:

```bash
cp /tmp/en.bak.js public/en301549.js
npx vitest run test/en301549.test.js
```

Restore and confirm green:

```bash
cp /tmp/en.bak.js public/en301549.js
npx vitest run test/en301549.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/en301549.js test/en301549.test.js
git commit -m "Derive EN 301 549 clauses from axe rule tags

axe tags each rule with its success criterion (wcag111, wcag1410) and its
level separately (wcag2a, wcag21aa). Clause 9 of EN 301 549 numbers its web
requirements to match WCAG, so the clause is the criterion prefixed with
9. — no mapping table to drift when axe adds rules.

The criterion pattern requires three or more digits so level tags are never
mistaken for criteria; that exclusion is mutation-checked. Rules tagged only
best-practice yield no clause and are reported separately rather than
inflating the compliance count."
```

---

### Task 3: Worker endpoint returning raw HTML

**Files:**
- Create: `src/fetch-html.js`
- Modify: `src/scan.js` (export two functions; correct one message)
- Modify: `src/index.js` (add route)
- Test: `test/fetch-html.test.js`

**Interfaces:**
- Consumes: `isBlockedHost` from `src/scan.js` (already exported)
- Produces:
  - `src/scan.js` additionally exports `normaliseUrl(raw) → URL` (throws `Error` with a user-facing message) and `fetchFollowingSafely(startUrl: URL, signal: AbortSignal) → { response: Response, finalUrl: URL }`
  - `src/fetch-html.js` exports `handleFetchHtml(request) → Response` with JSON body `{ html: string, finalUrl: string, bytes: number }` on success or `{ error: string }` on failure

- [ ] **Step 1: Write the failing test**

Create `test/fetch-html.test.js`:

```javascript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleFetchHtml } from '../src/fetch-html.js';

function servePage(html, init = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(html, {
        status: init.status ?? 200,
        headers: { 'content-type': init.contentType ?? 'text/html; charset=utf-8' },
      })
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const url = (target) =>
  new Request(`https://wcagcheck.eu/api/fetch?url=${encodeURIComponent(target)}`);

describe('handleFetchHtml', () => {
  it('returns the raw html and the final url', async () => {
    servePage('<!doctype html><html lang="en"><body>hi</body></html>');
    const res = await handleFetchHtml(url('https://example.com/'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.html).toContain('<body>hi</body>');
    expect(body.finalUrl).toBe('https://example.com/');
    expect(body.bytes).toBeGreaterThan(0);
  });

  it('rejects a missing url', async () => {
    const res = await handleFetchHtml(new Request('https://wcagcheck.eu/api/fetch'));
    expect(res.status).toBe(400);
  });

  // Same guard as /api/scan — this endpoint must not become an SSRF bypass.
  it('rejects a private address', async () => {
    const res = await handleFetchHtml(url('http://169.254.169.254/'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a public website/i);
  });

  it('rejects a non-HTML response', async () => {
    servePage('{}', { contentType: 'application/json' });
    const res = await handleFetchHtml(url('https://example.com/x.json'));
    expect(res.status).toBe(502);
  });

  it('explains a 403 as bot protection', async () => {
    servePage('', { status: 403 });
    const res = await handleFetchHtml(url('https://example.com/'));
    expect((await res.json()).error).toMatch(/refuses automated requests/i);
  });

  // Regression: a 511 from a site blocking us was being reported as the site
  // being broken, which sends people to debug the wrong thing.
  it('describes a 511 as a block, not an origin error', async () => {
    servePage('', { status: 511 });
    const res = await handleFetchHtml(url('https://example.com/'));
    // Read the body once — a Response body cannot be consumed twice.
    const { error } = await res.json();
    expect(error).toMatch(/blocking|refuses/i);
    expect(error).not.toMatch(/itself is erroring/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run test/fetch-html.test.js
```

Expected: FAIL — cannot resolve `../src/fetch-html.js`.

- [ ] **Step 3: Export the two helpers from `src/scan.js`**

Change line 124 from:

```javascript
function normaliseUrl(raw) {
```

to:

```javascript
export function normaliseUrl(raw) {
```

Change line 214 from:

```javascript
async function fetchFollowingSafely(startUrl, signal) {
```

to:

```javascript
export async function fetchFollowingSafely(startUrl, signal) {
```

- [ ] **Step 4: Correct the misleading 5xx message in `src/scan.js`**

Replace this block (near line 281):

```javascript
    if (response.status >= 500) {
      throw new Error(`The site itself is erroring (HTTP ${response.status}). Nothing to check yet.`);
    }
```

with:

```javascript
    // 511 and 520-527 are gateway-level rejections, not the origin failing.
    // Reporting them as "the site is broken" sends people to debug the wrong
    // thing — emag.ro returns 511 to us while serving browsers normally.
    if (response.status === 511 || (response.status >= 520 && response.status <= 527)) {
      throw new Error(
        `The site is blocking automated requests at its gateway (HTTP ${response.status}). ` +
          'It loads normally in a browser, so this is not a fault on the site.'
      );
    }
    if (response.status >= 500) {
      throw new Error(`The site itself is erroring (HTTP ${response.status}). Nothing to check yet.`);
    }
```

- [ ] **Step 5: Write `src/fetch-html.js`**

```javascript
/**
 * Returns a target page's raw HTML so the client can analyse it in a frame.
 *
 * Shares the validation and redirect handling used by /api/scan, so this
 * endpoint cannot become a softer SSRF path than the one already hardened.
 */

import { normaliseUrl, fetchFollowingSafely } from './scan.js';

const MAX_BYTES = 2_500_000;
const FETCH_TIMEOUT_MS = 20_000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

export async function handleFetchHtml(request) {
  const target = new URL(request.url).searchParams.get('url');

  let parsed;
  try {
    parsed = normaliseUrl(target);
  } catch (err) {
    return json({ error: err.message }, 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  let finalUrl;
  try {
    ({ response, finalUrl } = await fetchFollowingSafely(parsed, controller.signal));
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return json({ error: 'The site took longer than 20 seconds to respond.' }, 502);
    }
    if (/redirect/i.test(err.message)) return json({ error: err.message }, 502);
    return json({ error: 'Could not reach that address. Check the spelling and that the site is public.' }, 502);
  }
  clearTimeout(timer);

  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      return json({ error: 'The site refuses automated requests, so it cannot be checked from here.' }, 502);
    }
    if (response.status === 429) {
      return json({ error: 'The site is rate-limiting requests right now. Wait a minute and try again.' }, 502);
    }
    if (response.status === 404) {
      return json({ error: 'That page does not exist (404). Check the path after the domain name.' }, 502);
    }
    if (response.status === 511 || (response.status >= 520 && response.status <= 527)) {
      return json({
        error:
          `The site is blocking automated requests at its gateway (HTTP ${response.status}). ` +
          'It loads normally in a browser, so this is not a fault on the site.',
      }, 502);
    }
    return json({ error: `The site returned HTTP ${response.status}. Nothing to check.` }, 502);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('html')) {
    return json(
      { error: `That address returned ${contentType.split(';')[0] || 'a non-HTML file'}. Point it at a web page.` },
      502
    );
  }

  const html = (await response.text()).slice(0, MAX_BYTES);
  return json({ html, finalUrl: finalUrl.toString(), bytes: html.length }, 200);
}
```

- [ ] **Step 6: Route it in `src/index.js`**

Add the import beneath the existing one:

```javascript
import { handleFetchHtml } from './fetch-html.js';
```

Add this branch immediately after the closing brace of the `/api/scan` branch:

```javascript
    if (url.pathname === '/api/fetch') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Use GET.' }), {
          status: 405,
          headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET' },
        });
      }
      return handleFetchHtml(request);
    }
```

- [ ] **Step 7: Run the full suite**

```bash
npx vitest run
```

Expected: PASS — the pre-existing 60 tests plus the new ones.

- [ ] **Step 8: Verify the route end to end against the dev server**

```bash
npx wrangler dev --port 8788 --ip 127.0.0.1 &
sleep 8
curl -s "http://127.0.0.1:8788/api/fetch?url=https%3A%2F%2Fexample.com" | head -c 200
curl -s -o /dev/null -w "405 check: %{http_code}\n" -X POST "http://127.0.0.1:8788/api/fetch?url=https://example.com"
curl -s "http://127.0.0.1:8788/api/fetch?url=http%3A%2F%2F127.0.0.1" | head -c 120
```

Expected: first returns JSON containing `"html"` and `"finalUrl"`; second prints `405`; third returns the "not a public website" error.

- [ ] **Step 9: Commit**

```bash
git add src/fetch-html.js src/scan.js src/index.js test/fetch-html.test.js
git commit -m "Add /api/fetch returning raw HTML for client-side analysis

Reuses normaliseUrl and fetchFollowingSafely from scan.js rather than
duplicating them, so this endpoint inherits the hardened host guard and
per-hop redirect validation instead of becoming a softer SSRF path.

Also corrects a misleading error: 511 and 520-527 are gateway rejections,
not the origin failing. Reporting them as 'the site itself is erroring'
sent people to debug the wrong thing — emag.ro returns 511 to us while
serving browsers normally."
```

---

### Task 4 — SUPERSEDED by Task 4R below

The iframe approach in this task **does not work**. Measured in Chrome against
axe-core 4.12.1:

| Attempt | Result |
|---|---|
| `axe.run(frame.contentDocument)` | throws *"axe.run arguments are invalid"* — a `Document` is not a valid context |
| `axe.run({include:[frame.contentDocument.documentElement]})` | accepted, but finds only `frame-title` — nothing inside the frame |
| `axe.run(frameElement)` | same |
| open shadow root on a div | **works** — finds `button-name`, `image-alt`, `label`, `link-name`; inline `<script>` does not execute |

axe's cross-frame traversal requires axe to be running *inside* each frame,
which needs `allow-scripts`, which is ruled out. Contrast additionally requires
the content to be genuinely visible:

| Container | `color-contrast` |
|---|---|
| off-screen `left:-10000px` | `inapplicable` — never evaluated |
| in viewport, `opacity:0.01` | `incomplete` (`bgOverlap`) |
| in viewport, visible | **`violations: 1`** — correct |

Kept here rather than deleted, because the reason it failed is the most useful
thing in this document.

---

### Task 4R: The axe runner (shadow DOM)

**Files:**
- Create: `public/sanitise.js`
- Create: `public/axe-runner.js` (replacing the superseded version)
- Create: `public/dev/fixture.html`
- Test: `test/sanitise.test.js`

**Interfaces:**
- Consumes: `classify` from `public/en301549.js`; global `axe` from `/vendor/axe.min.js`; `GET /api/fetch`
- Produces:
  - `sanitiseForAnalysis(html: string, baseUrl: string) → string` in `public/sanitise.js`
  - `runAxeScan(target: string) → Promise<Result>` in `public/axe-runner.js`, with `Result` as the superseded task defined it, plus `contrastScope: 'visible-area' | 'not-assessed'`

**The security position, stated because it is the crux of this task**

We are inserting third-party HTML into our own origin. `innerHTML` never
executes `<script>`, but event-handler attributes fire on their own —
`<img src=x onerror=…>` runs without any interaction. So sanitisation is not
defence in depth here, it is the only barrier.

The threat model is narrow, which is what makes hand-written sanitisation
defensible: we insert once via `innerHTML`, never execute scripts, never
activate links, and remove the subtree immediately. The vectors that fire
automatically are event-handler attributes and auto-loading embedded content.
Removing **every** attribute matching `/^on/i` — not a blocklist of specific
handlers — is complete for that class.

- [ ] **Step 1: Write the failing sanitiser test**

Create `test/sanitise.test.js`. Note these tests run in the Workers pool, which
has no `DOMParser`, so the sanitiser must be string-based and dependency-free:

```javascript
import { describe, it, expect } from 'vitest';
import { sanitiseForAnalysis } from '../public/sanitise.js';

const base = 'https://example.com/shop/page';

describe('sanitiseForAnalysis — things that execute', () => {
  it('removes script elements and their contents', () => {
    const out = sanitiseForAnalysis('<p>a</p><script>window.x=1</script><p>b</p>', base);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/window\.x/);
  });

  // The vector that fires with no interaction at all.
  it('removes onerror', () => {
    const out = sanitiseForAnalysis('<img src="missing.png" onerror="window.x=1" alt="a">', base);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toMatch(/alt="a"/);
  });

  it('removes every on* handler regardless of name or case', () => {
    const out = sanitiseForAnalysis(
      '<div ONCLICK="a()" onMouseOver=\'b()\' onfocus=c() onanything="d()">x</div>', base
    );
    expect(out).not.toMatch(/on[a-z]+\s*=/i);
  });

  it('removes javascript: urls but keeps the element', () => {
    const out = sanitiseForAnalysis('<a href="javascript:alert(1)">click</a>', base);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toMatch(/<a /);
  });

  it('removes auto-loading embedded content', () => {
    const out = sanitiseForAnalysis('<iframe src="x"></iframe><object data="y"></object><embed src="z">', base);
    expect(out).not.toMatch(/<iframe|<object|<embed/i);
  });

  it('removes meta refresh', () => {
    const out = sanitiseForAnalysis('<meta http-equiv="refresh" content="0;url=http://evil.test">', base);
    expect(out).not.toMatch(/http-equiv/i);
  });
});

describe('sanitiseForAnalysis — things axe needs kept', () => {
  it('keeps style elements, because contrast depends on them', () => {
    const out = sanitiseForAnalysis('<style>.a{color:#999;background:#fff}</style><p class="a">x</p>', base);
    expect(out).toMatch(/<style>/);
    expect(out).toMatch(/color:#999/);
  });

  it('keeps accessibility attributes', () => {
    const html = '<button aria-label="Close" aria-expanded="false" role="button" tabindex="0"></button>';
    const out = sanitiseForAnalysis(html, base);
    for (const attr of ['aria-label="Close"', 'aria-expanded="false"', 'role="button"', 'tabindex="0"']) {
      expect(out).toContain(attr);
    }
  });

  it('keeps alt, label association and lang', () => {
    const html = '<html lang="ro"><img src="a.png" alt=""><label for="x">N</label><input id="x"></html>';
    const out = sanitiseForAnalysis(html, base);
    expect(out).toMatch(/lang="ro"/);
    expect(out).toMatch(/alt=""/);
    expect(out).toMatch(/for="x"/);
  });
});

describe('sanitiseForAnalysis — url resolution', () => {
  // Shadow DOM ignores <base>, so relative URLs must be absolute before
  // insertion or the target's stylesheets never load and contrast is wrong.
  it('absolutises relative stylesheet and image urls', () => {
    const out = sanitiseForAnalysis(
      '<link rel="stylesheet" href="/css/main.css"><img src="../img/a.png" alt="a">', base
    );
    expect(out).toContain('https://example.com/css/main.css');
    expect(out).toContain('https://example.com/img/a.png');
  });

  it('leaves absolute and data urls alone', () => {
    const out = sanitiseForAnalysis(
      '<img src="https://cdn.test/a.png" alt="a"><img src="data:image/gif;base64,AA" alt="b">', base
    );
    expect(out).toContain('https://cdn.test/a.png');
    expect(out).toContain('data:image/gif;base64,AA');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run test/sanitise.test.js
```

Expected: FAIL — cannot resolve `../public/sanitise.js`.

- [ ] **Step 3: Implement `public/sanitise.js`**

String-based so it runs both in the browser and in the Workers test pool.

```javascript
/**
 * Prepares third-party HTML for rendering inside our own origin.
 *
 * We render scanned pages in an open shadow root so axe can traverse them,
 * which means the browser gives us no isolation — sanitisation is the only
 * barrier, not a second layer.
 *
 * The threat model is deliberately narrow: the HTML is inserted once via
 * innerHTML, no script ever executes (innerHTML does not run <script>), no link
 * is activated, and the subtree is removed immediately. What remains is content
 * that acts on its own — event-handler attributes and auto-loading embeds. So
 * every attribute matching /^on/i is removed, by pattern rather than by a list
 * of known handler names, which is what makes the removal complete for that
 * class rather than a guess at today's vocabulary.
 *
 * Style elements and accessibility attributes are preserved deliberately:
 * stripping them would silently change the very results we are measuring.
 */

const VOID_OR_PAIRED_REMOVED = ['script', 'iframe', 'object', 'embed', 'noscript', 'template'];

function stripElement(html, tag) {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
  const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi');
  return html.replace(paired, '').replace(selfClosing, '');
}

/** Rewrites a relative URL against the scanned page's address. */
function absolutise(value, baseUrl) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^(https?:|data:|mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

export function sanitiseForAnalysis(html, baseUrl) {
  let out = String(html);

  for (const tag of VOID_OR_PAIRED_REMOVED) out = stripElement(out, tag);

  // Anything that navigates or reloads on its own.
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');

  // Every event-handler attribute, quoted or bare, any case.
  //
  // The separator class is [\s/]+ not \s+ because HTML accepts a solidus
  // between attributes: after a quoted value, and directly after the tag name.
  // Requiring whitespace let <img src="x.png"/onerror="..."> through, and it
  // fired — four variants verified in Chrome.
  out = out.replace(/[\s/]+on[a-z0-9_-]*\s*=\s*"[^"]*"/gi, ' ');
  out = out.replace(/[\s/]+on[a-z0-9_-]*\s*=\s*'[^']*'/gi, ' ');
  out = out.replace(/[\s/]+on[a-z0-9_-]*\s*=\s*[^\s>]+/gi, ' ');

  // Script-bearing URLs, keeping the element so axe still evaluates it.
  out = out.replace(
    /\s(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi,
    ' $1="#"'
  );

  // Shadow DOM ignores <base>, so URLs must already be absolute.
  out = out.replace(
    /\s(href|src|srcset|poster)\s*=\s*"([^"]*)"/gi,
    (whole, attr, value) => ` ${attr}="${absolutise(value, baseUrl)}"`
  );
  out = out.replace(
    /\s(href|src|srcset|poster)\s*=\s*'([^']*)'/gi,
    (whole, attr, value) => ` ${attr}='${absolutise(value, baseUrl)}'`
  );

  return out;
}
```

- [ ] **Step 4: Run the sanitiser tests, then the full suite**

```bash
npx vitest run test/sanitise.test.js
npx vitest run
```

Expected: sanitiser tests PASS; full suite PASS including every pre-existing test.

- [ ] **Step 5: Mutation-check the sanitiser — this is the security barrier**

For each row: break it, confirm the named test fails, restore. Record every result.

| Break this | Expected failing test |
|---|---|
| delete the three `\son[a-z0-9_-]*` replacements | "removes onerror" and "removes every on* handler" |
| remove `'script'` from `VOID_OR_PAIRED_REMOVED` | "removes script elements and their contents" |
| remove the `javascript\|vbscript` replacement | "removes javascript: urls but keeps the element" |
| make `absolutise` return `value` unchanged | "absolutises relative stylesheet and image urls" |
| add `'style'` to `VOID_OR_PAIRED_REMOVED` | "keeps style elements, because contrast depends on them" |

If any row does not produce a failure, that test protects nothing — fix the test so it does.

- [ ] **Step 6: Create the verification fixture**

Create `public/dev/fixture.html`:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>axe verification fixture</title>
<style>
  .low-contrast { color: #999999; background: #ffffff; font-size: 16px; }
</style>
</head>
<body>
  <!-- expect: html-has-lang (no lang attribute above) -->
  <!-- expect: image-alt -->
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
  <!-- expect: link-name -->
  <a href="/somewhere"></a>
  <!-- expect: button-name -->
  <button></button>
  <!-- expect: label -->
  <input type="text" name="unlabelled">
  <!-- expect: color-contrast -->
  <p class="low-contrast">This grey text on white fails the AA contrast requirement.</p>
  <!-- expect: heading-order -->
  <h1>One</h1>
  <h4>Four, skipping two and three</h4>
</body>
</html>
```

- [ ] **Step 7: Implement `public/axe-runner.js`** — full code in the section below, under "Task 4R runner source".

- [ ] **Step 8: Syntax check, full suite, commit**

```bash
node --check public/sanitise.js
node --check public/axe-runner.js
npx vitest run
```

Expected: no syntax output; full suite passes. In-browser verification is done by
the controller, not this task.

```bash
git add public/sanitise.js public/axe-runner.js public/dev/fixture.html test/sanitise.test.js
git commit -m "Run axe in a shadow root instead of an iframe

axe cannot analyse a sandboxed frame: cross-frame support needs axe running
inside the frame, which needs allow-scripts, which would let sandboxed
content escape into our origin. Measured — passing frame.contentDocument
throws, and the context forms axe accepts find only frame-title. An open
shadow root works and keeps the target's CSS off our page.

The stage renders visibly because axe cannot judge contrast otherwise:
off-screen content is inapplicable, near-transparent comes back incomplete.
Only on-screen content yields a verdict, so contrastScope reports
visible-area rather than implying whole-page coverage.

Rendering third-party HTML in our own origin means the browser gives us no
isolation, so sanitise.js is the only barrier. innerHTML never executes
script elements, but handler attributes fire unprompted, so every attribute
matching /^on/i is removed by pattern rather than by a list of known names."
```

---

### Task 4 (original, superseded — kept for the record)

**Files:**
- Create: `public/axe-runner.js`
- Create: `public/dev/fixture.html`

**Interfaces:**
- Consumes: `classify` from `public/en301549.js`; the global `axe` from `/vendor/axe.min.js`; `/api/fetch`
- Produces: `runAxeScan(target: string) → Promise<Result>` where `Result` is

```javascript
{
  finalUrl: string,
  engine: 'axe-core 4.12.1',
  requirements: Array<Finding>,   // has an EN clause
  bestPractices: Array<Finding>,  // no EN clause
  incomplete: Array<Finding>,     // axe could not decide — never a pass
  counts: { violations: number, incomplete: number, passes: number, inapplicable: number }
}
```

and `Finding` is

```javascript
{
  id: string,          // axe rule id, e.g. 'color-contrast'
  help: string,        // axe's short description
  helpUrl: string,
  impact: 'critical'|'serious'|'moderate'|'minor'|null,
  wcag: string|null,   // '1.4.3'
  en301549: string|null, // '9.1.4.3'
  level: 'A'|'AA'|'AAA'|null,
  nodes: number,
  examples: string[]   // up to 5 truncated html snippets
}
```

- [ ] **Step 1: Create the verification fixture**

Create `public/dev/fixture.html`. Each violation is deliberate and named so the browser check has expected rule ids:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>axe verification fixture</title>
<style>
  .low-contrast { color: #999999; background: #ffffff; }
</style>
</head>
<body>
  <!-- expect: html-has-lang (no lang attribute above) -->
  <!-- expect: image-alt -->
  <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
  <!-- expect: link-name -->
  <a href="/somewhere"></a>
  <!-- expect: button-name -->
  <button></button>
  <!-- expect: label -->
  <input type="text" name="unlabelled">
  <!-- expect: color-contrast -->
  <p class="low-contrast">This grey text on white fails AA contrast.</p>
  <!-- expect: heading-order -->
  <h1>One</h1>
  <h4>Four, skipping two and three</h4>
  <!-- expect: duplicate-id or landmark rules may also fire; that is fine -->
  <div id="dup">a</div>
  <div id="dup">b</div>
</body>
</html>
```

- [ ] **Step 2: Write `public/axe-runner.js`**

```javascript
/**
 * Runs axe-core in the visitor's browser against a fetched page.
 *
 * The page HTML is injected into a same-origin frame rather than analysed as a
 * string, because axe needs a real DOM with layout — colour contrast in
 * particular reports "outsideViewport" for anything not laid out, so the frame
 * is sized to its content height before the run.
 *
 * The frame is sandboxed with allow-same-origin and deliberately NOT
 * allow-scripts. Those two together let sandboxed content remove its own
 * sandbox, which would execute arbitrary third-party JavaScript in our origin.
 * The cost is that script-rendered content is invisible to the scan.
 */

import { classify } from './en301549.js';

const AXE_URL = '/vendor/axe.min.js';
const AXE_VERSION = 'axe-core 4.12.1';
const MAX_EXAMPLES = 5;
const FRAME_MIN_HEIGHT = 800;
const FRAME_MAX_HEIGHT = 15000;
const FRAME_WIDTH = 1280;

let axeLoading = null;

/** Loads axe once, on first scan. Never on page load — it is ~600 KB. */
function loadAxe() {
  if (window.axe) return Promise.resolve(window.axe);
  if (axeLoading) return axeLoading;

  axeLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = AXE_URL;
    script.onload = () => (window.axe ? resolve(window.axe) : reject(new Error('axe failed to initialise')));
    script.onerror = () => reject(new Error('Could not load the analysis engine.'));
    document.head.append(script);
  });
  return axeLoading;
}

/** Injects <base> so relative stylesheet and image URLs resolve against the target. */
function withBase(html, finalUrl) {
  const base = `<base href="${finalUrl.replace(/"/g, '&quot;')}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${base}</head>`);
  return `<head>${base}</head>${html}`;
}

function buildFrame(html, finalUrl) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'Analysis frame';
  // Rendered, but pushed out of sight. display:none would remove layout and
  // every contrast check would come back as incomplete.
  frame.style.cssText =
    `position:absolute;left:-10000px;top:0;width:${FRAME_WIDTH}px;` +
    `height:${FRAME_MIN_HEIGHT}px;border:0;visibility:visible;`;
  frame.srcdoc = withBase(html, finalUrl);
  document.body.append(frame);

  return new Promise((resolve, reject) => {
    const failed = setTimeout(() => reject(new Error('The page took too long to render for analysis.')), 20000);
    frame.addEventListener('load', () => {
      clearTimeout(failed);
      resolve(frame);
    });
  });
}

/** Grows the frame to its content height so contrast checks are in-viewport. */
function fitToContent(frame) {
  try {
    const doc = frame.contentDocument;
    const height = Math.max(
      FRAME_MIN_HEIGHT,
      Math.min(FRAME_MAX_HEIGHT, doc.documentElement.scrollHeight || 0)
    );
    frame.style.height = `${height}px`;
  } catch {
    // Same-origin access should always work for srcdoc; if it doesn't, the
    // default height still yields useful non-contrast results.
  }
}

function toFinding(result) {
  const meta = classify(result.tags);
  return {
    id: result.id,
    help: result.help,
    helpUrl: result.helpUrl,
    impact: result.impact ?? null,
    wcag: meta.wcag,
    en301549: meta.en301549,
    level: meta.level,
    nodes: result.nodes.length,
    examples: result.nodes.slice(0, MAX_EXAMPLES).map((node) => {
      const html = node.html || '';
      return html.length > 200 ? `${html.slice(0, 197)}...` : html;
    }),
  };
}

export async function runAxeScan(target) {
  const response = await fetch(`/api/fetch?url=${encodeURIComponent(target)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'That page could not be fetched.');

  const axe = await loadAxe();
  const frame = await buildFrame(payload.html, payload.finalUrl);
  fitToContent(frame);

  try {
    const results = await axe.run(frame.contentDocument, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      resultTypes: ['violations', 'incomplete'],
besides: undefined,
    });

    const violations = results.violations.map(toFinding);
    return {
      finalUrl: payload.finalUrl,
      engine: AXE_VERSION,
      requirements: violations.filter((f) => f.en301549),
      bestPractices: violations.filter((f) => !f.en301549),
      // Never folded into passes: axe could not decide these.
      incomplete: results.incomplete.map(toFinding),
      counts: {
        violations: results.violations.length,
        incomplete: results.incomplete.length,
        passes: results.passes.length,
        inapplicable: results.inapplicable.length,
      },
    };
  } finally {
    frame.remove();
  }
}
```

- [ ] **Step 3: Remove the stray key that will throw**

The snippet above contains a deliberate error to catch copy-paste-without-reading: the line `besides: undefined,` is not a valid axe option and must be deleted. Delete that line, then verify the file parses:

```bash
node --check public/axe-runner.js
```

Expected: no output, exit 0.

- [ ] **Step 4: Verify in a real browser against the fixture**

Start the dev server, then load `http://127.0.0.1:8788/dev/fixture.html` and run the scan against it from the console:

```bash
npx wrangler dev --port 8788 --ip 127.0.0.1 &
sleep 8
```

In Chrome at `http://127.0.0.1:8788/`, open the console and run:

```javascript
const { runAxeScan } = await import('/axe-runner.js');
const r = await runAxeScan('http://127.0.0.1:8788/dev/fixture.html');
console.log(r.counts, r.requirements.map(f => `${f.en301549} ${f.id}`));
```

Note the fixture is on localhost, which `/api/fetch` refuses by design. So for this check temporarily point it at a public equivalent instead: run against `https://example.com` and confirm the shape, then confirm the fixture path by loading the fixture directly and running `axe.run(document)` in its own tab:

```javascript
// In the fixture's own tab, after loading /vendor/axe.min.js manually:
const s = document.createElement('script'); s.src = '/vendor/axe.min.js';
document.head.append(s); await new Promise(r => s.onload = r);
const res = await axe.run(document);
console.log(res.violations.map(v => v.id).sort());
```

Expected to include at least: `button-name`, `color-contrast`, `html-has-lang`, `image-alt`, `label`, `link-name`. If `color-contrast` is missing, the frame sizing or CSS loading is wrong — stop and fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add public/axe-runner.js public/dev/fixture.html
git commit -m "Add client-side axe runner

Injects fetched HTML into a same-origin frame and runs axe there, so
detection reaches ~100 rules including colour contrast without any server
compute. The frame is sized to its content height first: axe reports
contrast as 'outsideViewport' for anything without layout, so a hidden
frame would silently lose the most valuable check.

Sandboxed with allow-same-origin and deliberately not allow-scripts —
together they let sandboxed content escape the sandbox and run arbitrary
third-party JavaScript in our origin. Script-rendered content is therefore
not analysed.

axe's incomplete results are kept as their own category and never counted
as passes. Rules without a wcagNNN tag are separated as best practice
rather than reported as EN 301 549 requirements."
```

---

### Task 5: Wire it into the page

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/sitemap.xml` (unchanged content, verified)

**Interfaces:**
- Consumes: `runAxeScan` from `public/axe-runner.js`
- Produces: no new exports; the page now renders axe findings, falling back to `/api/scan` when the axe path fails

- [ ] **Step 1: Make `app.js` a module and import the runner**

In `public/index.html`, change the script tag from:

```html
<script src="/app.js" defer></script>
```

to:

```html
<script src="/app.js" type="module"></script>
```

- [ ] **Step 2: Add the axe path with a fallback in `public/app.js`**

Add at the top of the file:

```javascript
import { runAxeScan } from './axe-runner.js';
```

In the `form.addEventListener('submit', …)` handler that begins at line 139, replace **lines 152–165** — from `const response = await fetch(...)` through the `heading.focus();` block inside `try` — with the following. Leave the `catch`/`finally` that follow it untouched:

```javascript
    let data;
    let engine = 'axe';
    try {
      data = await runAxeScan(value);
    } catch (axeError) {
      // The static scan still works without a DOM, so a failed axe path
      // degrades instead of dead-ending. Errors that came from /api/fetch are
      // real and user-facing; surface those rather than retrying.
      if (/could not be fetched|blocking|refuses|rate-limiting|does not exist|private address/i.test(axeError.message)) {
        results.replaceChildren();
        showMessage("That page couldn't be scanned", axeError.message);
        return;
      }
      engine = 'static';
      const response = await fetch(`/api/scan?url=${encodeURIComponent(value)}`);
      data = await response.json();
      if (!response.ok) {
        results.replaceChildren();
        showMessage("That page couldn't be scanned", data.error || 'Try a different address.');
        return;
      }
    }

    renderResult(data, engine);
    results.tabIndex = -1;
    results.focus();
```

- [ ] **Step 3: Add `renderResult` to `public/app.js`**

Add this function above the submit handler. It routes to the existing `render()` for the static shape and renders axe findings itself:

```javascript
/** Renders either an axe result or the static-scan result. */
function renderResult(data, engine) {
  if (engine === 'static') {
    render(data);
    return;
  }

  results.replaceChildren();

  const tally = el('div', 'tally');
  const subject = el('div', 'tally__subject');
  const heading = el('h2', 'entry__title');
  heading.append(el('span', 'visually-hidden', 'Results for '));
  heading.append(document.createTextNode(data.finalUrl));
  subject.append(heading);
  subject.append(el('p', 'tally__url', `${data.engine} · ${data.counts.passes} checks passed`));
  tally.append(subject);

  if (data.requirements.length === 0 && data.incomplete.length === 0) {
    tally.append(figure('0', 'issues found', 'clear'));
  } else {
    if (data.requirements.length) tally.append(figure(data.requirements.length, 'requirement failures', 'serious'));
    if (data.bestPractices.length) tally.append(figure(data.bestPractices.length, 'best practice', 'minor'));
    if (data.incomplete.length) tally.append(figure(data.incomplete.length, 'needs review', 'moderate'));
  }
  results.append(tally);

  for (const finding of data.requirements) results.append(renderAxeEntry(finding, 'serious'));
  for (const finding of data.bestPractices) results.append(renderAxeEntry(finding, 'minor'));
  for (const finding of data.incomplete) results.append(renderAxeEntry(finding, 'moderate'));

  results.append(renderScope({
    standard: `${data.engine}, WCAG 2.2 A/AA plus best practices`,
    mappedTo: 'EN 301 549 clause 9 (the standard referenced by the European Accessibility Act)',
    notCovered: [
      'Content rendered by JavaScript — scripts are not executed, by design',
      'Anything below the analysed viewport height',
      'The roughly two thirds of WCAG criteria that need human judgement',
    ],
  }, false));
}

/** One axe finding as a ledger entry. */
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

  const meta = [finding.impact, finding.wcag ? `WCAG ${finding.wcag}` : 'Best practice', finding.level ? `Level ${finding.level}` : null]
    .filter(Boolean)
    .join(' · ');
  body.append(el('p', 'entry__meta', meta));

  if (finding.examples.length) {
    const list = el('ul', 'entry__samples');
    for (const sample of finding.examples) list.append(el('li', null, sample));
    body.append(list);
  }

  entry.append(body);
  return entry;
}
```

- [ ] **Step 4: Update the on-page claim about check count**

In `public/index.html`, change:

```html
        <p class="probe__note">20 checks &middot; no signup &middot; nothing stored</p>
```

to:

```html
        <p class="probe__note">100+ checks incl. colour contrast &middot; no signup &middot; nothing stored</p>
```

And in the "Static analysis only" explainer paragraph, replace its text with:

```html
          Your browser renders the page in a sandboxed frame and runs the axe-core
          engine against it &mdash; the same engine used in most accessibility test
          suites. Scripts are deliberately not executed, so content built by
          JavaScript is not analysed.
```

- [ ] **Step 4b: Satisfy the MPL-2.0 attribution requirement**

The Global Constraints require linking to the upstream source of the vendored
axe-core. Nothing else in this plan does it, so it happens here.

In `public/index.html`, inside the `<footer class="foot">` block, add this line
directly after the existing `<p>References: …</p>` paragraph:

```html
    <p>Analysis by <a href="https://github.com/dequelabs/axe-core">axe-core</a> 4.12.1, &copy; Deque Systems, used under the <a href="https://www.mozilla.org/en-US/MPL/2.0/">Mozilla Public License 2.0</a>. Source: <a href="https://github.com/dequelabs/axe-core">github.com/dequelabs/axe-core</a>.</p>
```

Verify the licence file we ship is reachable:

```bash
curl -s -o /dev/null -w "licence: %{http_code}\n" http://127.0.0.1:8788/vendor/LICENSE-axe-core.txt
```

Expected: `200`.

- [ ] **Step 5: Verify in the browser and re-check Lighthouse**

```bash
npx wrangler dev --port 8788 --ip 127.0.0.1 &
sleep 8
```

In Chrome, load `http://127.0.0.1:8788/`, scan `https://example.com`, and confirm: findings render with EN clause numbers, the tally shows passed-check count, and no console errors.

Then run a Lighthouse audit on `http://127.0.0.1:8788/` (mobile). Expected: accessibility 100, best practices 100, SEO 100. If any dropped, axe is loading on page load rather than on scan — fix before committing.

- [ ] **Step 6: Run the full suite**

```bash
npx vitest run
```

Expected: PASS. No test touches `app.js`, so this is a regression check on everything else.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/index.html
git commit -m "Render axe findings, falling back to the static scan

The page now runs axe in the visitor's browser and renders findings keyed on
their EN 301 549 clause. When the axe path fails for a reason that isn't the
target being unreachable, it degrades to the 20-rule static scan rather than
dead-ending.

Incomplete results render as 'needs review' in their own group, and best
practices are separated from requirements, so a clean requirement count is
never manufactured by hiding what axe could not decide.

axe loads only on scan, keeping Lighthouse at 100."
```

---

## Task 4R runner source

The complete `public/axe-runner.js` referenced by Task 4R Step 7:

```javascript
/**
 * Runs axe-core in the visitor's browser against a fetched page.
 *
 * The page renders in an OPEN SHADOW ROOT, not an iframe. axe cannot traverse
 * into a sandboxed frame — its cross-frame support requires axe running inside
 * the frame, which needs allow-scripts, which would let sandboxed content escape
 * into our origin. A shadow root is the only container axe can see into that also
 * keeps the target's CSS off our page.
 *
 * The stage is rendered VISIBLY during the scan because axe cannot judge colour
 * contrast otherwise: off-screen content is reported inapplicable and
 * near-transparent content comes back incomplete. Only what is genuinely on
 * screen yields a contrast verdict, which is why contrastScope says
 * 'visible-area' instead of implying whole-page coverage.
 */

import { classify } from './en301549.js';
import { sanitiseForAnalysis } from './sanitise.js';

const AXE_URL = '/vendor/axe.min.js';
const AXE_VERSION = 'axe-core 4.12.1';
const MAX_EXAMPLES = 5;
const STAGE_WIDTH = 1280;
const RENDER_SETTLE_MS = 350;

let axeLoading = null;

/** Loads axe once, on first scan. Never on page load — it is ~570 KB. */
function loadAxe() {
  if (window.axe) return Promise.resolve(window.axe);
  if (axeLoading) return axeLoading;
  axeLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = AXE_URL;
    script.onload = () => (window.axe ? resolve(window.axe) : reject(new Error('axe failed to initialise')));
    script.onerror = () => reject(new Error('Could not load the analysis engine.'));
    document.head.append(script);
  });
  return axeLoading;
}

/**
 * Builds the visible stage the scanned page renders into.
 *
 * Deliberately on screen and opaque: hiding it or fading it out silently
 * disables every contrast check.
 */
function buildStage(html, finalUrl) {
  const stage = document.createElement('div');
  // DO NOT ADD aria-hidden / hidden / inert / display:none HERE. axe only
  // evaluates elements in the accessibility tree, so aria-hidden="true" took
  // dedeman.ro from 11 violations to 0 with 84 rules inapplicable — a broken
  // page reported as clean. Measured, not theorised.
  stage.dataset.role = 'analysis-stage';
  stage.style.cssText =
    'position:fixed;top:0;left:0;z-index:9998;' +
    `width:min(${STAGE_WIDTH}px,100vw);height:100vh;overflow:hidden;` +
    'background:#fff;opacity:1;pointer-events:none;';

  const host = document.createElement('div');
  host.style.cssText = `width:${STAGE_WIDTH}px;`;
  stage.append(host);
  document.body.append(stage);

  host.attachShadow({ mode: 'open' }).innerHTML = sanitiseForAnalysis(html, finalUrl);
  return { stage, host };
}

function toFinding(result) {
  const meta = classify(result.tags);
  return {
    id: result.id,
    help: result.help,
    helpUrl: result.helpUrl,
    impact: result.impact ?? null,
    wcag: meta.wcag,
    en301549: meta.en301549,
    level: meta.level,
    nodes: result.nodes.length,
    examples: result.nodes.slice(0, MAX_EXAMPLES).map((node) => {
      const snippet = node.html || '';
      return snippet.length > 200 ? `${snippet.slice(0, 197)}...` : snippet;
    }),
  };
}

export async function runAxeScan(target) {
  const response = await fetch(`/api/fetch?url=${encodeURIComponent(target)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'That page could not be fetched.');

  const axe = await loadAxe();
  const { stage, host } = buildStage(payload.html, payload.finalUrl);

  try {
    // Let the target's stylesheets settle, or contrast reads an unstyled page.
    await new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));

    const results = await axe.run(host, {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    });

    const violations = results.violations.map(toFinding);
    const contrastEvaluated = [...results.violations, ...results.passes, ...results.incomplete].some(
      (r) => r.id === 'color-contrast'
    );

    return {
      finalUrl: payload.finalUrl,
      engine: AXE_VERSION,
      truncated: Boolean(payload.truncated),
      contrastScope: contrastEvaluated ? 'visible-area' : 'not-assessed',
      requirements: violations.filter((f) => f.en301549),
      bestPractices: violations.filter((f) => !f.en301549),
      // Never folded into passes: axe could not decide these.
      incomplete: results.incomplete.map(toFinding),
      counts: {
        violations: results.violations.length,
        incomplete: results.incomplete.length,
        passes: results.passes.length,
        inapplicable: results.inapplicable.length,
      },
    };
  } finally {
    stage.remove();
  }
}
```

## Task 5 copy correction

Task 5 Step 4 said to change the on-page note to "100+ checks incl. colour
contrast". That overstates what the architecture delivers, so use instead:

```html
        <p class="probe__note">95+ checks &middot; contrast on the visible area &middot; no signup</p>
```

And the "Static analysis only" explainer becomes:

```html
          Your browser renders the page and runs the axe-core engine against it
          &mdash; the same engine used in most accessibility test suites. Scripts
          are never executed, so content built by JavaScript is not analysed, and
          colour contrast is judged only for the part of the page that fits on
          screen.
```

## Not in this plan

Deferred to their own plans, each shippable alone:

- **Conformance table and draft accessibility statement** — spec section "Output: what nobody else produces", items 1 and 2
- **Print stylesheet** — item 3
- **Criterion content pages, German translations, JSON-LD, sitemap expansion** — spec section "SEO"

## Self-review notes

- **Spec coverage for this step:** client-side axe in a sandboxed frame (Task 4), no `allow-scripts` (Task 4), clause derived from tags rather than a table (Task 2), best-practice separation (Tasks 2, 5), incomplete never counted as passes (Tasks 4, 5), MPL-2.0 compliance (Task 1), Lighthouse stays 100 (Task 5 Step 5), static scan retained as fallback (Task 5 Step 2), the 511 message correction (Task 3 Step 4).
- **Deliberate trap:** Task 4 Step 2 contains an invalid `besides: undefined,` line that Step 3 requires deleting. It is there so a `node --check` runs against code that was actually read.
- **Type consistency:** `classify()` returns `{wcag, en301549, level, bestPractice}` in Task 2 and is consumed with exactly those names in Task 4. `runAxeScan` returns `{finalUrl, engine, requirements, bestPractices, incomplete, counts}` in Task 4 and is consumed with exactly those names in Task 5. `el`, `figure`, `renderScope`, `showMessage` and `render` are pre-existing helpers in `public/app.js`.
