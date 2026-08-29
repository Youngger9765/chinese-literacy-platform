/**
 * ClassicalText — 原文＋白話對照 (#2752)
 *
 * Step: classical-text. Displays the classical-Chinese source text a 文言文
 * lesson is built from (`classical_text.paragraphs` + its pre-printed 注釋
 * glossary), with the vernacular translation (`modern_translation.paragraphs`)
 * shown alongside as a companion — the worksheet has no separate step for
 * 古文今譯, it is meant to be read next to the original.
 *
 * This is deliberately NOT the annotate-by-student interaction that
 * `full-text-annotate` (讀全文-做記號) uses elsewhere: the 注釋 for a 文言文
 * lesson are already printed on the worksheet, not something the student
 * selects and marks themselves — reusing that component's UI would imply an
 * interaction this genre's worksheet never has.
 */
import React, { useState } from 'react';
import type { Story } from '../../types';
import NextStepFooter from '../learning/NextStepFooter';

export interface ClassicalTextProps {
  story: Story;
  onFinish: () => void;
}

const ClassicalText: React.FC<ClassicalTextProps> = ({ story, onFinish }) => {
  const [showTranslation, setShowTranslation] = useState(false);
  const classical = story.classicalText;
  const translation = story.modernTranslation;

  if (!classical || classical.paragraphs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">menu_book</span>
          <p className="text-on-surface-variant">本課尚無原文資料</p>
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
            <h2 className="text-xl font-headline font-bold text-on-surface mb-1">原文</h2>
            {classical.source_label && (
              <p className="text-sm text-on-surface-variant">{classical.source_label}</p>
            )}
          </div>

          <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 space-y-4">
            {classical.paragraphs.map((p, i) => (
              <p key={i} className="text-lg leading-loose text-on-surface font-serif">
                {p}
              </p>
            ))}
          </div>

          {translation && translation.paragraphs.length > 0 && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowTranslation((v) => !v)}
                className="inline-flex items-center gap-2 text-sm text-accent hover:brightness-110 transition-colors"
                aria-expanded={showTranslation}
              >
                <span className="material-symbols-outlined text-lg">
                  {showTranslation ? 'visibility_off' : 'translate'}
                </span>
                {showTranslation ? '隱藏白話對照' : `顯示${translation.section_name || '古文今譯'}`}
              </button>
              {showTranslation && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 space-y-4">
                  {translation.paragraphs.map((p, i) => (
                    <p key={i} className="text-base leading-loose text-on-surface-variant">
                      {p}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {classical.annotations && classical.annotations.length > 0 && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
              <h3 className="text-sm font-headline font-bold text-on-surface-variant mb-3">
                {classical.annotations_label || '注釋'}
              </h3>
              <dl className="space-y-2">
                {classical.annotations.map((a, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <dt className="font-bold text-on-surface shrink-0">{a.term}</dt>
                    <dd className="text-on-surface-variant">{a.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
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

export default ClassicalText;
