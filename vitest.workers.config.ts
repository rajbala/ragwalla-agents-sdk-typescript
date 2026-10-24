import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Real-workerd test project for the Cloudflare Workers WebSocket transport. Runs under
// @cloudflare/vitest-plugin (workerd), so the SDK's createWorkersSocket() path
// (fetch + Upgrade + accept) executes against genuine Workers WebSocket primitives.
// Separate from the jest unit suite; run with `npm run test:workers`.
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './tests/workers/test-worker-entry.ts',
      miniflare: {
        compatibilityDate: '2024-09-23',
        compatibilityFlags: ['nodejs_compat'],
      },
    }),
  ],
  test: {
    include: ['tests/workers/**/*.workers.test.ts'],
  },
});
