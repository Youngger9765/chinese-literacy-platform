import { ZhuyinMode } from '../../context/ZhuyinContext';

interface ZhuyinToggleProps {
  mode: ZhuyinMode;
  ready: boolean;
  onModeChange: (mode: ZhuyinMode) => void;
  /** @deprecated use mode + onModeChange */
  enabled?: boolean;
  /** @deprecated use onModeChange */
  onToggle?: () => void;
}

const SEGMENTS: Array<{ mode: ZhuyinMode; label: string; title: string }> = [
  { mode: 'none',      label: '無',   title: '關閉注音' },
  { mode: 'difficult', label: '難字', title: '僅標示難字注音（詞彙表）' },
  { mode: 'all',       label: '全',   title: '顯示全文注音' },
];

export default function ZhuyinToggle({ mode, ready, onModeChange }: ZhuyinToggleProps) {
  const isLoading = !ready;

  return (
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
  );
}
