import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { Story } from '../../types';
import { PolyphonicProcessor, buildZhuyinString } from '../zhuyin/polyphonicProcessor';
import ZhuyinToggle from '../ui/ZhuyinToggle';

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
  zhuyinActive?: boolean;
  fontSizePx?: number;
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
  zhuyinActive: zhuyinActiveProp,
  fontSizePx = 28,
}) => {
  // Zhuyin state (internal if not controlled via prop)
  const [zhuyinEnabled, setZhuyinEnabled] = useState(true);
  const [zhuyinReady, setZhuyinReady] = useState(false);
  const zhuyinActive = zhuyinActiveProp !== undefined
    ? zhuyinActiveProp
    : (zhuyinReady && zhuyinEnabled);

  // Annotations persisted to localStorage
  const [annotations, setAnnotations] = useState<Annotation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY(story.id));
      return raw ? (JSON.parse(raw) as Annotation[]) : [];
    } catch {
      return [];
    }
  });

  // Active mark tool
  const [activeTool, setActiveTool] = useState<AnnotationType>('unknown');

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

  // Highlighted annotation id (for jump-to animation)
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Side panel visibility (mobile: toggle; desktop: always visible)
  const [panelOpen, setPanelOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Map annotation id → span DOM element for scroll-to
  const annSpanRefs = useRef<Map<string, HTMLElement>>(new Map());

  // ── Zhuyin ─────────────────────────────────────────────────────────────

  useEffect(() => {
    PolyphonicProcessor.instance.loadPolyphonicData()
      .then(() => setZhuyinReady(true))
      .catch((err) => console.error('Failed to load zhuyin data:', err));
  }, []);

  const processZhuyin = useCallback(
    (text: string): string => {
      if (!zhuyinActive) return text;
      try {
        return buildZhuyinString(PolyphonicProcessor.instance.process(text));
      } catch {
        return text;
      }
    },
    [zhuyinActive]
  );

  const zhuyinParagraphs = useMemo(() => {
    if (!zhuyinActive) return null;
    try {
      return story.content.map((p) =>
        buildZhuyinString(PolyphonicProcessor.instance.process(p))
      );
    } catch {
      return null;
    }
  }, [story.content, zhuyinActive]);

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

  // ── Side panel — sorted list of annotations ────────────────────────────

  const sortedAnnotations = useMemo(() =>
    [...annotations].sort((a, b) =>
      a.paragraphIndex !== b.paragraphIndex
        ? a.paragraphIndex - b.paragraphIndex
        : a.charStart - b.charStart
    ),
    [annotations]
  );

  // Derive the display text for a given annotation
  const getAnnotationText = useCallback((ann: Annotation): string => {
    const raw = story.content[ann.paragraphIndex];
    if (!raw) return '';
    return raw.slice(ann.charStart, ann.charEnd);
  }, [story.content]);

  // ── Jump-to annotation ─────────────────────────────────────────────────

  const jumpToAnnotation = useCallback((id: string) => {
    const el = annSpanRefs.current.get(id);
    if (!el) return;

    // Scroll the span into view inside the scroll container
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Flash highlight
    setHighlightedId(id);
    setTimeout(() => setHighlightedId(null), 1500);

    // On mobile: close panel after jump
    setPanelOpen(false);
  }, []);

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

    // Compute char offsets relative to the original paragraph text.
    // Uses the selected text to find its position in the raw paragraph string,
    // avoiding DOM text node offset issues caused by annotation spans.
    const selectedText = range.toString();
    if (!selectedText.trim()) return null;

    const rawParagraph = story.content[paragraphIndex];
    const selStart = rawParagraph.indexOf(selectedText);
    if (selStart < 0) return null; // selected text not found in paragraph

    const charStart = selStart;
    const charEnd = selStart + selectedText.length;

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
    annSpanRefs.current.delete(id);
  }, []);

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
    annSpanRefs.current.clear();
  }, [annotations]);

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
      const ann = seg.annotation;
      const cfg = TYPE_CONFIG[ann.type];
      const isHighlighted = highlightedId === ann.id;
      return (
        <span
          key={ann.id}
          ref={(el) => {
            if (el) {
              annSpanRefs.current.set(ann.id, el);
            } else {
              annSpanRefs.current.delete(ann.id);
            }
          }}
          data-ann-id={ann.id}
          className={`cursor-pointer transition-all duration-300 ${cfg.className} ${
            isHighlighted
              ? 'ring-2 ring-offset-1 ring-indigo-500 rounded scale-105 inline-block animate-pulse'
              : ''
          }`}
          title={`${cfg.icon} ${cfg.label} (點擊移除)`}
          onClick={() => removeAnnotation(ann.id)}
          role="mark"
          aria-label={`${cfg.label}標記：${chars}`}
        >
          {chars}
        </span>
      );
    });
  }

  // ── Side Panel ─────────────────────────────────────────────────────────

  const SidePanel = () => (
    <aside
      aria-label="已標記詞語清單"
      className="flex flex-col bg-white border-l border-gray-200 w-52 flex-shrink-0 overflow-hidden"
    >
      {/* Panel header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
          <span aria-hidden="true">📋</span>
          已標記詞語
        </h2>
        {sortedAnnotations.length > 0 && (
          <span className="text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
            {sortedAnnotations.length}
          </span>
        )}
      </div>

      {/* Panel list */}
      <div className="flex-1 overflow-y-auto">
        {sortedAnnotations.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-400 text-sm leading-relaxed">
            <div className="text-2xl mb-2" aria-hidden="true">✏️</div>
            選取課文文字<br />並標記後<br />會出現在這裡
          </div>
        ) : (
          <ul className="divide-y divide-gray-100" role="list">
            {sortedAnnotations.map((ann) => {
              const text = getAnnotationText(ann);
              const cfg = TYPE_CONFIG[ann.type];
              const isHighlighted = highlightedId === ann.id;
              return (
                <li
                  key={ann.id}
                  className={`group flex items-center gap-2 px-3 py-2.5 transition-colors ${
                    isHighlighted
                      ? 'bg-indigo-50'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {/* Jump button */}
                  <button
                    type="button"
                    onClick={() => jumpToAnnotation(ann.id)}
                    className="flex-1 flex items-start gap-2 text-left min-w-0"
                    aria-label={`跳轉到標記：${text}`}
                    title="點擊跳轉到課文位置"
                  >
                    <span className="flex-shrink-0 text-sm mt-0.5" aria-hidden="true">
                      {cfg.icon}
                    </span>
                    <span
                      className={`text-sm font-medium leading-snug break-all ${
                        ann.type === 'unknown'
                          ? 'text-red-700 underline decoration-red-400 decoration-2 underline-offset-2'
                          : 'text-yellow-800 bg-yellow-100 px-1 rounded'
                      }`}
                    >
                      {text}
                    </span>
                  </button>
                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => removeAnnotation(ann.id)}
                    aria-label={`刪除標記：${text}`}
                    title="刪除此標記"
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 hover:text-red-500 transition-all p-0.5 rounded"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );

  // ── Mobile panel overlay ───────────────────────────────────────────────

  const MobilePanelOverlay = () => (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 lg:hidden"
        onClick={() => setPanelOpen(false)}
        aria-hidden="true"
      />
      {/* Drawer sliding in from right */}
      <div
        className="fixed top-0 right-0 bottom-0 w-64 bg-white z-50 shadow-2xl flex flex-col lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-label="已標記詞語清單"
      >
        {/* Close button */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
            <span aria-hidden="true">📋</span>
            已標記詞語
            {sortedAnnotations.length > 0 && (
              <span className="ml-1 text-xs bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">
                {sortedAnnotations.length}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="關閉標記清單"
            className="text-gray-500 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {sortedAnnotations.length === 0 ? (
            <div className="px-4 py-6 text-center text-gray-400 text-sm leading-relaxed">
              <div className="text-2xl mb-2" aria-hidden="true">✏️</div>
              選取課文文字<br />並標記後<br />會出現在這裡
            </div>
          ) : (
            <ul className="divide-y divide-gray-100" role="list">
              {sortedAnnotations.map((ann) => {
                const text = getAnnotationText(ann);
                const cfg = TYPE_CONFIG[ann.type];
                const isHighlighted = highlightedId === ann.id;
                return (
                  <li
                    key={ann.id}
                    className={`group flex items-center gap-2 px-3 py-3 transition-colors ${
                      isHighlighted ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => jumpToAnnotation(ann.id)}
                      className="flex-1 flex items-start gap-2 text-left min-w-0"
                      aria-label={`跳轉到標記：${text}`}
                    >
                      <span className="flex-shrink-0 text-sm mt-0.5" aria-hidden="true">
                        {cfg.icon}
                      </span>
                      <span
                        className={`text-sm font-medium leading-snug break-all ${
                          ann.type === 'unknown'
                            ? 'text-red-700 underline decoration-red-400 decoration-2 underline-offset-2'
                            : 'text-yellow-800 bg-yellow-100 px-1 rounded'
                        }`}
                      >
                        {text}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAnnotation(ann.id)}
                      aria-label={`刪除標記：${text}`}
                      className="flex-shrink-0 text-gray-400 hover:text-red-500 transition-colors p-0.5 rounded"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="flex-1 flex flex-col h-full bg-amber-50 overflow-hidden select-none"
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

        {/* Tool selector */}
        <div className="flex items-center gap-2" role="group" aria-label="標記類型">
          {(Object.entries(TYPE_CONFIG) as Array<[AnnotationType, typeof TYPE_CONFIG[AnnotationType]]>).map(
            ([type, cfg]) => (
              <button
                key={type}
                type="button"
                onClick={() => setActiveTool(type)}
                aria-pressed={activeTool === type}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                  activeTool === type
                    ? `${cfg.activeClass} border-current`
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span aria-hidden="true">{cfg.icon}</span>
                {cfg.label}
              </button>
            )
          )}
        </div>

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

        {/* Mobile: toggle panel button */}
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          aria-label={`查看已標記詞語（${summary.totalMarks} 個）`}
          className="lg:hidden relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-all"
        >
          <span aria-hidden="true">📋</span>
          標記清單
          {summary.totalMarks > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center bg-[#5B4FC4] text-white text-xs font-black rounded-full">
              {summary.totalMarks}
            </span>
          )}
        </button>

        {/* Zhuyin toggle */}
        {zhuyinActiveProp === undefined && (
          <ZhuyinToggle
            enabled={zhuyinEnabled}
            ready={zhuyinReady}
            onToggle={() => setZhuyinEnabled((v) => !v)}
          />
        )}
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

      {/* ── Body: text area + side panel ───────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Main text area ─────────────────────────────────────────── */}
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
                  className={`text-2xl lg:text-3xl text-gray-900 leading-[3.5rem] lg:leading-[3.5rem] ${zhuyinActive ? 'tracking-[0.4em]' : ''}`}
                >
                  {renderAnnotatedParagraph(rawPara, displayText, paraIdx)}
                </p>
              );
            })}
          </div>

          {/* ── Floating toolbar — larger for touch ──────────────────── */}
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

        {/* ── Desktop side panel (lg+) ────────────────────────────────── */}
        <div className="hidden lg:flex">
          <SidePanel />
        </div>

      </div>

      {/* ── Mobile panel overlay ──────────────────────────────────────── */}
      {panelOpen && <MobilePanelOverlay />}

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
          className="px-8 py-3 rounded-xl font-bold text-base bg-amber-600 hover:bg-amber-700 text-white shadow-lg transition-all active:scale-95 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
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
