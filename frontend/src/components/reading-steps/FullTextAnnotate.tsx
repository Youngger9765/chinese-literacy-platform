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
import { loadAnnotations, saveAnnotations } from '../../services/learning/annotationApi';
import type { AnnotationPayload } from '../../services/learning/annotationApi';
import { fontForZhuyin } from '../../constants/fonts';
import GraphicTextImageStrip from './GraphicTextImageStrip';
import TableDisplay from './TableDisplay';
import InlineImageCard from './InlineImageCard';
import InlineTableCard from './InlineTableCard';
import {
  detectImageMarker,
  detectTableMarker,
  detectTableBodyMarker,
  resolveImageIndex,
  resolveTableIndex,
} from '../../utils/paragraphMarkers';

// Sub-components and utilities extracted as part of #1855 refactor
import { getSelectionInfo, stripPUASelectors } from './annotationOffsets';
import {
  annotationReducer,
  computeSummary,
  Annotation,
  AnnotationType,
} from './annotationReducer';
import { type AnnotationWithText } from './AnnotationSidePanel';
import AnnotationSidePanel from './AnnotationSidePanel';
import AnnotationToolbar from './AnnotationToolbar';
import ReadingPlayer from './ReadingPlayer';
import { useFullTextTtsQueue } from '../../hooks/useFullTextTtsQueue';
import AnnotatedParagraph from './AnnotatedParagraph';

// Re-export types for consumers that import from ReadingAnnotation
export type { AnnotationType, Annotation };
export type { AnnotationSummary } from './annotationReducer';

// ── Config ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = (storyId: string) => scopedStepStorageKey('annotations_', storyId);

function loadAnnotationsWithFallback(storyId: string): Annotation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(storyId));
    return raw ? (JSON.parse(raw) as Annotation[]) : [];
  } catch {
    return [];
  }
}

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
  /** DB session id — when provided, annotations are persisted to and loaded from DB. */
  dbSessionId?: number | null;
  /**
   * Hide every annotating affordance (#2649). Set for a QR-code visitor who has
   * no account: a mark has to belong to somebody. Removed rather than disabled —
   * a greyed-out button reads as "broken", an absent one reads as "not part of
   * this page".
   *
   * Named for what it hides, not for the visitor. It used to be `hideAnnotation`, and
   * that name quietly took the player down with the annotations: the guest page
   * then needed its own audio, which drifted from the signed-in one within days.
   * Listening is not annotating, so it is not covered by this flag.
   */
  hideAnnotation?: boolean;
}

// ── A5: First-use onboarding coach component ───────────────────────────────

// A5: Detect touch vs mouse for device-appropriate wording
const IS_TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

// ── Demo overlay: animated drag illustration ───────────────────────────────

function DemoOverlay({ onClose }: { onClose: () => void }) {
  return (
    <>
      <style>{`
        @keyframes ra-demo-highlight {
          0%   { width: 0px;   opacity: 0; }
          15%  { opacity: 1; }
          60%  { width: 210px; opacity: 0.75; }
          85%  { width: 210px; opacity: 0.75; }
          100% { width: 0px;   opacity: 0; }
        }
        @keyframes ra-demo-cursor {
          0%   { left: 12px; }
          60%  { left: 222px; }
          85%  { left: 222px; }
          100% { left: 12px; }
        }
      `}</style>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(3px)' }}
        onClick={onClose}
      >
        <div
          className="relative bg-white rounded-2xl shadow-2xl px-8 py-7 max-w-md w-full mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-lg font-bold text-on-surface mb-4 text-center">示範：如何拖曳標記</p>

          {/* Animated demo area */}
          <div className="relative rounded-xl bg-surface-container-low px-4 py-5 mb-5 overflow-hidden select-none" style={{ minHeight: '72px' }}>
            <p className="text-base leading-relaxed text-on-surface">
              孟嘗君是有錢的貴族，最讓人津津樂道。
            </p>
            {/* Animated yellow highlight */}
            <span
              className="absolute rounded pointer-events-none bg-yellow-300/70"
              style={{
                animation: 'ra-demo-highlight 2.4s ease-in-out infinite',
                top: '50%',
                height: '28px',
                left: '12px',
                transform: 'translateY(-50%)',
                width: 0,
              }}
            />
            {/* Animated cursor emoji */}
            <span
              className="absolute pointer-events-none"
              style={{
                animation: 'ra-demo-cursor 2.4s ease-in-out infinite',
                top: '50%',
                transform: 'translateY(-60%)',
                fontSize: '20px',
                lineHeight: 1,
              }}
            >
              🖱️
            </span>
          </div>

          <p className="text-base text-on-surface-variant text-center mb-5">
            {IS_TOUCH ? '用手指在文字上滑過' : '用滑鼠在文字上拖曳選取'}，即可標記詞語
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-full text-base font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
          >
            我知道了，開始標記！
          </button>
        </div>
      </div>
    </>
  );
}

// ── Unified onboarding coach (merged instructions + demo) ─────────────────

interface OnboardingCoachProps {
  onDismiss: () => void;
}

function OnboardingCoach({ onDismiss }: OnboardingCoachProps) {
  const [showDemo, setShowDemo] = useState(false);
  const gestureWord = IS_TOUCH ? '用手指在文字上滑過' : '用滑鼠在文字上拖曳選取';

  // Bug fix (#2154): closing the demo overlay must NOT dismiss the coach box.
  // onDismiss() writes to localStorage and hides the coach permanently — that
  // should only happen when the user explicitly clicks "我知道了" in the coach.
  const handleDemoClose = () => {
    setShowDemo(false);
  };

  return (
    <>
      {showDemo && <DemoOverlay onClose={handleDemoClose} />}
      <div className="mx-auto max-w-4xl px-6 md:px-16 pt-4 pb-2">
        <div className="rounded-2xl border-2 border-accent/30 bg-accent/5 px-6 py-5 flex flex-col gap-4">

          {/* How-to header */}
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-accent text-3xl flex-shrink-0 mt-0.5">
              {IS_TOUCH ? 'swipe' : 'select_all'}
            </span>
            <div className="flex-1">
              <p className="font-bold text-on-surface text-lg mb-1">如何標記詞語？</p>
              <p className="text-base text-on-surface-variant leading-relaxed">
                {gestureWord}，就能標記不懂的詞語。
              </p>
            </div>
          </div>

          {/* Reading round instructions (merged from grey banner) */}
          <div className="border-t border-accent/20 pt-3 space-y-2">
            <p className="text-base text-on-surface-variant">
              <span className="font-bold text-on-surface">第一次閱讀</span>：找出不懂的詞語，用 ❓ 標記
            </p>
            <p className="text-base text-on-surface-variant">
              <span className="font-bold text-on-surface">第二次閱讀</span>：找出重要的詞語，用 💛 標記
            </p>
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 justify-end">
            <button
              type="button"
              onClick={() => setShowDemo(true)}
              className="px-5 py-2 rounded-full text-base font-bold text-accent border-2 border-accent hover:bg-accent/10 active:scale-[0.98] transition-all"
            >
              示範
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-5 py-2 rounded-full text-base font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
            >
              我知道了
            </button>
          </div>
        </div>
      </div>
    </>
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

// ── A6: 讀前自我檢核 banner (#2752 Phase 2) ─────────────────────────────────
//
// The worksheet's own self-check checklist for 大題一 (讀全文-做記號), printed
// unnumbered right before this section starts. Distinct from OnboardingCoach
// above: OnboardingCoach is a generic, dismissible, one-time tutorial on HOW
// to use the drag-to-mark interaction; this is the worksheet's own per-lesson
// CONTENT (what to specifically check for), shown every time like the printed
// page — not dismissed, not paraphrased. Present for 58/175 lessons.
function SelfCheckBeforeReadingBanner({
  instruction,
  items,
}: {
  instruction?: string;
  items: string[];
}) {
  return (
    <div className="mx-auto max-w-4xl px-6 md:px-16 pt-4">
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 px-6 py-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-700 text-xl" aria-hidden="true">
            checklist
          </span>
          <span className="text-xs font-bold text-amber-800 uppercase tracking-widest">讀前自我檢核</span>
        </div>
        {instruction && <p className="text-sm text-amber-800">{instruction}</p>}
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-on-surface">
              <span className="text-amber-600 mt-0.5" aria-hidden="true">☐</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

const ReadingAnnotation: React.FC<ReadingAnnotationProps> = ({
  story,
  onFinish,
  fontSizePx = 22,
  dbSessionId = null,
  hideAnnotation = false,
}) => {
  // Zhuyin state from global context
  const { isZhuyinAny, processLinesSelective } = useZhuyin();

  // Whole-lesson playback (#2649). Paragraph-by-paragraph rather than one long
  // clip, so the page knows which paragraph is being read and can carry the
  // reader there. A QR-code visitor never reaches this hook — GuestReadingPage
  // drives its own player off the pre-generated mp3, because the synthesis
  // endpoint this one calls answers 401 without a session.
  const numericLessonId = Number.isFinite(Number(story.id)) ? Number(story.id) : undefined;
  const reader = useFullTextTtsQueue({ paragraphs: story.content, lessonId: numericLessonId });
  const paragraphRefs = useRef<Record<number, HTMLElement | null>>({});

  // Scroll the paragraph being read into view. `nearest` rather than `center`
  // so a paragraph already on screen doesn't yank the page under the reader.
  useEffect(() => {
    const idx = reader.currentParagraphIdx;
    if (idx === null || idx === undefined) return;
    paragraphRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [reader.currentParagraphIdx]);
  const vocabWords = useMemo(
    () => (story.vocabulary ?? []).map((v) => v.word).filter(Boolean),
    [story.vocabulary]
  );

  // Annotation state managed via reducer.
  // Initial state comes from localStorage (sync, immediate).
  // A DB load runs after mount to replace/merge with the authoritative DB copy.
  const [{ annotations, undoStack }, dispatch] = useReducer(annotationReducer, {
    annotations: loadAnnotationsWithFallback(String(story.id)),
    undoStack: [],
  });

  // DB-sync tracking: true once the initial DB load finishes.
  // Using useState (not ref) so the save effect re-runs when hydration completes —
  // this fixes the race where an annotation made before hydration would be silently
  // skipped (the ref-only version's guard would have already returned early and
  // no timer would be set, leaving the annotation in localStorage but not in DB).
  const [dbHydrated, setDbHydrated] = useState(false);
  // Debounce timer ref for DB saves
  const dbSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Persist annotations (localStorage — always, for offline cache) ────────

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY(story.id), JSON.stringify(annotations));
    } catch {
      // Storage full — ignore
    }
  }, [annotations, story.id]);

  // ── Load annotations from DB on mount (#2070) ────────────────────────────
  // DB is the source of truth; localStorage is the offline/pre-load cache.
  // On first load: if DB has annotations, replace localStorage snapshot.
  // If DB has none but localStorage does, we keep the localStorage version
  // (student might be offline or using a fresh DB session).

  useEffect(() => {
    if (!dbSessionId) {
      setDbHydrated(true); // no DB available — treat as hydrated immediately
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dbAnnotations = await loadAnnotations(dbSessionId);
        if (cancelled) return;
        if (dbAnnotations.length > 0) {
          // DB has annotations — hydrate reducer with DB copy
          dispatch({ type: 'INIT', payload: { annotations: dbAnnotations.map((r) => ({
            id: r.client_id ?? String(r.id),
            paragraphIndex: r.paragraph_index,
            charStart: r.char_start,
            charEnd: r.char_end,
            type: r.annotation_type as Annotation['type'],
          })) } });
        }
        // else: keep localStorage snapshot as-is (DB is empty, likely fresh session)
      } catch (err) {
        // DB load failed — silently keep localStorage data; log for debugging
        console.warn('[ReadingAnnotation] DB load failed, using localStorage fallback:', err);
      } finally {
        // setDbHydrated(true) triggers the save effect to re-evaluate — this ensures
        // any annotation the student made during the DB load window is saved to DB.
        if (!cancelled) setDbHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSessionId]); // run once per session

  // ── Debounced DB save on annotation change (#2070) ───────────────────────
  // Only runs after DB hydration to avoid saving the localStorage snapshot back.

  useEffect(() => {
    if (!dbSessionId || !dbHydrated) return;

    // Clear any pending save
    if (dbSaveTimerRef.current) clearTimeout(dbSaveTimerRef.current);

    dbSaveTimerRef.current = setTimeout(async () => {
      try {
        const payload: AnnotationPayload[] = annotations.map((ann) => ({
          paragraph_index: ann.paragraphIndex,
          char_start: ann.charStart,
          char_end: ann.charEnd,
          annotation_type: ann.type as 'unknown' | 'important',
          client_id: ann.id,
        }));
        await saveAnnotations(dbSessionId, payload);
      } catch (err) {
        // Save failed (offline, token expired, etc.) — localStorage copy survives
        console.warn('[ReadingAnnotation] DB save failed:', err);
      }
    }, 800); // 800 ms debounce — balances responsiveness vs write frequency

    return () => {
      if (dbSaveTimerRef.current) clearTimeout(dbSaveTimerRef.current);
    };
  }, [annotations, dbSessionId, dbHydrated]);

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
    // Pass 1 — dedicated caption rows (`圖N …` / `表N …`) are the strongest anchor.
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
    // Pass 2 — for any table not anchored by a caption row, fall back to the
    // body paragraph that introduces it (`表N比較了…`). Keeps tables inline at
    // their reference point after #2218 stripped the `表N …` caption rows from
    // paragraphs (regression: tables dropped to the bottom-of-article fallback).
    // Only the FIRST intro sentence per table anchors it; a paragraph already
    // carrying an inline table (caption row) is skipped to avoid stacking.
    story.content.forEach((para, paraIdx) => {
      if (tblMap.has(paraIdx)) return;
      const tblN = detectTableBodyMarker(para);
      if (tblN === null) return;
      const tblIdx = resolveTableIndex(story.tables, tblN);
      if (tblIdx !== null && !usedTbl.has(tblIdx)) {
        tblMap.set(paraIdx, tblIdx);
        usedTbl.add(tblIdx);
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
        // charStart/charEnd are RAW char offsets (PUA Variation Selectors stripped
        // by getSelectionInfo). Lesson YAML embeds PUA selectors in the paragraph
        // text, so slice the PUA-stripped paragraph — otherwise the panel word
        // drifts left (e.g. 孟嘗君 → 投奔孟). AnnotatedParagraph already strips; this
        // is the side-panel consumer that #2155 missed. (#2165)
        const paragraph = stripPUASelectors(story.content[annotation.paragraphIndex] ?? '');
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
          onMouseUp={hideAnnotation ? undefined : handleMouseUp}
          onTouchEnd={hideAnnotation ? undefined : handleTouchEnd}
          style={{ WebkitUserSelect: 'text', userSelect: 'text' } as React.CSSProperties}
        >
          {/* A5: First-use onboarding coach (dismissable, gated by localStorage) */}
          {!hideAnnotation && (showCoach ? (
            <OnboardingCoach onDismiss={handleDismissCoach} />
          ) : (
            /* A5: Persistent mini hint bar shown after onboarding is dismissed */
            <HintBar />
          ))}

          {/* A6: 讀前自我檢核 (#2752 Phase 2) — the worksheet's own checklist,
              not gated by hideAnnotation (it's read-only content, not an
              annotate affordance a QR-code guest visitor shouldn't have). */}
          {story.selfCheckBeforeReading && story.selfCheckBeforeReading.items.length > 0 && (
            <SelfCheckBeforeReadingBanner
              instruction={story.selfCheckBeforeReading.instruction}
              items={story.selfCheckBeforeReading.items}
            />
          )}

          {/* Whole-lesson player. Sits above the legend so it's the first control
              on the page — listening is what a lot of students come here to do. */}
          {(
            <div className="flex justify-center pt-4">
              <ReadingPlayer
                isPlaying={reader.isPlaying}
                isPaused={reader.isPaused}
                onPlay={reader.play}
                onPause={reader.pause}
                onResume={reader.resume}
                onStop={reader.stop}
              />
            </div>
          )}

          {/* Legend pills + counts + undo/clear — floating centered */}
          <div className="flex flex-wrap justify-center items-center gap-3 pt-4 pb-10 px-4">
            <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-full shadow-sm">
              <span className="text-sm font-medium">❓ 不懂</span>
              {summary.unknownCount > 0 && (
                <span className="text-sm font-bold text-tertiary">{summary.unknownCount}</span>
              )}
            </div>
            <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-full shadow-sm">
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
          <div className={story.layout_mode === 'graphic-text' && fallbackImages.length > 0 ? 'flex flex-col lg:flex-row items-start' : undefined}>
            <article className={story.layout_mode === 'graphic-text' && fallbackImages.length > 0 ? 'flex-1 min-w-0 px-6 md:px-12 space-y-10' : 'max-w-4xl mx-auto px-6 md:px-16 space-y-10'}>
            {story.content.map((rawPara, paraIdx) => {
              const displayText = zhuyinParagraphs?.[paraIdx] ?? rawPara;
              const inlineImgIdx = inlineImageIdxByPara.get(paraIdx);
              const inlineTblIdx = inlineTableIdxByPara.get(paraIdx);
              return (
                <React.Fragment key={paraIdx}>
                  <section
                    ref={(el) => { paragraphRefs.current[paraIdx] = el; }}
                    data-reading-active={reader.currentParagraphIdx === paraIdx ? 'true' : undefined}
                    className={`relative group rounded-lg transition-colors duration-300 ${
                      reader.currentParagraphIdx === paraIdx ? 'bg-accent/[0.07]' : ''
                    }`}
                  >
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
                Graphic-text: renders as sticky right column alongside article.
                Preserves G7-L29 behavior where paragraphs reference 圖 N inside body
                sentences but never as standalone caption rows. */}
            {story.layout_mode === 'graphic-text' && fallbackImages.length > 0 && (
              <aside
                className="w-full mt-8 lg:mt-0 lg:w-80 lg:shrink-0 lg:border-l border-outline-variant/20 lg:pl-4 lg:sticky lg:top-0 lg:h-[calc(100vh-5rem)] overflow-hidden"
                data-testid="reading-annotation-graphic-text-images"
                style={{ WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties}
              >
                <GraphicTextImageStrip
                  images={fallbackImages}
                  lessonCode={story.lesson_code}
                />
              </aside>
            )}
          </div>

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
          {!hideAnnotation && toolbar.visible && (
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
        {!hideAnnotation && (
          <AnnotationSidePanel
            summary={summary}
            annotationsForPanel={annotationsForPanel}
            onJump={jumpToAnnotation}
          />
        )}
      </div>

      {!hideAnnotation && (
        <>
          {/* ── Fixed bottom CTA — gradient fade ─────────────────────────── */}
      <div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
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
        </>
      )}

      {/* Background decoration */}
      <div className="fixed top-40 -left-20 w-64 h-64 bg-accent/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
      <div className="fixed bottom-20 -right-20 w-96 h-96 bg-tertiary-container/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
    </div>
  );
};

export default ReadingAnnotation;
