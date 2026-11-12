import React from 'react';
import type { EscapeRoomAbilityKey } from '../../services/escapeRoomApi';

interface AbilityBarProps {
  used: EscapeRoomAbilityKey[];
  disabled: boolean;
  onUse: (key: EscapeRoomAbilityKey) => void;
}

const ABILITIES: Array<{ key: EscapeRoomAbilityKey; title: string; description: string }> = [
  { key: 'hint', title: '提示卡', description: '排除一個選項' },
  { key: 'extra_time', title: '延時卡', description: '本題多五秒' },
  { key: 'shield', title: '護字符', description: '擋住一次迷霧' },
];

const AbilityBar: React.FC<AbilityBarProps> = ({ used, disabled, onUse }) => (
  <nav
    aria-label="能力卡"
    className="fixed inset-x-0 bottom-0 z-10 border-t border-accent-bg-subtle bg-surface/95 p-2 backdrop-blur sm:static sm:rounded-2xl sm:border"
  >
    <div className="mx-auto flex max-w-xl gap-2">
      {ABILITIES.map((ability) => {
        const actuallyUsed = used.includes(ability.key);
        const unavailable = disabled || actuallyUsed;
        return (
          <button
            key={ability.key}
            type="button"
            disabled={unavailable}
            onClick={() => onUse(ability.key)}
            className="min-h-12 flex-1 rounded-xl border border-accent px-2 py-2 text-center text-xs font-semibold text-accent transition disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400 sm:text-sm"
            aria-label={`${ability.title}，${actuallyUsed ? '已使用' : ability.description}`}
          >
            <span className="block">{ability.title}</span>
            <span className="hidden font-normal sm:block">{actuallyUsed ? '已使用' : ability.description}</span>
          </button>
        );
      })}
    </div>
  </nav>
);

export default AbilityBar;
