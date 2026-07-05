/**
 * BlockRenderer — switch on `block.type` (5 branches). One code path for every block;
 * 一般課文 vs 圖文課文 is a layout hint (lessonLayout.ts), not a second renderer.
 *
 *   paragraph        → ParagraphBlockView (numbered line + 注音)
 *   figure           → FigureBlockView (delegates FigureCard + buildImageSrc)
 *   table            → TableBlockView (fast path TableBody / raw grid fallback)
 *   parallel_passage → ParallelPassageBlockView (two-column presentation)
 *   exercise         → ExerciseBlockView (EDD 收口: kind → widget → grade())
 */
import React from 'react';
import type { Block } from '../../schema/lessonContent';
import ParagraphBlockView from './blocks/ParagraphBlockView';
import FigureBlockView from './blocks/FigureBlockView';
import TableBlockView from './blocks/TableBlockView';
import ParallelPassageBlockView from './blocks/ParallelPassageBlockView';
import ExerciseBlockView from './ExerciseBlockView';

type TableBlock = Block & { type: 'table' };
type ParallelPassageBlock = Block & { type: 'parallel_passage' };

interface Props {
  block: Block;
  lessonCode: string;
  storyTitle?: string | null;
  passage?: string | null;
  /** 1-based line number for paragraph blocks (position in the paragraph run). */
  paragraphNumber?: number;
  /** 0-based figure index for the figure numeral badge fallback. */
  figureIndex?: number;

  // exercise wiring (only used when block.type === 'exercise')
  answerValue?: unknown;
  onAnswerChange?: (value: unknown) => void;
  onGraded?: (result: { verdict: boolean | null; needsReview: boolean }) => void;
  verdict?: boolean | null;
}

const BlockRenderer: React.FC<Props> = ({
  block,
  lessonCode,
  storyTitle,
  passage,
  paragraphNumber,
  figureIndex = 0,
  answerValue,
  onAnswerChange,
  onGraded,
  verdict,
}) => {
  switch (block.type) {
    case 'paragraph':
      return <ParagraphBlockView text={block.text} lineNumber={paragraphNumber} />;
    case 'figure':
      return (
        <FigureBlockView
          label={block.label}
          caption={block.caption}
          asset={block.asset}
          lessonCode={lessonCode}
          index={figureIndex}
        />
      );
    case 'table':
      // Runtime switch guarantees the tag; the zod-inferred union does not narrow to the
      // intersection prop type, so we assert the tag we already checked.
      return <TableBlockView block={block as TableBlock} />;
    case 'parallel_passage':
      return <ParallelPassageBlockView block={block as ParallelPassageBlock} />;
    case 'exercise': {
      // #2505 review #5 — loader sets needsReview=true when the spotlight's declared
      // identity mismatches the display lesson's authoritative _parsed twin (the
      // 「內容放錯課」guard). `custom` carries its own 需人工檢核 affordance inside
      // CustomExerciseView; for the machine-graded kinds surface a visible per-exercise
      // badge so a flagged question isn't rendered/graded as if it were trustworthy
      // (the aggregate "有 N 題需老師人工檢核" banner alone was easy to miss).
      const flagForReview = block.needsReview === true && block.question.kind !== 'custom';
      return (
        <>
          {flagForReview && (
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
              <span className="material-symbols-outlined text-base leading-none">flag</span>
              需老師人工檢核：此題內容可能與本課不符
            </div>
          )}
          <ExerciseBlockView
            exercise={block}
            lessonCode={lessonCode}
            storyTitle={storyTitle}
            passage={passage}
            value={answerValue}
            onValueChange={(v) => onAnswerChange?.(v)}
            onGraded={(r) => onGraded?.(r)}
            verdict={verdict}
          />
        </>
      );
    }
    default:
      return null;
  }
};

export default BlockRenderer;
