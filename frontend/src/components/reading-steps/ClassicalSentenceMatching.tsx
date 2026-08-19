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

export interface ClassicalSentenceMatchingProps {
  story: Story;
  onFinish: () => void;
}

const ClassicalSentenceMatching: React.FC<ClassicalSentenceMatchingProps> = ({ story, onFinish }) => {
  const content = story.sentenceMatching;
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  if (!content || content.segments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">compare_arrows</span>
          <p className="text-on-surface-variant">本課尚無文白句子比對資料</p>
          <button onClick={onFinish} className="btn-immersive">
            繼續下一步 <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
          </button>
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
            {content.instruction && <p className="text-sm text-on-surface-variant">{content.instruction}</p>}
          </div>

          {content.reference_sentences && Object.keys(content.reference_sentences).length > 0 && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-5">
              <h3 className="text-sm font-headline font-bold text-on-surface-variant mb-2">
                {content.reference_label || '參考句：'}
              </h3>
              <ol className="space-y-1 text-sm text-on-surface-variant list-decimal list-inside">
                {Object.entries(content.reference_sentences).map(([num, text]) => (
                  <li key={num}>{text}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="space-y-4">
            {content.segments.map((seg) => (
              <div key={seg.index} className="bg-surface-container-lowest rounded-3xl shadow-editorial p-5 space-y-3">
                <p className="text-lg leading-relaxed text-on-surface font-serif">
                  {seg.index}. {seg.classical}
                </p>
                {revealed[seg.index] ? (
                  <p className="text-sm text-accent">
                    對應參考句：{content.reference_sentences?.[String(seg.answer)] ?? `第 ${seg.answer} 句`}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [seg.index]: true }))}
                    className="text-sm text-accent hover:brightness-110 transition-colors"
                  >
                    顯示答案
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-8 pt-4 bg-surface">
        <div className="max-w-md mx-auto">
          <button onClick={onFinish} className="btn-immersive w-full">
            繼續下一步 <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClassicalSentenceMatching;
