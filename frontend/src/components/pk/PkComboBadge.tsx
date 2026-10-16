/**
 * PkComboBadge — PRD §3.3: "連續答對 2 題以上疊加一個小小的「連擊」提示文字
 * （如「連對 2！」）——連擊數純前端計算，從這場對戰目前已知的作答序列即可
 * 算出，不需要在資料庫多開欄位記錄".
 */
import React from 'react';

export interface PkAnswerLite {
  round_index: number;
  is_correct: boolean;
}

/** Pure function: current trailing streak of correct answers, computed
 * client-side from the answer history already visible in match state. */
export function computeCombo(answers: PkAnswerLite[]): number {
  const sorted = [...answers].sort((a, b) => a.round_index - b.round_index);
  let combo = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].is_correct) combo += 1;
    else break;
  }
  return combo;
}

const PkComboBadge: React.FC<{ combo: number }> = ({ combo }) => {
  if (combo < 2) return null;
  return (
    <div
      key={combo}
      className="pointer-events-none select-none rounded-full bg-tertiary-container px-3 py-1 text-sm font-bold text-tertiary animate-pop"
      role="status"
    >
      連對 {combo}！
    </div>
  );
};

export default PkComboBadge;
