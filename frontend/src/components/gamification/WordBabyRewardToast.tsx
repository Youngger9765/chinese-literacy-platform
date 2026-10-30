/**
 * WordBabyRewardToast — mid-session word-baby fragment/encounter notification
 * (#3794，PRD 2026-10-30-island-v2-rpg-pets-story-prd.md §5「即時回饋」)。
 *
 * 同一個位置、同一套模式照抄 BadgeUnlockToast（#3024）：渲染在
 * LearningLayout 層級，不管學生當下在哪一步都看得到，不是每個步驟頁各自
 * 接一次。文案邏輯沿用既有 `wordBabyRewardHint.ts`（島嶼頁已經在用、已經
 * 測過優先序：遇到新寶貝 > 碎片，一次只講一件事）——不重寫一份新的文案
 * 規則，否則學生在學習頁跟回到島上看到的措辭會對不起來。
 */
import React, { useEffect } from 'react';
import { firstWordBabyRewardHint } from '../../pages/lab/island/wordBabyRewardHint';
import type { WordBabyRewardMessagePayload } from '../../pages/lab/island/storyMode';

export interface WordBabyRewardToastProps {
  /** 本次 session 新發放的獎勵。空陣列或「全部都沒有文案」時不渲染任何東西。 */
  rewards: WordBabyRewardMessagePayload[];
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;

const WordBabyRewardToast: React.FC<WordBabyRewardToastProps> = ({ rewards, onDismiss }) => {
  const hint = firstWordBabyRewardHint(rewards);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // 重新武裝計時器的時機比照 BadgeUnlockToast：整批 rewards 變了（用
    // id 清單當 key）才重算，不要因為 onDismiss 參考變了就重設。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewards.map((r) => r.id).join(',')]);

  if (!hint) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="word-baby-reward-toast"
      className="fixed top-6 right-6 z-50"
    >
      <div className="max-w-xs rounded-2xl border-2 border-amber-200 bg-white px-5 py-4 shadow-2xl">
        <div className="mb-2 text-xs font-medium text-gray-500">喝采島</div>
        <p className="text-sm font-bold text-gray-800">{hint}</p>
        <button
          onClick={onDismiss}
          className="mt-3 w-full text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          好的！
        </button>
      </div>
    </div>
  );
};

export default WordBabyRewardToast;
