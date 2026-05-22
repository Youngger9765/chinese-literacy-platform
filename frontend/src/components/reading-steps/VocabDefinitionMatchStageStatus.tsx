/**
 * StageStatus — Two-step progress indicator for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Stateless UI component.
 */
import React from 'react';
import { Lock } from 'lucide-react';
import { InteractionMode } from './vocabDefinitionMatchLogic';

export interface StageStatusProps {
  current: InteractionMode;
  mcDone: boolean;
  dragDropDone: boolean;
}

export function StageStatus({ current, mcDone, dragDropDone }: StageStatusProps) {
  const step1Active = current === 'multiple-choice';
  const step2Active = current === 'drag-drop';
  const step2Locked = !mcDone;

  return (
    <div className="flex items-center justify-center gap-0 mb-6 max-w-sm mx-auto select-none">
      {/* Step 1 */}
      <div className="flex flex-col items-center gap-1">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
            mcDone
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : step1Active
                ? 'bg-accent border-accent text-white'
                : 'bg-white border-gray-300 text-gray-400'
          }`}
        >
          {mcDone ? '✓' : '1'}
        </div>
        <span
          className={`text-xs font-semibold whitespace-nowrap ${
            step1Active ? 'text-accent' : mcDone ? 'text-emerald-600' : 'text-gray-400'
          }`}
        >
          選擇題
        </span>
      </div>

      {/* Connector line */}
      <div
        className={`h-0.5 w-12 mb-4 transition-colors ${
          mcDone ? 'bg-emerald-400' : 'bg-gray-200'
        }`}
      />

      {/* Step 2 */}
      <div className="flex flex-col items-center gap-1">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
            dragDropDone
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : step2Active
                ? 'bg-accent border-accent text-white'
                : 'bg-gray-100 border-gray-200 text-gray-300'
          }`}
        >
          {dragDropDone ? '✓' : step2Locked ? <Lock size={14} /> : '2'}
        </div>
        <span
          className={`text-xs font-semibold whitespace-nowrap ${
            step2Active ? 'text-accent' : dragDropDone ? 'text-emerald-600' : 'text-gray-300'
          }`}
        >
          拖拉配對
        </span>
      </div>
    </div>
  );
}
