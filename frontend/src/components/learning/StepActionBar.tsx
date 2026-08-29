/**
 * StepActionBar — 每一步固定在畫面底部的那條動作列。**唯一一條。**
 *
 * 為什麼要有這個元件（#2897）
 * ---------------------------
 * 在此之前，同一段 markup 被抄了 11 份：
 * `ComprehensionChat` / `SentencePractice` / `ListeningPractice` /
 * `FullTextAnnotate` / `VocabDefinitionMatchSummary` / `KnowledgeStation` /
 * `CharacterPractice` / `VocabDefinitionMatch` / `VocabWordSearch` /
 * `ParagraphReadingControls` / `KeyPassageReadingControls`。
 *
 * 11 份是逐字相同的，連那道漸層遮罩的 `#FBF6EE` 都硬寫了 11 次 ——
 * 那個值其實就是 `theme.colors.surface`（`--color-surface`）。一個色票散在
 * 11 個檔案裡，改一次主題就要改 11 個地方，而且漏掉的那幾個不會有人發現：
 * 遮罩顏色跟背景差一點點，肉眼看不出來，只會覺得「某幾步的底部怪怪的」。
 *
 * 位置說明：`bottom-16` = 64px = `StepFooterNav` 的高度（`h-16`），
 * 所以這條動作列剛好疊在那條持久導航列的正上方，不會蓋住它。
 */
import React from 'react';

/** 內容區的排列方式 —— 三種都是既有 call site 用過的形狀，沒有新增。 */
export type StepActionBarLayout =
  /** 單一元素（多半就是一顆 NextStepFooter 或一顆按鈕）。 */
  | 'plain'
  /** 垂直堆疊、左右撐滿（例：再做一次 + 下一關）。 */
  | 'stack'
  /** 垂直堆疊並置中（例：錄音控制列，按鈕寬度各自不同）。 */
  | 'stack-center'
  /**
   * 水平並排置中（例：讀全文-做記號的「播放全文 + 完成標記」，#2941）。
   * `flex-wrap` 是必要的：`max-w-md` 扣掉 `px-6` 之後，360px 的手機只剩約
   * 320px，播放中那三顆（暫停/停止/完成標記）擠不進一行。不換行就會直接
   * 視覺溢出（review #2942 抓到的）—— 換行是退成兩行、仍然置中。
   */
  | 'row';

const LAYOUT_CLASS: Record<StepActionBarLayout, string> = {
  plain: '',
  stack: 'flex flex-col gap-2',
  'stack-center': 'flex flex-col items-center gap-3',
  row: 'flex flex-wrap items-center justify-center gap-3',
};

interface Props {
  children: React.ReactNode;
  layout?: StepActionBarLayout;
}

const StepActionBar: React.FC<Props> = ({ children, layout = 'plain' }) => (
  <div
    data-testid="step-action-bar"
    className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
    // 遮罩讓底下捲動的內容淡出，不會直接切在按鈕邊緣。
    // 顏色跟著 --color-surface 走（literal 只留作 fallback）。
    style={{
      background:
        'linear-gradient(to top, var(--color-surface, #FBF6EE) 60%, transparent)',
    }}
  >
    <div className={`max-w-md mx-auto pointer-events-auto ${LAYOUT_CLASS[layout]}`.trimEnd()}>
      {children}
    </div>
  </div>
);

export default StepActionBar;
