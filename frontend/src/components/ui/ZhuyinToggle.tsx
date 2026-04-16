interface ZhuyinToggleProps {
  enabled: boolean;
  ready: boolean;
  onToggle: () => void;
}

export default function ZhuyinToggle({ enabled, ready, onToggle }: ZhuyinToggleProps) {
  const isOn = enabled && ready;
  const label = isOn ? '隱藏注音符號' : '顯示注音符號';

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isOn}
      aria-label={label}
      title={label}
      className={`relative inline-flex items-center gap-2 h-10 pl-3 pr-4 rounded-full font-headline font-bold text-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:scale-[0.95] ${
        isOn
          ? 'bg-accent text-white shadow-[0_4px_16px_rgba(86,74,191,0.3)]'
          : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
      }`}
    >
      {/* Toggle track */}
      <span className={`relative w-8 h-5 rounded-full transition-colors duration-300 ${
        isOn ? 'bg-white/30' : 'bg-on-surface-variant/20'
      }`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 shadow-sm ${
          isOn ? 'left-3.5 bg-white' : 'left-0.5 bg-on-surface-variant/60'
        }`} />
      </span>
      <span className="whitespace-nowrap">注音</span>
    </button>
  );
}
