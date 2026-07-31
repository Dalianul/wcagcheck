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
