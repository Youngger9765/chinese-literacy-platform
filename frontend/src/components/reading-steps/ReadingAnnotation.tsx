import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useReducer,
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

// Sub-components and utilities extracted as part of #1855 refactor
import { getSelectionInfo } from './annotationOffsets';
import {
  annotationReducer,
  computeSummary,
  Annotation,
  AnnotationType,
} from './annotationReducer';
import { type AnnotationWithText } from './AnnotationSidePanel';
import AnnotationSidePanel from './AnnotationSidePanel';
import AnnotationToolbar from './AnnotationToolbar';
import AnnotatedParagraph from './AnnotatedParagraph';

// Re-export types for consumers that import from ReadingAnnotation
export type { AnnotationType, Annotation };
export type { AnnotationSummary } from './annotationReducer';

// ── Config ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = (storyId: string) => scopedStepStorageKey('annotations_', storyId);

// A5: localStorage key for first-use onboarding gate
const ANNOTATION_ONBOARDED_KEY = 'annotation_onboarded';

// ── ID generator ───────────────────────────────────────────────────────────

let _idCounter = 0;
function genId(): string {
  return `ann-${Date.now()}-${++_idCounter}`;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface ReadingAnnotationProps {
  story: Story;
  onFinish: (summary: ReturnType<typeof computeSummary>) => void;
  fontSizePx?: number;
}

// ── A5: First-use onboarding coach component ───────────────────────────────

// A5: Detect touch vs mouse for device-appropriate wording
const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

interface OnboardingCoachProps {
  onDismiss: () => void;
}

function OnboardingCoach({ onDismiss }: OnboardingCoachProps) {
  const gestureWord = IS_TOUCH ? '用手指在文字上滑過' : '用滑鼠在文字上拖曳選取';
  return (
    <div className="mx-auto max-w-4xl px-6 md:px-16 pt-4 pb-2">
      <div className="rounded-2xl border-2 border-accent/30 bg-accent/5 px-5 py-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-accent text-2xl flex-shrink-0 mt-0.5">
            {IS_TOUCH ? 'swipe' : 'select_all'}
          </span>
          <div className="flex-1">
            <p className="font-bold text-on-surface text-base mb-1">如何標記詞語？</p>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {gestureWord}，就能標記不懂的詞語。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="self-end px-5 py-2 rounded-full text-sm font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}

// ── A5: Persistent mini hint bar (shown after onboarding is dismissed) ──────

function HintBar() {
  const hint = IS_TOUCH ? '滑過文字即可標記' : '選取文字即可標記';
  return (
    <div className="flex items-center justify-center gap-1.5 py-1 px-3 text-xs text-on-surface-variant/60">
      <span className="material-symbols-outlined text-xs align-middle">
        {IS_TOUCH ? 'touch_app' : 'select_all'}
      </span>
      <span>{hint}</span>
    </div>
  );
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

  // Annotation state managed via reducer
  const [{ annotations, undoStack }, dispatch] = useReducer(annotationReducer, {
    annotations: (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY(story.id));
        return raw ? (JSON.parse(raw) as Annotation[]) : [];
      } catch {
        return [];
      }
    })(),
    undoStack: [],
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

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const annotationElementRefs = useRef(new Map<string, HTMLSpanElement>());
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | null>(null);

  // A5: First-use onboarding — gated by localStorage flag
  const [showCoach, setShowCoach] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(ANNOTATION_ONBOARDED_KEY);
    } catch {
      return true;
    }
  });

  const handleDismissCoach = useCallback(() => {
    setShowCoach(false);
    try {
      localStorage.setItem(ANNOTATION_ONBOARDED_KEY, '1');
    } catch {
      // Storage unavailable — silently ignore
    }
  }, []);

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

  const summary = useMemo(() => computeSummary(annotations), [annotations]);

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

    dispatch({
      type: 'ADD',
      payload: {
        paragraphIndex,
        charStart,
        charEnd,
        annotationType: type,
        newAnnotation: {
          id: genId(),
          paragraphIndex,
          charStart,
          charEnd,
          type,
        },
      },
    });

    // Clear selection
    window.getSelection()?.removeAllRanges();
    hideToolbar();
  }, [toolbar, hideToolbar]);

  // ── Remove annotation on click ─────────────────────────────────────────

  const removeAnnotation = useCallback((id: string) => {
    dispatch({ type: 'REMOVE', payload: { id } });

    if (focusedAnnotationId === id) {
      setFocusedAnnotationId(null);
    }
    annotationElementRefs.current.delete(id);
  }, [focusedAnnotationId]);

  // ── Undo ──────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  // ── Clear all ─────────────────────────────────────────────────────────

  const clearAll = useCallback(() => {
    dispatch({ type: 'CLEAR' });
    setFocusedAnnotationId(null);
    annotationElementRefs.current.clear();
  }, []);

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
          {/* A5: First-use onboarding coach (dismissable, gated by localStorage) */}
          {showCoach ? (
            <OnboardingCoach onDismiss={handleDismissCoach} />
          ) : (
            /* A5: Persistent mini hint bar shown after onboarding is dismissed */
            <HintBar />
          )}

          {/* Instruction banner */}
          <div className="mx-auto max-w-4xl px-6 md:px-16 pt-2 pb-4">
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
                    <AnnotatedParagraph
                      rawText={rawPara}
                      displayText={displayText}
                      paraIdx={paraIdx}
                      annotations={annotations}
                      focusedAnnotationId={focusedAnnotationId}
                      isZhuyinAny={isZhuyinAny}
                      fontSizePx={fontSizePx}
                      annotationElementRefs={annotationElementRefs}
                      onRemoveAnnotation={removeAnnotation}
                    />
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
            <AnnotationToolbar
              x={toolbar.x}
              y={toolbar.y}
              toolbarRef={toolbarRef}
              onApply={applyAnnotation}
              onCancel={hideToolbar}
            />
          )}
        </div>

        {/* ── Right panel: 我的記號 ──────────────────────────────────────── */}
        <AnnotationSidePanel
          summary={summary}
          annotationsForPanel={annotationsForPanel}
          onJump={jumpToAnnotation}
        />
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
