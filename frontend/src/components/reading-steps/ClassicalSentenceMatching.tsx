/**
 * ClassicalSentenceMatching — 文白句子比對 (#2752, worksheet 大題一)
 *
 * The worksheet reprints the classical passage with 8 bracketed segments, and
 * a separate numbered list of vernacular reference sentences; the student
 * writes the matching reference number into each bracket. Same self-check
 * reveal pattern as ClassicalWordMatching — see that file's comment for why.
 */
import React, { useState } from 'react';
import type { Story } from '../../types';
import NextStepFooter from '../learning/NextStepFooter';
import { normalizeSentenceMatching } from './classicalShapes';

export interface ClassicalSentenceMatchingProps {
  story: Story;
  onFinish: () => void;
}

const ClassicalSentenceMatching: React.FC<ClassicalSentenceMatchingProps> = ({ story, onFinish }) => {
  const content = normalizeSentenceMatching(story.sentenceMatching);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">compare_arrows</span>
          <p className="text-on-surface-variant">本課尚無文白句子比對資料</p>
          <NextStepFooter onNext={onFinish} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-3xl mx-auto px-6 md:px-16 py-8 space-y-6 w-full">
          <div className="text-center">
            <h2 className="text-xl font-headline font-bold text-on-surface mb-1">文白句子比對</h2>
            {content.instruction && (
              <p className="text-sm text-on-surface-variant whitespace-pre-line">{content.instruction}</p>
            )}
          </div>

          {content.parts.map((part, pi) => (
            <section key={pi} className="space-y-4" aria-label={part.label ?? `第 ${pi + 1} 題`}>
              {content.parts.length > 1 && (
                <h3 className="text-base font-headline font-bold text-on-surface">{part.label ?? `第 ${pi + 1} 題`}</h3>
              )}

              {Object.keys(part.referenceSentences).length > 0 && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-5">
                  <h4 className="text-sm font-headline font-bold text-on-surface-variant mb-2">
                    {part.referenceLabel || '參考句：'}
                  </h4>
                  <ol className="space-y-1 text-sm text-on-surface-variant">
                    {Object.entries(part.referenceSentences).map(([n, text]) => (
                      <li key={n}>
                        <span className="font-bold">［{n}］</span>
                        {text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {part.example && (
                <div className="bg-accent/5 rounded-3xl p-5 space-y-1">
                  <p className="text-xs font-bold text-accent">例句</p>
                  <p className="text-lg leading-relaxed text-on-surface font-serif">{part.example.classical}</p>
                  <p className="text-sm text-accent">
                    對應參考句：［{part.example.answer}］{part.referenceSentences[String(part.example.answer)] ?? ''}
                  </p>
                </div>
              )}

              <div className="space-y-4">
                {part.segments.map((seg) => {
                  const key = `${pi}-${seg.index}`;
                  return (
                    <div key={key} className="bg-surface-container-lowest rounded-3xl shadow-editorial p-5 space-y-3">
                      <p className="text-lg leading-relaxed text-on-surface font-serif">
                        {seg.index}. {seg.classical}
                      </p>
                      {revealed[key] ? (
                        <p className="text-sm text-accent">
                          對應參考句：［{seg.answer}］{part.referenceSentences[String(seg.answer)] ?? ''}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRevealed((r) => ({ ...r, [key]: true }))}
                          className="text-sm text-accent hover:brightness-110 transition-colors"
                        >
                          顯示答案
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-6 pb-8 pt-4 bg-surface">
        <div className="max-w-md mx-auto">
          <NextStepFooter onNext={onFinish} />
        </div>
      </div>
    </div>
  );
};

export default ClassicalSentenceMatching;
