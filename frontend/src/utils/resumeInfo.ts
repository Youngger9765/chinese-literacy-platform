/**
 * 首頁「接著做」要的資料：上次進行中的課與第幾關（#4159）
 *
 * 資料來源與規則跟續讀提示（SessionResumePrompt）同一份：
 *  - 紀錄是登入時存在這台裝置的 active session
 *  - 超過 7 天算放棄
 *  - 關卡用 `dbStepNumber` 對身分、不是比大小（見 SessionResumePrompt 的 #3153 說明）
 *  - 不認得、已停用、或已到最後一關（成績單 = 做完）都不算進行中
 *
 * 只讀不刪：清掉無效紀錄是續讀提示自己的事，這裡刪了會讓兩邊各自為政。
 */
import { loadActiveSession } from '../services/api';
import { STEP_REGISTRY, resolveActiveSteps } from '../config/stepConfig';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResumeInfo {
  storyId: string;
  stepId: string;
  stepLabel: string;
  /** 第幾關（從 1 算，依現行啟用的關卡順序） */
  stepNumber: number;
  totalSteps: number;
}

export interface ResumeRecord {
  storyId: string;
  currentStep: number;
}

/** 只做「有沒有進行中紀錄、有沒有過期」，關卡要等拿到那一課自己的關卡順序才能算 */
export function loadResumeRecord(userId: string, now: number = Date.now()): ResumeRecord | null {
  const saved = loadActiveSession(userId);
  if (!saved) return null;
  if (now - saved.timestamp > MAX_AGE_MS) return null;
  return { storyId: saved.storyId, currentStep: saved.currentStep };
}

/**
 * 用「這一課自己的」關卡順序算第幾關（每課順序與總關數都不同，文言文還有專屬關卡），
 * 不能用全站預設順序（審查實測 155/179 課至少一關位置不同）
 */
export function resolveResume(
  record: ResumeRecord,
  stepSequence?: string[] | null,
): ResumeInfo | null {
  const step = Object.values(STEP_REGISTRY).find((s) => s.dbStepNumber === record.currentStep);
  if (!step) return null;

  const active = resolveActiveSteps(stepSequence);
  const idx = active.findIndex((s) => (s.baseId ?? s.id) === step.id);
  if (idx < 0) return null; // 已停用或這課沒有的關卡
  if (idx === active.length - 1) return null; // 最後一關 = 成績單 = 做完

  return {
    storyId: record.storyId,
    stepId: active[idx].id,
    stepLabel: step.label,
    stepNumber: idx + 1,
    totalSteps: active.length,
  };
}

export function findResumeInfo(
  userId: string,
  now: number = Date.now(),
  stepSequence?: string[] | null,
): ResumeInfo | null {
  const record = loadResumeRecord(userId, now);
  return record ? resolveResume(record, stepSequence) : null;
}
