interface ZhuyinToggleProps {
  enabled: boolean;
  ready: boolean;
  onToggle: () => void;
}

export default function ZhuyinToggle({ enabled, ready, onToggle }: ZhuyinToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={`px-2.5 py-1 rounded text-xs transition-colors ${
        enabled && ready
          ? 'bg-indigo-600/80 text-white hover:bg-indigo-500'
          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
      }`}
      title={enabled ? '隱藏注音' : '顯示注音'}
    >
      注音 {enabled ? 'ON' : 'OFF'}
    </button>
  );
}
