/**
 * iapAuth.test.ts — lock for tests/e2e/utils/iapAuth.ts (#3719).
 *
 * The guarantee this locks: with IAP off (no IAP_AUDIENCE — the state for
 * the whole repo today), the helper must be a pure no-op — no token minter
 * call, no header, no throw. Everything the rest of the IAP-prep work wires
 * this into (playwright.config.ts, spec files) depends on that being true
 * to land safely before IAP is actually turned on.
 *
 * Uses dependency injection (a fake `mintToken`) rather than mocking
 * `node:child_process` directly — Vitest's ESM mock of Node builtins does
 * not propagate across module boundaries (verified: a wrapper module that
 * imports `execFileSync` from `node:child_process` still calls the REAL
 * implementation even when the test file's own import is a `vi.mock`'d
 * one). DI sidesteps that entirely and is what `getIapProxyAuthHeader`'s
 * second parameter exists for.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getIapProxyAuthHeader,
  _resetIapProxyAuthHeaderCacheForTests,
} from '../../tests/e2e/utils/iapAuth';

describe('getIapProxyAuthHeader', () => {
  beforeEach(() => {
    _resetIapProxyAuthHeaderCacheForTests();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op (negative control matching today's reality) when IAP_AUDIENCE is unset", () => {
    vi.stubEnv('IAP_AUDIENCE', '');
    const mintToken = vi.fn();
    expect(getIapProxyAuthHeader(mintToken)).toEqual({});
    expect(mintToken).not.toHaveBeenCalled();
  });

  it('returns {} (not throw) when the minter throws (gcloud unavailable / not logged in)', () => {
    vi.stubEnv('IAP_AUDIENCE', 'https://example.com');
    const mintToken = vi.fn(() => {
      throw new Error('ENOENT: gcloud not found');
    });
    expect(() => getIapProxyAuthHeader(mintToken)).not.toThrow();
    _resetIapProxyAuthHeaderCacheForTests();
    expect(getIapProxyAuthHeader(mintToken)).toEqual({});
  });

  it('returns Proxy-Authorization (never Authorization) when a token is minted', () => {
    vi.stubEnv('IAP_AUDIENCE', 'https://example.com');
    const mintToken = vi.fn(() => 'fake-id-token');
    const headers = getIapProxyAuthHeader(mintToken);
    expect(headers).toEqual({ 'Proxy-Authorization': 'Bearer fake-id-token' });
    expect(headers).not.toHaveProperty('Authorization');
    expect(mintToken).toHaveBeenCalledWith('https://example.com');
  });

  it('caches the result across calls within the same process (minter runs once)', () => {
    vi.stubEnv('IAP_AUDIENCE', 'https://example.com');
    const mintToken = vi.fn(() => 'one-token');
    getIapProxyAuthHeader(mintToken);
    getIapProxyAuthHeader(mintToken);
    expect(mintToken).toHaveBeenCalledTimes(1);
  });

  it('an empty token from the minter is treated the same as no token', () => {
    vi.stubEnv('IAP_AUDIENCE', 'https://example.com');
    const mintToken = vi.fn(() => '');
    expect(getIapProxyAuthHeader(mintToken)).toEqual({});
  });
});
