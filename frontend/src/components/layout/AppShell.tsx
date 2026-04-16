/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — standalone immersive shell for /learn/:storyId/* routes.
 * Hides all navigation chrome (Header, Sidebar) to maximise focus.
 * Shows only a minimal glassmorphic top bar with back button, step name,
 * progress dots, and a settings gear.
 */
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { useZhuyin } from '../../context/ZhuyinContext';
import { getMyAssignments } from '../../services/assignmentApi';
import { AppView } from '../../types';
import { ACTIVE_STEPS } from '../../config/stepConfig';
import { useAppView } from '../../hooks/useAppView';
import Header from './Header';
import Sidebar from './Sidebar';
import LearningLayout from '../../layouts/LearningLayout';
import ZhuyinToggle from '../ui/ZhuyinToggle';
import DevSkipButton from '../ui/DevSkipButton';
import { OnboardingWrapper } from '../../pages/app/InlinePages';

/** The authenticated app shell with header + sidebar. */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  const { activeView } = useWorkspace();
  const navigate = useNavigate();

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
    <div className="h-screen flex flex-col bg-surface text-on-surface font-sans overflow-hidden">
      {/* Skip-to-content link — visually hidden until focused (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded focus:font-medium focus:text-sm focus:shadow-lg"
      >
        跳至主要內容
      </a>

      <Header />

      {/* Body: sidebar + main content */}
      <div className="flex-1 flex overflow-hidden">
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
      </div>

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
  const reportStep = ACTIVE_STEPS.find((s) => s.id === 'report');

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

  return (
    <header
      aria-label="學習進度列"
      className="shrink-0 z-30 h-24 flex items-center justify-between px-6 md:px-10"
      style={{ background: 'rgba(251,246,238,0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
    >
      {/* Left: back button */}
      <button
        type="button"
        onClick={handleBack}
        className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors active:scale-90 duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="返回圖書館"
      >
        <span className="material-symbols-outlined text-on-surface text-2xl">arrow_back</span>
      </button>

      {/* Center: step label + hint + progress dots */}
      <div className="flex flex-col items-center gap-1.5 min-w-0">
        {currentStep && (
          <>
            <span className="font-headline font-bold text-base text-accent tracking-wide whitespace-nowrap">
              {currentStep.label} · {currentStepIndex + 1}/{totalSteps}
            </span>
            <span className="text-sm text-on-surface-variant whitespace-nowrap">
              {currentStep.hint}
            </span>
          </>
        )}

        {/* Progress dots — clickable to navigate between steps */}
        <div className="flex items-center gap-1.5" role="navigation" aria-label="學習步驟導航">
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
                className={`w-2.5 h-2.5 rounded-full transition-all hover:scale-150 disabled:cursor-not-allowed disabled:opacity-40 ${dotClass}`}
                title={`${step.label}${isLocked ? '（完成所有階段後解鎖）' : ''}`}
                aria-label={step.label}
                aria-current={isActive ? 'step' : undefined}
              />
            );
          })}
        </div>
      </div>

      {/* Right: zhuyin toggle + settings */}
      <div className="flex items-center">
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
