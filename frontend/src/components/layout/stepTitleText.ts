/**
 * 頁首的關卡標題文字（#4157）。
 *
 * 報告頁不帶「N/total」：那是關卡位置，而報告頁自己的頁首寫「完成 X / Y 關」，
 * 兩個數字在一關都沒做時會互相矛盾（「報告 10/10」對「完成 0 / 9 關」）。
 */
export function stepTitleText(
  step: { id: string; label: string },
  index: number,
  total: number,
  inToolbox: boolean,
): string {
  if (inToolbox || step.id === 'report') return step.label;
  return `${step.label} ${index + 1}/${total}`;
}
