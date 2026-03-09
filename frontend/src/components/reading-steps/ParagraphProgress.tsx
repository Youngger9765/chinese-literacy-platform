/**
 * ParagraphProgress — visual progress bar showing paragraph states.
 * Displays each paragraph as a segment: locked / current / completed.
 * Used inside LiveTutor to give students a quick overview.
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
    <div className="px-6 py-2 bg-white border-b border-gray-100">
      <div className="flex items-center gap-3 max-w-3xl mx-auto">
        <span className="text-xs text-gray-400 shrink-0 font-medium">進度</span>

        {/* Segment bar */}
        <div className="flex flex-1 gap-1 h-2">
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
                    : 'bg-gray-200 cursor-not-allowed'
              }`}
              style={{ minWidth: 0 }}
            />
          ))}
        </div>

        {/* Counter */}
        <span className="text-xs text-gray-400 shrink-0 tabular-nums">
          {completedCount === total
            ? `全部完成`
            : `${currentIndex + 1} / ${total}`}
        </span>
      </div>

      {/* Unlock hint: shown when all paragraphs done */}
      {completedCount === total && (
        <p className="text-center text-xs text-emerald-600 font-bold mt-1 animate-bounce">
          所有段落完成！可以進行全文朗讀了
        </p>
      )}
    </div>
  );
};

export default ParagraphProgress;
