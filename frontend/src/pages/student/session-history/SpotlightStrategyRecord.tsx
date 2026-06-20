/**
 * SpotlightStrategyRecord — 閱讀聚光燈作答紀錄（老師端 / 學生端共用）
 * Renders step_progress['reading-strategy'] for spotlight v2 + legacy guided steps.
 * Issue #2083 — 老師端可檢視學生申論 / 選擇題答案
 */

import React from 'react';
import type { SpotlightBlock, SpotlightV2, StrategyExercise as StrategyExerciseType } from '../../../types';
import type { StrategyGradeResult } from '../../../services/learning/sentence';
import { OPTION_LABELS } from '../../../components/reading-steps/strategyExerciseLogic';
import {
  blockStateKey,
  isInteractiveBlock,
  segmentBlocks,
} from '../../../components/reading-spotlight/spotlightBlockLogic';
import { ReportSectionAccordion } from './ReportSectionAccordion';

interface SpotlightStrategyRecordProps {
  stepData: Record<string, unknown>;
  spotlight?: SpotlightV2 | null;
  strategyExercise?: StrategyExerciseType | null;
}

function promptLabel(block: SpotlightBlock): string {
  if (block.type === 'single' || block.type === 'multi') return block.prompt ?? '選擇題';
  if (block.type === 'free_text') return block.prompt ?? '申論';
  if (block.type === 'self_check') return '自我檢核';
  return block.type;
}

function AnswerBadge({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true) {
    return <span className="text-xs font-medium text-green-700">✓ 答對</span>;
  }
  if (ok === false) {
    return <span className="text-xs font-medium text-red-600">✗ 答錯</span>;
  }
  return <span className="text-xs text-gray-400">已作答</span>;
}

function FreeTextBlock({
  prompt,
  answer,
  grade,
}: {
  prompt: string;
  answer: string;
  grade?: StrategyGradeResult | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
      <p className="text-sm font-medium text-gray-800">{prompt}</p>
      <p className="text-sm text-gray-700 whitespace-pre-wrap">{answer || '（未填寫）'}</p>
      {grade && (
        <div
          className={`text-sm rounded-lg px-3 py-2 ${
            grade.is_correct ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'
          }`}
        >
          <span className="font-medium">💡 </span>
          {grade.feedback}
          {grade.suggestion ? (
            <p className="text-xs mt-1 opacity-80">{grade.suggestion}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function renderSpotlightV2Items(
  blocks: SpotlightBlock[],
  blockState: Record<string, unknown>,
  feedback: Record<string, boolean | null>,
  textGrades: Record<string, StrategyGradeResult>,
): React.ReactNode[] {
  const segments = segmentBlocks(blocks);
  const items: React.ReactNode[] = [];
  let qNum = 0;

  segments.forEach((seg, segIdx) => {
    seg.forEach((block, blockIdx) => {
      if (!isInteractiveBlock(block.type)) return;
      const key = blockStateKey(segIdx, blockIdx);
      qNum += 1;

      if (block.type === 'single') {
        const selected = blockState[key];
        const idx = typeof selected === 'number' ? selected : -1;
        const label = idx >= 0 ? OPTION_LABELS[idx] ?? String(idx + 1) : '—';
        const text = idx >= 0 && block.options?.[idx] ? block.options[idx] : '（未選擇）';
        items.push(
          <div key={key} className="rounded-xl border border-gray-200 p-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-gray-800">
                {qNum}. {promptLabel(block)}
              </p>
              <AnswerBadge ok={feedback[key]} />
            </div>
            <p className="text-sm text-gray-700">
              {label}. {text}
            </p>
          </div>,
        );
        return;
      }

      if (block.type === 'free_text') {
        items.push(
          <FreeTextBlock
            key={key}
            prompt={`${qNum}. ${promptLabel(block)}`}
            answer={String(blockState[key] ?? '')}
            grade={textGrades[key]}
          />,
        );
        return;
      }

      if (block.type === 'self_check') {
        const checked = blockState[key];
        const count = Array.isArray(checked) ? checked.length : 0;
        items.push(
          <div key={key} className="rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-medium text-gray-800">{qNum}. 自我檢核</p>
            <p className="text-sm text-gray-600 mt-1">已勾選 {count} 項</p>
          </div>,
        );
      }
    });
  });

  return items;
}

function renderGuidedStepsItems(
  exercise: StrategyExerciseType,
  answers: (string | number | null)[],
  stepFeedback: (boolean | null)[],
  textGrades: (StrategyGradeResult | null)[],
): React.ReactNode[] {
  const steps = exercise.steps ?? [];
  return steps.map((step, i) => {
    const answer = answers[i];
    const fb = stepFeedback[i];
    const grade = textGrades[i];

    if (step.type === 'free_text') {
      return (
        <FreeTextBlock
          key={i}
          prompt={step.prompt ?? `步驟 ${i + 1}`}
          answer={typeof answer === 'string' ? answer : ''}
          grade={grade}
        />
      );
    }

    if (step.type === 'select') {
      const idx = typeof answer === 'number' ? answer : -1;
      const opts = step.options ?? [];
      const label = idx >= 0 ? OPTION_LABELS[idx] ?? String(idx + 1) : '—';
      const text = idx >= 0 && opts[idx] ? opts[idx] : '（未選擇）';
      return (
        <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-gray-800">{step.prompt ?? `步驟 ${i + 1}`}</p>
            <AnswerBadge ok={fb} />
          </div>
          <p className="text-sm text-gray-700">
            {label}. {text}
          </p>
        </div>
      );
    }

    return null;
  }).filter(Boolean) as React.ReactNode[];
}

function hasRenderableAnswers(stepData: Record<string, unknown>): boolean {
  if (stepData.renderer === 'spotlight_v2') {
    const blockState = stepData.blockState as Record<string, unknown> | undefined;
    return !!blockState && Object.keys(blockState).length > 0;
  }
  if (stepData.exerciseType === 'guided_steps') {
    const answers = stepData.answers as unknown[] | undefined;
    return !!answers && answers.some((a) => a !== null && a !== '');
  }
  return false;
}

export const SpotlightStrategyRecord: React.FC<SpotlightStrategyRecordProps> = ({
  stepData,
  spotlight,
  strategyExercise,
}) => {
  if (!hasRenderableAnswers(stepData)) {
    const completed = stepData.completed === true || stepData.allDone === true;
    if (!completed) return null;
    return (
      <ReportSectionAccordion title="閱讀聚光燈" defaultOpen>
        <p className="text-sm text-gray-500">學生已完成此步驟，但詳細作答未儲存（可能是較舊的學習紀錄）</p>
      </ReportSectionAccordion>
    );
  }

  let items: React.ReactNode[] = [];

  if (stepData.renderer === 'spotlight_v2' && spotlight?.blocks?.length) {
    items = renderSpotlightV2Items(
      spotlight.blocks,
      (stepData.blockState as Record<string, unknown>) ?? {},
      (stepData.feedback as Record<string, boolean | null>) ?? {},
      (stepData.textGrades as Record<string, StrategyGradeResult>) ?? {},
    );
  } else if (stepData.exerciseType === 'guided_steps' && strategyExercise) {
    items = renderGuidedStepsItems(
      strategyExercise,
      (stepData.answers as (string | number | null)[]) ?? [],
      (stepData.stepFeedback as (boolean | null)[]) ?? [],
      (stepData.textGrades as (StrategyGradeResult | null)[]) ?? [],
    );
  }

  if (items.length === 0) return null;

  const done = stepData.allDone === true || stepData.completed === true;

  return (
    <ReportSectionAccordion title="閱讀聚光燈">
      {done && (
        <p className="text-xs text-green-700 font-medium">學生已完成聚光燈練習</p>
      )}
      <div className="space-y-3">{items}</div>
    </ReportSectionAccordion>
  );
};

export default SpotlightStrategyRecord;
