/**
 * stepAttempts — 每一關「每一次作答」的紀錄（#4087）
 *
 * 成績單的折線圖、點節點看那一次的作答、雷達圖，資料全部來自這裡。
 * 存在 `step_progress.step_data[<關卡 key>].attempts`（DB 的 JSONB），老師端看同一份。
 *
 * 什麼算一次（案主定調 2026-11-16）：第一次做完、「全部重做」做完、「重做錯題」做完，
 * 各算一次；重點朗讀每唸一次算一次。每一關獨立，點數各自不同。
 */

/** 一次作答裡的一題。`correct` 是這一次裡「第一次就答對」。 */
export interface AttemptRow {
  label: string;
  correct: boolean;
  studentAnswer?: string | null;
  correctAnswer?: string | null;
}

export type AttemptKind = 'first' | 'retry-all' | 'retry-wrong' | 'reading';

export interface StepAttempt {
  /** 唯一 id —— 後端合併時依它聯集，競速的儲存不會把別筆洗掉。 */
  id: string;
  /** ISO 時間。 */
  at: string;
  kind: AttemptKind;
  /** 答對題數 / 填對格數（作答類）。重做錯題那一次 = 做完之後總共答對幾題。 */
  correct?: number;
  total?: number;
  /** 重點朗讀。 */
  cpm?: number;
  /** 重點朗讀正確率 0–100。 */
  accuracy?: number;
  /** 這一次的逐題結果，點折線圖節點時顯示。 */
  rows?: AttemptRow[];
}

/** 每一關最多留幾筆（最舊的先丟）—— step_progress 是一整個 JSONB，不能無限長。 */
export const MAX_ATTEMPTS_PER_STEP = 30;

export function newAttemptId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${rand}`;
}

/** 從 step_data 的一關讀出 attempts（形狀不對的略過），依時間排序。 */
export function readAttempts(stepData: unknown): StepAttempt[] {
  if (!stepData || typeof stepData !== 'object') return [];
  const list = (stepData as { attempts?: unknown }).attempts;
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is StepAttempt =>
      !!a && typeof a === 'object' && typeof (a as StepAttempt).id === 'string' && typeof (a as StepAttempt).at === 'string')
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** 加一筆（同 id 不重複），超過上限丟最舊的。回傳新陣列。 */
export function appendAttempt(prev: unknown, attempt: StepAttempt): StepAttempt[] {
  const list = readAttempts({ attempts: prev }).filter((a) => a.id !== attempt.id);
  list.push(attempt);
  list.sort((a, b) => a.at.localeCompare(b.at));
  return list.slice(-MAX_ATTEMPTS_PER_STEP);
}

/** 建一筆作答類的紀錄。 */
export function scoredAttempt(
  kind: Exclude<AttemptKind, 'reading'>,
  correct: number,
  total: number,
  rows?: AttemptRow[],
): StepAttempt {
  return { id: newAttemptId(), at: new Date().toISOString(), kind, correct, total, ...(rows ? { rows } : {}) };
}
