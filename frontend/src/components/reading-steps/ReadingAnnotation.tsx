import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { Story } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';

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

const STORAGE_KEY = (storyId: string) => `annotations_${storyId}`;

const TYPE_CONFIG: Record<AnnotationType, { label: string; icon: string; className: string; activeClass: string }> = {
  unknown: {
    label: '不懂',
    icon: '❓',
    className: 'underline decoration-red-500 decoration-2 underline-offset-2',
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
  const { zhuyinActive, processZhuyin } = useZhuyin();

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

  const zhuyinParagraphs = useMemo(() => {
    if (!zhuyinActive) return null;
    return story.content.map((p) => processZhuyin(p));
  }, [story.content, zhuyinActive, processZhuyin]);

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
    let charStart = 0;
    let found = false;
    const walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node === range.startContainer) {
        charStart += range.startOffset;
        found = true;
        break;
      }
      charStart += node.textContent?.length ?? 0;
    }
    if (!found) return null;

    const charEnd = charStart + selectedText.length;

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

    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    // Position toolbar above the selection
    const x = info.rect.left + info.rect.width / 2 - containerRect.left;
    const y = info.rect.top - containerRect.top - 8; // 8px gap above

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

    // Build segments from raw text char offsets, render display text char-by-char
    // NOTE: when zhuyin is active, displayText has different length than rawText.
    // We annotate by raw char positions and render rawText characters
    // (zhuyin adds ruby annotations which we can't easily split here).
    // So when zhuyin is active, we fall back to rendering rawText for annotated paragraphs.
    const textToRender = zhuyinActive ? rawText : displayText;

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
              annotationElementRefs.current.set(seg.annotation.id, element);
            } else {
              annotationElementRefs.current.delete(seg.annotation.id);
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
      className="flex-1 flex flex-col bg-amber-50 overflow-hidden select-none"
      style={{
        fontFamily: zhuyinActive
          ? "'BpmfIansui', 'Iansui', 'Noto Sans TC', sans-serif"
          : "'Iansui', 'Noto Sans TC', sans-serif",
      }}
    >
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <nav
        aria-label="閱讀標記工具列"
        className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3 flex-wrap"
      >
        {/* Story title */}
        <span className="text-sm font-bold text-gray-700 mr-1">{story.title}</span>
        <span className="text-gray-300 text-xs" aria-hidden="true">›</span>
        <span className="text-xs text-amber-700 font-bold">閱讀標記</span>

        <div className="flex-1" />

        {/* Undo */}
        <button
          type="button"
          onClick={undo}
          disabled={undoStack.length === 0}
          aria-label="復原上一步"
          className="px-2.5 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          ↩ 復原
        </button>

        {/* Clear all */}
        <button
          type="button"
          onClick={clearAll}
          disabled={annotations.length === 0}
          aria-label="清除所有標記"
          className="px-2.5 py-1.5 rounded-lg text-sm border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          清除全部
        </button>

      </nav>

      {/* ── Instruction banner ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-amber-100 border-b border-amber-200 px-6 py-3 flex items-start gap-3 text-amber-900">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">📖</span>
        <div className="text-sm leading-relaxed">
          <span className="font-black text-base">選取課文中不太了解的字詞，標記起來</span>
          <div className="mt-0.5 text-amber-800">
            <strong>第一次閱讀</strong>：選取後按 <strong>❓ 不懂</strong> 做記號。
            <strong className="ml-3">第二次閱讀</strong>：選取重要的地方，按 <strong>💛 重要</strong> 標記。
          </div>
        </div>
      </div>

      {/* ── Main text area ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto relative"
          onMouseUp={handleMouseUp}
          onTouchEnd={handleTouchEnd}
          style={{ WebkitUserSelect: 'text', userSelect: 'text' } as React.CSSProperties}
        >
          <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
            {story.content.map((rawPara, paraIdx) => {
              const displayText = zhuyinParagraphs?.[paraIdx] ?? rawPara;
              return (
                <p
                  key={paraIdx}
                  data-para-idx={paraIdx}
                  className="text-gray-900 leading-loose"
                  style={{
                    fontSize: `${fontSizePx}px`,
                    lineHeight: zhuyinActive ? '3.8rem' : '2.8rem',
                    letterSpacing: zhuyinActive ? '0.35em' : '0.05em',
                  }}
                >
                  {renderAnnotatedParagraph(rawPara, displayText, paraIdx)}
                </p>
              );
            })}
          </div>

          {/* ── Floating toolbar — larger for touch ──────────────────────── */}
          {toolbar.visible && (
            <div
              ref={toolbarRef}
              role="toolbar"
              aria-label="標記選取文字"
              className="absolute z-50 flex items-center gap-2 bg-white border-2 border-amber-300 rounded-2xl shadow-2xl px-3 py-2 -translate-x-1/2 -translate-y-full"
              style={{ left: toolbar.x, top: toolbar.y }}
            >
              {(Object.entries(TYPE_CONFIG) as Array<[AnnotationType, typeof TYPE_CONFIG[AnnotationType]]>).map(
                ([type, cfg]) => (
                  <button
                    key={type}
                    type="button"
                    onPointerDown={(e) => {
                      // Use pointerdown so we act before selection is cleared
                      e.preventDefault();
                      applyAnnotation(type);
                    }}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-base font-black border-2 transition-all min-h-[44px] active:scale-95 ${cfg.activeClass}`}
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
                className="ml-1 px-3 py-2 rounded-xl text-base text-gray-400 hover:text-gray-700 border-2 border-gray-200 hover:bg-gray-50 transition-all min-h-[44px]"
                aria-label="取消"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <aside className="w-52 sm:w-60 md:w-72 border-l border-amber-200 bg-white overflow-y-auto">
          <div className="sticky top-0 bg-amber-50 border-b border-amber-200 px-4 py-3">
            <h3 className="text-sm font-black text-amber-900">我的記號</h3>
            <p className="text-xs text-amber-700 mt-1">點擊詞語可跳到課文對應位置</p>
          </div>
          <div className="px-3 py-3 space-y-2">
            {annotationsForPanel.length === 0 ? (
              <p className="text-xs text-gray-400 px-1 py-2">尚未標記詞語</p>
            ) : (
              annotationsForPanel.map(({ annotation, text }, index) => {
                const cfg = TYPE_CONFIG[annotation.type];
                const displayText = text.trim() || '（空白選取）';
                return (
                  <button
                    key={annotation.id}
                    type="button"
                    onClick={() => jumpToAnnotation(annotation.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl border transition-all hover:shadow-sm ${focusedAnnotationId === annotation.id
                      ? 'border-lime-300 bg-lime-50 shadow-[0_0_0_3px_rgba(163,230,53,0.25)]'
                      : 'border-gray-200 bg-white hover:bg-amber-50'}
                    `}
                    aria-label={`跳轉到${cfg.label}標記：${displayText}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-gray-500">#{index + 1}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${annotation.type === 'unknown' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-yellow-50 text-yellow-900 border-yellow-200'}`}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-gray-800 break-all">{displayText}</p>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {/* ── Summary bar + finish button ────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-4">
        {/* Mark count summary — more visual */}
        <div className="flex items-center gap-3">
          {summary.totalMarks === 0 ? (
            <span className="text-sm text-gray-400">（還沒有標記）</span>
          ) : (
            <>
              <span className="text-sm text-gray-600">
                已標記
                <strong className="mx-1 text-lg text-gray-900">{summary.totalMarks}</strong>
                處
              </span>
              {summary.unknownCount > 0 && (
                <span className="flex items-center gap-1 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full text-sm font-bold text-red-700">
                  <span aria-hidden="true">❓</span>
                  {summary.unknownCount}
                </span>
              )}
              {summary.importantCount > 0 && (
                <span className="flex items-center gap-1 bg-yellow-50 border border-yellow-200 px-2.5 py-1 rounded-full text-sm font-bold text-yellow-800">
                  <span aria-hidden="true">💛</span>
                  {summary.importantCount}
                </span>
              )}
            </>
          )}
        </div>

        {/* Finish button */}
        <button
          type="button"
          onClick={() => onFinish(summary)}
          className="px-8 py-3 rounded-xl font-bold text-base bg-accent hover:bg-accent-hover text-white shadow-lg transition-all active:scale-95 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          完成標記
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default ReadingAnnotation;
