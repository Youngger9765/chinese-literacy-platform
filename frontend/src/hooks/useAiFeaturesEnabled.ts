/**
 * useAiFeaturesEnabled — frontend half of the AI kill switch (Issue #3838).
 *
 * Security incident: a sister project had its GCP service account key
 * stolen via an RCE and was billed for Vertex AI abuse. Young ordered every
 * AI feature in LingoLeap turned OFF and HIDDEN. The backend enforces this
 * with a fail-closed AI_FEATURES_ENABLED env var (every AI route returns
 * 503 while it's off) — this hook mirrors that flag via GET /api/features
 * so components can hide AI entry points instead of showing a button that
 * always errors.
 *
 * Fails closed on the frontend too: defaults to `false` (hidden) until the
 * fetch resolves, and on any fetch error. A momentary "hidden while
 * loading" flash is an acceptable trade for never flashing an AI button
 * that's actually disabled.
 */
import { useEffect, useState } from 'react';
import { API_BASE } from '../services/apiConfig';

let cachedEnabled: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

async function fetchAiFeaturesEnabled(): Promise<boolean> {
  if (cachedEnabled !== null) return cachedEnabled;
  if (!inFlight) {
    inFlight = fetch(`${API_BASE}/api/features`)
      .then((res) => (res.ok ? res.json() : { ai_features_enabled: false }))
      .then((data: { ai_features_enabled?: boolean }) => {
        cachedEnabled = !!data.ai_features_enabled;
        return cachedEnabled;
      })
      .catch(() => {
        cachedEnabled = false;
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Test-only — clears the module-level cache between test cases. */
export function _resetAiFeaturesCacheForTests(): void {
  cachedEnabled = null;
  inFlight = null;
}

/**
 * Returns whether AI features are currently enabled server-side.
 *
 * Starts as `false` (hidden) and flips to the real value once GET
 * /api/features resolves. The result is cached at module scope for the
 * lifetime of the page load, so every component calling this hook shares
 * one network request.
 */
export function useAiFeaturesEnabled(): boolean {
  const [enabled, setEnabled] = useState<boolean>(cachedEnabled ?? false);

  useEffect(() => {
    let mounted = true;
    fetchAiFeaturesEnabled().then((value) => {
      if (mounted) setEnabled(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return enabled;
}
