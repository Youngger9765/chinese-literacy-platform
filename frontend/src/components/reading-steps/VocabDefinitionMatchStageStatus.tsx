/**
 * StageStatus — Two-step progress indicator for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Both steps are freely selectable —
 * drag-drop is no longer locked behind multiple-choice completion.
 */
import React from 'react';
import { InteractionMode } from './vocabDefinitionMatchLogic';

export interface StageStatusProps {
  current: InteractionMode;
  mcDone: boolean;
  dragDropDone: boolean;
  onSelectMode: (mode: InteractionMode) => void;
}

function StepButton({
  label,
  stepNumber,
  done,
  active,
  onClick,
}: {
  label: string;
  stepNumber: number;
  done: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl px-2 py-1 transition-colors hover:bg-surface-container-low focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      aria-current={active ? 'step' : undefined}
      aria-label={`${label}${done ? '（已完成）' : ''}`}
    >
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
          done
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : active
              ? 'bg-accent border-accent text-white'
              : 'bg-white border-gray-300 text-gray-500'
        }`}
      >
        {done ? '✓' : stepNumber}
      </div>
      <span
        className={`text-xs font-semibold whitespace-nowrap ${
          active ? 'text-accent' : done ? 'text-emerald-600' : 'text-gray-500'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export function StageStatus({ current, mcDone, dragDropDone, onSelectMode }: StageStatusProps) {
  const step1Active = current === 'multiple-choice';
  const step2Active = current === 'drag-drop';
  const anyDone = mcDone || dragDropDone;

  return (
    <div className="flex items-center justify-center gap-0 mb-6 max-w-sm mx-auto">
      <StepButton
        label="選擇題"
        stepNumber={1}
        done={mcDone}
        active={step1Active}
        onClick={() => onSelectMode('multiple-choice')}
      />

      <div
        className={`h-0.5 w-12 mb-4 transition-colors ${
          anyDone ? 'bg-emerald-400' : 'bg-gray-200'
        }`}
        aria-hidden
      />

      <StepButton
        label="拖拉配對"
        stepNumber={2}
        done={dragDropDone}
        active={step2Active}
        onClick={() => onSelectMode('drag-drop')}
      />
    </div>
  );
}
