/**
 * StepCoachCard — 每一步開場那張「怎麼玩？」教學卡。**唯一一張。**
 *
 * 為什麼要有這個元件（#2897）
 * ---------------------------
 * 在此之前有 6 份各自手寫的 `OnboardingCoach`，而且已經漂開了：
 *
 * | 檔案 | 底色 | 標題 | icon | 內距 | 按鈕 | 下方留白 |
 * |---|---|---|---|---|---|---|
 * | FullTextAnnotate            | 紫 accent/5 | text-lg  | swipe/select_all | px-6 py-5 | text-base | — |
 * | VocabDefinitionMatchMCQ     | 琥珀        | text-base| lightbulb        | px-5 py-4 | text-sm   | mb-5 |
 * | VocabDefinitionMatchDragDrop| 琥珀        | text-base| lightbulb        | px-5 py-4 | text-sm   | mb-5 |
 * | FillInBlankExercise         | 琥珀        | text-base| lightbulb        | px-5 py-4 | text-sm   | mb-5 |
 * | VocabWordSearch             | 琥珀        | text-base| lightbulb        | px-5 py-4 | text-sm   | mb-5 |
 * | StoryStructureTable         | 琥珀        | text-base| account_tree     | px-5 py-4 | text-sm   | mb-4 |
 *
 * 沒有人決定過這些差異，它們是六次各自抄改的結果。學生走過 11 個步驟時，
 * 同一種「先讀這張卡，再開始」的提示會換底色、換字級、換 icon ——
 * 那會讓他每一步都要重新認一次「這張卡是幹嘛的」。
 *
 * 統一成琥珀（6 份裡 5 份用它，而且琥珀在這個介面裡本來就是「提示」的顏色，
 * 紫色是主要動作的顏色 —— 教學卡不是主要動作）。
 *
 * icon 保留成 prop：它描述的是「這一關要做的動作」（拖曳／滑選／填表），
 * 那是內容不是樣式，`lightbulb` 只是預設值。
 */
import React from 'react';

interface StepCoachCardProps {
  /** 例：「語詞應用怎麼玩？」 */
  title: string;
  /** 說明文字（可帶粗體片段、分行等）。 */
  children: React.ReactNode;
  /** 「示範」——開啟該關自己的示範動畫。 */
  onDemo: () => void;
  /** 「我知道了」——收起這張卡。 */
  onDismiss: () => void;
  /** Material Symbols 名稱，描述這一關的操作。預設 `lightbulb`。 */
  icon?: string;
  /** 卡片下方留白。預設 `mb-5`；雙欄版面較擠時可傳 `mb-4`。 */
  className?: string;
}

export const StepCoachCard: React.FC<StepCoachCardProps> = ({
  title,
  children,
  onDemo,
  onDismiss,
  icon = 'lightbulb',
  className = 'mb-5',
}) => (
  <div
    data-testid="step-coach-card"
    className={[
      className,
      'rounded-2xl border-2 border-amber-400/60 bg-amber-50 px-5 py-4 flex flex-col gap-3',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined text-amber-500 text-2xl flex-shrink-0 mt-0.5">
        {icon}
      </span>
      <div className="flex-1">
        <p className="font-bold text-on-surface text-base mb-1">{title}</p>
        <div className="text-sm text-on-surface-variant leading-relaxed">{children}</div>
      </div>
    </div>
    <div className="flex items-center gap-2 self-end">
      <button
        type="button"
        onClick={onDemo}
        className="px-4 py-2 rounded-full text-sm font-bold border-2 border-accent text-accent hover:bg-accent/10 active:scale-[0.98] transition-all"
      >
        示範
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="px-5 py-2 rounded-full text-sm font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
      >
        我知道了
      </button>
    </div>
  </div>
);

/**
 * 收起教學卡之後留下的那顆「怎麼玩？」小按鈕。
 *
 * 同樣有 5 份手寫版本，而 `StoryStructureTable` 那份用的是 `text-gray-500`，
 * 其餘四份用 `text-on-surface-variant/60` —— 同一顆按鈕在不同步驟深淺不同。
 */
export const StepCoachHelpButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid="step-coach-help"
    className="text-xs text-on-surface-variant/60 hover:text-on-surface-variant transition-colors flex items-center gap-1 shrink-0"
  >
    <span className="material-symbols-outlined text-sm">help_outline</span>
    怎麼玩？
  </button>
);

export default StepCoachCard;
