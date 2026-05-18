/**
 * GraphicTextIntegrationExercise — G7 圖文整合 閱讀聚光燈 (#1683)
 *
 * Renders the StrategyExerciseItem[] schema used by G7 圖文整合 lessons (e.g. G7-L30).
 * Each item is a guided-exploration card with a description and ordered steps —
 * NOT interactive (no free_text / select like guided_steps); this is a reading
 * aid that walks the student through how to approach 文圖對照.
 *
 * Wire-up: parent page sets allDone when the student clicks "我已讀完，繼續下一步".
 *
 * Why this exists as its own component: the existing StrategyExercise component
 * is keyed off a `type` field (`ordering` | `trait_inference` | `guided_steps`).
 * G7 items have no `type` field — they're a pure walkthrough schema. Adding a
 * fourth branch to StrategyExercise would muddy that component's interactive
 * grading abstraction.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { StrategyExerciseItem } from '../../types';

interface Props {
  exercises: StrategyExerciseItem[];
  /** Fired once the student clicks "我已讀完，繼續下一步". */
  onComplete?: () => void;
  /** Persist read-state across page refresh. */
  onChange?: (state: Record<string, unknown>) => void;
  initialState?: Record<string, unknown>;
}

const GraphicTextIntegrationExercise: React.FC<Props> = ({
  exercises,
  onComplete,
  onChange,
  initialState,
}) => {
  const [done, setDone] = useState<boolean>(() => !!(initialState?.allDone as boolean));

  useEffect(() => {
    onChange?.({ allDone: done, exerciseType: 'graphic_text_integration' });
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = useCallback(() => {
    setDone(true);
    onComplete?.();
  }, [onComplete]);

  return (
    <div>
      <div className="mb-5">
        <div className="inline-block px-3 py-1 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold mb-3">
          閱讀策略：圖文整合
        </div>
        <p className="text-sm text-gray-600 leading-relaxed bg-violet-50 rounded-xl px-4 py-3 border border-violet-100">
          圖文整合題就是「文字」與「圖表」一起出現的題目。下方有幾個練習，每個練習都會帶你
          一步一步看懂文字與圖表的對應關係。
        </p>
      </div>

      <div className="space-y-4">
        {exercises.map((item, idx) => (
          <div
            key={`${idx}-${item.exercise}`}
            className="rounded-xl border border-gray-200 bg-surface-container-low p-4"
          >
            <div className="flex items-baseline gap-2 mb-2">
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                {item.exercise}
              </span>
              <span className="text-sm font-semibold text-on-surface">
                {item.description}
              </span>
            </div>

            {item.steps && item.steps.length > 0 ? (
              <ol className="space-y-1.5 mt-3 ml-1">
                {item.steps.map((step, stepIdx) => (
                  <li key={stepIdx} className="flex items-start gap-2 text-sm text-on-surface-variant">
                    <span className="flex-shrink-0 font-semibold text-violet-600 min-w-[3rem]">
                      {step.step}
                    </span>
                    <span className="leading-relaxed">{step.description}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-xs text-on-surface-variant/60">
                請對照課文與圖表，自己思考兩者的關係。
              </p>
            )}
          </div>
        ))}
      </div>

      {!done ? (
        <button
          onClick={handleConfirm}
          className="mt-5 w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
        >
          我已讀完，繼續下一步
        </button>
      ) : (
        <div className="mt-5 rounded-xl p-4 bg-emerald-50 border border-emerald-200 text-center">
          <p className="text-emerald-700 font-semibold text-sm">
            完成！可以前往下一關。
          </p>
        </div>
      )}
    </div>
  );
};

export default GraphicTextIntegrationExercise;
