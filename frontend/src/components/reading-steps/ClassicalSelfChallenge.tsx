/**
 * ClassicalSelfChallenge — 自我挑戰 (#2752, worksheet 大題六)
 *
 * The worksheet's own note marks this optional ("老師可視同學情況決定是否做此
 * 大題") — a separate short classical passage with its own question set
 * (part_one: guided short-answer, part_two: multiple-choice comprehension).
 * It gets its OWN step rather than folding into `comprehension` because it is
 * a second, independent passage — cramming a second reading + question set
 * into the main 閱讀理解 step would bury one behind the other, not fold them.
 */
import React, { useState } from 'react';
import type { Story, ClassicalSelfChallengeQuestionItem } from '../../types';
import NextStepFooter from '../learning/NextStepFooter';

export interface ClassicalSelfChallengeProps {
  story: Story;
  onFinish: () => void;
}

const QuestionItem: React.FC<{ item: ClassicalSelfChallengeQuestionItem }> = ({ item }) => {
  const [revealed, setRevealed] = useState(false);
  const answerLabel =
    item.options && typeof item.answer !== 'undefined'
      ? `${item.answer}. ${item.options[String(item.answer)] ?? ''}`
      : String(item.answer);

  return (
    <div className="space-y-2">
      <p className="text-base text-on-surface">
        {item.index}. {item.stem}
        {item.instruction && <span className="text-on-surface-variant text-sm"> {item.instruction}</span>}
      </p>
      {item.options && (
        <ul className="pl-4 space-y-1 text-sm text-on-surface-variant">
          {Object.entries(item.options).map(([key, text]) => (
            <li key={key}>
              {key}. {text}
            </li>
          ))}
        </ul>
      )}
      {revealed ? (
        <p className="text-sm text-accent">答案：{answerLabel}</p>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="text-sm text-accent hover:brightness-110 transition-colors"
        >
          顯示答案
        </button>
      )}
    </div>
  );
};

const ClassicalSelfChallenge: React.FC<ClassicalSelfChallengeProps> = ({ story, onFinish }) => {
  const content = story.selfChallenge;
  const [showTranslation, setShowTranslation] = useState(false);

  if (!content || !content.passage) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">military_tech</span>
          <p className="text-on-surface-variant">本課尚無自我挑戰資料</p>
          <NextStepFooter onNext={onFinish} label="繼續下一步" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-3xl mx-auto px-6 md:px-16 py-8 space-y-6 w-full">
          <div className="text-center">
            <h2 className="text-xl font-headline font-bold text-on-surface mb-1">自我挑戰</h2>
            {content.optional_note && (
              <p className="text-xs text-on-surface-variant/70">{content.optional_note}</p>
            )}
            {content.instruction && <p className="text-sm text-on-surface-variant mt-1">{content.instruction}</p>}
            {content.strategy_banner && (
              <p className="text-sm text-accent mt-2">{content.strategy_banner}</p>
            )}
          </div>

          <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 space-y-4">
            <p className="text-lg leading-loose text-on-surface font-serif">{content.passage}</p>
            {content.annotations && content.annotations.length > 0 && (
              <dl className="pt-3 border-t border-on-surface/10 space-y-1">
                {content.annotations.map((a, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <dt className="font-bold text-on-surface shrink-0">{a.term}</dt>
                    <dd className="text-on-surface-variant">{a.text}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {content.translation && (
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
                {showTranslation ? '隱藏白話翻譯' : '顯示白話翻譯'}
              </button>
              {showTranslation && (
                <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
                  <p className="text-base leading-loose text-on-surface-variant">{content.translation}</p>
                </div>
              )}
            </div>
          )}

          {content.part_one && content.part_one.items.length > 0 && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 space-y-4">
              {content.part_one.label && (
                <h3 className="text-sm font-headline font-bold text-on-surface-variant">{content.part_one.label}</h3>
              )}
              {content.part_one.items.map((item) => (
                <QuestionItem key={item.index} item={item} />
              ))}
            </div>
          )}

          {content.part_two && content.part_two.items.length > 0 && (
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6 space-y-4">
              {content.part_two.label && (
                <h3 className="text-sm font-headline font-bold text-on-surface-variant">{content.part_two.label}</h3>
              )}
              {content.part_two.items.map((item) => (
                <QuestionItem key={item.index} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-6 pb-8 pt-4 bg-surface">
        <div className="max-w-md mx-auto">
          <NextStepFooter onNext={onFinish} label="繼續下一步" />
        </div>
      </div>
    </div>
  );
};

export default ClassicalSelfChallenge;
