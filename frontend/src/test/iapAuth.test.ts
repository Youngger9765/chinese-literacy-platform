/**
 * iapAuth.test.ts — lock for tests/e2e/utils/iapAuth.ts (#3719, #3730).
 *
 * Two contracts locked here:
 *
 * 1. With IAP off (no IAP_AUDIENCE — the state for the whole repo today),
 *    the helper must be a pure no-op — no token minter call, no header, no
 *    throw. Everything the rest of the IAP-prep work wires this into
 *    (playwright.config.ts, spec files) depends on that being true to land
 *    safely before IAP is actually turned on. Tested via dependency
 *    injection (a fake `mintToken`).
 *
 * 2. When an audience IS set and a service-account key file is available
 *    (the `GOOGLE_APPLICATION_CREDENTIALS` path), the DEFAULT minter — not
 *    a fake — must produce a JWT with the exact shape #3730's canary proved
 *    IAP actually accepts: iss == sub == the signing service account's
 *    email, aud == exactly the audience, lifetime <= 1 hour, and a
 *    signature that verifies against the matching public key. This is
 *    tested end to end with a real generated RSA keypair and zero mocks —
 *    the ambient/no-key-file branch (which shells out to
 *    `gcloud iam service-accounts sign-jwt`) is NOT covered here: Vitest's
 *    ESM mock of Node builtins does not propagate across module boundaries
 *    (verified: a wrapper module that imports `execFileSync` from
 *    `node:child_process` still calls the REAL implementation even when
 *    the test file's own import is a `vi.mock`'d one), so that branch can
 *    only be exercised with a real `gcloud` + real IAM permissions, which
 *    is out of scope for a unit test. It has a mocked equivalent on the
 *    Python side (`scripts/test_iap_token.py`), where the same claims-
 *    building logic is shared, and this file's own
 *    `getIapProxyAuthHeader`-level DI tests cover that the wrapper's
 *    header/cache/error-swallowing behavior is identical regardless of
 *    which minter is plugged in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getIapProxyAuthHeader,
  _resetIapProxyAuthHeaderCacheForTests,
  _setClockForTests,
  _resetClockForTests,
} from '../../tests/e2e/utils/iapAuth';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

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

describe('getIapProxyAuthHeader — default (self-signed JWT) minter, key-file branch', () => {
  let dir: string;
  let keyPath: string;
  let publicKeyPem: string;
  const saEmail = 'test-sa@example-project.iam.gserviceaccount.com';
  const audience = 'https://backend-abc123.a.run.app';

  beforeEach(() => {
    _resetIapProxyAuthHeaderCacheForTests();
    vi.unstubAllEnvs();

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = publicKey;

    dir = mkdtempSync(join(tmpdir(), 'iap-auth-test-'));
    keyPath = join(dir, 'fake-sa-key.json');
    writeFileSync(
      keyPath,
      JSON.stringify({ type: 'service_account', client_email: saEmail, private_key: privateKey }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('mints a JWT whose claims match the #3730 canary-validated shape (iss=sub=SA email, aud=audience, lifetime<=1h)', () => {
    vi.stubEnv('IAP_AUDIENCE', audience);
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', keyPath);

    const headers = getIapProxyAuthHeader(); // no override -> exercises the real default minter
    expect(headers).toHaveProperty('Proxy-Authorization');
    expect(headers).not.toHaveProperty('Authorization');

    const token = (headers['Proxy-Authorization'] as string).replace(/^Bearer /, '');
    const claims = decodeJwtPayload(token);

    expect(claims.iss).toBe(saEmail);
    expect(claims.sub).toBe(saEmail);
    expect(claims.aud).toBe(audience);
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(3600);
    expect(claims.exp as number).toBeGreaterThan(claims.iat as number);
  });

  it('the minted JWT is a real, verifiable RS256 signature against the key file (not a stub)', () => {
    vi.stubEnv('IAP_AUDIENCE', audience);
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', keyPath);

    const headers = getIapProxyAuthHeader();
    const token = (headers['Proxy-Authorization'] as string).replace(/^Bearer /, '');
    const [headerSeg, payloadSeg, sigSeg] = token.split('.');
    const signingInput = `${headerSeg}.${payloadSeg}`;
    const signature = Buffer.from(sigSeg, 'base64url');

    const verifier = createVerify('RSA-SHA256');
    verifier.update(signingInput);
    expect(verifier.verify(publicKeyPem, signature)).toBe(true);
  });

  // Note: a "broken key file -> falls through gracefully" case is deliberately
  // NOT tested here. With no client_email/private_key, mintTokenSelfSigned
  // falls through to the gcloud ambient-credentials branch, which would shell
  // out to the REAL `gcloud` on whatever machine runs this test — an
  // uncontrolled live call to GCP that a unit test must never make. The
  // "minter throws -> {} not throw" contract above (DI section) already
  // locks the wrapper's error-swallowing behavior generically, independent
  // of which minter is plugged in, so this is not a coverage gap.
});

describe('getIapProxyAuthHeader — token cache TTL (refresh before the 1h hard expiry, #3731)', () => {
  const audience = 'https://example.com';
  let clock: number;

  beforeEach(() => {
    _resetIapProxyAuthHeaderCacheForTests();
    vi.unstubAllEnvs();
    vi.stubEnv('IAP_AUDIENCE', audience);
    clock = 1_000_000_000;
    _setClockForTests(() => clock);
  });

  afterEach(() => {
    _resetClockForTests();
    vi.unstubAllEnvs();
  });

  it('reuses the cached token within the refresh window without re-minting', () => {
    const mintToken = vi.fn(() => 'tok-1');
    getIapProxyAuthHeader(mintToken);
    getIapProxyAuthHeader(mintToken);
    expect(mintToken).toHaveBeenCalledTimes(1);
  });

  it('re-mints once the refresh margin has passed, well before the hard 1h expiry', () => {
    const mintToken = vi.fn().mockReturnValueOnce('tok-1').mockReturnValueOnce('tok-2');
    const first = getIapProxyAuthHeader(mintToken);
    clock += 2_701_000; // 45:01 in -- past the 2700s refresh margin, before the 3600s hard expiry
    const second = getIapProxyAuthHeader(mintToken);
    expect(first).toEqual({ 'Proxy-Authorization': 'Bearer tok-1' });
    expect(second).toEqual({ 'Proxy-Authorization': 'Bearer tok-2' });
    expect(mintToken).toHaveBeenCalledTimes(2);
  });

  it('falls back to the stale-but-not-yet-hard-expired token when a re-mint attempt fails', () => {
    const mintToken = vi
      .fn()
      .mockReturnValueOnce('tok-1')
      .mockImplementationOnce(() => {
        throw new Error('IAM Credentials API down');
      });
    const first = getIapProxyAuthHeader(mintToken);
    clock += 2_701_000;
    const second = getIapProxyAuthHeader(mintToken);
    expect(first).toEqual({ 'Proxy-Authorization': 'Bearer tok-1' });
    expect(second).toEqual({ 'Proxy-Authorization': 'Bearer tok-1' }); // stale but still valid
  });

  it('returns {} once both the refresh margin and the hard expiry have passed and re-mint still fails', () => {
    const mintToken = vi.fn().mockReturnValueOnce('tok-1').mockImplementation(() => {
      throw new Error('IAM Credentials API down');
    });
    getIapProxyAuthHeader(mintToken);
    clock += 3_601_000; // past the hard 1h expiry too
    const second = getIapProxyAuthHeader(mintToken);
    expect(second).toEqual({});
  });

  it('caches per audience, not globally', () => {
    const mintToken = vi.fn((aud: string) => `tok-for-${aud}`);
    // getIapProxyAuthHeader reads process.env.IAP_AUDIENCE directly, so to
    // exercise a second audience we flip the env var between calls rather
    // than passing it as an argument.
    const first = getIapProxyAuthHeader(mintToken);
    vi.stubEnv('IAP_AUDIENCE', 'https://other.example.com');
    const second = getIapProxyAuthHeader(mintToken);
    vi.stubEnv('IAP_AUDIENCE', audience);
    const firstAgain = getIapProxyAuthHeader(mintToken);
    expect(first).toEqual({ 'Proxy-Authorization': `Bearer tok-for-${audience}` });
    expect(second).toEqual({ 'Proxy-Authorization': 'Bearer tok-for-https://other.example.com' });
    expect(firstAgain).toEqual(first);
    expect(mintToken).toHaveBeenCalledTimes(2); // first audience's second lookup was cached, not re-minted
  });
});
