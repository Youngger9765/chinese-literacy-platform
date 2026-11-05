/**
 * ReadingBabyGrowthToast — 閱讀寶貝「寶貝長大了」當頁提示（#3780
 * reading-babies PRD §5「當頁成長提示」，取代 v1 WordBabyRewardToast）。
 *
 * 同一個位置、同一套模式照抄 BadgeUnlockToast（#3024）：渲染在
 * LearningLayout 層級，不管學生當下在哪一步都看得到，不是每個步驟頁各自
 * 接一次。文案邏輯沿用 `readingBabyGrowthHint.ts`——不重寫一份新的文案
 * 規則，否則學生在學習頁跟回到島上看到的措辭會對不起來。
 *
 * G5/G6（遊戲化學院）：這是「小」分級回饋（game-design.md §3.3）——一個
 * 通道（文字卡片），不疊音效/粒子，那兩種留給「進化到中階/進階」的中/大
 * 分級回饋（見 ReadingBabyCardPage 的進化提示）。文案不出現升級/餵食/領取
 * 字樣。
 */
import React, { useEffect } from 'react';
import { firstReadingBabyGrowthHint } from '../../pages/lab/island/readingBabyGrowthHint';
import type { ReadingBabyGrowthMessagePayload } from '../../pages/lab/island/storyMode';

export interface ReadingBabyGrowthToastProps {
  /** 本次 session 新記錄的成長事件。空陣列或「全部都沒有文案」時不渲染任何東西。 */
  events: ReadingBabyGrowthMessagePayload[];
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;

const ReadingBabyGrowthToast: React.FC<ReadingBabyGrowthToastProps> = ({ events, onDismiss }) => {
  const hint = firstReadingBabyGrowthHint(events);

  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // 重新武裝計時器的時機比照 BadgeUnlockToast：整批 events 變了（用
    // station 清單當 key）才重算，不要因為 onDismiss 參考變了就重設。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.map((e) => e.station).join(',')]);

  if (!hint) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="reading-baby-growth-toast"
      className="fixed top-6 right-6 z-50"
    >
      <div className="max-w-xs rounded-2xl border-2 border-amber-200 bg-white px-5 py-4 shadow-2xl">
        <div className="mb-2 text-xs font-medium text-gray-500">喝采島・閱讀寶貝</div>
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

export default ReadingBabyGrowthToast;
