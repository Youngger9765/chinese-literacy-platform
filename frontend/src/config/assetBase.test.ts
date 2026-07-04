import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Issue #2486: ASSET_BASE mirrors API_BASE's own resolution logic exactly —
 * same-origin relative path when the app is served through the Firebase
 * Hosting `/assets/**` rewrite (VITE_API_URL=""), or an absolute backend URL
 * when the frontend is served directly by its own Cloud Run service / local
 * dev (VITE_API_URL set to an absolute backend origin).
 *
 * TDD: written before frontend/src/config/assetBase.ts exists. Red -> Green -> Refactor.
 */

describe('ASSET_BASE', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves to a relative /assets path when API_BASE is empty (Firebase Hosting rewrite)', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const { ASSET_BASE } = await import('./assetBase');
    expect(ASSET_BASE).toBe('/assets');
  });

  it('resolves to {backend}/assets when API_BASE is an absolute backend URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://lingoleap-backend-staging-xxx.run.app');
    const { ASSET_BASE } = await import('./assetBase');
    expect(ASSET_BASE).toBe('https://lingoleap-backend-staging-xxx.run.app/assets');
  });

  it('falls back to the same localhost default as API_BASE when unset', async () => {
    vi.stubEnv('VITE_API_URL', undefined);
    const { ASSET_BASE } = await import('./assetBase');
    expect(ASSET_BASE).toBe('http://localhost:8000/assets');
  });

  it('respects an explicit VITE_ASSET_BASE override', async () => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_ASSET_BASE', 'https://cdn.example.com/course-assets');
    const { ASSET_BASE } = await import('./assetBase');
    expect(ASSET_BASE).toBe('https://cdn.example.com/course-assets');
  });
});
