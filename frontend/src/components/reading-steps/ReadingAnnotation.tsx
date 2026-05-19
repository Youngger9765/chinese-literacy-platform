import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import { fontForZhuyin } from '../../constants/fonts';
import GraphicTextImageStrip from './GraphicTextImageStrip';
import TableDisplay from './TableDisplay';
import InlineImageCard from './InlineImageCard';
import InlineTableCard from './InlineTableCard';
import {
  detectImageMarker,
  detectTableMarker,
  resolveImageIndex,
  resolveTableIndex,
} from '../../utils/paragraphMarkers';

// ── Types ──────────────────────────────────────────────────────────────────

export type AnnotationType = 'unknown' | 'important';

export interface Annotation {
  id: string;
  paragraphIndex: number;
  charStart: number;
  charEnd: number;
  type: AnnotationType;
}

export interface AnnotationSummary {
  totalMarks: number;
  unknownCount: number;
  importantCount: number;
}

interface ReadingAnnotationProps {
  story: Story;
  onFinish: (summary: AnnotationSummary) => void;
  fontSizePx?: number;
}

interface AnnotationWithText {
  annotation: Annotation;
  text: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = (storyId: string) => scopedStepStorageKey('annotations_', storyId);

const TYPE_CONFIG: Record<AnnotationType, { label: string; icon: string; className: string; activeClass: string }> = {
  unknown: {
    label: '不懂',
    icon: '❓',
    // Bottom red line drawn via inset box-shadow so it tracks the inline-box edge
    // (always straight), unaffected by letter-spacing, ruby baselines, or PUA
    // variation selectors that can make text-decoration: underline look tilted.
    className: 'shadow-[inset_0_-3px_0_0_#ef4444]',
    activeClass: 'bg-red-100 border-red-400 text-red-800',
  },
  important: {
    label: '重要',
    icon: '💛',
    className: 'bg-yellow-200',
    activeClass: 'bg-yellow-300 border-yellow-500 text-yellow-900',
  },
};

// ── ID generator ───────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(): string {
  return `ann-${Date.now()}-${++_idCounter}`;
}

// ── Main Component ─────────────────────────────────────────────────────────

const ReadingAnnotation: React.FC<ReadingAnnotationProps> = ({
  story,
  onFinish,
  fontSizePx = 22,
}) => {
  // Zhuyin state from global context
  const { isZhuyinAny, processLinesSelective } = useZhuyin();
  const vocabWords = useMemo(
    () => (story.vocabulary ?? []).map((v) => v.word).filter(Boolean),
    [story.vocabulary]
  );

  // Annotations persisted to localStorage
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY(story.id));
      return raw ? (JSON.parse(raw) as Annotation[]) : [];
    } catch {
      return [];
    }
  });

  // Floating toolbar state
  const [toolbar, setToolbar] = useState<{
    visible: boolean;
    x: number;
    y: number;
    paragraphIndex: number;
    charStart: number;
    charEnd: number;
  }>({ visible: false, x: 0, y: 0, paragraphIndex: -1, charStart: 0, charEnd: 0 });

  // Undo stack
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const annotationElementRefs = useRef(new Map<string, HTMLSpanElement>());
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);

  // ── Zhuyin ─────────────────────────────────────────────────────────────

  const zhuyinParagraphs = useMemo(
    () => processLinesSelective(story.content, vocabWords),
    [story.content, vocabWords, processLinesSelective]
  );

  // ── Persist annotations ────────────────────────────────────────────────

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY(story.id), JSON.stringify(annotations));
    } catch {
      // Storage full — ignore
    }
  }, [annotations, story.id]);

  // ── Summary ────────────────────────────────────────────────────────────

  const summary = useMemo<AnnotationSummary>(() => ({
    totalMarks: annotations.length,
    unknownCount: annotations.filter((a) => a.type === 'unknown').length,
    importantCount: annotations.filter((a) => a.type === 'important').length,
  }), [annotations]);

  // Pre-compute which images/tables get rendered inline (caption-matched) so the
  // fallback strip at the bottom only emits the un-referenced ones. Avoids the
  // duplicate-render trap when a lesson labels every figure in its paragraphs.
  // See utils/paragraphMarkers.ts for the caption rule.
  const { inlineImageIdxByPara, inlineTableIdxByPara, usedImageIdx, usedTableIdx } = useMemo(() => {
    const imgMap = new Map<number, number>();
    const tblMap = new Map<number, number>();
    const usedImg = new Set<number>();
    const usedTbl = new Set<number>();
    story.content.forEach((para, paraIdx) => {
      const imgN = detectImageMarker(para);
      if (imgN !== null) {
        const imgIdx = resolveImageIndex(story.images, imgN);
        if (imgIdx !== null && !usedImg.has(imgIdx)) {
          imgMap.set(paraIdx, imgIdx);
          usedImg.add(imgIdx);
        }
      }
      const tblN = detectTableMarker(para);
      if (tblN !== null) {
        const tblIdx = resolveTableIndex(story.tables, tblN);
        if (tblIdx !== null && !usedTbl.has(tblIdx)) {
          tblMap.set(paraIdx, tblIdx);
          usedTbl.add(tblIdx);
        }
      }
    });
    return {
      inlineImageIdxByPara: imgMap,
      inlineTableIdxByPara: tblMap,
      usedImageIdx: usedImg,
      usedTableIdx: usedTbl,
    };
  }, [story.content, story.images, story.tables]);

  const fallbackImages = useMemo(
    () => (story.images ?? []).filter((_, i) => !usedImageIdx.has(i)),
    [story.images, usedImageIdx],
  );
  const fallbackTables = useMemo(
    () => (story.tables ?? []).filter((_, i) => !usedTableIdx.has(i)),
    [story.tables, usedTableIdx],
  );

  const annotationsForPanel = useMemo<AnnotationWithText[]>(() => {
    return [...annotations]
      .sort((a, b) => {
        if (a.paragraphIndex !== b.paragraphIndex) {
          return a.paragraphIndex - b.paragraphIndex;
        }
        return a.charStart - b.charStart;
      })
      .map((annotation) => {
        const paragraph = story.content[annotation.paragraphIndex] ?? '';
        return {
          annotation,
          text: paragraph.slice(annotation.charStart, annotation.charEnd),
        };
      });
  }, [annotations, story.content]);

  // ── Selection helpers ──────────────────────────────────────────────────

  /**
   * Strip BpmfIansui PUA Variation Selector surrogate pairs from a string.
   *
   * Both buildZhuyinString() and some YAML lesson files embed PUA Variation
   * Selectors Supplement (U+E0100–U+E01EF) directly in the paragraph text.
   * Each occupies 2 UTF-16 code units (surrogate pair: 0xDB40 + 0xDD00–0xDDEF).
   * These have no semantic content — they are font rendering hints only.
   * Stripping them gives a string where .length equals the raw character count,
   * so standard Array/String slice operations work correctly with raw char indices.
   */
  function stripPUASelectors(text: string): string {
    return text.replace(/\uDB40[\uDC00-\uDFFF]/g, '');
  }

  /**
   * Count raw (non-selector) characters in a string, stopping after `upTo`
   * UTF-16 code units have been consumed.  When `upTo` is omitted the entire
   * string is scanned.
   *
   * BpmfIansui uses Unicode Variation Selectors Supplement (U+E0100–U+E01EF)
   * to select polyphonic-character pronunciation variants.  buildZhuyinString()
   * appends one of U+E01E1–U+E01E5 after each non-default character.  These
   * code points are above U+FFFF so each occupies 2 UTF-16 code units (a
   * surrogate pair).  The browser's Selection API reports offsets in UTF-16
   * code units, so without correction the reported charStart is inflated by
   * 2 × (number of PUA selectors before the selection point).
   *
   * This helper strips those selectors so we always get an index into the
   * original raw paragraph text.
   */
  function countRawChars(text: string, upTo?: number): number {
    // PUA range used by BpmfIansui variant selectors: U+E0100–U+E01EF.
    // In UTF-16 these are the surrogate pair: high D83C + low DC00..DCEF.
    const limit = upTo ?? text.length;
    let rawCount = 0;
    let i = 0;
    while (i < limit) {
      const code = text.charCodeAt(i);
      // High surrogate of the PUA Variation Selectors Supplement block
      // U+E0100–U+E01EF encodes as high surrogate 0xDB40 + low 0xDD00–0xDDEF.
      if (code === 0xDB40 && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xDD00 && low <= 0xDDEF) {
          // This is a PUA selector — skip both code units, don't count
          i += 2;
          continue;
        }
      }
      rawCount++;
      i++;
    }
    return rawCount;
  }

  /**
   * Given a Selection that spans inside a paragraph <p data-para-idx="N">,
   * compute character offsets into the raw paragraph text.
   * Returns null if selection is empty or crosses paragraph boundaries.
   */
  function getSelectionInfo(): {
    paragraphIndex: number;
    charStart: number;
    charEnd: number;
    rect: DOMRect;
  } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    // Find the paragraph element from start container
    const startEl = range.startContainer.parentElement?.closest('[data-para-idx]') as HTMLElement | null;
    const endEl = range.endContainer.parentElement?.closest('[data-para-idx]') as HTMLElement | null;
    if (!startEl || !endEl) return null;

    // Must be same paragraph
    const paraIdxStr = startEl.getAttribute('data-para-idx');
    if (!paraIdxStr || startEl !== endEl) return null;

    const paragraphIndex = parseInt(paraIdxStr, 10);
    const paraEl = startEl; // same element

    // Compute char offsets relative to the original paragraph text.
    // Walk text nodes with a TreeWalker to get the actual character offset from
    // the Range, so duplicate text in the same paragraph is handled correctly.
    const selectedText = range.toString();
    if (!selectedText.trim()) return null;

    // Walk all text nodes inside the paragraph to find where range.startContainer
    // sits and accumulate the character offset up to range.startOffset.
    //
    // When zhuyin is active, each text node may contain BpmfIansui PUA variant
    // selectors (U+E01E1–U+E01E5, stored as surrogate pairs = 2 UTF-16 units
    // each).  These inflate node.textContent.length and range.startOffset
    // compared to the raw paragraph text.  countRawChars() strips them so the
    // stored annotation indices always refer to raw-text positions.
    let charStart = 0;
    let found = false;
    const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) {
        // range.startOffset is a UTF-16 offset into this text node; convert to
        // raw-character count by stripping PUA selectors up to that point.
        charStart += countRawChars(node.textContent ?? '', range.startOffset);
        found = true;
        break;
      }
      // Accumulate raw (non-selector) character count for completed nodes.
      charStart += countRawChars(node.textContent ?? '');
    }
    if (!found) return null;

    // selectedText from range.toString() also includes PUA selector code points;
    // strip them to get the raw character count of the selection.
    const rawSelectedLength = countRawChars(selectedText);
    const charEnd = charStart + rawSelectedLength;

    if (charStart >= charEnd) return null;

    const rect = range.getBoundingClientRect();
    return { paragraphIndex, charStart, charEnd, rect };
  }

  // ── Text selection events ──────────────────────────────────────────────

  const hideToolbar = useCallback(() => {
    setToolbar((t) => ({ ...t, visible: false }));
  }, []);

  const showToolbarForSelection = useCallback(() => {
    const info = getSelectionInfo();
    if (!info) {
      hideToolbar();
      return;
    }

    const container = containerRef.current;
    const containerRect = container?.getBoundingClientRect();
    if (!container || !containerRect) return;

    // Convert viewport coords to scroll-content coords so the toolbar stays
    // attached to the selected text even in long, scrolled paragraphs.
    const x = info.rect.left + info.rect.width / 2 - containerRect.left + container.scrollLeft;
    const y = info.rect.top - containerRect.top - 8 + container.scrollTop;

    setToolbar({
      visible: true,
      x,
      y,
      paragraphIndex: info.paragraphIndex,
      charStart: info.charStart,
      charEnd: info.charEnd,
    });
  }, [hideToolbar]);

  const handleMouseUp = useCallback(() => {
    // Small delay so selection is stable
    setTimeout(showToolbarForSelection, 50);
  }, [showToolbarForSelection]);

  // Touch: show toolbar after touch end
  const handleTouchEnd = useCallback(() => {
    setTimeout(showToolbarForSelection, 150);
  }, [showToolbarForSelection]);

  // Click outside hides toolbar
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (toolbarRef.current && toolbarRef.current.contains(e.target as Node)) return;
      hideToolbar();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [hideToolbar]);

  // ── Apply annotation from toolbar ─────────────────────────────────────

  const applyAnnotation = useCallback((type: AnnotationType) => {
    if (!toolbar.visible) return;
    const { paragraphIndex, charStart, charEnd } = toolbar;

    setAnnotations((prev) => {
      const snapshot = prev;
      setUndoStack((stack) => [...stack.slice(-19), snapshot]);

      // Remove any existing annotations that fully overlap
      const filtered = prev.filter(
        (a) =>
          a.paragraphIndex !== paragraphIndex ||
          a.charEnd <= charStart ||
          a.charStart >= charEnd
      );

      const newAnn: Annotation = {
        id: genId(),
        paragraphIndex,
        charStart,
        charEnd,
        type,
      };

      return [...filtered, newAnn];
    });

    // Clear selection
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  }, [toolbar, hideToolbar]);

  // ── Remove annotation on click ─────────────────────────────────────────

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => {
      setUndoStack((stack) => [...stack.slice(-19), prev]);
      return prev.filter((a) => a.id !== id);
    });

    if (focusedAnnotationId === id) {
      setFocusedAnnotationId(null);
    }
    annotationElementRefs.current.delete(id);
  }, [focusedAnnotationId]);

  // ── Undo ──────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setAnnotations(prev);
      return stack.slice(0, -1);
    });
  }, []);

  // ── Clear all ─────────────────────────────────────────────────────────

  const clearAll = useCallback(() => {
    setUndoStack((stack) => [...stack.slice(-19), annotations]);
    setAnnotations([]);
    setFocusedAnnotationId(null);
    annotationElementRefs.current.clear();
  }, [annotations]);

  const jumpToAnnotation = useCallback((annotationId: string) => {
    const targetElement = annotationElementRefs.current.get(annotationId);
    if (!targetElement) return;

    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusedAnnotationId(annotationId);
  }, []);

  useEffect(() => {
    if (!focusedAnnotationId) return;

    const timer = window.setTimeout(() => {
      setFocusedAnnotationId((current) => (current === focusedAnnotationId ? null : current));
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [focusedAnnotationId]);

  // ── Render paragraph with annotation spans ─────────────────────────────

  /**
   * Splits a paragraph's raw text into segments:
   * plain text and annotated ranges.
   * Then wraps annotated segments in styled <span> elements.
   */
  function renderAnnotatedParagraph(
    rawText: string,
    displayText: string,
    paraIdx: number
  ): React.ReactNode {
    const paraAnnotations = annotations
      .filter((a) => a.paragraphIndex === paraIdx)
      .sort((a, b) => a.charStart - b.charStart);

    if (paraAnnotations.length === 0) {
      // No annotations — render plain (possibly zhuyin) text
      return displayText;
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
      if (!seg.annotation) {
        return <React.Fragment key={seg.start}>{chars}</React.Fragment>;
      }
      const cfg = TYPE_CONFIG[seg.annotation.type];
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
          title={`${cfg.icon} ${cfg.label} (點擊移除)`}
          onClick={() => removeAnnotation(seg.annotation!.id)}
          role="mark"
          aria-label={`${cfg.label}標記：${chars}`}
          data-annotation-id={seg.annotation.id}
        >
          {chars}
        </span>
      );
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="flex-1 flex flex-col bg-surface overflow-hidden select-none"
      style={{
        fontFamily: fontForZhuyin(isZhuyinAny),
      }}
    >
      {/* ── Two-column layout: article left, panel right ──────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Scrollable article area ───────────────────────────────────── */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto relative pb-44"
          onMouseUp={handleMouseUp}
          onTouchEnd={handleTouchEnd}
          style={{ WebkitUserSelect: 'text', userSelect: 'text' } as React.CSSProperties}
        >
          {/* Instruction banner */}
          <div className="mx-auto max-w-4xl px-6 md:px-16 pt-6 pb-4">
            <div className="rounded-2xl bg-surface-container-low px-5 py-4 text-sm text-on-surface-variant space-y-1">
              <p><span className="font-bold text-on-surface">第一次閱讀</span>：找出不懂的詞語，用 ❓ 標記</p>
              <p><span className="font-bold text-on-surface">第二次閱讀</span>：找出重要的詞語，用 💛 標記</p>
            </div>
          </div>

          {/* Legend pills + counts + undo/clear — floating centered */}
          <div className="flex flex-wrap justify-center items-center gap-3 pt-4 pb-10 px-4">
            <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-full shadow-sm">
              <span className="w-3 h-3 rounded-full bg-red-400" />
              <span className="text-sm font-medium">❓ 不懂</span>
              {summary.unknownCount > 0 && (
                <span className="text-sm font-bold text-tertiary">{summary.unknownCount}</span>
              )}
            </div>
            <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-full shadow-sm">
              <span className="w-3 h-3 rounded-full bg-tertiary-container" />
              <span className="text-sm font-medium">💛 重要</span>
              {summary.importantCount > 0 && (
                <span className="text-sm font-bold text-yellow-800">{summary.importantCount}</span>
              )}
            </div>
            {/* Undo / Clear — always rendered, disabled when no history/annotations */}
            <button
              type="button"
              onClick={undo}
              disabled={undoStack.length === 0}
              aria-label="復原上一步"
              className="px-3 py-2 rounded-full text-sm text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 transition-all"
            >
              ↩ 復原
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={annotations.length === 0}
              aria-label="清除所有標記"
              className="px-3 py-2 rounded-full text-sm text-tertiary hover:bg-tertiary-container/20 disabled:opacity-30 transition-all"
            >
              清除全部
            </button>
          </div>

          {/* Title */}
          <div className="text-center mb-8 px-6">
            <h1 className="font-headline font-medium text-3xl md:text-4xl text-on-surface tracking-tight leading-tight">
              {story.title}
            </h1>
          </div>

          {/* Article paragraphs.
              Images/tables whose captions appear inside paragraphs render inline
              right after the caption row (#1692). Un-referenced assets fall back
              to the strip/table block below the article. */}
          <article className="max-w-4xl mx-auto px-6 md:px-16 space-y-10">
            {story.content.map((rawPara, paraIdx) => {
              const displayText = zhuyinParagraphs?.[paraIdx] ?? rawPara;
              const inlineImgIdx = inlineImageIdxByPara.get(paraIdx);
              const inlineTblIdx = inlineTableIdxByPara.get(paraIdx);
              return (
                <React.Fragment key={paraIdx}>
                  <section className="relative group">
                    {/* Paragraph number — lives outside the [data-para-idx] subtree
                        so its text doesn't inflate selection offsets. */}
                    <span
                      aria-hidden="true"
                      className="absolute -left-8 md:-left-12 top-2 text-sm font-headline font-bold text-on-surface-variant/30 select-none pointer-events-none"
                    >
                      {String(paraIdx + 1).padStart(2, '0')}
                    </span>
                    <p
                      data-para-idx={paraIdx}
                      className="text-on-surface/90"
                      style={{
                        fontSize: `${fontSizePx}px`,
                        lineHeight: isZhuyinAny ? '2.4rem' : '1.6', /* ruby annotations need 2.4rem minimum to avoid clipping */
                        letterSpacing: isZhuyinAny ? '0.15em' : '0',
                      }}
                    >
                      {renderAnnotatedParagraph(rawPara, displayText, paraIdx)}
                    </p>
                  </section>
                  {inlineImgIdx !== undefined && story.images?.[inlineImgIdx] && (
                    <div
                      data-testid={`inline-image-after-para-${paraIdx}`}
                      className="max-w-3xl mx-auto"
                    >
                      <InlineImageCard
                        image={story.images[inlineImgIdx]}
                        lessonCode={story.lesson_code}
                      />
                    </div>
                  )}
                  {inlineTblIdx !== undefined && story.tables?.[inlineTblIdx] && (
                    <div data-testid={`inline-table-after-para-${paraIdx}`}>
                      <InlineTableCard table={story.tables[inlineTblIdx]} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </article>

          {/* Fallback image strip — only un-referenced images (no caption match).
              Preserves G7-L29 behavior where paragraphs reference 圖 N inside body
              sentences but never as standalone caption rows. */}
          {story.layout_mode === 'graphic-text' && fallbackImages.length > 0 && (
            <div
              className="max-w-4xl mx-auto px-6 md:px-16 mt-10 h-72 md:h-80 flex"
              data-testid="reading-annotation-graphic-text-images"
              style={{ WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
            >
              <GraphicTextImageStrip
                images={fallbackImages}
                lessonCode={story.lesson_code}
              />
            </div>
          )}

          {/* Fallback tables — only un-referenced tables. */}
          {fallbackTables.length > 0 && (
            <div
              className="max-w-4xl mx-auto px-6 md:px-16 mt-10"
              data-testid="reading-annotation-tables"
              style={{ WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
            >
              <TableDisplay tables={fallbackTables} layout="stacked" />
            </div>
          )}

          {/* ── Floating selection toolbar ─────────────────────────────── */}
          {toolbar.visible && (
            <div
              ref={toolbarRef}
              role="toolbar"
              aria-label="標記選取文字"
              className="absolute z-50 flex items-center gap-2 bg-surface-container-lowest rounded-2xl shadow-editorial px-3 py-2.5 -translate-x-1/2 -translate-y-full"
              style={{ left: toolbar.x, top: toolbar.y }}
            >
              {(Object.entries(TYPE_CONFIG) as Array<[AnnotationType, typeof TYPE_CONFIG[AnnotationType]]>).map(
                ([type, cfg]) => (
                  <button
                    key={type}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      applyAnnotation(type);
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all min-h-[48px] active:scale-95 ${cfg.activeClass}`}
                  >
                    <span aria-hidden="true">{cfg.icon}</span>
                    {cfg.label}
                  </button>
                )
              )}
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  hideToolbar();
                }}
                className="ml-1 px-3 py-2.5 rounded-xl text-base text-on-surface-variant hover:bg-surface-container-high transition-all min-h-[48px]"
                aria-label="取消"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* ── Right panel: 我的記號 ──────────────────────────────────────── */}
        <aside
          className="hidden md:flex flex-col w-56 shrink-0 border-l border-outline-variant bg-surface-container-low overflow-y-auto"
          aria-label="我的記號清單"
        >
          {/* Panel header */}
          <div className="px-4 pt-5 pb-3">
            <h2 className="font-headline font-bold text-base text-on-surface">我的記號</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              共 <strong>{summary.totalMarks}</strong> 個標記
            </p>
          </div>

          <div className="flex-1 px-3 pb-4 space-y-2">
            {annotationsForPanel.length === 0 ? (
              <p className="text-sm text-on-surface-variant/70 px-1 py-2">還沒有標記</p>
            ) : (
              annotationsForPanel.map(({ annotation, text }) => {
                const cfg = TYPE_CONFIG[annotation.type];
                return (
                  <button
                    key={annotation.id}
                    type="button"
                    onClick={() => jumpToAnnotation(annotation.id)}
                    aria-label={`跳轉到${cfg.label}標記：${text}`}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-all hover:brightness-95 active:scale-[0.98] ${cfg.activeClass}`}
                  >
                    <span aria-hidden="true" className="mr-1">{cfg.icon}</span>
                    {text}
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {/* ── Fixed bottom CTA — gradient fade ─────────────────────────── */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto">
          <button
            type="button"
            onClick={() => onFinish(summary)}
            className="w-full flex items-center justify-center gap-2 h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
          >
            <span>完成標記</span>
            <span className="material-symbols-outlined text-xl">arrow_forward</span>
          </button>
        </div>
      </div>

      {/* Background decoration */}
      <div className="fixed top-40 -left-20 w-64 h-64 bg-accent/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
      <div className="fixed bottom-20 -right-20 w-96 h-96 bg-tertiary-container/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
    </div>
  );
};

export default ReadingAnnotation;
