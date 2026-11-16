/**
 * #4097 security review — the IAP JWT must only go to the IAP-protected
 * origin(s), never to third parties the page loads (Google Fonts,
 * accounts.google.com, any CDN).
 *
 * The old wiring put getIapProxyAuthHeader() into playwright.config.ts's
 * `use.extraHTTPHeaders` (and into every manual `browser.newContext`),
 * which Playwright sends on EVERY request of the context, any origin.
 * Harmless while the header was empty; a live credential leak once
 * e2e-tests.yml started passing a real token.
 *
 * Locked here:
 *   1. the route handler adds the header for the staging origin and leaves
 *      a third-party request untouched (executed with a fake context/route)
 *   2. the scoped APIRequestContext wrapper does the same
 *   3. structurally: no global / per-context extraHTTPHeaders carrying the
 *      IAP header remains, and every spec gets `test` from the IAP fixture
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  attachIapRoute,
  iapHeaderForUrl,
  scopeIapRequest,
  _resetIapProxyAuthHeaderCacheForTests,
} from '../../tests/e2e/utils/iapAuth';

const STAGING = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';
const THIRD_PARTY = [
  'https://fonts.googleapis.com/css2?family=Noto+Sans+TC',
  'https://accounts.google.com/o/oauth2/v2/auth',
  'https://cdn.jsdelivr.net/npm/x.js',
  // same registrable domain, different host: still NOT the IAP origin
  'https://lingoleap-backend-staging-958347263320.asia-east1.run.app/api/health',
];

type Handler = (route: FakeRoute) => Promise<void> | void;
interface FakeRoute {
  request(): { url(): string; headers(): Record<string, string> };
  continue: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  fulfill: ReturnType<typeof vi.fn>;
}

const FETCHED = { fake: 'response' };

function fakeRoute(url: string): FakeRoute {
  return {
    request: () => ({ url: () => url, headers: () => ({ accept: '*/*' }) }),
    continue: vi.fn(async () => {}),
    fetch: vi.fn(async () => FETCHED),
    fulfill: vi.fn(async () => {}),
  };
}

async function installedHandler(): Promise<Handler> {
  let handler: Handler | null = null;
  const ctx = { route: vi.fn(async (_p: string, h: Handler) => { handler = h; }) };
  await attachIapRoute(ctx as never);
  expect(ctx.route).toHaveBeenCalledTimes(1);
  return handler as unknown as Handler;
}

describe('IAP header is scoped to the IAP origin (#4097)', () => {
  beforeEach(() => {
    _resetIapProxyAuthHeaderCacheForTests();
    vi.unstubAllEnvs();
    vi.stubEnv('IAP_AUDIENCE', '');
    vi.stubEnv('IAP_PROXY_TOKEN', 'pre-minted-jwt');
    vi.stubEnv('PLAYWRIGHT_BASE_URL', STAGING);
    vi.stubEnv('E2E_BACKEND_URL', STAGING);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('iapHeaderForUrl: staging origin gets the header, third parties get nothing', () => {
    expect(iapHeaderForUrl(`${STAGING}/learn/1`)).toEqual({ 'Proxy-Authorization': 'Bearer pre-minted-jwt' });
    for (const u of THIRD_PARTY) expect(iapHeaderForUrl(u), u).toEqual({});
  });

  // CI run 43939003809: 4 tests failed with "route.fetch: Target page,
  // context or browser has been closed" — a request still in flight when the
  // test ended. That is teardown noise, not a test result; anything else
  // must still surface.
  it('route handler ignores a request still in flight when the context closes', async () => {
    const handler = await installedHandler();
    const r = fakeRoute(`${STAGING}/assets/x.js`);
    r.fetch = vi.fn(async () => {
      throw new Error('route.fetch: Target page, context or browser has been closed');
    });
    await expect(handler(r)).resolves.toBeUndefined();
    expect(r.fulfill).not.toHaveBeenCalled();
  });

  it('route handler still surfaces real fetch errors', async () => {
    const handler = await installedHandler();
    const r = fakeRoute(`${STAGING}/api/stories`);
    r.fetch = vi.fn(async () => {
      throw new Error('route.fetch: net::ERR_CONNECTION_RESET');
    });
    await expect(handler(r)).rejects.toThrow('ERR_CONNECTION_RESET');
  });

  it('route handler adds the header only for the staging origin', async () => {
    const handler = await installedHandler();
    const own = fakeRoute(`${STAGING}/api/stories`);
    await handler(own);
    // route.continue({headers}) silently drops Proxy-Authorization in
    // Chromium -> the handler must fetch + fulfill for the IAP origin.
    expect(own.continue).not.toHaveBeenCalled();
    expect(own.fetch).toHaveBeenCalledWith({
      headers: { accept: '*/*', 'Proxy-Authorization': 'Bearer pre-minted-jwt' },
      maxRedirects: 0,
    });
    expect(own.fulfill).toHaveBeenCalledWith({ response: FETCHED });
    for (const u of THIRD_PARTY) {
      const r = fakeRoute(u);
      await handler(r);
      expect(r.fetch, u).not.toHaveBeenCalled();
      expect(r.continue, u).toHaveBeenCalledTimes(1);
      const arg = r.continue.mock.calls[0][0] as { headers?: Record<string, string> } | undefined;
      expect(arg?.headers?.['Proxy-Authorization'], u).toBeUndefined();
    }
  });

  it('no token at all -> no route installed (zero behaviour change locally)', async () => {
    vi.stubEnv('IAP_PROXY_TOKEN', '');
    const ctx = { route: vi.fn() };
    await attachIapRoute(ctx as never);
    expect(ctx.route).not.toHaveBeenCalled();
  });

  it('scoped APIRequestContext only adds the header for the staging origin', async () => {
    const calls: Array<[string, { headers?: Record<string, string> }]> = [];
    const base = {
      get: vi.fn(async (u: string, o: { headers?: Record<string, string> } = {}) => { calls.push([u, o]); }),
      post: vi.fn(async (u: string, o: { headers?: Record<string, string> } = {}) => { calls.push([u, o]); }),
    };
    const req = scopeIapRequest(base as never) as unknown as typeof base;
    await req.post(`${STAGING}/api/auth/login`, { headers: { a: '1' } });
    await req.get('/api/stories'); // relative -> baseURL = staging
    await req.get(THIRD_PARTY[0]);
    expect(calls[0][1].headers).toEqual({ a: '1', 'Proxy-Authorization': 'Bearer pre-minted-jwt' });
    expect(calls[1][1].headers?.['Proxy-Authorization']).toBe('Bearer pre-minted-jwt');
    expect(calls[2][1].headers?.['Proxy-Authorization']).toBeUndefined();
  });
});

describe('no context-wide IAP header remains (#4097)', () => {
  const root = resolve(__dirname, '../..');
  const e2eDir = join(root, 'tests/e2e');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  const files = walk(e2eDir);

  it('playwright.config.ts does not put the IAP header in extraHTTPHeaders', () => {
    const cfg = readFileSync(join(root, 'playwright.config.ts'), 'utf8');
    expect(cfg).not.toMatch(/extraHTTPHeaders\s*:\s*getIapProxyAuthHeader/);
  });

  it('no spec passes the IAP header as a context-wide extraHTTPHeaders', () => {
    expect(files.length).toBeGreaterThan(5); // positive control: really scanning
    const bad = files.filter((f) => /extraHTTPHeaders\s*:\s*getIapProxyAuthHeader/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('every spec takes `test` from the IAP-scoped fixture chain, not @playwright/test', () => {
    const specs = files.filter((f) => f.endsWith('.spec.ts'));
    expect(specs.length).toBeGreaterThan(5);
    const bad = specs.filter((f) =>
      /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/.test(readFileSync(f, 'utf8')),
    );
    expect(bad).toEqual([]);
    const pe = readFileSync(join(e2eDir, 'fixtures/pageerror-fixture.ts'), 'utf8');
    expect(pe).toMatch(/from '\.\/iap-fixture'/);
  });
});
