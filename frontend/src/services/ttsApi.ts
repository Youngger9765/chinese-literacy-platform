import { API_BASE } from './apiConfig';
import { authToken } from '../utils/storage';
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


/** Build Authorization header if a token is available. */
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

// ---------------------------------------------------------------------------
// Issue #1808: 429 rate-limit state
// ---------------------------------------------------------------------------

/**
 * When the backend returns 429, we pause the TTS queue until Retry-After elapses.
 * _rateLimitUntil holds the timestamp (ms) after which requests can resume.
 * 0 = not rate-limited.
 */
let _rateLimitUntil = 0;

/**
 * Optional callback invoked when TTS hits a 429 rate limit.
 * Callers (e.g. useTtsPlayback) can use this to show a toast / disable the
 * play button without needing to catch an exception.
 * Receives the number of seconds until the limit resets.
 */
let _onRateLimit: ((retryAfterSeconds: number) => void) | null = null;

/**
 * Register a callback to be called when TTS is rate-limited (429).
 *
 * Usage:
 *   setTtsRateLimitCallback((secs) => showToast(`AI 助教暫時忙線，請 ${secs} 秒後再試`, 'warning'));
 */
export function setTtsRateLimitCallback(cb: ((retryAfterSeconds: number) => void) | null): void {
  _onRateLimit = cb;
}

/**
 * Return true if TTS requests are currently paused due to a 429 response.
 * Useful for disabling the play button in the UI.
 */
export function isTtsRateLimited(): boolean {
  return Date.now() < _rateLimitUntil;
}

/**
 * Remaining seconds until the TTS rate limit resets, or 0 if not limited.
 */
export function ttsRateLimitRemainingSeconds(): number {
  const remaining = _rateLimitUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
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
  /** 這一節自己的代號。一課多篇時少了它會唸到第 1 篇（#2930）。 */
  roundSlug?: string,
): Promise<void> {
  if (!text.trim()) return;
  cancelTts();
  _cancelRequested = false;
  await _speakViaBackend(text, lessonId, paragraphIdx, roundSlug);
}

/**
 * Warm the cache for text that will be spoken soon, without playing it.
 *
 * The in-loop prefetch only reaches the next sentence of the *current*
 * paragraph, so every paragraph boundary still fetched cold — which is where
 * a whole-lesson walk audibly stalls. A walker calls this with the next
 * paragraph while the current one is still being read.
 *
 * Never throws and never interrupts playback: a failed warm-up simply means
 * the real request pays for it later.
 */
export function prefetchText(
  text: string | undefined,
  lessonId?: number,
  paragraphIdx?: number,
  /** 這一節自己的代號（#2930）—— 少了它會預熱到第 1 篇。 */
  roundSlug?: string,
): void {
  if (!text || !text.trim()) return;
  void (async () => {
    try {
      let sentences: string[] | null = null;
      if (lessonId !== undefined && paragraphIdx !== undefined) {
        sentences = await _fetchLessonSentences(lessonId, paragraphIdx, roundSlug);
      }
      // Warm exactly what playback will ask for, or the warm-up is wasted and
      // pays for a second synthesis on top. When there is lesson context that
      // is the whole paragraph — reassembled the same way _speakViaBackend
      // reassembles it — not its first sentence. Getting this wrong was
      // measurable on staging: 8 synthesis requests for a 5-paragraph lesson,
      // alternating one long (the paragraph) and one short (a first sentence
      // nothing would ever play), and 13% of playback silent because every
      // paragraph still started cold.
      const unit =
        sentences !== null && sentences !== undefined
          ? sentences.join('').trim()
          : _splitSentences(_cleanForTts(text)).find((x) => x.trim());
      if (unit) await _fetchAudioUrl(unit);
    } catch {
      // deliberately silent — see doc comment
    }
  })();
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
  /** 這一節自己的代號（#2930）。 */
  roundSlug?: string,
): Promise<void> {
  if (!text.trim()) return;
  cancelTts();
  _cancelRequested = false;
  await _speakViaBackendWithProgress(text, onProgress, lessonId, paragraphIdx, roundSlug);
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
    _rateLimitUntil = 0;
    _onRateLimit = null;
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
  roundSlug?: string,
): Promise<string[] | null> {
  // 一課印好幾篇時，`lessonId + 段落序號` 定址的是**整課頂層**（＝第 1 篇），
  // 所以快取 key 也要分篇 —— 少了它，第 1 篇先到就把後兩篇釘死，
  // 而且畫面正常、音檔正常播出，只是唸錯篇（#2930）。
  const cacheKey = `${lessonId}-${roundSlug ?? ''}-${paragraphIdx}`;
  if (_mappingCache.has(cacheKey)) {
    return _mappingCache.get(cacheKey)!;
  }

  try {
    const qs = roundSlug ? `?p=${encodeURIComponent(roundSlug)}` : '';
    const response = await fetch(`${API_BASE}/api/tts/mapping/${lessonId}${qs}`);
    if (!response.ok) return null;
    const data = await response.json() as {
      paragraphs: Array<{ index: number; sentences: Array<{ text: string }> }>;
    };
    // Populate all paragraphs from this lesson into the cache at once.
    for (const para of data.paragraphs) {
      const key = `${lessonId}-${roundSlug ?? ''}-${para.index}`;
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

/**
 * Fetch audio URL for a sentence, or null if rate-limited (429).
 *
 * On 429 (Issue #1808):
 * - Reads Retry-After header (default 60s).
 * - Sets _rateLimitUntil so subsequent sentences in the queue skip fetching.
 * - Fires _onRateLimit callback so the UI can show a toast.
 * - Returns null — callers skip playback for this sentence instead of throwing.
 *
 * On any other error: throws (existing behaviour, caught by outer try/catch in
 * speakText callers or surfaced to the user as a silent skip).
 */
/**
 * Requests in flight, so two callers asking for the same sentence at the same
 * time produce one synthesis rather than two.
 *
 * Needed once prefetch exists: the prefetch for sentence N+1 is still on the
 * wire when the loop arrives at N+1, and the plain `_urlCache` check misses it
 * because nothing has been cached *yet*. Without this we paid for every
 * prefetched sentence twice.
 */
const _inFlight = new Map<string, Promise<string | null>>();

async function _fetchAudioUrl(sentence: string): Promise<string | null> {
  const cached = _urlCache.get(sentence);
  if (cached) return cached;

  const pending = _inFlight.get(sentence);
  if (pending) return pending;

  const request = _fetchAudioUrlUncached(sentence);
  _inFlight.set(sentence, request);
  try {
    return await request;
  } finally {
    _inFlight.delete(sentence);
  }
}

async function _fetchAudioUrlUncached(sentence: string): Promise<string | null> {
  let audioUrl = _urlCache.get(sentence);
  if (!audioUrl) {
    // If still within a rate-limit window, skip this sentence silently.
    if (isTtsRateLimited()) {
      return null;
    }

    const response = await fetch(`${API_BASE}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify({ text: sentence }),
    });

    // Issue #1808 Fix #3: Handle 429 gracefully — pause queue, notify UI.
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
      _rateLimitUntil = Date.now() + retryAfterSeconds * 1000;
      if (_onRateLimit) {
        _onRateLimit(retryAfterSeconds);
      }
      return null; // don't throw — caller skips playback for this sentence
    }

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
  roundSlug?: string,
): Promise<void> {
  let sentences: string[];

  // A paragraph is one synthesis unit, not a list of sentences.
  //
  // Splitting it costs almost nothing in timing — measured, three sentences as
  // one request run 5.33 s against 5.50 s concatenated, and the resulting pause
  // (763 ms) is shorter than the one Azure renders itself between sentences in
  // a single request (873–883 ms). What splitting loses is prosody: each clip
  // is generated in isolation, so the pitch contour resets at every sentence
  // and the reading sounds like a list rather than someone reading aloud.
  //
  // The canonical sentence list is still fetched, but only to reconstruct the
  // paragraph exactly as the backend split it, so the text sent matches the
  // text the mapping describes.
  if (lessonId !== undefined && paragraphIdx !== undefined) {
    const canonical = await _fetchLessonSentences(lessonId, paragraphIdx, roundSlug);
    const paragraph = (canonical?.join('') || _cleanForTts(text)).trim();
    sentences = paragraph ? [paragraph] : [];
  } else {
    const cleaned = _cleanForTts(text);
    if (!cleaned) return;
    sentences = _splitSentences(cleaned);
  }

  if (sentences.length === 0) return;

  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i];
    if (_cancelRequested) break;
    if (!sentence.trim()) continue;

    const audioUrl = await _fetchAudioUrl(sentence);
    // null = 429 rate-limited — skip this sentence (toast already fired)
    if (audioUrl === null) continue;
    if (_cancelRequested) break;

    // Fetch the next sentence while this one is being said (#2627).
    //
    // Playback used to be strictly serial, so every uncached sentence inserted
    // its whole synthesis time as silence — 4.5s on a cold key passage. A
    // sentence takes seconds to say and well under a second to fetch, so the
    // next fetch fits inside the current playback and the gap disappears.
    //
    // Deliberately not awaited, and deliberately before the play: the point is
    // that it overlaps. _fetchAudioUrl caches by sentence text, so when the
    // loop arrives at i+1 it is a local hit rather than a second request.
    _prefetchSentence(sentences[i + 1]);

    await _playSingleAudio(audioUrl);
  }
}

/**
 * Warm the cache for a sentence without playing it. Errors are swallowed —
 * a failed prefetch must never break playback; the real request will retry
 * and surface the failure then.
 */
function _prefetchSentence(sentence: string | undefined): void {
  if (!sentence || !sentence.trim()) return;
  if (_cancelRequested) return;
  if (_urlCache.has(sentence)) return;
  void _fetchAudioUrl(sentence).catch(() => undefined);
}

async function _speakViaBackendWithProgress(
  text: string,
  onProgress: (info: TtsProgressInfo) => void,
  lessonId?: number,
  paragraphIdx?: number,
  roundSlug?: string,
): Promise<void> {
  let sentences: string[];

  // A paragraph is one synthesis unit, not a list of sentences.
  //
  // Splitting it costs almost nothing in timing — measured, three sentences as
  // one request run 5.33 s against 5.50 s concatenated, and the resulting pause
  // (763 ms) is shorter than the one Azure renders itself between sentences in
  // a single request (873–883 ms). What splitting loses is prosody: each clip
  // is generated in isolation, so the pitch contour resets at every sentence
  // and the reading sounds like a list rather than someone reading aloud.
  //
  // The canonical sentence list is still fetched, but only to reconstruct the
  // paragraph exactly as the backend split it, so the text sent matches the
  // text the mapping describes.
  if (lessonId !== undefined && paragraphIdx !== undefined) {
    const canonical = await _fetchLessonSentences(lessonId, paragraphIdx, roundSlug);
    const paragraph = (canonical?.join('') || _cleanForTts(text)).trim();
    sentences = paragraph ? [paragraph] : [];
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
  let pending: { idx: number; promise: Promise<string | null> } | null =
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
    // null = 429 rate-limited — skip playback for this sentence
    if (audioUrl === null) continue;
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

