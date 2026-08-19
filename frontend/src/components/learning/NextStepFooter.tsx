/**
 * NextStepFooter — 每一步底部那顆「下一關」。**唯一一個。**
 *
 * 為什麼要有這個元件（Young 2026-08-19）
 * --------------------------------------
 * > 下一關統一都用 footer 的格式，不要突然跑出一個按鈕來
 * > 不要有客製化的下一關按鈕
 *
 * 在此之前，七個地方各自畫了一顆：`SpotlightPage`、`KeypointsTablePage`、
 * `ComprehensionMcqPage`（三顆）、`ComprehensionChat`、`DictationPractice`、
 * `KeyPassageReadingControls`。同一份漸層、同一組 class 被抄了七次，
 * 而位置、停用條件、提示文字每個都自己決定 —— 學生在不同步驟看到的
 * 「下一關」長得不一樣、出現的地方也不一樣。
 *
 * 樣式上的分歧只是表面。真正的成本是**行為分歧**：有的 disabled 有的不會、
 * 有的附提示有的沒有，而那些差異沒有人決定過，是七次各自抄改的結果。
 */
import React from 'react';

interface Props {
  onNext: () => void;
  /** 尚未達成前進條件時停用。省略 = 一律可按。 */
  disabled?: boolean;
  /** 停用時顯示在按鈕下方的一行說明（例：完成閱讀聚光燈後才能繼續）。 */
  disabledHint?: string;
  /** 按鈕文字。預設「下一關」；跳過型的傳「跳過，下一關」。 */
  label?: string;
}

const NextStepFooter: React.FC<Props> = ({
  onNext,
  disabled = false,
  disabledHint,
  label = '下一關',
}) => (
  <div className="mt-6 shrink-0 w-full max-w-3xl mx-auto" data-testid="next-step-footer">
    <button
      type="button"
      onClick={onNext}
      disabled={disabled}
      className={[
        'w-full h-12 rounded-full font-headline font-bold text-base text-white',
        'transition-all flex items-center justify-center gap-2',
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98]',
      ].join(' ')}
      style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
    >
      <span>{label}</span>
      <span className="material-symbols-outlined text-base" aria-hidden="true">
        arrow_forward
      </span>
    </button>
    {disabled && disabledHint ? (
      <p className="text-center text-xs text-on-surface-variant mt-2">{disabledHint}</p>
    ) : null}
  </div>
);

export default NextStepFooter;
