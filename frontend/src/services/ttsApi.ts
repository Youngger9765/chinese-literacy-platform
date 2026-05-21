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

import { authToken } from '../utils/storage';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

/** Build Authorization header if a token is available.
 *  #1786: previously duplicated TOKEN_KEY locally → centralised in authToken. */
function _authHeaders(): Record<string, string> {
  return authToken.authHeader();
}

// In-memory URL cache: sentence text → blob URL.
// Avoids re-fetching the same sentence audio.
// Blob URLs are released when the page unloads.
const _urlCache = new Map<string, string>();

// In-process lesson mapping cache: "lessonId-paragraphIdx" → canonical sentence texts.
// Populated on first access from GET /api/tts/mapping/{lessonId}. (Issue #1208 fix)
const _mappingCache = new Map<string, string[]>();

// Track the currently playing audio element so cancelTts() can stop it
let _currentAudio: HTMLAudioElement | null = null;

// Flag to signal cancellation mid-sequence
let _cancelRequested = false;

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
 * Pause the currently playing sentence without aborting the queue.
 * Next sentence will still be fetched+played when resumed.
 * Used by the v2 sentence-level playback path where useTtsPlayback has
 * no direct handle to the internal Audio element.
 */
export function pauseCurrentTts(): void {
  _currentAudio?.pause();
}

/**
 * Resume a previously paused sentence.
 */
export function resumeCurrentTts(): void {
  _currentAudio?.play().catch(() => {});
}

/**
 * Synthesise and play *text* in Traditional Chinese via Azure/Gemini TTS.
 *
 * When lessonId + paragraphIdx are provided, fetches canonical sentence list from
 * GET /api/tts/mapping/{lessonId} so SHA-256 keys match pre-generated GCS blobs
 * (Issue #1208 fix: eliminates regex-split cache miss → 8s live synthesis).
 *
 * Falls back to regex _splitSentences() when lessonId is not provided.
 *
 * @param text - Text to synthesise (keep under 5000 chars per request).
 * @param lessonId - Optional lesson ID for canonical v2 sentence lookup.
 * @param paragraphIdx - Optional paragraph index (0-based) within the lesson.
 * @returns Promise that resolves when all sentences finish, or rejects on fatal error.
 */
export async function speakText(
  text: string,
  lessonId?: number,
  paragraphIdx?: number,
): Promise<void> {
  if (!text.trim()) return;
  cancelTts();
  _cancelRequested = false;
  await _speakViaBackend(text, lessonId, paragraphIdx);
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
 * @param lessonId - Optional lesson ID for canonical v2 sentence lookup.
 * @param paragraphIdx - Optional paragraph index (0-based) within the lesson.
 * @returns Promise that resolves when all sentences finish, or rejects on fatal error.
 */
export async function speakTextWithProgress(
  text: string,
  onProgress: (info: TtsProgressInfo) => void,
  lessonId?: number,
  paragraphIdx?: number,
): Promise<void> {
  if (!text.trim()) return;
  cancelTts();
  _cancelRequested = false;
  await _speakViaBackendWithProgress(text, onProgress, lessonId, paragraphIdx);
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
    _mappingCache.clear();
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
// Private: canonical sentence list from backend mapping (Issue #1208 fix)
// ---------------------------------------------------------------------------

/**
 * Fetch canonical sentences for a lesson paragraph from the backend mapping.
 *
 * Uses GET /api/tts/mapping/{lessonId} which now returns sentences from
 * sentences.v2.jsonl (Opus 4.7 segmentation).  The SHA-256 of each sentence
 * text matches pre-generated GCS blobs → cache hit, no live synthesis.
 *
 * Returns null on any fetch/parse error so the caller can fall back to regex.
 */
async function _fetchLessonSentences(
  lessonId: number,
  paragraphIdx: number,
): Promise<string[] | null> {
  const cacheKey = `${lessonId}-${paragraphIdx}`;
  if (_mappingCache.has(cacheKey)) {
    return _mappingCache.get(cacheKey)!;
  }

  try {
    const response = await fetch(`${API_BASE}/api/tts/mapping/${lessonId}`);
    if (!response.ok) return null;
    const data = await response.json() as {
      paragraphs: Array<{ index: number; sentences: Array<{ text: string }> }>;
    };
    // Populate all paragraphs from this lesson into the cache at once.
    for (const para of data.paragraphs) {
      const key = `${lessonId}-${para.index}`;
      _mappingCache.set(key, para.sentences.map((s) => s.text));
    }
    return _mappingCache.get(cacheKey) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private: backend sequential playback
// ---------------------------------------------------------------------------

async function _fetchAudioUrl(sentence: string): Promise<string> {
  let audioUrl = _urlCache.get(sentence);
  if (!audioUrl) {
    const response = await fetch(`${API_BASE}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
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

async function _speakViaBackend(
  text: string,
  lessonId?: number,
  paragraphIdx?: number,
): Promise<void> {
  let sentences: string[];

  // Prefer canonical v2 sentences to guarantee GCS cache hits (Issue #1208).
  if (lessonId !== undefined && paragraphIdx !== undefined) {
    const canonical = await _fetchLessonSentences(lessonId, paragraphIdx);
    sentences = canonical ?? _splitSentences(_cleanForTts(text));
  } else {
    const cleaned = _cleanForTts(text);
    if (!cleaned) return;
    sentences = _splitSentences(cleaned);
  }

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
  lessonId?: number,
  paragraphIdx?: number,
): Promise<void> {
  let sentences: string[];

  // Prefer canonical v2 sentences to guarantee GCS cache hits (Issue #1208).
  if (lessonId !== undefined && paragraphIdx !== undefined) {
    const canonical = await _fetchLessonSentences(lessonId, paragraphIdx);
    sentences = canonical ?? _splitSentences(_cleanForTts(text));
  } else {
    const cleaned = _cleanForTts(text);
    if (!cleaned) return;
    sentences = _splitSentences(cleaned);
  }

  if (sentences.length === 0) return;

  const total = sentences.length;

  // Bug 1 (#1211): progress must be char-weighted, not sentence-weighted.
  // Consumer computes `pos = Math.floor(progress * charCount)` against the
  // whole paragraph's cleaned char count. Sentence-weighted progress drifts
  // 2-12 chars when sentence lengths are highly variable (Opus v2 segmenter).
  //
  // _cleanForTts is idempotent for all transforms we use on already-clean
  // canonical sentences; the only edge is adjacent 「，」 which collapses only
  // at paragraph-level cleaning (1-3 char delta across a whole paragraph),
  // well under the 2-12 char drift this PR targets.
  const sentChars = sentences.map((s) => Array.from(_cleanForTts(s || '')).length);
  const cumChars: number[] = [0];
  for (const n of sentChars) cumChars.push(cumChars[cumChars.length - 1] + n);
  const totalChars = Math.max(cumChars[cumChars.length - 1], 1);

  // Bug 2 (#1211): prefetch next sentence's audio URL while current plays
  // so 100-500ms inter-sentence fetch doesn't freeze the highlight.
  const firstIdx = sentences.findIndex((s) => s?.trim());
  let pending: { idx: number; promise: Promise<string> } | null =
    firstIdx >= 0
      ? { idx: firstIdx, promise: _fetchAudioUrl(sentences[firstIdx]) }
      : null;

  for (let i = 0; i < total; i++) {
    if (_cancelRequested) break;
    const sentence = sentences[i];
    if (!sentence?.trim()) continue;

    onProgress({
      sentenceIndex: i,
      totalSentences: total,
      progress: cumChars[i] / totalChars,
    });

    const audioUrl = pending && pending.idx === i
      ? await pending.promise
      : await _fetchAudioUrl(sentence);
    if (_cancelRequested) break;

    // Start prefetch for next non-empty sentence BEFORE awaiting playback.
    let j = i + 1;
    while (j < total && !sentences[j]?.trim()) j++;
    pending = j < total
      ? { idx: j, promise: _fetchAudioUrl(sentences[j]) }
      : null;

    const startChar = cumChars[i];
    const nChars = sentChars[i];

    await _playSingleAudio(audioUrl, (currentTime, duration) => {
      const within = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
      const charPos = startChar + within * nChars;
      onProgress({
        sentenceIndex: i,
        totalSentences: total,
        progress: charPos / totalChars,
      });
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

