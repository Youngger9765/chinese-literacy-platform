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
    case 'exercise':
      return (
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
      );
    default:
      return null;
  }
};

export default BlockRenderer;
