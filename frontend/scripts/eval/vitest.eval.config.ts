import { defineConfig } from 'vitest/config';

/**
 * Standalone vitest config for scripts/eval/*.eval.ts — deliberately separate
 * from the main vite.config.ts test config (whose `include` glob only matches
 * *.test.ts / *.spec.ts, and which every `npm run test` / CI run uses).
 *
 * Eval scripts here hit REAL staging network endpoints and are not something
 * every CI run should depend on — this config exists so they can still be run
 * explicitly, on demand, without needing to touch the main test include/exclude
 * lists (which would otherwise force an awkward choice between "auto-discovered
 * by npm run test" and "not discoverable by an explicit path at all" — vitest's
 * `exclude` applies even to explicitly-passed file paths).
 *
 * Run with:
 *   npx vitest run --config scripts/eval/vitest.eval.config.ts
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/eval/**/*.eval.ts'],
  },
});
