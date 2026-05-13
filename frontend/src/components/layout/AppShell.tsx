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
import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { useKaraoke } from '../../context/KaraokeContext';
import { getMyAssignments } from '../../services/assignmentApi';
import { AppView } from '../../types';
import { ACTIVE_STEPS } from '../../config/stepConfig';
import { useStepSequence } from '../../hooks/useStepSequence';
import { useAppView } from '../../hooks/useAppView';
import Sidebar from './Sidebar';
import LearningLayout from '../../layouts/LearningLayout';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import DevSkipButton from '../ui/DevSkipButton';
import { OnboardingWrapper } from '../../pages/app/InlinePages';
import { isToolboxMode, setToolboxMode } from '../../services/learningStorageScope';

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

interface StepDotsProps {
  steps: ReturnType<typeof useStepSequence>;
  currentStepIndex: number;
  completedSet: Set<string>;
  allNonReportDone: boolean;
  onStepClick: (step: ReturnType<typeof useStepSequence>[number]) => void;
}

const StepDots: React.FC<StepDotsProps> = ({
  steps,
  currentStepIndex,
  completedSet,
  allNonReportDone,
  onStepClick,
}) => {
  return (
    <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-center min-w-0">
      {steps.map((step, i) => {
        const isCompleted = completedSet.has(step.id);
        const isActive = i === currentStepIndex;
        const isReport = step.id === 'report';
        const isLocked = isReport && !allNonReportDone;

        let dotClass = 'bg-on-surface-variant/20 text-on-surface-variant';
        if (isCompleted) dotClass = 'bg-emerald-500 text-white';
        if (isActive) dotClass = 'bg-accent text-white scale-110';
        const displayChar = step.displayChar ?? String(i + 1);

        return (
          <span key={step.id} className="group relative flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                if (isLocked) return;
                onStepClick(step);
              }}
              disabled={isLocked}
              className={`w-8 h-8 md:w-9 md:h-9 rounded-full text-sm md:text-base font-bold flex items-center justify-center transition-all hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${dotClass}`}
              aria-label={`${i + 1}. ${step.label}${isLocked ? '（完成所有階段後解鎖）' : ''}`}
              aria-current={isActive ? 'step' : undefined}
              title={isLocked ? `${step.label}（完成所有階段後解鎖）` : step.label}
            >
              {isCompleted ? (
                <svg className="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                displayChar
              )}
            </button>
            <span
              role="tooltip"
              className="hidden md:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0"
            >
              <span className="block bg-gray-900 text-white text-sm font-medium px-2.5 py-1 rounded-lg shadow-lg whitespace-nowrap leading-tight">
                {step.label}
              </span>
              <span
                className="block w-0 h-0 mx-auto border-x-4 border-x-transparent border-t-4 border-t-gray-900"
                aria-hidden="true"
              />
            </span>
          </span>
        );
      })}
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
  const { selectedStory, session } = useLearningNav();
  const { zhuyinMode, zhuyinReady, setZhuyinMode } = useZhuyin();
  const { karaokeEnabled, toggleKaraoke } = useKaraoke();

  // #1460 — toolbox mode: single-shot practice from /tools picker.
  // Hide multi-step navigation (dots + arrows) and route the back button
  // to /tools instead of /library.
  const inToolbox = isToolboxMode();

  // Resolve the active step list driven by the current lesson's step_sequence (#1374).
  // Falls back to DEFAULT_STEP_SEQUENCE when lesson has no step_sequence field.
  const activeSteps = useStepSequence(selectedStory ?? null);

  // Find current step index and label
  const currentStepIndex = activeSteps.findIndex((s) => s.view === currentView);
  const currentStep = currentStepIndex >= 0 ? activeSteps[currentStepIndex] : null;
  const totalSteps = activeSteps.length;

  // Determine completed steps
  const completedSet = new Set(session?.completedSteps ?? []);
  const allNonReportDone = activeSteps.filter(s => s.id !== 'report').every(s => completedSet.has(s.id));

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
    // Report only accessible when all other steps done
    if (step.id === 'report' && !allNonReportDone) return;
    navigate(`/learn/${selectedStory.id}/${step.id}`);
  };

  // Issue #1094: prev/next step arrows skip the locked report step
  const prevStep = useMemo(() => {
    for (let i = currentStepIndex - 1; i >= 0; i--) {
      const s = activeSteps[i];
      if (!(s.id === 'report' && !allNonReportDone)) return s;
    }
    return null;
  }, [activeSteps, currentStepIndex, allNonReportDone]);

  const nextStep = useMemo(() => {
    for (let i = currentStepIndex + 1; i < activeSteps.length; i++) {
      const s = activeSteps[i];
      if (!(s.id === 'report' && !allNonReportDone)) return s;
    }
    return null;
  }, [activeSteps, currentStepIndex, allNonReportDone]);

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
          <div className="flex items-center gap-1 max-w-full min-w-0 h-8 md:h-10" role="navigation" aria-label="學習步驟導航">
            <button
              type="button"
              onClick={() => prevStep && handleStepClick(prevStep)}
              disabled={!prevStep || !selectedStory}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={prevStep ? `上一步：${prevStep.label}` : '已是第一步'}
              title={prevStep ? `上一步：${prevStep.label}` : '已是第一步'}
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '28px' }}>chevron_left</span>
            </button>

            <StepDots
              steps={activeSteps}
              currentStepIndex={currentStepIndex}
              completedSet={completedSet}
              allNonReportDone={allNonReportDone}
              onStepClick={handleStepClick}
            />

            <button
              type="button"
              onClick={() => nextStep && handleStepClick(nextStep)}
              disabled={!nextStep || !selectedStory}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-30 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={nextStep ? `下一步：${nextStep.label}` : '已是最後一步'}
              title={nextStep ? `下一步：${nextStep.label}` : '已是最後一步'}
            >
              <span className="material-symbols-outlined leading-none" style={{ fontSize: '28px' }}>chevron_right</span>
            </button>
          </div>
        )}
      </div>

      {/* Right: karaoke toggle + zhuyin toggle */}
      <div className="shrink-0 flex items-center gap-2">
        {selectedStory && (
          <button
            type="button"
            onClick={toggleKaraoke}
            aria-pressed={karaokeEnabled}
            aria-label={karaokeEnabled ? '關閉跟讀' : '開啟跟讀'}
            title={karaokeEnabled ? '關閉跟讀' : '開啟跟讀'}
            className={`relative inline-flex items-center gap-1.5 h-10 pl-3 pr-3 rounded-full font-headline font-bold text-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 active:scale-[0.95] ${
              karaokeEnabled
                ? 'bg-accent text-white shadow-[0_4px_16px_rgba(86,74,191,0.3)]'
                : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            <span className="material-symbols-outlined text-base leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
              {karaokeEnabled ? 'lyrics' : 'lyrics'}
            </span>
            <span className="whitespace-nowrap hidden md:inline">跟讀</span>
          </button>
        )}
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

      {/* Dev-only: skip to next step button — fixed bottom-right on ALL learning steps */}
      <DevSkipButton />
    </div>
  );
};
