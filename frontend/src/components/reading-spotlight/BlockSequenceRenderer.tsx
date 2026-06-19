/**
 * BlockSequenceRenderer — spotlight v2 block-sequence UI (#2205).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpotlightBlock, SpotlightV2, Story } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { validateStrategyAnswer } from '../../services/learningApi';
import type { StrategyGradeResult } from '../../services/learning/sentence';
import { FigureCard, buildImageSrc } from '../reading-steps/GraphicTextImageStrip';
import {
  blockStateKey,
  countVisibleSegments,
  figureLabelFromBlock,
  isBlockAnswered,
  isInteractiveBlock,
  isSectionHeaderPrompt,
  resolveFreeTextCorrect,
  resolveLessonCode,
  resolveSingleCorrect,
  segmentBlocks,
} from './spotlightBlockLogic';

interface Props {
  spotlight: SpotlightV2;
  story?: Story | null;
  lessonId?: string;
  onComplete?: () => void;
  onChange?: (state: Record<string, unknown>) => void;
  initialState?: Record<string, unknown>;
  onOpenKeypoints?: () => void;
}

const FALLBACK_GRADE: StrategyGradeResult = {
  is_correct: true,
  feedback: '已記錄你的答案，做得好！',
  suggestion: '',
};

const BlockSequenceRenderer: React.FC<Props> = ({
  spotlight,
  story,
  lessonId,
  onComplete,
  onChange,
  initialState,
  onOpenKeypoints,
}) => {
  const { token } = useAuth();
  const storyTitle = story?.title;
  const passage = story?.content?.join('\n');
  const segments = useMemo(() => segmentBlocks(spotlight.blocks), [spotlight.blocks]);

  const [blockState, setBlockState] = useState<Record<string, unknown>>(
    () => (initialState?.blockState as Record<string, unknown>) ?? {},
  );
  const [feedback, setFeedback] = useState<Record<string, boolean | null>>(
    () => (initialState?.feedback as Record<string, boolean | null>) ?? {},
  );
  const [textGrades, setTextGrades] = useState<Record<string, StrategyGradeResult>>(
    () => (initialState?.textGrades as Record<string, StrategyGradeResult>) ?? {},
  );
  const [gradingKey, setGradingKey] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(() => !!(initialState?.allDone as boolean));

  const visibleSegmentCount = countVisibleSegments(segments, blockState);

  useEffect(() => {
    onChange?.({ blockState, feedback, textGrades, allDone, renderer: 'spotlight_v2' });
  }, [blockState, feedback, textGrades, allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const setBlockValue = useCallback((key: string, value: unknown) => {
    setBlockState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const checkCompletion = useCallback(
    (nextState: Record<string, unknown>) => {
      const allComplete = segments.every((seg, segIdx) => {
        const interactive = seg
          .map((b, i) => ({ b, i }))
          .filter(({ b }) => isInteractiveBlock(b.type));
        return interactive.every(({ b, i }) =>
          isBlockAnswered(b, nextState, blockStateKey(segIdx, i)),
        );
      });
      if (allComplete) {
        setAllDone(true);
        onComplete?.();
      }
    },
    [segments, onComplete],
  );

  const handleSingleSubmit = (segIdx: number, blockIdx: number, block: SpotlightBlock) => {
    if (block.type !== 'single') return;
    const key = blockStateKey(segIdx, blockIdx);
    const selected = blockState[key];
    if (typeof selected !== 'number') return;
    const options = block.options ?? [];
    const correct = resolveSingleCorrect(options, block.answer, selected);
    setFeedback((prev) => ({ ...prev, [key]: correct }));
    checkCompletion(blockState);
  };

  const finishFreeText = (key: string, grade: StrategyGradeResult) => {
    setTextGrades((prev) => ({ ...prev, [key]: grade }));
    setFeedback((prev) => ({ ...prev, [key]: true }));
    checkCompletion(blockState);
  };

  const handleFreeTextSubmit = async (
    segIdx: number,
    blockIdx: number,
    block: SpotlightBlock,
  ) => {
    if (block.type !== 'free_text') return;
    const key = blockStateKey(segIdx, blockIdx);
    const text = String(blockState[key] ?? '').trim();
    if (!text) return;

    if (!token) {
      const localCorrect = resolveFreeTextCorrect(text, block.answer);
      finishFreeText(key, {
        ...FALLBACK_GRADE,
        is_correct: localCorrect,
        feedback: localCorrect ? '✓ 答對了' : '再想想看',
      });
      return;
    }

    setGradingKey(key);
    try {
      const grade = await validateStrategyAnswer(token, {
        question: block.prompt ?? '',
        studentAnswer: text,
        strategyName: spotlight.strategy_name,
        storyTitle,
        passage,
      });
      finishFreeText(key, grade);
    } catch {
      finishFreeText(key, FALLBACK_GRADE);
    } finally {
      setGradingKey(null);
    }
  };

  const renderGuide = (key: string, text: string) => (
    <div
      key={key}
      className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-5 py-4 text-base text-on-surface whitespace-pre-wrap leading-relaxed"
    >
      {text}
    </div>
  );

  const renderFigure = (block: SpotlightBlock) => {
    if (block.type !== 'figure') return null;
    const label = figureLabelFromBlock(block);
    const imgIdx = story?.images?.findIndex((i) => i.figure_label === label) ?? -1;
    const img = imgIdx >= 0 ? story?.images?.[imgIdx] : undefined;
    const lessonCode = resolveLessonCode(spotlight, story, lessonId, img?.filename);
    if (img && lessonCode) {
      return (
        <FigureCard
          src={buildImageSrc(img.filename, lessonCode)}
          alt={label ?? '圖'}
          caption={block.bind_paragraph ? String(block.bind_paragraph) : label ?? undefined}
          index={imgIdx}
          figureLabel={label ?? undefined}
        />
      );
    }
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-base text-on-surface-variant text-center">
        {label ? `${label}（圖片）` : '圖表參考'}
        {block.asset ? <span className="block text-xs mt-1 opacity-60">{block.asset}</span> : null}
      </div>
    );
  };

  const renderBlock = (block: SpotlightBlock, segIdx: number, blockIdx: number) => {
    const key = blockStateKey(segIdx, blockIdx);
    const fb = feedback[key];

    switch (block.type) {
      case 'guide':
        return renderGuide(key, block.text ?? '');

      case 'passage':
        return (
          <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
            <div className="text-sm font-semibold text-on-surface-variant mb-2">閱讀文本</div>
            {block.paragraphs.map((p, i) => (
              <p key={i} className="text-base text-on-surface mb-2 last:mb-0 leading-relaxed">
                {p}
              </p>
            ))}
          </div>
        );

      case 'single': {
        const options = block.options ?? [];
        const selected = blockState[key];
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{block.prompt}</p>
            <div className="space-y-2">
              {options.map((opt, oi) => (
                <button
                  key={oi}
                  type="button"
                  disabled={fb !== undefined && fb !== null}
                  onClick={() => setBlockValue(key, oi)}
                  className={[
                    'w-full text-left rounded-lg border px-4 py-2.5 text-base transition-colors',
                    selected === oi
                      ? 'border-violet-500 bg-violet-50 text-violet-900'
                      : 'border-gray-200 hover:border-violet-300',
                  ].join(' ')}
                >
                  {String.fromCharCode(65 + oi)}. {opt}
                </button>
              ))}
            </div>
            {fb === null || fb === undefined ? (
              <button
                type="button"
                onClick={() => handleSingleSubmit(segIdx, blockIdx, block)}
                disabled={typeof selected !== 'number'}
                className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
              >
                確認
              </button>
            ) : (
              <p className={`mt-3 text-base font-medium ${fb ? 'text-green-700' : 'text-amber-700'}`}>
                {fb ? '✓ 答對了' : '再想想看'}
              </p>
            )}
          </div>
        );
      }

      case 'free_text': {
        if (isSectionHeaderPrompt(block.prompt)) {
          return renderGuide(key, block.prompt);
        }
        const grade = textGrades[key];
        const isGrading = gradingKey === key;
        const isSubmitted = fb !== undefined && fb !== null;
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{block.prompt}</p>
            <textarea
              value={String(blockState[key] ?? '')}
              disabled={isSubmitted || isGrading}
              onChange={(e) => setBlockValue(key, e.target.value)}
              rows={3}
              placeholder="請在此寫下你的答案…"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-base"
            />
            {!isSubmitted && !isGrading ? (
              <button
                type="button"
                onClick={() => void handleFreeTextSubmit(segIdx, blockIdx, block)}
                className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600"
              >
                送出
              </button>
            ) : null}
            {isGrading ? (
              <p className="mt-3 text-sm text-violet-600 font-semibold">AI 批改中…</p>
            ) : null}
            {!isGrading && grade ? (
              <div
                className={`mt-3 rounded-lg border p-3 ${
                  grade.is_correct
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-amber-50 border-amber-200'
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    grade.is_correct ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {grade.is_correct ? '✓ ' : '💡 '}
                  {grade.feedback}
                </p>
                {grade.suggestion ? (
                  <p className="mt-1.5 text-sm text-amber-700/90">{grade.suggestion}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      }

      case 'self_check':
        return (
          <div key={key} className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-base font-semibold text-on-surface mb-3">自我檢核</p>
            <div className="space-y-2">
              {block.items.map((item, ii) => {
                const checks = (blockState[key] as boolean[]) ?? [];
                return (
                  <label key={ii} className="flex items-start gap-2 text-base cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!checks[ii]}
                      onChange={(e) => {
                        const next = [...checks];
                        next[ii] = e.target.checked;
                        while (next.length < block.items.length) next.push(false);
                        setBlockValue(key, next);
                        if (next.filter(Boolean).length >= block.items.length) {
                          setFeedback((prev) => ({ ...prev, [key]: true }));
                          checkCompletion({ ...blockState, [key]: next });
                        }
                      }}
                      className="mt-0.5"
                    />
                    <span>{item}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );

      case 'figure':
        return <div key={key}>{renderFigure(block)}</div>;

      case 'fill_table':
        return (
          <div
            key={key}
            className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-base text-blue-900"
          >
            文章重點表請在「文章重點表」步驟填寫
            {onOpenKeypoints ? (
              <button
                type="button"
                onClick={onOpenKeypoints}
                className="ml-3 underline text-blue-700"
              >
                前往重點表
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setBlockValue(key, true);
                checkCompletion({ ...blockState, [key]: true });
              }}
              className="ml-3 underline text-blue-700"
            >
              知道了
            </button>
          </div>
        );

      default:
        return (
          <div key={key} className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-3 text-base text-on-surface-variant">
            {(block as { text?: string; prompt?: string }).text ??
              (block as { prompt?: string }).prompt ??
              `[${block.type}]`}
          </div>
        );
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto w-full">
      <header className="border-b border-gray-200 pb-4">
        <div className="text-sm font-semibold text-violet-600 tracking-wide">閱讀聚光燈</div>
        <h2 className="text-xl font-bold text-on-surface mt-1">{spotlight.strategy_name}</h2>
      </header>

      {segments.slice(0, visibleSegmentCount).map((segment, segIdx) => (
        <section key={segIdx} className="space-y-4">
          {segIdx > 0 ? (
            <div className="text-sm font-semibold text-on-surface-variant pt-2 border-t border-gray-100">
              第 {segIdx + 1} 部分
            </div>
          ) : null}
          {segment.map((block, blockIdx) => renderBlock(block, segIdx, blockIdx))}
        </section>
      ))}

      {allDone ? (
        <p className="text-center text-base font-medium text-green-700 py-4">✓ 閱讀聚光燈練習完成</p>
      ) : null}

      {story && story.content.length > 0 ? (
        <details className="rounded-lg border border-gray-200 bg-surface-container-low p-3 text-base">
          <summary className="cursor-pointer font-medium text-on-surface-variant">
            需要時查看本課課文全文
          </summary>
          <div className="mt-3 space-y-2 text-on-surface leading-relaxed">
            {story.content.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
};

export default BlockSequenceRenderer;
