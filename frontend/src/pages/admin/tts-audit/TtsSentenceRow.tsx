// TtsSentenceRow.tsx — single row in the virtual list (Issue #1120)
import React, { forwardRef } from 'react';
import type { ProvenanceEntry } from './types';
import { TtsInlineAnnotation } from './TtsInlineAnnotation';
import { useTtsAudio } from './useTtsAudio';

const AUDITED_PREFIX = 'tts-audited:';

interface Props {
  entry: ProvenanceEntry;
  token: string;
  isSelected: boolean;
  onSelect: () => void;
  /** externally triggered play (Space key) */
  triggerPlay?: boolean;
}

export const TtsSentenceRow = forwardRef<HTMLDivElement, Props>(
  ({ entry, token, isSelected, onSelect, triggerPlay }, ref) => {
    const { state, toggle } = useTtsAudio();

    const [audited, setAudited] = React.useState(
      () => !!localStorage.getItem(AUDITED_PREFIX + entry.cache_key),
    );

    // Triggered by keyboard Space when this row is selected
    React.useEffect(() => {
      if (triggerPlay) toggle(entry.tts_input, token);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [triggerPlay]);

    const toggleAudited = (e: React.MouseEvent) => {
      e.stopPropagation();
      const next = !audited;
      setAudited(next);
      if (next) {
        localStorage.setItem(AUDITED_PREFIX + entry.cache_key, '1');
      } else {
        localStorage.removeItem(AUDITED_PREFIX + entry.cache_key);
      }
    };

    const handlePlay = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle(entry.tts_input, token);
    };

    const hasReplacements = entry.replacements_applied.length > 0;
    const lessonLabel = `L${String(entry.lesson_id).padStart(2, '0')}`;

    return (
      <div
        ref={ref}
        role="row"
        aria-selected={isSelected}
        onClick={onSelect}
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors border-b border-gray-100 min-h-[48px] ${
          isSelected
            ? 'bg-blue-50 border-l-2 border-l-blue-400'
            : 'hover:bg-gray-50 border-l-2 border-l-transparent'
        } ${audited ? 'opacity-60' : ''}`}
        style={{ contentVisibility: 'auto', containIntrinsicSize: '0 48px' }}
      >
        {/* Lesson label */}
        <span className="font-mono text-xs text-gray-400 w-8 shrink-0">{lessonLabel}</span>

        {/* Raw text with inline annotation */}
        <div className="flex-1 text-sm text-gray-700 min-w-0 truncate">
          <TtsInlineAnnotation
            raw={entry.raw_text.slice(0, 60) + (entry.raw_text.length > 60 ? '…' : '')}
            replacements={entry.replacements_applied}
            compact
          />
        </div>

        {/* Replacement dot */}
        <div className="w-10 shrink-0 text-center">
          {hasReplacements ? (
            <span className="inline-flex items-center gap-1 text-xs text-orange-600">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
              {entry.replacements_applied.length}
            </span>
          ) : (
            <span className="text-gray-200 text-xs">—</span>
          )}
        </div>

        {/* Duration */}
        <span className="w-10 shrink-0 text-xs text-gray-400 text-right tabular-nums">
          {(entry.audio_duration_ms / 1000).toFixed(1)}s
        </span>

        {/* Play button */}
        <button
          onClick={handlePlay}
          aria-label={state === 'playing' ? '暫停' : '播放'}
          title={state === 'playing' ? '暫停 (Space)' : '播放 (Space)'}
          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
            state === 'playing'
              ? 'bg-red-100 text-red-600 hover:bg-red-200'
              : state === 'loading'
              ? 'bg-gray-100 text-gray-400 cursor-wait'
              : state === 'error'
              ? 'bg-red-50 text-red-400'
              : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
          }`}
        >
          {state === 'loading' ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          ) : state === 'playing' ? (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Audited checkbox */}
        <button
          onClick={toggleAudited}
          aria-label={audited ? '取消已聽' : '標記已聽'}
          title={audited ? '取消已聽' : '標記已聽'}
          className={`shrink-0 w-6 h-6 flex items-center justify-center rounded border transition-colors cursor-pointer ${
            audited
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-gray-300 text-transparent hover:border-gray-400'
          }`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </button>
      </div>
    );
  },
);

TtsSentenceRow.displayName = 'TtsSentenceRow';
