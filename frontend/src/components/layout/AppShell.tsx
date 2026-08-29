/**
 * AppShell — the authenticated app chrome (sidebar + main area).
 *
 * LearningAppShell — standalone immersive shell for /learn/:storyId/* routes.
 * Hides all navigation chrome (Sidebar) to maximise focus.
 * Shows only a minimal glassmorphic top bar with back button, step name,
 * progress dots, and a settings gear.
 *
 * Header removed (2026-04-18): all header functionality (logo, story title,
 * notification bell, zhuyin toggle, logout) is now integrated into Sidebar.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useCurrentStepId } from '../../hooks/useCurrentStepId';
import { stepPath } from '../../config/stepPath';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { getMyAssignments } from '../../services/assignmentApi';
import { AppView } from '../../types';
import { ACTIVE_STEPS } from '../../config/stepConfig';
import { useStepSequence } from '../../hooks/useStepSequence';
import { annotateStepParts } from '../../config/roundScope';
import { useAppView } from '../../hooks/useAppView';
import Sidebar from './Sidebar';
import LearningLayout from '../../layouts/LearningLayout';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import DevSkipButton from '../ui/DevSkipButton';
import StepFooterNav from '../reading-steps/StepFooterNav';
import { OnboardingWrapper } from '../../pages/app/InlinePages';
import { isToolboxMode, setToolboxMode } from '../../services/learningStorageScope';
import { stepNeighbours } from '../../config/stepNeighbours';

/** The authenticated app shell with sidebar only (header removed 2026-04-18). */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  const { activeView } = useWorkspace();

  // Pending assignment count for the student nav badge
  const [pendingAssignmentCount, setPendingAssignmentCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    if (!token || activeView !== 'student') return;
    try {
      const assignments = await getMyAssignments(token);
      const count = assignments.filter(
        (a) => a.status === 'pending' || a.status === 'in_progress',
      ).length;
      setPendingAssignmentCount(count);
    } catch {
      // Silently ignore — badge is non-critical
    }
  }, [token, activeView]);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  return (
    <div className="h-screen flex bg-surface text-on-surface font-sans overflow-hidden">
      {/* Skip-to-content link — visually hidden until focused (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded focus:font-medium focus:text-sm focus:shadow-lg"
      >
        跳至主要內容
      </a>

      <Sidebar pendingAssignmentCount={pendingAssignmentCount} />

      <main
        id="main-content"
        role="main"
        aria-label="主要內容"
        className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0"
        tabIndex={-1}
      >
        {children}
      </main>

      {/* Onboarding overlay for first-time students */}
      <Suspense fallback={null}>
        <OnboardingWrapper />
      </Suspense>
    </div>
  );
};

// ---------------------------------------------------------------------------
// StepDots — progress dot row with desktop hover/focus tooltip
// ---------------------------------------------------------------------------

type Step = ReturnType<typeof useStepSequence>[number];

interface StepDotsProps {
  steps: ReturnType<typeof useStepSequence>;
  /** 每一步屬於哪一篇（多篇課才有）；單篇課全部沒有篇次 */
  annotations?: ReturnType<typeof annotateStepParts>;
  currentStepIndex: number;
  completedSet: Set<string>;
  onStepClick: (step: Step) => void;
  /** Prev/next live INSIDE the dot row (#2889) — see NavArrow below. */
  prevStep: Step | null;
  nextStep: Step | null;
  navDisabled: boolean;
}

/**
 * The chevrons sit inside the same flex row as the circles, as its first and
 * last children.
 *
 * They used to be siblings of the scroll box in the header row. That box carried
 * `flex-1`, so at 2000px wide it measured 1648px and the circles centred inside
 * it — leaving the two chevrons pinned to the far edges of the screen with a
 * wide empty gap on either side of the circles. Shrinking the box helped, but
 * only inside the row is the position actually guaranteed: whatever the header
 * width, "next to the first circle" is where the first circle is.
 *
 * Owner: 「直接把上下頁 放到 圈圈 row 內，左右貼合」.
 */
const NavArrow: React.FC<{
  dir: 'prev' | 'next';
  step: Step | null;
  disabled: boolean;
  onClick: (step: Step) => void;
}> = ({ dir, step, disabled, onClick }) => {
  const label = step
    ? `${dir === 'prev' ? '上一步' : '下一步'}：${step.label}`
    : dir === 'prev' ? '已是第一步' : '已是最後一步';
  return (
    <button
      type="button"
      onClick={() => step && onClick(step)}
      disabled={!step || disabled}
      className="shrink-0 w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={label}
      title={label}
    >
      <span className="material-symbols-outlined leading-none text-2xl sm:text-[28px]">
        {dir === 'prev' ? 'chevron_left' : 'chevron_right'}
      </span>
    </button>
  );
};

const StepDots: React.FC<StepDotsProps> = ({
  steps,
  annotations,
  currentStepIndex,
  completedSet,
  onStepClick,
  prevStep,
  nextStep,
  navDisabled,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeEl = container.querySelector('[aria-current="step"]');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentStepIndex, steps.length]);

  // Sized to its content, not flex-1 (#2889). flex-1 made this box eat every
  // spare pixel, so the dots centred inside it while the two chevrons were pushed
  // to the far edges of the header — 「左右的 < > 拉到圈圈左右側，不要離那麼遠」.
  // min-w-0 keeps overflow-x-auto working when the dots are wider than the space.
  return (
    <div
      ref={scrollRef}
      className="min-w-0 max-w-full overflow-x-auto scrollbar-hide overscroll-x-contain"
      aria-label="學習步驟進度"
    >
      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 flex-nowrap justify-center min-w-max px-0.5">
      <NavArrow dir="prev" step={prevStep} disabled={navDisabled} onClick={onStepClick} />
      {steps.map((step, i) => {
        // 多篇課的圈圈原樣重複好幾組，學生只能靠位置猜是哪一篇（#2916 階段 6）。
        // 篇次走 annotateStepParts（帳本 text_ref），跟挑內容同一個來源。
        // 靠 index 對齊 —— 兩個陣列都由 activeSteps 推導，長度必然相同，
        // 但萬一將來有人傳了別的陣列，錯位會是「標籤指到別篇」這種無聲的錯。
        // 比對 id 之後不一致就當作沒有篇次，寧可不標也不要標錯。
        const annAt = annotations?.[i];
        const ann = annAt?.step.id === step.id ? annAt : undefined;
        const isCompleted = completedSet.has(step.id);
        const isActive = i === currentStepIndex;

        let dotClass = 'bg-on-surface-variant/20 text-on-surface-variant';
        if (isCompleted) dotClass = 'bg-emerald-500 text-white';
        if (isActive) dotClass = 'bg-accent text-white ring-2 ring-accent/30';
        const emphasis = step.navEmphasis && !isCompleted;
        if (emphasis && !isActive) dotClass = 'bg-violet-100 text-violet-700 ring-2 ring-violet-400';
        const displayChar = step.displayChar ?? String(i + 1);
        const sizeClass = emphasis
          ? 'w-9 h-9 sm:w-10 sm:h-10 md:w-11 md:h-11'
          : 'w-7 h-7 sm:w-8 sm:h-8 md:w-9 md:h-9';

        return (
          <React.Fragment key={step.id}>
          {ann?.isPartStart && (
            // 篇的起點插一個小標，否則三組一樣的圈圈連在一起分不出邊界。
            // aria-hidden：篇次已經在每一顆的 aria-label 裡，這裡只是視覺。
            <span
              aria-hidden="true"
              className="shrink-0 select-none px-1 text-[10px] sm:text-xs font-bold text-accent/70 border-l border-on-surface-variant/25 pl-1.5 ml-0.5"
            >
              {ann.partNo}
            </span>
          )}
          <span className="group relative flex flex-col items-center justify-center shrink-0">
            <button
              type="button"
              onClick={() => onStepClick(step)}
              className={`${sizeClass} rounded-full text-xs sm:text-sm md:text-base font-bold flex items-center justify-center transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${dotClass}`}
              aria-label={ann?.a11yLabel ?? `${i + 1}. ${step.label}`}
              aria-current={isActive ? 'step' : undefined}
              title={ann?.partNo ? `${step.label}（第 ${ann.partNo} 篇）` : step.label}
            >
              {isCompleted ? (
                <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : emphasis ? (
                <span className="material-symbols-outlined text-[18px] sm:text-[20px] md:text-[22px] leading-none" aria-hidden="true">
                  lightbulb
                </span>
              ) : (
                displayChar
              )}
            </button>
            {emphasis && step.navShortLabel ? (
              <span className={`sm:hidden text-[9px] leading-none mt-0.5 font-semibold ${isActive ? 'text-accent' : 'text-violet-600'}`}>
                {step.navShortLabel}
              </span>
            ) : null}
            <span
              role="tooltip"
              className="hidden md:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0"
            >
              <span className="block bg-gray-900 text-white text-sm font-medium px-2.5 py-1 rounded-lg shadow-lg whitespace-nowrap leading-tight">
                {ann?.partNo ? `${step.label}（第 ${ann.partNo} 篇）` : step.label}
              </span>
              <span
                className="block w-0 h-0 mx-auto border-x-4 border-x-transparent border-t-4 border-t-gray-900"
                aria-hidden="true"
              />
            </span>
          </span>
          </React.Fragment>
        );
      })}
      <NavArrow dir="next" step={nextStep} disabled={navDisabled} onClick={onStepClick} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ImmersiveTopBar — minimal glassmorphic bar for learning mode
// Shows: ← back | step label (N/total) | progress dots | zhuyin toggle
// ---------------------------------------------------------------------------

const ImmersiveTopBar: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  // ⚠️ 比對步驟一律用**帶輪次**的 key（`full-text-annotate#7wavn`）。
  //    `currentView` 只反映路徑段，多文本課三個輪次的路徑段一樣，
  //    於是 `stepNeighbours` 永遠命中第一個同名步驟 ——
  //    active 圓圈與上一步／下一步三輪共用一顆（2026-08-25 staging 實測）。
  const currentStepKey = useCurrentStepId(String(currentView));
  const { selectedStory, session } = useLearningNav();
  const { zhuyinMode, zhuyinReady, setZhuyinMode } = useZhuyin();

  // #1460 — toolbox mode: single-shot practice from /tools picker.
  // Hide multi-step navigation (dots + arrows) and route the back button
  // to /tools instead of /library.
  const inToolbox = isToolboxMode();

  // Resolve the active step list driven by the current lesson's step_sequence (#1374).
  // Falls back to DEFAULT_STEP_SEQUENCE when lesson has no step_sequence field.
  const activeSteps = useStepSequence(selectedStory ?? null);

  // #2905: one helper, so a step this lesson does not have still has neighbours.
  // Both this file and StepFooterNav used to do `findIndex(...)` and treat -1 as
  // "nowhere", which disabled every chevron on e.g. /learn/20011/spotlight.
  const nav = useMemo(
    () => stepNeighbours(activeSteps, currentStepKey),
    [activeSteps, currentStepKey],
  );
  const currentStepIndex = nav.index;
  const currentStep = nav.current;
  // 多篇課才有東西；單篇課回傳的每一項 partNo 都是 undefined（行為與以前一致）
  const stepAnnotations = React.useMemo(
    () => annotateStepParts(activeSteps, selectedStory?.manifestSections),
    [activeSteps, selectedStory?.manifestSections],
  );
  const totalSteps = activeSteps.length;

  // Determine completed steps
  const completedSet = new Set(session?.completedSteps ?? []);

  const handleBack = () => {
    if (inToolbox) {
      setToolboxMode(false);
      navigate('/tools');
      return;
    }
    if (selectedStory) {
      navigate('/library');
    } else {
      navigate('/student');
    }
  };

  const handleStepClick = (step: ReturnType<typeof useStepSequence>[number]) => {
    if (!selectedStory) return;
    navigate(stepPath(selectedStory.id, step.id));
  };

  const { prev: prevStep, next: nextStep } = nav;

  return (
    <header
      aria-label="學習進度列"
      className="shrink-0 z-30 h-16 md:h-20 flex items-center justify-between px-2 md:px-10 gap-2 glass"
    >
      {/* Left: back button */}
      <button
        type="button"
        onClick={handleBack}
        className="shrink-0 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors active:scale-90 duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={inToolbox ? '返回練習工具箱' : '返回圖書館'}
      >
        <span className="material-symbols-outlined text-on-surface text-xl md:text-2xl">arrow_back</span>
      </button>

      {/* Center: 標題+步驟（row 1）/ 提示（row 2, 小字）/ 點點+箭頭（row 3） */}
      <div className="flex-1 min-w-0 flex flex-col items-center gap-0.5">
        {/* Row 1 — 標題 · 步驟 N/total */}
        <div className="flex items-center gap-2 md:gap-3 max-w-full min-w-0 text-sm md:text-base">
          {selectedStory && (
            <span
              className="text-on-surface-variant truncate"
              title={selectedStory.title}
            >
              《{selectedStory.title}》
            </span>
          )}
          {currentStep && (
            <>
              {selectedStory && <span className="text-on-surface-variant/40 shrink-0">·</span>}
              <span className="font-headline font-bold text-accent tracking-wide shrink-0">
                {/* Toolbox mode: single-shot, hide N/total counter (#1460) */}
                {inToolbox ? currentStep.label : `${currentStep.label} ${currentStepIndex + 1}/${totalSteps}`}
              </span>
            </>
          )}
        </div>
        {/* Row 2 — 提示（小字，桌機才顯示） */}
        {currentStep?.hint && (
          <span className="hidden md:inline text-[11px] text-on-surface-variant/70 truncate max-w-full leading-tight">
            {currentStep.hint}
          </span>
        )}

        {/* Progress dots + left/right arrows (Issue #1094).
            Toolbox mode (#1460): hide entirely — single-shot practice has no
            cross-step navigation. Other steps remain unreachable from here. */}
        {!inToolbox && (
          <div className="flex items-center justify-center w-full max-w-full min-w-0 h-8 md:h-10" role="navigation" aria-label="學習步驟導航">
            <StepDots
              steps={activeSteps}
              annotations={stepAnnotations}
              currentStepIndex={currentStepIndex}
              completedSet={completedSet}
              onStepClick={handleStepClick}
              prevStep={prevStep}
              nextStep={nextStep}
              navDisabled={!selectedStory}
            />
          </div>
        )}
      </div>

      {/* Right: zhuyin toggle */}
      <div className="shrink-0 flex items-center gap-2">
        {selectedStory && (
          <ZhuyinToggle
            mode={zhuyinMode}
            ready={zhuyinReady}
            onModeChange={setZhuyinMode}
          />
        )}
      </div>
    </header>
  );
};

/**
 * LearningAppShell — standalone immersive shell for the learning flow.
 *
 * NO Header. NO Sidebar. Just the ImmersiveTopBar + LearningLayout.
 * This maximises screen real estate for learning content and removes
 * all "escape routes" that distract students.
 */
export const LearningAppShell: React.FC = () => {
  const { zhuyinActive } = useZhuyin();
  return (
    <div
      className="h-screen flex flex-col bg-surface text-on-surface font-sans overflow-hidden"
      data-zhuyin-active={zhuyinActive ? 'true' : undefined}
    >
      {/* Skip-to-content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded focus:font-medium focus:text-sm focus:shadow-lg"
      >
        跳至主要內容
      </a>

      {/* Minimal immersive top bar — glassmorphic, no distractions */}
      <ImmersiveTopBar />

      {/* Learning content fills the rest of the screen */}
      <main
        id="main-content"
        role="main"
        aria-label="學習內容"
        className="flex-1 flex flex-col overflow-y-auto"
        tabIndex={-1}
      >
        <LearningLayout />
      </main>

      {/* Persistent bottom nav bar — in-place next/prev step without scroll-to-top (Issue #2082) */}
      <StepFooterNav />

      {/* Dev-only: skip to next step button — fixed bottom-right on ALL learning steps */}
      <DevSkipButton />
    </div>
  );
};
