/**
 * 頁首與底部的關卡文字（#4157、#4155）。
 *
 * 名稱與「第 N / M 關」分開：以前寫成「報告 10/10」，在一關都沒做時會和報告頁自己的
 * 「完成 0 / 9 關」互相矛盾。M 不含報告（報告是總結，不是一關），報告頁與工具箱模式
 * 不顯示計數。頁首與底部進度列共用這裡，才不會一邊 9、一邊 10。
 */
export function stepTitleText(step: { id: string; label: string }): string {
  return step.label;
}

/** 不含報告的關數（M） */
export function stepCountExcludingReport(steps: ReadonlyArray<{ id: string }>): number {
  return steps.filter((s) => s.id !== 'report').length;
}

export function stepCounterText(
  steps: ReadonlyArray<{ id: string }>,
  index: number,
  inToolbox: boolean,
): string | null {
  const current = steps[index];
  if (inToolbox || !current || current.id === 'report') return null;
  // N 只數「到這一關為止的非報告關」，報告不在最後也不會讓分子超過分母
  const n = steps.slice(0, index + 1).filter((s) => s.id !== 'report').length;
  return `第 ${n} / ${stepCountExcludingReport(steps)} 關`;
}
