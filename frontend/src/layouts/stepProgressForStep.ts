/**
 * stepProgressForStep — 讓步驟頁讀得回自己這一輪的進度（#4028）
 *
 * #2930 把「寫」補上了輪次：步驟頁傳寫死的 base id（`vocab-definition`），
 * layout 幫它存成 `vocab-definition#c9fyn`。但「讀」沒有跟著改 —— 十個步驟頁都還在讀
 * `step_data['vocab-definition']`，而 179 課裡有 169 課的步驟 id 帶 `#slug`，所以
 * 離開一步再回來，那一步的進度就讀不到，學生被要求從第 1 題重做。資料一直都在 DB，
 * 只是讀錯 key。
 *
 * 跟 #2930 一樣在 layout 一處解決：給步驟頁的 step_data 裡，把「目前這一輪」的資料
 * 也放在 base id 底下。步驟頁不用改，以後新增的步驟也不會漏。
 *
 * 舊資料（#2930 之前、或紙本 OMO 同步）寫的是不帶輪次的 key：這一課這種步驟只出現
 * 一次時照樣接受；出現好幾輪（真的多篇）就不借，免得第 2 篇讀到第 1 篇的進度 ——
 * 跟報告卡片（reportCardsModel.buildStepReportCards）同一條規則。
 */
import type { StepProgressData } from '../services/learningApi';

export function stepProgressForStep(
  progress: StepProgressData,
  stepKey: string,
  stepSequence: readonly string[] | null | undefined,
): StepProgressData {
  const i = stepKey.indexOf('#');
  if (i < 0) return progress;
  const base = stepKey.slice(0, i);
  const stepData = progress.step_data ?? {};
  const rounds = (stepSequence ?? []).filter((s) => s === base || s.startsWith(`${base}#`)).length;
  const own = stepData[stepKey];
  const value = own !== undefined ? own : rounds <= 1 ? stepData[base] : undefined;
  if (value === stepData[base]) return progress;
  const nextStepData = { ...stepData };
  if (value === undefined) delete nextStepData[base];
  else nextStepData[base] = value;
  return { ...progress, step_data: nextStepData };
}
