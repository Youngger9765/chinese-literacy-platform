import { ZhuyinMode, THRESHOLD_MIN, THRESHOLD_MAX } from '../../context/ZhuyinContext';
import DifficultRuleExplainer from '../zhuyin/DifficultRuleExplainer';

interface ZhuyinToggleProps {
  mode: ZhuyinMode;
  ready: boolean;
  onModeChange: (mode: ZhuyinMode) => void;
  /**
   * 難字門檻：錯幾次算「還不會」（#3240）。只在「難字」模式下顯示。
   *
   * ⛔ 兩個都是 optional —— `AppShell` 與 `Sidebar` 都 render 這個元件，
   *    漏傳一邊只會少一個控制項，不會讓注音開關整個壞掉。
   */
  difficultThreshold?: number;
  onThresholdChange?: (n: number) => void;
  /** @deprecated use mode + onModeChange */
  enabled?: boolean;
  /** @deprecated use onModeChange */
  onToggle?: () => void;
}

const SEGMENTS: Array<{ mode: ZhuyinMode; label: string; title: string }> = [
  { mode: 'none',      label: '無',   title: '關閉注音' },
  // ⚠️ #3224 之後這裡不再是詞彙表 —— 難字＝**這個孩子唸錯過的字**。
  //    原本的 title 寫「（詞彙表）」，那句話在 #3224 之後就不對了。
  { mode: 'difficult', label: '難字', title: '只標你唸錯過的字' },
  { mode: 'all',       label: '全',   title: '顯示全文注音' },
];

export default function ZhuyinToggle({
  mode, ready, onModeChange, difficultThreshold, onThresholdChange,
}: ZhuyinToggleProps) {
  const isLoading = !ready;
  const showThreshold =
    mode === 'difficult' && difficultThreshold !== undefined && onThresholdChange !== undefined;

  return (
    <div className="inline-flex items-center gap-1.5">
    <div
      role="group"
      aria-label="注音顯示模式"
      className={`inline-flex items-center rounded-full bg-surface-container-high p-0.5 gap-0.5 transition-opacity ${
        isLoading ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      {SEGMENTS.map((seg) => {
        const isActive = mode === seg.mode;
        return (
          <button
            key={seg.mode}
            type="button"
            onClick={() => onModeChange(seg.mode)}
            aria-pressed={isActive}
            aria-label={seg.title}
            title={seg.title}
            className={`h-8 sm:h-9 px-2 sm:px-3 rounded-full font-headline font-bold text-xs sm:text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 active:scale-95 whitespace-nowrap ${
              isActive
                ? 'bg-accent text-white shadow-[0_2px_10px_rgba(86,74,191,0.35)]'
                : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
            }`}
          >
            {seg.label}
          </button>
        );
      })}
    </div>

    {/*
      #3240：門檻只在「難字」模式下出現 —— 其他兩個模式下它沒有意義，
      常駐只是讓開關變寬（這個開關在手機側欄裡，寬度是稀缺的）。
    */}
    {showThreshold && (
      <div
        role="group"
        aria-label="難字門檻"
        className="inline-flex items-center gap-0.5 rounded-full bg-surface-container-high p-0.5"
      >
        <button
          type="button"
          onClick={() => onThresholdChange(difficultThreshold - 1)}
          disabled={difficultThreshold <= THRESHOLD_MIN}
          aria-label="降低難字門檻（標更多字）"
          title={`錯 ${difficultThreshold} 次以上才標 —— 按這裡標更多字`}
          className="h-8 sm:h-9 w-7 rounded-full font-headline font-bold text-sm text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-95"
        >
          −
        </button>
        <span
          aria-live="polite"
          aria-label={`錯 ${difficultThreshold} 次以上才標`}
          className="min-w-[2.5rem] text-center font-headline font-bold text-xs sm:text-sm text-on-surface-variant tabular-nums"
        >
          {difficultThreshold}&thinsp;次
        </span>
        <button
          type="button"
          onClick={() => onThresholdChange(difficultThreshold + 1)}
          disabled={difficultThreshold >= THRESHOLD_MAX}
          aria-label="提高難字門檻（標更少字）"
          title={`錯 ${difficultThreshold} 次以上才標 —— 按這裡標更少字`}
          className="h-8 sm:h-9 w-7 rounded-full font-headline font-bold text-sm text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-95"
        >
          ＋
        </button>
      </div>
    )}

    {/*
      #3257：規則說明。⛔ 它的顯示條件只看 `mode`，**不跟門檻控制項綁在一起** ——
      門檻那組要求 host 有傳 `difficultThreshold`/`onThresholdChange`（兩個都是
      optional，因為 `AppShell` 與 `Sidebar` 各 render 一次、漏傳一邊只會少一個
      控制項）。說明不該被那個 host 細節連坐：在難字模式下「這些字為什麼被標」
      永遠是有意義的問題。

      它自己讀 context 而不是收 props —— 要透傳的話 `AppShell` 跟 `Sidebar` 兩邊
      都得各加一次，而「只改了其中一個 host」正是這個檔案已經有的那個風險。
    */}
    {mode === 'difficult' && <DifficultRuleExplainer />}
    </div>
  );
}
