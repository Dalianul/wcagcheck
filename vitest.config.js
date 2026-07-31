import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd, not Node, so HTMLRewriter is the real thing rather
// than a shim. That matters: the scanner is almost entirely HTMLRewriter
// behaviour, and a DOM stand-in would test something we don't ship.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
    }),
  ],
  test: {
    include: ['test/**/*.test.js'],
  },
});
