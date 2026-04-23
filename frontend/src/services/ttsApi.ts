/**
 * ttsApi.ts — TTS client with sentence-level sequential playback (Issue #667)
 *
 * Provides speakText() that:
 * 1. Splits text into sentences (matching backend _split_sentences / _clean_for_tts)
 * 2. Fetches each sentence from /api/tts/synthesize (stored per-sentence in GCS)
 * 3. Plays audio blobs sequentially — one sentence finishes, next one starts
 *
 * Azure TTS is the sole TTS source. Web Speech API has been removed (#737).
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

// Auth token for TTS requests (Issue #1234: secure TTS endpoints)
// Set via setAuthToken() from AuthContext on login/logout.
let _authToken: string | null = null;

/**
 * Set the auth token used for TTS backend requests.
 * Call this from AuthContext whenever the token changes (login / logout).
 */
export function setAuthToken(token: string | null): void {
  _authToken = token;
}

/**
 * Get the current auth token, falling back to localStorage.
 * The localStorage fallback covers the window between page load and AuthContext mount.
 */
function _getToken(): string | null {
  if (_authToken) return _authToken;
  try {
    return localStorage.getItem('lingoleap_token');
  } catch {
    return null;
  }
}

/**
 * Stop any TTS currently in progress.
 */
export function cancelTts(): void {
  _cancelRequested = true;
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio.currentTime = 0;
    _currentAudio = null;
  }
}

/**
 * Synthesise and play *text* in Traditional Chinese via Azure TTS.
 *
 * Splits text into sentences and plays each one sequentially via the backend.
 *
 * @param text - Text to synthesise (keep under 5000 chars per request).
 * @returns Promise that resolves when all sentences finish, or rejects on fatal error.
 */
export async function speakText(text: string): Promise<void> {
  if (!text.trim()) return;
  cancelTts();
  _cancelRequested = false;
  await _speakViaBackend(text);
}

/**
 * Progress info emitted during speakTextWithProgress playback.
 */
export interface TtsProgressInfo {
  /** Sentence currently playing (0-based) */
  sentenceIndex: number;
  /** Total number of sentences */
  totalSentences: number;
  /** Overall progress 0–1 based on sentences completed + within-sentence position */
  progress: number;
}

/**
 * Like speakText, but fires `onProgress` on each sentence start and on
 * `timeupdate` within each sentence so callers can render a progress bar.
 *
 * @param text - Text to synthesise.
 * @param onProgress - Called with progress info as playback advances.
 * @returns Promise that resolves when all sentences finish, or rejects on fatal error.
 */
export async function speakTextWithProgress(
  text: string,
  onProgress: (info: TtsProgressInfo) => void,
): Promise<void> {
  if (!text.trim()) return;
  cancelTts();
  _cancelRequested = false;
  await _speakViaBackendWithProgress(text, onProgress);
}

/**
 * Public alias for _cleanForTts — allows other modules to compute the cleaned
 * character count without duplicating the regex logic.
 * Used by useTtsPlayback to calculate msPerChar from the TTS-actual char count.
 */
export const cleanForTts = _cleanForTts;

// Exported for testing only
export const _testInternals = {
  reset() {
    _cancelRequested = false;
    _urlCache.clear();
    _authToken = null;
  },
  splitSentences: _splitSentences,
  cleanForTts: _cleanForTts,
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

async function _fetchAudioUrl(sentence: string): Promise<string> {
  let audioUrl = _urlCache.get(sentence);
  if (!audioUrl) {
    const token = _getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${API_BASE}/api/tts/synthesize`, {
      method: 'POST',
      headers,
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
  return audioUrl;
}

async function _speakViaBackend(text: string): Promise<void> {
  const cleaned = _cleanForTts(text);
  if (!cleaned) return;

  const sentences = _splitSentences(cleaned);
  if (sentences.length === 0) return;

  for (const sentence of sentences) {
    if (_cancelRequested) break;
    if (!sentence.trim()) continue;

    const audioUrl = await _fetchAudioUrl(sentence);
    if (_cancelRequested) break;
    await _playSingleAudio(audioUrl);
  }
}

async function _speakViaBackendWithProgress(
  text: string,
  onProgress: (info: TtsProgressInfo) => void,
): Promise<void> {
  const cleaned = _cleanForTts(text);
  if (!cleaned) return;

  const sentences = _splitSentences(cleaned);
  if (sentences.length === 0) return;

  const total = sentences.length;

  for (let i = 0; i < total; i++) {
    if (_cancelRequested) break;
    const sentence = sentences[i];
    if (!sentence.trim()) continue;

    // Emit start of this sentence
    onProgress({ sentenceIndex: i, totalSentences: total, progress: i / total });

    const audioUrl = await _fetchAudioUrl(sentence);
    if (_cancelRequested) break;

    await _playSingleAudio(audioUrl, (currentTime, duration) => {
      const withinSentence = duration > 0 ? currentTime / duration : 0;
      const progress = (i + withinSentence) / total;
      onProgress({ sentenceIndex: i, totalSentences: total, progress });
    });
  }

  if (!_cancelRequested) {
    // Emit 100% when all sentences finished
    onProgress({ sentenceIndex: total - 1, totalSentences: total, progress: 1 });
  }
}

/**
 * Play a single audio URL and wait for it to finish.
 * Optional `onTimeUpdate` fires with (currentTime, duration) during playback.
 */
function _playSingleAudio(
  audioUrl: string,
  onTimeUpdate?: (currentTime: number, duration: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (_cancelRequested) {
      resolve();
      return;
    }

    const audio = new Audio(audioUrl);
    _currentAudio = audio;

    if (onTimeUpdate) {
      audio.ontimeupdate = () => {
        onTimeUpdate(audio.currentTime, audio.duration || 0);
      };
    }

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

