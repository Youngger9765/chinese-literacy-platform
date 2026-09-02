/**
 * AnnotatedParagraph.tsx
 *
 * Renders a single paragraph with annotation highlight spans.
 * Handles PUA selector stripping so raw-char offsets map correctly to
 * UTF-16 slice positions.
 *
 * Extracted from ReadingAnnotation.tsx as part of #1855 refactor.
 */
import React from 'react';
import { Annotation } from './annotationReducer';
import { TYPE_CONFIG, EDITOR_PREMARK_STYLE } from './AnnotationToolbar';
import { stripPUASelectors } from './annotationOffsets';
import {
  renderDifficultAwareText,
  difficultFlagsByRawIndex,
  renderDifficultFlagged,
} from '../zhuyin/difficultSpanRenderer';

interface AnnotatedParagraphProps {
  rawText: string;
  displayText: string;
  paraIdx: number;
  annotations: Annotation[];
  focusedAnnotationId: string | null;
  isZhuyinAny: boolean;
  fontSizePx: number;
  annotationElementRefs: React.MutableRefObject<Map<string, HTMLSpanElement>>;
  onRemoveAnnotation: (id: string) => void;
}

const AnnotatedParagraph: React.FC<AnnotatedParagraphProps> = ({
  rawText,
  displayText,
  paraIdx,
  annotations,
  focusedAnnotationId,
  isZhuyinAny,
  fontSizePx,
  annotationElementRefs,
  onRemoveAnnotation,
}) => {
  /**
   * Splits a paragraph's raw text into segments:
   * plain text and annotated ranges.
   * Then wraps annotated segments in styled <span> elements.
   */
  function renderAnnotatedContent(): React.ReactNode {
    const paraAnnotations = annotations
      .filter((a) => a.paragraphIndex === paraIdx)
      .sort((a, b) => a.charStart - b.charStart);

    if (paraAnnotations.length === 0) {
      // No annotations — render plain (possibly zhuyin) text. In 'difficult'
      // mode displayText carries DIFFICULT_SPAN_START/END markers around the
      // vocab-word runs (#3022) -- renderDifficultAwareText applies the
      // zhuyin font ONLY inside them and is a no-op (returns the string
      // as-is) when there are no markers, i.e. 'none'/'all' mode or an
      // annotation-free difficult line with no vocab hits.
      return renderDifficultAwareText(displayText, paraIdx);
    }

    // Build segments from raw text char offsets, render display text char-by-char.
    //
    // ann.charStart / ann.charEnd are RAW character indices — PUA Variation Selectors
    // (U+E0100–U+E01EF, stored as surrogate pairs) are NOT counted.  See countRawChars().
    //
    // However, lesson YAML files may embed these PUA selectors directly in the paragraph
    // text (e.g. L01 paragraph 1: 「著󠇣頭緒」has a selector after 著).  This means rawText
    // and even displayText (when zhuyin is off) may contain PUA surrogates, making their
    // .length exceed the raw char count.  Using raw char indices directly as slice() indices
    // would then slice the string at the wrong UTF-16 positions, putting the annotation
    // highlight on the wrong characters — this was the regression introduced by PR #1155.
    //
    // Fix: strip PUA selectors from the rendering string before slicing.  After stripping,
    // .length == raw char count, so raw indices and UTF-16 slice indices agree perfectly.
    //
    // NOTE: when zhuyin is active (any mode with ruby), displayText contains BpmfZihiSerif PUA
    // selectors AND ruby annotations that cannot be split character-by-character, so we fall
    // back to rawText for annotation offset calculations.
    const baseText = isZhuyinAny ? rawText : displayText;
    // Strip PUA Variation Selectors so that .length == raw char count and slice indices match.
    const textToRender = stripPUASelectors(baseText);

    // #3022: the strip above also removes the DIFFICULT_SPAN markers -- they
    // live in the same Variation Selectors block. Carry which characters were
    // inside a marked run across the strip as a parallel flag array, indexed
    // the same way the slices below are, so difficult-mode ruby survives here.
    // Empty in 'none'/'all' mode (no markers) -> those render exactly as before.
    const difficultFlags = difficultFlagsByRawIndex(displayText);
    // Only trust the flags when they line up with what we are slicing. In
    // 'all' mode baseText is rawText while displayText may be a different
    // length, and a misaligned flag array would mark the wrong characters --
    // better to fall back to no marking than to mark the wrong ones.
    const flagsUsable = difficultFlags.length === textToRender.length;

    const segments: Array<{ start: number; end: number; annotation?: Annotation }> = [];
    let cursor = 0;

    for (const ann of paraAnnotations) {
      const s = Math.min(ann.charStart, textToRender.length);
      const e = Math.min(ann.charEnd, textToRender.length);
      if (s > cursor) {
        segments.push({ start: cursor, end: s });
      }
      if (e > s) {
        segments.push({ start: s, end: e, annotation: ann });
      }
      cursor = Math.max(cursor, e);
    }
    if (cursor < textToRender.length) {
      segments.push({ start: cursor, end: textToRender.length });
    }

    return segments.map((seg) => {
      const chars = textToRender.slice(seg.start, seg.end);
      // #3022: re-apply the per-run zhuyin font to this slice.
      const body = flagsUsable
        ? renderDifficultFlagged(chars, difficultFlags.slice(seg.start, seg.end), seg.start)
        : chars;
      if (!seg.annotation) {
        return <React.Fragment key={seg.start}>{body}</React.Fragment>;
      }
      // #3026: an 'editor'-sourced pre-mark uses its own style — never the
      // student's own 重要/不懂 look — so the two stay visually distinguishable
      // (BDD: 「與新套用的預標在視覺上可分辨」). Clicking it doesn't "移除"
      // anything the student made; it hides that one pre-mark for this
      // student, so the wording says 隱藏, not 移除 (see FullTextAnnotate.tsx's
      // dismiss handling — a pre-mark's id is never fed to the reducer's
      // REMOVE action).
      const isEditorPreMark = seg.annotation.source === 'editor';
      const cfg = isEditorPreMark ? EDITOR_PREMARK_STYLE : TYPE_CONFIG[seg.annotation.type];
      return (
        <span
          key={seg.annotation.id}
          ref={(element) => {
            if (element) {
              annotationElementRefs.current.set(seg.annotation!.id, element);
            } else {
              annotationElementRefs.current.delete(seg.annotation!.id);
            }
          }}
          className={`cursor-pointer transition-all duration-300 ${cfg.className} ${focusedAnnotationId === seg.annotation.id ? 'ring-4 ring-lime-300 ring-offset-2 shadow-[0_0_0_4px_rgba(190,242,100,0.35)]' : ''}`}
          title={isEditorPreMark ? `${cfg.icon} ${cfg.label}（點擊隱藏）` : `${cfg.icon} ${cfg.label} (點擊移除)`}
          onClick={() => onRemoveAnnotation(seg.annotation!.id)}
          role="mark"
          aria-label={`${cfg.label}標記：${chars}`}
          data-annotation-id={seg.annotation.id}
          data-annotation-source={seg.annotation.source ?? 'student'}
        >
          {body}
        </span>
      );
    });
  }

  return (
    <p
      data-para-idx={paraIdx}
      className="text-on-surface/90"
      style={{
        fontSize: `${fontSizePx}px`,
        lineHeight: isZhuyinAny ? '2.4rem' : '1.6',
        letterSpacing: isZhuyinAny ? '0.15em' : '0',
      }}
    >
      {renderAnnotatedContent()}
    </p>
  );
};

export default AnnotatedParagraph;
