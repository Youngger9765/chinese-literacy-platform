/**
 * recordingValidation.ts — Issue #2362
 *
 * Shared "①.5 Recording Validation" layer that sits between ① Recording and
 * ② STT Transcription for BOTH ParagraphReading (per-paragraph) and KeyPassageReading
 * (full text).
 *
 * Previously the silence gate existed only in useKeyPassageReadingSession.ts (#2321).
 * ParagraphReading had no front-end guard and sent silent audio straight to Gemini,
 * allowing hallucinations to pass the hallucination-prefix backend gate
 * (which only fires when transcript ≥ 35% length of target).
 *
 * Constants are the single source of truth; both hooks import from here.
 */

/** Peak volume (0–1) from AnalyserNode below which we consider the recording silent.
 *  0.05 ≈ 6.4 / 128 byte value — well below conversational speech (~0.15–0.4)
 *  but above true digital silence.  Conservative so we do not block soft readers. */
export const SILENT_PEAK_THRESHOLD = 0.05;

/** 絕對下限：任何段落都至少要錄這麼久。比誤觸長，比一個字的朗讀短。
 *
 *  ⚠️ **1500 → 1000（#3299，2026-09-27）**。原本前端是 1500、後端是 1000 ——
 *  前端**比後端嚴**，意思是 client 會擋掉 server 本來願意收的錄音，而孩子在那個
 *  當下沒有任何申訴管道。兩邊不一致的兩種方向都不好，但這個方向更糟。
 *
 *  #2362 當初挑 1500 是在「門檻是平的」那個年代 —— 它要防的是誤觸，而現在
 *  `minDurationMsFor()` 對任何真實段落都要求遠超過這個數（最短的重點段 248 字
 *  就要 24.8 秒），所以這個下限實際上只在**拿不到課文**時才生效。
 *  既然它已經不是主力，就讓它跟後端一致，別再製造分岔。 */
export const SILENT_MIN_DURATION_MS = 1000;

/** 「快到不可能」的朗讀速度（字/分）。**必須與後端 `_MAX_PLAUSIBLE_CPM` 同值。**
 *
 *  依據是實測不是拍的：staging 人聲語料 338 筆真人朗讀，把全文唸完的那些最快
 *  463 字/分（見 `backend/specs/fixtures/reading_corpus_durations.csv`）。
 *  600 相對它有 1.30 倍餘裕，而對及格速度（年級常模 190~220）有 2.7 倍。 */
export const MAX_PLAUSIBLE_CPM = 600;

/** 這段課文至少要唸多久才可能是真的唸完（毫秒）。
 *
 *  ⚠️ **這條公式與後端 `_min_duration_ms_for()` 必須一致**，否則會出現
 *  「前端放行、後端擋掉」——孩子等完一整趟往返才被告知太短，那正是 #3299 的病。
 *  一致性由 `__tests__/clientGateMatchesServer3299.test.ts` 鎖住。
 *
 *  `targetChars` 拿不到（0）時退回平門檻，不要憑空擋人。 */
export function minDurationMsFor(targetChars: number): number {
  if (!Number.isFinite(targetChars) || targetChars <= 0) return SILENT_MIN_DURATION_MS;
  return Math.max(SILENT_MIN_DURATION_MS, Math.floor((targetChars / MAX_PLAUSIBLE_CPM) * 60_000));
}

import { countScorableCharacters } from './textDiff';

/** 用計分器的單位數字數 —— 門檻的分母必須跟 cpm 常模同一個單位。 */
function scorableCharCount(text: string): number {
  try {
    return countScorableCharacters(text);
  } catch {
    return 0; // 算不出來就當拿不到課文，退回平門檻（寧可放行）
  }
}

export type ValidationFailReason = 'silent' | 'too_short';

export interface RecordingValidationResult {
  ok: boolean;
  reason: ValidationFailReason | null;
}

/**
 * Validate a completed recording before sending it to STT.
 *
 * Returns { ok: true, reason: null } if the recording appears to contain speech.
 * Returns { ok: false, reason: 'silent' | 'too_short' } otherwise.
 *
 * @param opts.peakVolume  - peak volume (0–1) from audioRecorder.getPeakVolume()
 * @param opts.durationMs  - actual recording duration in milliseconds
 */
export function validateRecording(opts: {
  peakVolume: number;
  durationMs: number;
  /** 這次要唸的課文。給了就用段落相對門檻；沒給就退回平的 1500ms（舊行為）。
   *
   *  #3299：後端早就改成跟段落走了，但前端還是平的 —— 於是「130 字的段落只錄到
   *  兩秒」在前端放行，孩子上傳最多 10MB、等一趟 Gemini 往返，才拿到「請重錄一次」。
   *  同一條規則放在這裡＝零上傳、零延遲、當場知道。 */
  targetText?: string;
}): RecordingValidationResult {
  const { peakVolume, durationMs, targetText } = opts;

  const minMs = minDurationMsFor(scorableCharCount(targetText ?? ''));
  if (durationMs < minMs) {
    return { ok: false, reason: 'too_short' };
  }

  if (peakVolume < SILENT_PEAK_THRESHOLD) {
    return { ok: false, reason: 'silent' };
  }

  return { ok: true, reason: null };
}
