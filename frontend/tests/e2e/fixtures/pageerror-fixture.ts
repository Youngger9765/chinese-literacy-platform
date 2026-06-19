import { test as base } from '@playwright/test';

/**
 * pageerror-fixture.ts — Gate ③ of the frontend render-safety net (#2289)
 *
 * Extends the base Playwright test with automatic page error collection.
 * Any uncaught JavaScript error → afterEach assertion fails the test.
 *
 * Usage:
 *   import { test, expect } from './fixtures/pageerror-fixture';
 *   // (no other changes needed — collectPageErrors runs automatically)
 *
 * This catches TDZ ReferenceErrors and other runtime crashes that reach the
 * browser's uncaught error handler — exactly the class of bug from #2279.
 *
 * Add known-benign errors to ALLOWED_PATTERNS (use sparingly — only for
 * third-party library noise that cannot be fixed).
 */

const ALLOWED_PATTERNS: RegExp[] = [
  // Uncomment when needed:
  // /ResizeObserver loop limit exceeded/,
  // /Non-Error promise rejection captured/,
];

export const test = base.extend<{ collectPageErrors: void }>({
  collectPageErrors: [
    async ({ page }, use) => {
      const uncaughtErrors: string[] = [];
      const consoleErrors: string[] = [];

      // Collect uncaught JS errors (window.onerror / unhandled rejection)
      page.on('pageerror', (err) => {
        uncaughtErrors.push(err.message);
      });

      // Collect console.error calls — these often indicate React render errors
      // that were caught by an ErrorBoundary but logged to console.
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await use();

      // After the test: assert no uncaught errors slipped through.
      const relevantUncaught = uncaughtErrors.filter(
        (e) => !ALLOWED_PATTERNS.some((p) => p.test(e))
      );

      // Filter console errors: skip 404s for missing assets (often ENV-dependent)
      // but keep JavaScript errors.
      const relevantConsole = consoleErrors.filter(
        (e) =>
          !e.includes('Failed to load resource') &&
          !e.includes('net::ERR_') &&
          !ALLOWED_PATTERNS.some((p) => p.test(e))
      );

      if (relevantUncaught.length > 0 || relevantConsole.length > 0) {
        const allErrors = [...relevantUncaught, ...relevantConsole];
        throw new Error(
          `[pageerror-fixture] Page errors detected during test:\n` +
            allErrors.map((e) => `  • ${e}`).join('\n') +
            '\n\nTo suppress known-benign errors, add a RegExp to ALLOWED_PATTERNS in pageerror-fixture.ts'
        );
      }
    },
    { auto: true }, // runs automatically for every test using this base — no need to destructure
  ],
});

export { expect } from '@playwright/test';
