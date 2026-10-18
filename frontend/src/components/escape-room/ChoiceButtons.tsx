import React from 'react';
import type { EscapeRoomOption } from '../../services/escapeRoomApi';

interface ChoiceButtonsProps {
  options: EscapeRoomOption[];
  disabled: boolean;
  onSelect: (key: string) => void;
}

const ChoiceButtons: React.FC<ChoiceButtonsProps> = ({ options, disabled, onSelect }) => (
  <div className="grid w-full gap-3 sm:grid-cols-2" role="group" aria-label="作答選項">
    {options.map((option) => (
      <button
        key={option.key}
        type="button"
        disabled={disabled}
        onClick={() => onSelect(option.key)}
        className="min-h-16 rounded-2xl border-2 border-accent-bg-subtle bg-white px-4 py-3 text-left font-medium text-on-surface transition hover:border-accent active:scale-[0.98] disabled:opacity-50"
        aria-label={`選項 ${option.key}：${option.text}`}
      >
        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-bg text-xs font-bold text-accent">
          {option.key}
        </span>
        {option.text}
      </button>
    ))}
  </div>
);

export default ChoiceButtons;
