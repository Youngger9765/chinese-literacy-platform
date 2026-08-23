/**
 * ClassicalWordMatching — 文白詞語比對 (#2752, worksheet 大題二)
 *
 * Each item pairs a classical-Chinese clause with boxed terms and a
 * vernacular sentence carrying blanks for those terms' meanings. This is a
 * self-check reveal (not scored): the student reads the classical clause,
 * thinks through the vernacular meaning, then reveals the printed answer —
 * matching how the worksheet itself works (橘色手寫 answers written directly
 * on the page, not graded by a separate answer key at time of printing).
 */
import React, { useState } from 'react';
import type { Story } from '../../types';
import NextStepFooter from '../learning/NextStepFooter';

export interface ClassicalWordMatchingProps {
  story: Story;
  onFinish: () => void;
}

const ClassicalWordMatching: React.FC<ClassicalWordMatchingProps> = ({ story, onFinish }) => {
  const content = story.wordMatching;
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  if (!content || content.items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">translate</span>
          <p className="text-on-surface-variant">本課尚無文白詞語比對資料</p>
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
            <h2 className="text-xl font-headline font-bold text-on-surface mb-1">文白詞語比對</h2>
            {content.instruction && <p className="text-sm text-on-surface-variant">{content.instruction}</p>}
          </div>

          <div className="space-y-4">
            {content.items.map((item) => (
              <div key={item.index} className="bg-surface-container-lowest rounded-3xl shadow-editorial p-5 space-y-3">
                <p className="text-lg leading-relaxed text-on-surface font-serif">
                  {item.index}. {item.classical}
                </p>
                <p className="text-base leading-relaxed text-on-surface-variant">{item.vernacular}</p>
                {revealed[item.index] ? (
                  <p className="text-sm text-accent">
                    答案：{item.blanks.map((b) => b.answer).join('、')}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [item.index]: true }))}
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
          <NextStepFooter onNext={onFinish} />
        </div>
      </div>
    </div>
  );
};

export default ClassicalWordMatching;
