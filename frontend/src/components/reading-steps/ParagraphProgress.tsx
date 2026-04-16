/**
 * ParagraphProgress — visual progress bar showing paragraph states.
 * Displays each paragraph as a segment: locked / current / completed.
 * Designed to be embedded inside a card — no outer chrome or labels.
 */

import React from 'react';

export type ParagraphStatus = 'locked' | 'current' | 'completed';

interface ParagraphProgressProps {
  statuses: ParagraphStatus[];
  currentIndex: number;
  onSelectParagraph?: (idx: number) => void;
}

const ParagraphProgress: React.FC<ParagraphProgressProps> = ({
  statuses,
  currentIndex,
  onSelectParagraph,
}) => {
  const total = statuses.length;
  const completedCount = statuses.filter((s) => s === 'completed').length;

  return (
    <div>
      {/* Segment bar */}
      <div className="flex gap-1 h-2">
        {statuses.map((status, idx) => (
          <button
            key={idx}
            title={
              status === 'completed'
                ? `第 ${idx + 1} 段（完成）`
                : status === 'current'
                  ? `第 ${idx + 1} 段（目前）`
                  : `第 ${idx + 1} 段（未解鎖）`
            }
            disabled={status === 'locked' || !onSelectParagraph}
            onClick={() => onSelectParagraph?.(idx)}
            className={`flex-1 rounded-full transition-all duration-500 focus:outline-none ${
              status === 'completed'
                ? 'bg-emerald-500 hover:bg-emerald-400 cursor-pointer'
                : status === 'current'
                  ? 'bg-accent animate-pulse'
                  : 'bg-surface-container-high cursor-not-allowed'
            }`}
            style={{ minWidth: 0 }}
          />
        ))}
      </div>

      {/* Unlock hint: shown when all paragraphs done */}
      {completedCount === total && (
        <p className="text-center text-xs text-emerald-600 font-bold mt-2 animate-bounce">
          所有段落完成！
        </p>
      )}
    </div>
  );
};

export default ParagraphProgress;
