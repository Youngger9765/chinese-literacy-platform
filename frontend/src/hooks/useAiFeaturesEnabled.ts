/**
 * useAiFeaturesEnabled / useAiChatbotEnabled — frontend mirror of the
 * server-side AI flags (#3838 kill switch; #3861 scope correction).
 *
 * #3838 — security incident: a sister project had its GCP service account
 * key stolen via an RCE and was billed for Vertex AI abuse. Young ordered
 * every AI feature in LingoLeap turned OFF and HIDDEN. The backend enforced
 * this with a fail-closed AI_FEATURES_ENABLED env var.
 *
 * #3861 — scope correction: that blanket switch went further than
 * intended. Vertex AI access has been re-enabled; only the conversational
 * Socratic tutor (the comprehension chat / "ask the AI" floating helper)
 * should stay off. The backend now has TWO flags:
 *   - ai_features_enabled: general gate, defaults ON. When false, every
 *     AI-calling endpoint 503s and every AI entry point should hide.
 *   - ai_chatbot_enabled: chatbot-only gate, defaults OFF. When false, only
 *     the conversational tutor UI should hide — everything else (reading
 *     transcription, OMO grading, sentence practice, teacher comments,
 *     etc.) is governed by ai_features_enabled alone.
 *
 * Both are served by a single GET /api/features call so components share
 * one network request regardless of which flag they read.
 *
 * Fails closed on the frontend too: both default to `false` (hidden) until
 * the fetch resolves, and on any fetch error. A momentary "hidden while
 * loading" flash is an acceptable trade for never flashing an AI button
 * that's actually disabled.
 */
import { useEffect, useState } from 'react';
import { API_BASE } from '../services/apiConfig';

interface FeatureFlags {
  ai_features_enabled: boolean;
  ai_chatbot_enabled: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = { ai_features_enabled: false, ai_chatbot_enabled: false };

let cachedFlags: FeatureFlags | null = null;
let inFlight: Promise<FeatureFlags> | null = null;

async function fetchFeatureFlags(): Promise<FeatureFlags> {
  if (cachedFlags !== null) return cachedFlags;
  if (!inFlight) {
    inFlight = fetch(`${API_BASE}/api/features`)
      .then((res) => (res.ok ? res.json() : DEFAULT_FLAGS))
      .then((data: Partial<FeatureFlags>) => {
        cachedFlags = {
          ai_features_enabled: !!data.ai_features_enabled,
          ai_chatbot_enabled: !!data.ai_chatbot_enabled,
        };
        return cachedFlags;
      })
      .catch(() => {
        cachedFlags = DEFAULT_FLAGS;
        return DEFAULT_FLAGS;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Test-only — clears the module-level cache between test cases. */
export function _resetAiFeaturesCacheForTests(): void {
  cachedFlags = null;
  inFlight = null;
}

function useFeatureFlag(key: keyof FeatureFlags): boolean {
  const [value, setValue] = useState<boolean>(cachedFlags?.[key] ?? false);

  useEffect(() => {
    let mounted = true;
    fetchFeatureFlags().then((flags) => {
      if (mounted) setValue(flags[key]);
    });
    return () => {
      mounted = false;
    };
  }, [key]);

  return value;
}

/**
 * Returns whether the GENERAL AI gate is enabled server-side (#3838).
 *
 * Starts as `false` (hidden) and flips to the real value once GET
 * /api/features resolves. Governs every non-chatbot AI entry point
 * (reading transcription, OMO upload, sentence practice, teacher AI
 * comment, MCQ rescue, etc.).
 */
export function useAiFeaturesEnabled(): boolean {
  return useFeatureFlag('ai_features_enabled');
}

/**
 * Returns whether the CHATBOT-ONLY gate is enabled server-side (#3861).
 *
 * Starts as `false` (hidden) and flips to the real value once GET
 * /api/features resolves. Governs ONLY the conversational Socratic tutor
 * UI (FloatingAIHelper). Components that gate chat should check this flag
 * — not useAiFeaturesEnabled, which stays true even while chat is off.
 */
export function useAiChatbotEnabled(): boolean {
  return useFeatureFlag('ai_chatbot_enabled');
}
