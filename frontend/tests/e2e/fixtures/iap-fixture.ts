import { test as base } from '@playwright/test';
import { attachIapRoute, scopeIapRequest } from '../utils/iapAuth';

/**
 * iap-fixture.ts — #4097: the IAP credential reaches ONLY the origin under
 * test. Overrides the built-in `context` (so `page` too) with a route that
 * adds Proxy-Authorization per request for allowed origins, and wraps the
 * `request` fixture the same way. Third-party origins (fonts, Google login,
 * CDNs) never see it. pageerror-fixture extends this one.
 *
 * Manual contexts (`browser.newContext`) must use `newIapContext` from
 * utils/iapAuth.ts. Locked by src/test/iapOriginScope4097.test.ts.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await attachIapRoute(context);
    await use(context);
    // Let routes still in flight finish quietly before Playwright closes the
    // context (Playwright's own advice for route callbacks at test end).
    await context.unrouteAll({ behavior: 'ignoreErrors' });
  },
  request: async ({ request }, use) => {
    await use(scopeIapRequest(request));
  },
});

export { expect } from '@playwright/test';
