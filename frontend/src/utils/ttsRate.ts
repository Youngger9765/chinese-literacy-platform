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
 * ⚠️ DEFAULT: DEFAULT_TTS_RATE stays 1.0, i.e. today's speed. Whether the
 * shipped default should be slower is a product call for the owner; this
 * module only makes the choice possible and remembers it per browser.
 */

export const TTS_RATE_STORAGE_KEY = 'tts_playback_rate_v1';

/** Today's behaviour. Changing this changes the speed for every student. */
export const DEFAULT_TTS_RATE = 1;

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
  { value: 0.7, label: '慢', approxCharsPerMin: 191 },
  { value: 0.85, label: '稍慢', approxCharsPerMin: 232 },
  { value: 1, label: '正常', approxCharsPerMin: 273 },
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
