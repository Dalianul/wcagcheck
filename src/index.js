/**
 * Worker entry point.
 *
 * Static files in public/ are served by the assets binding before this handler
 * runs, so fetch() only sees paths with no matching file. That means /api/scan
 * lands here, and anything else is genuinely a 404.
 */

import { handleScan } from './scan.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/scan') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Use GET.' }), {
          status: 405,
          headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET' },
        });
      }
      return handleScan(request);
    }

    // Serve the styled 404 page rather than the runtime's bare text.
    try {
      const page = await env.ASSETS.fetch(new URL('/404.html', url.origin));
      if (page.ok) {
        return new Response(page.body, {
          status: 404,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
    } catch {
      // Fall through to the plain response below.
    }
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
