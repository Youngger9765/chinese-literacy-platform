/**
 * ttsRate.ts — playback speed for the *demo reading* voice (#3023).
 *
 * WHY THIS IS CLIENT-SIDE AND NOT AN SSML CHANGE
 * -----------------------------------------------
 * Azure's `<prosody rate="1.08">` is baked into the synthesized bytes, and
 * the TTS cache key is sha256(raw_text.strip()) with no provider, voice or
 * rate in it (CLAUDE.md, TTS section) -- the GCS prefix is the only
 * separator. So lowering the SSML rate changes nothing for the ~6356
 * already-cached sentences; it needs a new prefix and a full re-synthesis.
 *
 * Measured on prod: 21 chars / 4.608s = 273 字/分. The same worksheet prints
 * reading_benchmark.levels of ＜200 / 201~230 / ＞231, so the voice the
 * student is told to imitate reads faster than the top band that worksheet
 * defines. That is the substance of the teachers' report.
 *
 * playbackRate costs nothing, needs no re-synthesis, and -- unlike a global
 * SSML change -- lets one student slow down without slowing the class. The
 * 課後學習扶助 case that prompted this is exactly "this student needs it
 * slower", not "everyone does".
 *
 * ⚠️ SCOPE: the *demo* voice only. Do NOT apply this to a student's own
 * recording playback (ParagraphReadingControls, KeyPassageReading's replay)
 * or to a teacher listening to a submission (AssignmentSubmissionTable) --
 * those are evidence of how someone actually spoke, and re-timing them
 * would misrepresent the recording.
 *
 * ⚠️ DEFAULT: 0.85 as of #3023 — see DEFAULT_TTS_RATE below for why that
 * specific number, and ttsDefaultRateBand.test.ts for the lock that keeps
 * it inside the worksheet's own benchmark rather than merely pinning a
 * literal.
 */

export const TTS_RATE_STORAGE_KEY = 'tts_playback_rate_v1';

/**
 * Measured on prod: 21 characters of demo audio in 4.608s = 273 字/分.
 * Everything below is expressed as a multiple of this.
 */
export const BASELINE_CHARS_PER_MIN = 273;

/**
 * The worksheet prints its own reading_benchmark.levels: ＜200 / 201~230 / ＞231.
 * 231 is therefore the floor of the band it calls the best a student can do.
 */
export const WORKSHEET_TOP_BAND_FLOOR = 231;

/**
 * Shipped default: 0.85x = 232 字/分.
 *
 * WHY NOT 1.0 (the original). At 1.0 the demo reads at 273 字/分, which is
 * 42 字/分 FASTER than 231 -- the floor of the top band the same worksheet
 * defines. The model a student is told to imitate was faster than the best
 * score that worksheet says exists. Teachers running 課後學習扶助 reported
 * exactly this: "語速有點太快，希望慢一點".
 *
 * WHY NOT 0.7. That yields 191 字/分, below the 201~230 middle band -- the
 * demo would then be slower than an average reader, which is not a model
 * worth imitating either, and it undersells students who already read well.
 *
 * 0.85 is the only offered option that lands inside the worksheet's own top
 * band: aspirational, and actually reachable. A student who wants the old
 * speed can still pick 正常; the choice is remembered per browser.
 */
export const DEFAULT_TTS_RATE = 0.85;

/**
 * Bounds for anything that reaches an <audio> element. 0 or negative
 * silences/breaks it; far-from-1 rates are not intelligible speech. A
 * hand-edited or corrupted localStorage value must not get through.
 */
const MIN_RATE = 0.5;
const MAX_RATE = 1.5;

export interface TtsRateOption {
  value: number;
  label: string;
  /** Roughly what the demo voice lands at, given the measured 273 字/分. */
  approxCharsPerMin: number;
}

/**
 * Labels are speeds, not judgements -- a student picking "慢" should not
 * read it as "the slow-learner setting". 273 字/分 is the measured baseline.
 */
export const TTS_RATE_OPTIONS: readonly TtsRateOption[] = [
  { value: 0.7, label: '慢', approxCharsPerMin: Math.round(273 * 0.7) },   // 191
  { value: 0.85, label: '稍慢', approxCharsPerMin: Math.round(273 * 0.85) }, // 232 — shipped default
  { value: 1, label: '正常', approxCharsPerMin: 273 },                      // the original speed
];

function isUsableRate(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_RATE && n <= MAX_RATE;
}

/** Never throws, never returns an unusable number. */
export function getTtsPlaybackRate(): number {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TTS_RATE_STORAGE_KEY);
  } catch {
    return DEFAULT_TTS_RATE; // private browsing / ITP / quota
  }
  if (raw === null || raw.trim() === '') return DEFAULT_TTS_RATE;
  const n = Number(raw);
  return isUsableRate(n) ? n : DEFAULT_TTS_RATE;
}

/** Silently ignores an out-of-range rate rather than persisting it. */
export function setTtsPlaybackRate(rate: number): void {
  if (!isUsableRate(rate)) return;
  try {
    localStorage.setItem(TTS_RATE_STORAGE_KEY, String(rate));
  } catch {
    /* preference just won't persist; playback still works */
  }
}

/**
 * Apply the stored preference to one demo-audio element.
 *
 * preservesPitch is pinned true: with it off, a slowed voice drops in pitch
 * and stops being a model worth imitating. Chrome and Safari default it to
 * true today, but it has been defaulted the other way before, so state it.
 */
export function applyDemoPlaybackRate(audio: HTMLAudioElement): void {
  const rate = getTtsPlaybackRate();
  audio.playbackRate = rate;
  if ('preservesPitch' in audio) {
    audio.preservesPitch = true;
  }
}
