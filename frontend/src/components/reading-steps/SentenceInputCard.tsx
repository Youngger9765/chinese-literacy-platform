/**
 * SentenceInputCard — one sentence slot (input + voice + validate button + feedback)
 * Extracted from SentencePractice.tsx (#1883)
 */
import React, { useRef } from 'react';
import VoiceInputButton from '../ui/VoiceInputButton';
import { type SentenceEntry } from './useSentencePracticeState';

interface SentenceInputCardProps {
  idx: 0 | 1;
  entry: SentenceEntry;
  currentWord: string;
  currentWordZhuyin: string;
  isCurrentDone: boolean;
  liveTranscript: string;
  isComposingRef: React.MutableRefObject<boolean>;
  voiceStopRef: React.MutableRefObject<(() => void) | null>;
  onTextChange: (idx: 0 | 1, text: string) => void;
  onValidate: (idx: 0 | 1) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, idx: 0 | 1) => void;
  onLiveTranscript: (idx: 0 | 1, text: string) => void;
  onPasteWarning: () => void;
}

const SentenceInputCard: React.FC<SentenceInputCardProps> = ({
  idx,
  entry,
  currentWord,
  currentWordZhuyin,
  isCurrentDone,
  liveTranscript,
  isComposingRef,
  voiceStopRef,
  onTextChange,
  onValidate,
  onKeyDown,
  onLiveTranscript,
  onPasteWarning,
}) => {
  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-headline font-black ${
          entry.status === 'correct' ? 'bg-emerald-500 text-white'
          : entry.status === 'incorrect' ? 'bg-amber-400 text-amber-900'
          : 'bg-surface-container-high text-on-surface-variant'
        }`}>
          {entry.status === 'correct' ? <span className="material-symbols-outlined text-sm">check</span>
          : entry.status === 'incorrect' ? <span className="material-symbols-outlined text-sm">close</span>
          : idx + 1}
        </span>
        <span className="text-sm font-headline font-bold text-on-surface-variant">第 {idx + 1} 句</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <input
          type="text"
          value={entry.text}
          onChange={e => onTextChange(idx, e.target.value)}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          onKeyDown={e => onKeyDown(e, idx)}
          onPaste={e => { e.preventDefault(); onPasteWarning(); }}
          onDrop={e => { e.preventDefault(); onPasteWarning(); }}
          onDragOver={e => e.preventDefault()}
          disabled={entry.status === 'loading' || isCurrentDone}
          placeholder={`用「${currentWordZhuyin}」造一個句子…`}
          className={`flex-1 min-w-0 rounded-2xl border-2 px-4 py-3 text-base outline-none transition-all ${
            entry.status === 'correct' ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
            : entry.status === 'incorrect' ? 'border-amber-300 bg-amber-50 text-on-surface'
            : 'border-surface-container-high bg-transparent focus:border-accent text-on-surface'
          }`}
        />
        <div className="flex gap-2 justify-end sm:shrink-0">
          <VoiceInputButton
            key={currentWord + String(idx)}
            onTranscript={(text) => {
              onTextChange(idx, text);
              onLiveTranscript(idx, '');
            }}
            onLiveTranscript={(text) => onLiveTranscript(idx, text)}
            disabled={entry.status === 'loading' || isCurrentDone}
            stopRef={voiceStopRef}
          />
          <button
            onClick={() => onValidate(idx)}
            disabled={!entry.text.trim() || entry.status === 'loading' || isCurrentDone}
            className={`px-5 py-3 rounded-2xl text-sm font-headline font-bold transition-all active:scale-[0.97] shrink-0 ${
              entry.status === 'loading' ? 'bg-surface-container-high text-on-surface-variant cursor-wait'
              : entry.status === 'correct' ? 'bg-emerald-500 text-white'
              : 'bg-accent hover:brightness-110 text-white disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {entry.status === 'loading' ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : entry.status === 'correct' ? (
              <span className="material-symbols-outlined text-lg">check</span>
            ) : '送出'}
          </button>
        </div>
      </div>

      {liveTranscript && (
        <div className="mt-2 flex items-start gap-1.5 px-2">
          <span className="material-symbols-outlined text-sm text-red-400 animate-pulse mt-0.5 shrink-0">mic</span>
          <p className="text-sm text-on-surface-variant italic leading-snug">{liveTranscript}</p>
        </div>
      )}

      {(entry.status === 'correct' || entry.status === 'incorrect') && (
        <div className={`mt-3 rounded-2xl px-4 py-4 ${
          entry.status === 'correct' ? 'bg-emerald-50' : 'bg-amber-50'
        }`}>
          <div className="flex items-start gap-2">
            <span className={`material-symbols-outlined text-xl mt-0.5 ${entry.status === 'correct' ? 'text-emerald-600' : 'text-amber-600'}`}>
              {entry.status === 'correct' ? 'check_circle' : 'lightbulb'}
            </span>
            <div>
              <p className={`text-base font-medium leading-relaxed ${entry.status === 'correct' ? 'text-emerald-800' : 'text-amber-900'}`}>
                {entry.feedback}
              </p>
              {entry.suggestion && (
                <p className="mt-1.5 text-sm text-on-surface-variant leading-relaxed">{entry.suggestion}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SentenceInputCard;
