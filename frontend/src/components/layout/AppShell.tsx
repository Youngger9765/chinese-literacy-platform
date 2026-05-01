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
import { getMyAssignments } from '../../services/assignmentApi';
import { AppView } from '../../types';
import { ACTIVE_STEPS } from '../../config/stepConfig';
import { useAppView } from '../../hooks/useAppView';
import Sidebar from './Sidebar';
import LearningLayout from '../../layouts/LearningLayout';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import DevSkipButton from '../ui/DevSkipButton';
import { OnboardingWrapper } from '../../pages/app/InlinePages';

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
// ImmersiveTopBar — minimal glassmorphic bar for learning mode
// Shows: ← back | step label (N/total) | progress dots | zhuyin toggle
// ---------------------------------------------------------------------------

const ImmersiveTopBar: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  const { selectedStory, session } = useLearningNav();
  const { zhuyinEnabled, zhuyinReady, toggleZhuyin } = useZhuyin();

  // Find current step index and label
  const currentStepIndex = ACTIVE_STEPS.findIndex((s) => s.view === currentView);
  const currentStep = currentStepIndex >= 0 ? ACTIVE_STEPS[currentStepIndex] : null;
  const totalSteps = ACTIVE_STEPS.length;

  // Determine completed steps
  const completedSet = new Set(session?.completedSteps ?? []);
  const allNonReportDone = ACTIVE_STEPS.filter(s => s.id !== 'report').every(s => completedSet.has(s.id));

  const handleBack = () => {
    if (selectedStory) {
      navigate('/library');
    } else {
      navigate('/student');
    }
  };

  const handleStepClick = (step: typeof ACTIVE_STEPS[number]) => {
    if (!selectedStory) return;
    // Report only accessible when all other steps done
    if (step.id === 'report' && !allNonReportDone) return;
    navigate(`/learn/${selectedStory.id}/${step.id}`);
  };

  // Issue #1094: prev/next step arrows skip the locked report step
  const prevStep = useMemo(() => {
    for (let i = currentStepIndex - 1; i >= 0; i--) {
      const s = ACTIVE_STEPS[i];
      if (!(s.id === 'report' && !allNonReportDone)) return s;
    }
    return null;
  }, [currentStepIndex, allNonReportDone]);

  const nextStep = useMemo(() => {
    for (let i = currentStepIndex + 1; i < ACTIVE_STEPS.length; i++) {
      const s = ACTIVE_STEPS[i];
      if (!(s.id === 'report' && !allNonReportDone)) return s;
    }
    return null;
  }, [currentStepIndex, allNonReportDone]);

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
        aria-label="返回圖書館"
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
                {currentStep.label} {currentStepIndex + 1}/{totalSteps}
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

        {/* Progress dots + left/right arrows (Issue #1094) — tooltip shows step name; arrows fixed-size, dots wrap */}
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

          <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-center min-w-0">
            {ACTIVE_STEPS.map((step, i) => {
              const isCompleted = completedSet.has(step.id);
              const isActive = i === currentStepIndex;
              const isReport = step.id === 'report';
              const isLocked = isReport && !allNonReportDone;

              let dotClass = 'bg-on-surface-variant/20';
              if (isCompleted) dotClass = 'bg-emerald-500';
              if (isActive) dotClass = 'bg-accent scale-125';

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => handleStepClick(step)}
                  disabled={isLocked}
                  className={`w-4 h-4 md:w-5 md:h-5 rounded-full transition-all hover:scale-150 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 ${dotClass}`}
                  title={`${i + 1}. ${step.label}${isLocked ? '（完成所有階段後解鎖）' : ''}`}
                  aria-label={`${i + 1}. ${step.label}`}
                  aria-current={isActive ? 'step' : undefined}
                />
              );
            })}
          </div>

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
      </div>

      {/* Right: zhuyin toggle + settings */}
      <div className="shrink-0 flex items-center">
        {selectedStory && (
          <ZhuyinToggle
            enabled={zhuyinEnabled}
            ready={zhuyinReady}
            onToggle={toggleZhuyin}
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
