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
import { stripPUASelectors, toRawUnits } from './annotationOffsets';
import {
  underlinedFlagsByRawIndex,
  UNDERLINED_TERM_CLASS,
} from '../zhuyin/underlinedTermsRenderer';
import {
  renderDifficultAwareText,
  difficultFlagsByRawIndex,
  renderDifficultFlaggedUnits,
  stripDifficultMarkers,
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
  /**
   * #3134 — 標記模式。開啟時整段改走**逐字 span** 的獨立渲染路徑，
   * 讓 elementFromPoint 定位得到每一個字（iPad 上 caretRangeFromPoint
   * 在 user-select:none 下回傳課文以外的節點，不能用）。
   *
   * ⛔ 這條路徑刻意以**純文字**渲染，不套注音：下方主路徑的註解寫著注音的
   *    ruby「cannot be split character-by-character」，而逐字包 span 正是在拆它。
   *    繞開而不硬解 —— 那段還背著 PR #1155 的回歸紀錄。
   */
  markMode?: boolean;
  /**
   * 教材在課文裡替專有名詞（人名／地名／國名／機構名）加的底線（#3309）。
   *
   * ⛔ 不是插 `<u>` —— 課文是拖曳標記的介面，字元位移承重（#2165 錯位事故）。
   *    這裡只給落在詞範圍內的既有 `<span data-ci>` 多一個 class，DOM 的文字
   *    一個字都沒動。
   */
  underlinedTerms?: string[] | null;
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
  markMode = false,
  underlinedTerms,
}) => {
  /**
   * #3134 標記模式的渲染：純文字、逐字一個 span。
   *
   * 位移語意跟主路徑一致 —— `stripPUASelectors` 之後 .length == 原始字元數，
   * 所以 `data-ci` 就是 `Annotation.charStart/charEnd` 用的那個索引，
   * 上層不需要再做任何換算。
   */
  function renderMarkModeContent(): React.ReactNode {
    const text = stripPUASelectors(rawText);
    const paraAnnotations = annotations.filter((a) => a.paragraphIndex === paraIdx);
    // 每個字查一次「落在哪個記號裡」。一段最長 ~200 字、記號個位數，
    // 直接線性找比建索引省事，也不會有索引沒同步的風險。
    const typeAt = (i: number) =>
      paraAnnotations.find((a) => i >= a.charStart && i < a.charEnd);

    // 專有名詞底線（#3309）。索引基準跟 data-ci 一樣是剝過 PUA 的 `text`。
    const underlined = underlinedFlagsByRawIndex(text, underlinedTerms);

    return [...text].map((ch, i) => {
      const ann = typeAt(i);
      const cfg = ann
        ? (ann.source === 'editor' ? EDITOR_PREMARK_STYLE : TYPE_CONFIG[ann.type])
        : null;
      // 學生的記號用背景色、專有名詞只有底線 —— 同時出現時不會互相蓋掉。
      const cls = [cfg?.className, underlined[i] ? UNDERLINED_TERM_CLASS : null]
        .filter(Boolean).join(' ') || undefined;
      return (
        <span
          key={i}
          data-ci={i}
          data-annotated={ann ? ann.type : undefined}
          data-annotation-source={ann ? (ann.source ?? 'student') : undefined}
          data-underlined-term={underlined[i] ? 'true' : undefined}
          className={cls}
        >
          {ch}
        </span>
      );
    });
  }

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
    // #3185: this used to fall back to `rawText` whenever zhuyin was on, which
    // threw away every tone variant selector -- i.e. the whole polyphonic
    // correction -- for any paragraph the student or the teacher had marked.
    // Measured on staging L20013: 4/4 marked paragraphs had zero selectors while
    // every unmarked paragraph had them, so 「功夫了得」read ㄌㄜ˙ instead of ㄌㄧㄠˇ.
    //
    // We now render from `displayText` but slice it by RAW character index via
    // toRawUnits(), so each character keeps the selectors that belong to it and
    // `units.slice(a, b)` still lines up with `stripped.slice(a, b)` — the two
    // requirements (correction visible, highlight on the right characters) hold
    // at the same time.
    //
    // Fail-safe #1: if the processed text does not reduce to the same raw string
    // as rawText, something upstream changed the content and raw offsets can no
    // longer be trusted against it — render rawText instead rather than risk
    // putting the highlight on the wrong characters (PR #1155). Note this falls
    // back to the old SOURCE, not the old rendering: selectors embedded directly
    // in the lesson YAML (the 「著󠇣頭緒」 case above) still survive, which is what
    // the annotation-free branch has always done.
    const displayForRender = isZhuyinAny ? stripDifficultMarkers(displayText) : displayText;
    const offsetsAgree =
      stripPUASelectors(displayForRender) === stripPUASelectors(rawText);
    const baseText = offsetsAgree ? displayForRender : rawText;
    // Strip PUA Variation Selectors so that .length == raw char count and slice indices match.
    const textToRender = stripPUASelectors(baseText);
    // One entry per code unit of textToRender, each carrying its own selectors.
    const rawUnits = toRawUnits(baseText);
    // Fail-safe #2: the two parallel structures MUST line up index for index or
    // every segment after the first divergence paints the wrong characters —
    // #1155 again, by a different route. They can only diverge because
    // stripPUASelectors absorbs a wider surrogate range (U+E0000–U+E03FF) than
    // toRawUnits does (U+E0100–U+E01EF), so a plane-14 code point outside the
    // variant-selector block desynchronises them. No content in this repo
    // contains one today, which is exactly why this needs a guard rather than a
    // comment: when one appears, drop the selectors for this paragraph and
    // render plain text. No zhuyin is a visible, recoverable loss; a highlight
    // on the wrong characters is silent and wrong.
    const renderUnits =
      rawUnits.length === textToRender.length ? rawUnits : textToRender.split('');

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
      // `chars` is the plain slice — used for anything a human or a screen
      // reader reads. `units` is the same slice with the tone selectors still
      // attached — that is what actually gets rendered (#3185).
      const chars = textToRender.slice(seg.start, seg.end);
      const units = renderUnits.slice(seg.start, seg.end);
      // #3022: re-apply the per-run zhuyin font to this slice.
      const body = flagsUsable
        ? renderDifficultFlaggedUnits(units, difficultFlags.slice(seg.start, seg.end), seg.start)
        : units.join('');
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
        // 標記模式以純文字渲染，所以行高/字距也回到無注音的值 ——
        // 否則會留下為 ruby 準備的空間，看起來像破版。
        lineHeight: isZhuyinAny && !markMode ? '2.4rem' : '1.6',
        letterSpacing: isZhuyinAny && !markMode ? '0.15em' : '0',
      }}
    >
      {markMode ? renderMarkModeContent() : renderAnnotatedContent()}
    </p>
  );
};

export default AnnotatedParagraph;
