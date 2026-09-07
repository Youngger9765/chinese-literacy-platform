import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useReducer,
} from 'react';
import { Story } from '../../types';
import { sectionSlugForStep } from '../../config/roundScope';
import TtsDegradedNotice from './TtsDegradedNotice';
import { moduleForStep } from '../../config/stepConfig';
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
import { computeEditorPreMarks, mergeWithStudentAnnotations } from './editorPreMarks';
import { type AnnotationWithText } from './AnnotationSidePanel';
import AnnotationSidePanel from './AnnotationSidePanel';
import AnnotationToolbar from './AnnotationToolbar';
import ReadingPlayer from './ReadingPlayer';
import { useFullTextTtsQueue } from '../../hooks/useFullTextTtsQueue';
import AnnotatedParagraph from './AnnotatedParagraph';
import LessonQrButton from '../qr/LessonQrButton';
import { hasWholeTextToRead, type LessonQrStep } from '../qr/lessonQr';
import StepCoachCard from '../learning/StepCoachCard';
import StepActionBar from '../learning/StepActionBar';

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
  /**
   * 這一節**自己的**代號，QR 印它（#2916）。
   *
   * ⛔ 由頁面傳進來，不在這裡呼叫 `useLocation` —— 葉元件不該知道路由。
   *    一度改成在這裡叫 hook，結果 31 條既有測試（直接 render 不包 Router）
   *    全數炸掉，而那不是測試的問題，是把 routing 依賴放錯了層。
   *    沒傳就退回長網址：能掃的 QR 勝過沒有 QR。
   */
  sectionSlug?: string | null;
  /** 這一頁顯示的不是課文本身（例：訪客的重點段朗讀）。
   *  設為 true 就不拿課號＋段落序號去對照句子 —— 那對定址到的是整課課文的那一段，
   *  重點段根本不在那個索引裡，結果會唸出課文開頭（#2930）。 */
  disableCanonicalMapping?: boolean;
  story: Story;
  /**
   * Which QR code this page should offer, when the caller knows better than
   * this component does (#2886).
   *
   * GuestReadingPage renders THIS component for both 讀全文-做記號 and 重點朗讀
   * — an anonymous visitor never reaches KeyPassageReading — so without this it
   * offered the 全文 code on the 重點 page: button 「QR 全文」, dialog ／全文,
   * file qr-full-*.png. Caught on staging, anonymous, after the signed-in path
   * had already passed; the two paths render different components, so testing
   * one says nothing about the other.
   *
   * `undefined` keeps the ordinary rule (全文, and only for the grades the spec
   * gives one to). `null` hides it — the caller decided there is none.
   */
  qrStep?: LessonQrStep | null;
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
        {/* #2897：這張卡以前是自己畫的紫色版（text-lg 標題、px-6 py-5、text-base 按鈕），
            跟其餘五步的琥珀色教學卡對不起來。改走共用的 StepCoachCard —— 兩段閱讀的說明
            留在 children 裡，那是這一步獨有的內容，不是樣式。 */}
        <StepCoachCard
          title="如何標記詞語？"
          icon={IS_TOUCH ? 'swipe' : 'select_all'}
          className="mb-0"
          onDemo={() => setShowDemo(true)}
          onDismiss={onDismiss}
        >
          <p>{gestureWord}，就能標記不懂的詞語。</p>
          <div className="border-t border-amber-400/40 mt-3 pt-3 space-y-1.5">
            <p>
              <span className="font-bold text-on-surface">第一次閱讀</span>：找出不懂的詞語，用 ❓ 標記
            </p>
            <p>
              <span className="font-bold text-on-surface">第二次閱讀</span>：找出重要的詞語，用 💛 標記
            </p>
          </div>
        </StepCoachCard>
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

// ── A7: 多文本合讀課 — 第 2/3 篇 + 過場字 + 閱讀接力 (#2752 Phase 3) ─────────
//
// A 多文本 lesson prints "一 讀全文-做記號" more than once — one per article.
// The FIRST article already reaches the student through the interactive
// paragraphs above (that data lives in `full_text_annotate.yml`, the same
// module every single-text lesson uses). The REMAINING articles live in
// `multi_text_parts` and had no entry at all.
//
// These render READ-ONLY, not wired into the annotation reducer above:
// `annotationReducer`'s offsets are absolute positions into ONE article, with
// no concept of "which part". Making it part-aware would be a real rewrite of
// the annotation system for the 4 lessons this covers — the module_entry_gate
// bar is "the content reaches the student", not "every interaction the first
// article gets". Marking words on parts 2/3 is a deferred, separately-scoped
// enhancement, not something this lock silently skips: see the ENTRY table
// note in module_entry_gate.py.
function multiTextParagraphText(p: { text: string } | string): string {
  return typeof p === 'string' ? p : p.text;
}

function MultiTextPartSection({ part, index }: { part: NonNullable<Story['multiTextParts']>[number]; index: number }) {
  const paragraphs = part.body?.paragraphs ?? [];
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-16 pt-6">
      <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest px-6 py-5 space-y-3">
        <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">
          第 {index + 2} 篇
        </span>
        {part.lesson_heading && (
          <h3 className="text-lg font-bold text-on-surface">{part.lesson_heading}</h3>
        )}
        <div className="space-y-3">
          {paragraphs.map((p, i) => (
            <p key={i} className="text-base leading-loose text-on-surface">
              {multiTextParagraphText(p)}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// The "now read them together" transition text. Two source shapes coexist
// (title_block/note_line vs heading/text) — both printed, neither invented.
function CrossTextBannerSection({ banner }: { banner: NonNullable<Story['crossTextBanner']> }) {
  const title = banner.title_block?.title ?? banner.heading;
  const body = banner.note_line ?? banner.text;
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-16 pt-6">
      <div className="rounded-2xl border-2 border-accent/30 bg-accent/5 px-6 py-5 space-y-2">
        {title && (
          <p className="text-sm font-bold text-accent uppercase tracking-widest">{title}</p>
        )}
        {body && <p className="text-base text-on-surface whitespace-pre-line">{body}</p>}
      </div>
    </div>
  );
}

// 閱讀接力 (L0144-shape keypointsFollowupQuestions — `items[]`): a check on the
// article just read, then a guiding question into the next one. Same
// self-check reveal pattern as the classical-text steps (#2752 Phase 1) — see
// ClassicalWordMatching.tsx for the precedent.
function ReadingRelaySection({ items, title }: { items: NonNullable<Story['keypointsFollowupQuestions']>['items']; title?: string }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  if (!items || items.length === 0) return null;
  return (
    <div className="max-w-4xl mx-auto px-6 md:px-16 pt-6">
      <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest px-6 py-5 space-y-4">
        <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">
          {title || '閱讀接力'}
        </span>
        {items.map((item, i) => (
          <div key={i} className="space-y-2">
            {item.label && <p className="text-sm font-bold text-on-surface">{item.label}</p>}
            {item.prompt && <p className="text-base text-on-surface">{item.prompt}</p>}
            {item.text && <p className="text-base text-on-surface whitespace-pre-line">{item.text}</p>}
            {item.options && (
              <ul className="pl-4 space-y-1 text-sm text-on-surface-variant">
                {Object.entries(item.options).map(([key, text]) => (
                  <li key={key}>{key}. {text}</li>
                ))}
              </ul>
            )}
            {typeof item.answer !== 'undefined' && (
              revealed[i] ? (
                <p className="text-sm text-accent">答案：{item.answer}</p>
              ) : (
                <button
                  type="button"
                  onClick={() => setRevealed((r) => ({ ...r, [i]: true }))}
                  className="text-sm text-accent hover:brightness-110 transition-colors"
                >
                  顯示答案
                </button>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

const ReadingAnnotation: React.FC<ReadingAnnotationProps> = ({
  sectionSlug: qrSectionSlug,
  disableCanonicalMapping,
  story,
  onFinish,
  fontSizePx = 22,
  dbSessionId = null,
  hideAnnotation = false,
  qrStep,
}) => {
  // QR 實際要指的那一步（訪客頁可以用 `qrStep` 覆寫），再回帳本查它自己的代號。
  //
  // ⚠️ 不能只用「當前步驟」的代號：訪客頁可能停在讀全文卻要給重點的碼。
  // 單篇課帳本只有一列 → 推導得到；多篇課有好幾列 → `sectionSlugForStep` 回 null，
  // 這時才用 `?p=` 從網址傳進來的那個（它才知道是哪一篇）。
  // 這一課有沒有被拆成各篇的步驟：帳本裡讀全文出現兩列以上就是。
  const isSplitIntoParts =
    (story.manifestSections ?? []).filter((x) => x?.module === 'full_text_annotate').length > 1;

  const qrEffectiveStep =
    qrStep === undefined ? (hasWholeTextToRead(story.content) ? 'full-text-annotate' : null) : qrStep;
  const qrCode =
    (qrEffectiveStep
      ? sectionSlugForStep(story.manifestSections, qrEffectiveStep, moduleForStep)
      : null) ?? qrSectionSlug ?? null;
  // Zhuyin state from global context
  const { isZhuyinAny, zhuyinActive, processLinesSelective } = useZhuyin();

  // Whole-lesson playback (#2649). Paragraph-by-paragraph rather than one long
  // clip, so the page knows which paragraph is being read and can carry the
  // reader there. A QR-code visitor never reaches this hook — GuestReadingPage
  // drives its own player off the pre-generated mp3, because the synthesis
  // endpoint this one calls answers 401 without a session.
  const numericLessonId =
    disableCanonicalMapping || !Number.isFinite(Number(story.id))
      ? undefined
      : Number(story.id);
  const reader = useFullTextTtsQueue({
    paragraphs: story.content,
    lessonId: numericLessonId,
    // 一課印好幾篇時，句子對照表要跟著篇次走（#2930）。
    roundSlug: qrSectionSlug ?? undefined,
  });
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

  // ── 編者標 pre-marks (#3026) ───────────────────────────────────────────
  //
  // Deliberately kept OUT of the `annotations` reducer state above: they are
  // never dispatched through ADD/REMOVE/UNDO/CLEAR/INIT, never written to
  // localStorage, never sent to saveAnnotations(). That separation is what
  // keeps 清除全部 / undo / the DB-persisted "this student's marks" record
  // free of content the student never made — a student who clears everything
  // still gets the same pre-marks back on next render, because they are
  // recomputed fresh from `story.vocabulary` + `story.content`, not restored
  // from any saved state. It's also what makes injecting them safe across
  // the DB-hydration INIT above: INIT only ever touches `annotations`
  // (student-only), so a pre-mark can never be overwritten or duplicated by
  // that restore, and restoring on remount cannot resurrect a dismissed one
  // as if it were a saved annotation (dismissal is local-only, see below).
  //
  // 25/179 lessons have no vocab_definitions data — `story.vocabulary` is
  // null/undefined there, computeEditorPreMarks returns [], and the lesson
  // renders exactly as it does today. Not an error, no message.
  const editorPreMarks = useMemo(
    () => computeEditorPreMarks(story.content, story.vocabulary),
    [story.content, story.vocabulary],
  );

  // A student can dismiss an individual pre-mark (BDD: 「學生刪除某個編者標
  // 記，不影響其他學生看到的版本」). Session-local only — not persisted to
  // localStorage or the DB, on purpose: dismissing a reminder is not the
  // same action as making (and therefore owning) a mark, and every other
  // student's pre-marks for this lesson are computed independently from the
  // same static vocabulary data regardless of what happens here.
  const [dismissedPreMarkIds, setDismissedPreMarkIds] = useState<Set<string>>(() => new Set());

  const visibleEditorPreMarks = useMemo(
    () => editorPreMarks.filter((m) => !dismissedPreMarkIds.has(m.id)),
    [editorPreMarks, dismissedPreMarkIds],
  );

  // What AnnotatedParagraph actually renders: the student's own marks plus
  // any pre-marks that survive dismissal AND don't collide with a student
  // mark in the same paragraph (mergeWithStudentAnnotations drops those —
  // see its doc for why). `annotations` itself (student-only) stays the
  // source of truth everywhere else below: summary counts, the side panel,
  // undo, clear-all, localStorage, and the DB save.
  const renderAnnotations = useMemo(
    () => mergeWithStudentAnnotations(annotations, visibleEditorPreMarks),
    [annotations, visibleEditorPreMarks],
  );

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
  //
  // #3026: a click can land on either a student's own mark or an editor
  // pre-mark, and the two go through completely different paths — a
  // pre-mark's id is NEVER passed to `dispatch`, because it was never added
  // via `dispatch` in the first place (see editorPreMarks block above). Look
  // it up against the full (not dismissal-filtered) `editorPreMarks` list —
  // not the merged render list — so this stays correct even for a paragraph
  // where mergeWithStudentAnnotations already dropped the pre-mark for
  // overlapping a student mark elsewhere.
  const removeAnnotation = useCallback((id: string) => {
    if (editorPreMarks.some((m) => m.id === id)) {
      setDismissedPreMarkIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      annotationElementRefs.current.delete(id);
      return;
    }

    dispatch({ type: 'REMOVE', payload: { id } });

    if (focusedAnnotationId === id) {
      setFocusedAnnotationId(null);
    }
    annotationElementRefs.current.delete(id);
  }, [focusedAnnotationId, editorPreMarks]);

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

  // #3022: the zhuyin font used to sit on THIS wrapper, gated on isZhuyinAny
  // (true for 'difficult' too). BpmfZihiSerif/BpmfIansui renders bopomofo for
  // every character it draws, so that annotated the whole page -- the legend
  // pills, onboarding coach, undo/clear buttons, "還沒有標記" side panel --
  // any interface text sharing this container, not just the article text.
  // The font now lives only on <article> below (title + paragraphs), and
  // only for 'all' mode (zhuyinActive); 'difficult' mode applies it per-run
  // via renderDifficultAwareText inside AnnotatedParagraph instead.
  return (
    <div
      className="flex-1 flex flex-col bg-surface overflow-hidden select-none"
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

          {/* Whole-lesson player — 訪客（掃 QR 進來的）專用位置。
              #2941 把登入學生的播放鍵搬到底部動作列，跟「完成標記」並排：
              放在文章上方的話，學生一往下讀就把它捲出畫面，讀到第二段想聽
              就得先捲回頂端。訪客頁留在這裡，因為 `GuestReadingPage` 沒有
              底部 `StepFooterNav`，那條固定動作列會浮在半空中；訪客也沒有
              「完成標記」可並排（#2649：不能標記，但要能聽）。 */}
          {hideAnnotation && (
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
            {/* #2886: the QR for THIS page, so a teacher can hand it out in
                class without opening the admin panel. 有課文就有碼 —— 判準是
                資料不是年級（#3011），見 docs/requirements/reading-demo-audio-qr.md R1。*/}
            {(qrStep === undefined ? (hasWholeTextToRead(story.content) ? 'full-text-annotate' : null) : qrStep) && (
              <LessonQrButton
                lessonId={story.id}
                step={(qrStep ?? 'full-text-annotate') as LessonQrStep}
                lessonTitle={story.title}
              sectionSlug={qrCode}
              />
            )}
          </div>

          {/* Title */}
          <div className="text-center mb-8 px-6">
            {/* #3022: the title used to sit inside the page-wide font scope, so
                'all' mode annotated it. Narrowing that scope to <article> below
                dropped the title out of it -- restore it explicitly here rather
                than let 'all' mode quietly lose the heading. Still gated on
                zhuyinActive, so 'difficult' does NOT blanket-annotate it. */}
            <h1
              className="font-headline font-medium text-3xl md:text-4xl text-on-surface tracking-tight leading-tight"
              style={{ fontFamily: fontForZhuyin(zhuyinActive) }}
            >
              {story.title}
            </h1>
          </div>

          {/* Article paragraphs.
              Images/tables whose captions appear inside paragraphs render inline
              right after the caption row (#1692). Un-referenced assets fall back
              to the strip/table block below the article. */}
          <div className={story.layout_mode === 'graphic-text' && fallbackImages.length > 0 ? 'flex flex-col lg:flex-row items-start' : undefined}>
            <article
              className={story.layout_mode === 'graphic-text' && fallbackImages.length > 0 ? 'flex-1 min-w-0 px-6 md:px-12 space-y-10' : 'max-w-4xl mx-auto px-6 md:px-16 space-y-10'}
              style={{ fontFamily: fontForZhuyin(zhuyinActive) }}
            >
            {/* 降級成機器音時要說出來 —— 少了它，聽到的人不知道那不是 AI（#2930）。 */}
            {reader.isTtsDegraded && <TtsDegradedNotice className="mb-4" />}
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
                      annotations={renderAnnotations}
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

          {/* A7: 多文本合讀課的第 2/3 篇 + 過場字 + 閱讀接力 (#2752 Phase 3).
              Read-only — see the comment on MultiTextPartSection above for why. */}
          {/* ⛔ 已經拆成各篇步驟的課**不要**再整份重畫（#2916）。
              帳本有兩列以上讀全文 = 這一課的每一篇各自是一個步驟，
              學生停在第 1 篇時再把第 2、3 篇貼在下面，就是同一份內容出現兩次。
              2026-08-25 owner 截圖：第 1 篇的讀全文往下捲出現「第 2 篇 第23課」。
              沒拆的舊課維持原本行為（一頁到底）—— 那是 #2752 的設計。 */}
          {!isSplitIntoParts && story.multiTextParts?.map((part, i) => (
            <MultiTextPartSection key={i} part={part} index={i} />
          ))}
          {story.keypointsFollowupQuestions?.items && (
            <ReadingRelaySection
              items={story.keypointsFollowupQuestions.items}
              title={story.keypointsFollowupQuestions.section_name_printed}
            />
          )}
          {story.crossTextBanner && <CrossTextBannerSection banner={story.crossTextBanner} />}

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
          {/* #2941: 播放全文跟完成標記並排在這裡。兩顆都是這一步隨時要按得到的
              動作，而底部這條是唯一永遠在畫面上的地方。 */}
      <StepActionBar layout="row">
          <ReadingPlayer
            size="lg"
            isPlaying={reader.isPlaying}
            isPaused={reader.isPaused}
            onPlay={reader.play}
            onPause={reader.pause}
            onResume={reader.resume}
            onStop={reader.stop}
          />
          <button
            type="button"
            onClick={() => onFinish(summary)}
            /* w-44 / h-14 跟播放全文那顆一模一樣（`ReadingPlayer` size="lg"）——
               owner 2026-08-26：「兩個按鈕的大小要一樣並且置中」。 */
            className="w-44 h-14 flex items-center justify-center gap-2 rounded-full font-headline font-bold text-xl text-white whitespace-nowrap shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
          >
            <span>完成標記</span>
            <span className="material-symbols-outlined text-xl">arrow_forward</span>
          </button>
      </StepActionBar>
        </>
      )}

      {/* Background decoration */}
      <div className="fixed top-40 -left-20 w-64 h-64 bg-accent/5 rounded-full blur-[100px] -z-10 pointer-events-none" />
      <div className="fixed bottom-20 -right-20 w-96 h-96 bg-tertiary-container/5 rounded-full blur-[120px] -z-10 pointer-events-none" />
    </div>
  );
};

export default ReadingAnnotation;
