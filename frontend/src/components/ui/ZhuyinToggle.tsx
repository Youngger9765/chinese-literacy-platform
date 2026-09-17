import { ZhuyinMode, THRESHOLD_MIN, THRESHOLD_MAX } from '../../context/ZhuyinContext';

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
  /**
   * 難字這一刻是哪一條規則在標，以及收斂到幾個字（產品端 2026-09-18 的回饋）。
   *
   * 為什麼要顯示：難字有兩條規則，而**使用者不知道自己看到的是哪一條**。
   * Young 自己帶女兒 dogfood 時看到四年級課文標「之加千同大失小手成」，
   * 以為判定壞了 —— 那其實是走到最後那層退路（本課生詞拆成單字，見 #3247）。
   * 規則講出來，那種誤解就不會發生。
   */
  difficultSource?: 'errors' | 'lesson' | 'vocab' | 'none';
  difficultCount?: number;
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
  difficultSource, difficultCount,
}: ZhuyinToggleProps) {
  const isLoading = !ready;
  const showThreshold =
    mode === 'difficult' && difficultThreshold !== undefined && onThresholdChange !== undefined;

  return (
    <div className="inline-flex flex-col items-start gap-1">
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
    </div>

    {/*
      判定法要讓人看得到（產品端 2026-09-18）。

      ## 為什麼是一行字而不是 tooltip、也不在課文上

      - `title=` 在觸控裝置上根本不會出現，而這個產品的使用者一半在 iPad 上
      - 課文畫面是「讀」的地方，第二段鷹架的重點是讀順 —— 在那裡加說明會搶注意力
      - 所以掛在開關底下：**想知道規則的人正好就在看這個開關**

      ## 為什麼要報「是哪一條」而不只是「難字是你唸錯過的字」

      規則有兩條，而使用者看到的是哪一條取決於他自己有沒有朗讀紀錄。只講第一條
      的話，還沒唸過的孩子會看到一段跟畫面不符的說明 —— 那比不解釋更糟。
    */}
    {mode === 'difficult' && difficultSource && difficultSource !== 'none' && (
      <p className="text-[11px] leading-snug text-on-surface-variant max-w-[15rem]">
        {difficultSource === 'errors' && (
          <>
            標的是<b>你唸錯過的字</b>
            {typeof difficultCount === 'number' && difficultCount > 0 && `（${difficultCount} 個）`}
            —— 唸過的次數越多會越準
          </>
        )}
        {difficultSource === 'lesson' && (
          <>
            你還沒有唸錯紀錄，所以標的是<b>這一課比較少見的字</b>
            {typeof difficultCount === 'number' && difficultCount > 0 && `（${difficultCount} 個）`}
            。唸過之後會改成標你自己卡住的字
          </>
        )}
        {difficultSource === 'vocab' && (
          <>標的是<b>這一課的生詞</b>拆出來的字 —— 唸一次朗讀之後會改成標你自己唸錯的字</>
        )}
      </p>
    )}
    </div>
  );
}
