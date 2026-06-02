/**
 * WordProgressSidebar — vertical word tab list + progress bar
 * Extracted from SentencePractice.tsx (#1883)
 */
import React from 'react';

interface WordProgressSidebarProps {
  practicedWords: string[];
  completedWords: Set<string>;
  currentWordIndex: number;
  onSelectWord: (index: number) => void;
  zhWord: (w: string) => string;
}

const WordProgressSidebar: React.FC<WordProgressSidebarProps> = ({
  practicedWords,
  completedWords,
  currentWordIndex,
  onSelectWord,
  zhWord,
}) => {
  const progressPercent = practicedWords.length > 0
    ? (completedWords.size / practicedWords.length) * 100
    : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="material-symbols-outlined text-on-surface-variant text-lg">list_alt</span>
        <span className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
          詞語列表
        </span>
      </div>

      {practicedWords.map((w, i) => {
        const done = completedWords.has(w);
        const active = i === currentWordIndex;
        return (
          <button
            key={w}
            onClick={() => onSelectWord(i)}
            className={`flex items-center gap-2 px-4 py-3 rounded-2xl text-left transition-all ${
              active
                ? 'bg-accent text-white shadow-sm'
                : done
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-headline font-black ${
              active ? 'bg-white/20 text-white'
              : done ? 'bg-emerald-500 text-white'
              : 'bg-surface-container-high text-on-surface-variant'
            }`}>
              {done ? <span className="material-symbols-outlined text-sm">check</span> : i + 1}
            </span>
            <span className="font-bold text-base">{zhWord(w)}</span>
          </button>
        );
      })}

      <div className="mt-3 px-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-on-surface-variant">完成進度</span>
          <span className="text-xs font-headline font-bold text-on-surface-variant">
            {completedWords.size}/{practicedWords.length}
          </span>
        </div>
        <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default WordProgressSidebar;
