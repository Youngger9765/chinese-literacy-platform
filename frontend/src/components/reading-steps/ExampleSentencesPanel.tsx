/**
 * ExampleSentencesPanel — AI example sentences display panel
 * Extracted from SentencePractice.tsx (#1883)
 */
import React from 'react';
import { type ExampleSentence, type ExampleSentenceSource } from '../../services/learningApi';

interface HighlightedSentenceProps {
  sentence: string;
  target: string;
}

function HighlightedSentence({ sentence, target }: HighlightedSentenceProps) {
  const parts = sentence.split(target);
  return (
    <span>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {part}
          {i < parts.length - 1 && <span className="text-accent font-bold">{target}</span>}
        </React.Fragment>
      ))}
    </span>
  );
}

interface ExampleSentencesPanelProps {
  exampleSentences: ExampleSentence[] | null;
  examplesLoading: boolean;
  examplesError: string;
  examplesSource: ExampleSentenceSource | null;
  currentWord: string;
  onRetry: () => void;
}

const ExampleSentencesPanel: React.FC<ExampleSentencesPanelProps> = ({
  exampleSentences,
  examplesLoading,
  examplesError,
  examplesSource,
  currentWord,
  onRetry,
}) => {
  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-accent text-xl">auto_stories</span>
        <span className="font-headline font-bold text-on-surface text-sm uppercase tracking-wider">AI 例句示範</span>
        {!examplesLoading && examplesSource && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            examplesSource === 'pregenerated' ? 'bg-accent/10 text-accent' : 'bg-tertiary-container/20 text-tertiary'
          }`}>
            {examplesSource === 'pregenerated' ? '預先生成' : 'AI 即時'}
          </span>
        )}
      </div>

      {examplesLoading && (
        <div className="flex items-center gap-2 text-sm text-on-surface-variant py-4">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          AI 正在生成例句...
        </div>
      )}

      {examplesError && (
        <div className="text-sm text-tertiary py-2">
          {examplesError}
          <button onClick={onRetry} className="ml-2 text-accent underline font-bold">重試</button>
        </div>
      )}

      {exampleSentences && (
        <div className="space-y-3">
          {exampleSentences.map((ex, i) => (
            <div key={i} className="bg-surface-container-low rounded-2xl p-4">
              <p className="text-base text-on-surface leading-relaxed">
                <HighlightedSentence sentence={ex.sentence} target={currentWord} />
              </p>
              <p className="text-xs text-on-surface-variant mt-1.5">{ex.explanation}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExampleSentencesPanel;
