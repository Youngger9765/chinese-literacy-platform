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
      className={`px-2.5 py-1 rounded text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${
        isOn
          ? 'bg-accent/80 text-white hover:bg-accent-hover'
          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
      }`}
    >
      注音 {isOn ? 'ON' : 'OFF'}
    </button>
  );
}
