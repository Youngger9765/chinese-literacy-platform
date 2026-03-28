/**
 * ttsApi.ts — TTS client with sentence-level sequential playback (Issue #667)
 *
 * Provides speakText() that:
 * 1. Splits text into sentences (matching backend _split_sentences / _clean_for_tts)
 * 2. Fetches each sentence from /api/tts/synthesize (stored per-sentence in GCS)
 * 3. Plays audio blobs sequentially — one sentence finishes, next one starts
 * 4. Falls back to browser Web Speech API if backend is unavailable
 *
 * Usage:
 *   import { speakText, cancelTts } from '../../services/ttsApi';
 *   await speakText('你好世界');
 *   cancelTts();   // stop any in-progress playback
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// In-memory URL cache: sentence text → blob URL.
// Avoids re-fetching the same sentence audio.
// Blob URLs are released when the page unloads.
const _urlCache = new Map<string, string>();

// Track the currently playing audio element so cancelTts() can stop it
let _currentAudio: HTMLAudioElement | null = null;

// Flag to signal cancellation mid-sequence
let _cancelRequested = false;

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
  _cancelRequested = true;
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
 * Splits text into sentences and plays each one sequentially via the backend.
 * Falls back to browser Web Speech API if backend is unavailable.
 *
 * @param text - Text to synthesise (keep under 5000 chars per request).
 * @param rate - Playback speed multiplier (default 0.9, applied to Web Speech fallback).
 * @returns Promise that resolves when all sentences finish, or rejects on fatal error.
 */
export async function speakText(text: string, rate = 0.9): Promise<void> {
  if (!text.trim()) return;
  cancelTts();
  _cancelRequested = false;

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

  // Fallback: browser Web Speech API (whole text at once)
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
    _cancelRequested = false;
    _urlCache.clear();
  },
  getState() {
    return { _consecutiveFailures, _permanentlyFallback, _lastFailureTime };
  },
  splitSentences: _splitSentences,
  cleanForTts: _cleanForTts,
  BACKEND_COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
};

// ---------------------------------------------------------------------------
// Private: sentence splitting (mirrors backend _clean_for_tts + _split_sentences)
// ---------------------------------------------------------------------------

const MAX_SENTENCE_LEN = 40; // must match backend MAX_SENTENCE_LEN

/**
 * Clean text before TTS — remove symbols that would be read aloud verbatim.
 * Mirrors backend _clean_for_tts() exactly.
 */
function _cleanForTts(text: string): string {
  text = text.replace(/[~～]+/g, '');                          // tildes
  text = text.replace(/[──—–−]+/g, '，');                      // long dashes → pause
  text = text.replace(/-{2,}/g, '，');                         // double hyphens → pause
  text = text.replace(/[.]{3,}|[…⋯]+/g, '，');                // ellipsis → pause
  text = text.replace(/#/g, '');                               // hashtag
  text = text.replace(/(\d+)\/(\d+)/g, '$1 之 $2');           // fractions
  text = text.replace(/[/\\|]+/g, '');                         // slashes
  text = text.replace(/[\*\[\]\{\}]+/g, '');                   // markdown
  text = text.replace(/[·‧・°○]+/g, '');                      // interpunct
  text = text.replace(/%/g, '百分之');                         // percent
  text = text.replace(/，{2,}/g, '，');                        // collapse pauses
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * Split Chinese text into chunks <= MAX_SENTENCE_LEN chars.
 * Mirrors backend _split_sentences() exactly.
 */
function _splitSentences(text: string): string[] {
  // Split by sentence-ending punctuation
  const parts = text.split(/(?<=[。！？\n])/u).map(s => s.trim()).filter(Boolean);

  const result: string[] = [];
  for (const s of parts) {
    if (s.length <= MAX_SENTENCE_LEN) {
      result.push(s);
    } else {
      // Split by comma/pause marks
      const sub = s.split(/(?<=[，、；：」）])/u);
      let chunk = '';
      for (const part of sub) {
        if (chunk.length + part.length > MAX_SENTENCE_LEN && chunk) {
          result.push(chunk);
          chunk = part;
        } else {
          chunk += part;
        }
      }
      if (chunk) result.push(chunk);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Private: backend sequential playback
// ---------------------------------------------------------------------------

async function _speakViaBackend(text: string): Promise<void> {
  const cleaned = _cleanForTts(text);
  if (!cleaned) return;

  const sentences = _splitSentences(cleaned);
  if (sentences.length === 0) return;

  for (const sentence of sentences) {
    if (_cancelRequested) break;
    if (!sentence.trim()) continue;

    // Check URL cache first
    let audioUrl = _urlCache.get(sentence);

    if (!audioUrl) {
      const response = await fetch(`${API_BASE}/api/tts/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence }),
      });

      if (!response.ok) {
        throw new Error(`TTS backend responded ${response.status}`);
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('TTS backend returned empty audio');
      }

      audioUrl = URL.createObjectURL(blob);
      _urlCache.set(sentence, audioUrl);
    }

    if (_cancelRequested) break;

    await _playSingleAudio(audioUrl);
  }
}

/**
 * Play a single audio URL and wait for it to finish.
 */
function _playSingleAudio(audioUrl: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (_cancelRequested) {
      resolve();
      return;
    }

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
