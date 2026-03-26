/**
 * ttsApi.ts — Google Cloud TTS client (Issue #663)
 *
 * Provides speakText() that first tries the backend /api/tts/synthesize endpoint
 * (Cloud TTS Neural2, zh-TW, natural voice) and falls back to browser Web Speech
 * API if the backend is unavailable or returns an error.
 *
 * Usage:
 *   import { speakText, cancelTts } from '../../services/ttsApi';
 *   await speakText('你好世界');
 *   cancelTts();   // stop any in-progress playback
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// In-memory URL cache to avoid repeatedly fetching the same audio.
// Blob URLs are released when the page unloads.
const _urlCache = new Map<string, string>();

// Track the currently playing audio element so cancelTts() can stop it
let _currentAudio: HTMLAudioElement | null = null;

// Backend retry state: cooldown after failure, permanent fallback after 3 consecutive failures.
const BACKEND_COOLDOWN_MS = 30_000; // 30 seconds before retrying after a failure
const MAX_CONSECUTIVE_FAILURES = 3;

let _consecutiveFailures = 0;
let _permanentlyFallback = false;
let _lastFailureTime = 0;

/**
 * Stop any TTS currently in progress (backend or Web Speech API).
 */
export function cancelTts(): void {
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio.currentTime = 0;
    _currentAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Synthesise and play *text* in Traditional Chinese.
 *
 * Tries Cloud TTS backend first; if the backend returns an error or is
 * unavailable, falls back to browser Web Speech API so the app keeps
 * working in environments without GCP credentials.
 *
 * @param text - Text to synthesise (keep under 5000 chars per request).
 * @param rate - Playback speed multiplier (default 0.9, applied to Web Speech fallback).
 * @returns Promise that resolves when speech ends, or rejects on fatal error.
 */
export async function speakText(text: string, rate = 0.9): Promise<void> {
  if (!text.trim()) return;
  cancelTts();

  // Try backend TTS first (unless permanently fallen back or in cooldown)
  if (!_permanentlyFallback && _isBackendAvailable()) {
    try {
      await _speakViaBackend(text);
      // Reset failure count on success
      _consecutiveFailures = 0;
      return;
    } catch (err) {
      _consecutiveFailures++;
      _lastFailureTime = Date.now();
      if (_consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`[TTS] ${MAX_CONSECUTIVE_FAILURES} consecutive failures — permanently falling back to Web Speech API`);
        _permanentlyFallback = true;
      } else {
        console.warn(`[TTS] Backend TTS failed (${_consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), cooldown ${BACKEND_COOLDOWN_MS / 1000}s:`, err);
      }
    }
  }

  // Fallback: browser Web Speech API
  await _speakViaBrowserApi(text, rate);
}

// ---------------------------------------------------------------------------
// Private: backend availability check
// ---------------------------------------------------------------------------

function _isBackendAvailable(): boolean {
  if (_permanentlyFallback) return false;
  if (_consecutiveFailures === 0) return true;
  // In cooldown: wait before retrying
  return Date.now() - _lastFailureTime >= BACKEND_COOLDOWN_MS;
}

// Exported for testing only
export const _testInternals = {
  reset() {
    _consecutiveFailures = 0;
    _permanentlyFallback = false;
    _lastFailureTime = 0;
  },
  getState() {
    return { _consecutiveFailures, _permanentlyFallback, _lastFailureTime };
  },
  BACKEND_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
};

// ---------------------------------------------------------------------------
// Private: backend audio playback
// ---------------------------------------------------------------------------

async function _speakViaBackend(text: string): Promise<void> {
  // Check URL cache first
  let audioUrl = _urlCache.get(text);

  if (!audioUrl) {
    const response = await fetch(`${API_BASE}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`TTS backend responded ${response.status}`);
    }

    const blob = await response.blob();
    if (blob.size === 0) {
      throw new Error('TTS backend returned empty audio');
    }

    audioUrl = URL.createObjectURL(blob);
    _urlCache.set(text, audioUrl);
  }

  return new Promise<void>((resolve, reject) => {
    const audio = new Audio(audioUrl);
    _currentAudio = audio;

    audio.onended = () => {
      _currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      _currentAudio = null;
      reject(new Error('Audio playback error'));
    };
    audio.play().catch(reject);
  });
}

// ---------------------------------------------------------------------------
// Private: Web Speech API fallback
// ---------------------------------------------------------------------------

function _speakViaBrowserApi(text: string, rate: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      reject(new Error('Web Speech API not available'));
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = rate;
    utterance.pitch = 1.0;

    // Prefer Google Taiwan voice when available
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.name.includes('Google') && v.name.includes('Taiwan')) ||
      voices.find((v) => v.lang === 'zh-TW') ||
      voices.find((v) => v.lang.startsWith('zh'));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => resolve();
    utterance.onerror = (e) => reject(new Error(e.error ?? 'speech error'));
    window.speechSynthesis.speak(utterance);

    // If voices not loaded yet, retry after voiceschanged fires
    if (voices.length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        window.speechSynthesis.cancel();
        const v2 = window.speechSynthesis.getVoices();
        const best =
          v2.find((v) => v.name.includes('Google') && v.name.includes('Taiwan')) ||
          v2.find((v) => v.lang === 'zh-TW') ||
          v2.find((v) => v.lang.startsWith('zh'));
        if (best) utterance.voice = best;
        window.speechSynthesis.speak(utterance);
      };
    }
  });
}
