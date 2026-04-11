/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — thin wrapper that puts LearningLayout inside AppShell,
 * used for all /learn/:storyId/* routes. Supports three nav modes:
 *   classic — horizontal StepperNav top bar (default)
 *   world   — gamified WorldMap left sidebar (#1049)
 *   phases  — 3-phase accordion sidebar (#1048)
 */
import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { getMyAssignments } from '../../services/assignmentApi';
import { AppView } from '../../types';
import { VIEW_TO_PATH, ACTIVE_STEPS } from '../../config/stepConfig';
import { useAppView } from '../../hooks/useAppView';
import Header from './Header';
import Sidebar from './Sidebar';
import LearningLayout from '../../layouts/LearningLayout';
import StepperNav from '../StepperNav';
import WorldMap from '../ui/WorldMap';
import LearningPhases from '../ui/LearningPhases';
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

  const handleStepperNavigate = (view: AppView) => {
    // Map AppView back to route paths for StepperNav clicks
    switch (view) {
      case AppView.HOME:
        navigate('/');
        break;
      case AppView.LIBRARY:
        navigate('/library');
        break;
      default: {
        // Learning step navigation: look up path from config-driven VIEW_TO_PATH map.
        // ACTIVE_STEPS drives which views are valid learning steps, so any view
        // that resolves in VIEW_TO_PATH is a learning step.
        const pathId = VIEW_TO_PATH[view];
        if (pathId) {
          const match = window.location.pathname.match(/\/learn\/([^/]+)/);
          const storyId = match?.[1];
          if (storyId) {
            navigate(`/learn/${storyId}/${pathId}`);
          }
        }
        break;
      }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-amber-50 text-gray-900 font-sans overflow-hidden">
      {/* Skip-to-content link — visually hidden until focused (WCAG 2.4.1) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded focus:font-medium focus:text-sm focus:shadow-lg"
      >
        跳至主要內容
      </a>

      {/* Header — global chrome only (logo, user info, logout). No stepper here. */}
      <Header onStepperNavigate={handleStepperNavigate} />

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

type NavMode = 'classic' | 'world' | 'phases';

/**
 * Inner content for the learning flow.
 * Supports three nav modes toggled by the user.
 */
const LearningContent: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

  // Nav mode persisted to sessionStorage so it survives within a tab session
  const [navMode, setNavMode] = useState<NavMode>('classic');

  const cycleNavMode = useCallback(() => {
    setNavMode((prev): NavMode => {
      if (prev === 'classic') return 'world';
      if (prev === 'world') return 'phases';
      return 'classic';
    });
  }, []);

  const handleStepperNavigate = (view: AppView) => {
    switch (view) {
      case AppView.HOME:
        navigate('/');
        break;
      case AppView.LIBRARY:
        navigate('/library');
        break;
      default: {
        const pathId = VIEW_TO_PATH[view];
        if (pathId) {
          const match = window.location.pathname.match(/\/learn\/([^/]+)/);
          const storyId = match?.[1];
          if (storyId) {
            navigate(`/learn/${storyId}/${pathId}`);
          }
        }
        break;
      }
    }
  };

  // Shared step data for sidebar maps
  const allSteps = useMemo(
    () => ACTIVE_STEPS.map((s) => ({ id: s.id, label: s.label })),
    [],
  );

  const completedStepsSet = useMemo(
    () => new Set<string>(navSession?.completedSteps ?? []),
    [navSession?.completedSteps],
  );

  const currentStepId = useMemo(() => {
    const entry = ACTIVE_STEPS.find((s) => s.view === currentView);
    return entry?.id ?? ACTIVE_STEPS[0]?.id ?? '';
  }, [currentView]);

  // Steps for the phases sidebar (exclude 'report' — final destination)
  const phaseSteps = useMemo(
    () => allSteps.filter((s) => s.id !== 'report'),
    [allSteps],
  );

  const handleSidebarStepClick = useCallback(
    (stepId: string) => {
      const step = ACTIVE_STEPS.find((s) => s.id === stepId);
      if (step) handleStepperNavigate(step.view);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Mode toggle button icon + label
  const toggleLabel =
    navMode === 'classic' ? '🗺 地圖' : navMode === 'world' ? '📖 三階段' : '☰ 經典';

  // ── Sidebar mode layout ─────────────────────────────────────────────────
  if (navMode === 'world' || navMode === 'phases') {
    return (
      <div className="flex-1 flex flex-row overflow-hidden">
        {/* Left sidebar */}
        <aside
          className="w-52 flex-shrink-0 bg-white border-r border-gray-100 shadow-sm overflow-y-auto"
          aria-label={navMode === 'world' ? '世界地圖導航' : '三階段學習路徑'}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-white border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 tracking-wide uppercase">
              {navMode === 'world' ? '學習地圖' : '學習階段'}
            </span>
            <button
              type="button"
              onClick={cycleNavMode}
              className="text-xs text-gray-400 hover:text-accent transition-colors"
              aria-label="切換導航模式"
              title={toggleLabel}
            >
              {toggleLabel}
            </button>
          </div>

          <div className="p-2">
            {navMode === 'world' ? (
              <WorldMap
                steps={allSteps}
                completedSteps={completedStepsSet}
                currentStepId={currentStepId}
                onStepClick={handleSidebarStepClick}
              />
            ) : (
              <LearningPhases
                steps={phaseSteps}
                completedSteps={completedStepsSet}
                currentStepId={currentStepId}
                onStepClick={handleSidebarStepClick}
              />
            )}
          </div>
        </aside>

        {/* Main learning content */}
        <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
          <LearningLayout />
        </div>
      </div>
    );
  }

  // ── Classic mode ─────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center">
        <div className="flex-1 min-w-0">
          <StepperNav
            currentView={currentView}
            session={navSession}
            selectedStory={navStory}
            onNavigate={handleStepperNavigate}
          />
        </div>
        <button
          type="button"
          onClick={cycleNavMode}
          className="flex-shrink-0 mr-2 px-2 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors border border-gray-200"
          title={toggleLabel}
          aria-label={`切換到${toggleLabel}模式`}
        >
          {toggleLabel}
        </button>
      </div>

      {/* Learning step content */}
      <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
        <LearningLayout />
      </div>
    </div>
  );
};

/**
 * AppShell wrapper specifically for the learning flow.
 */
export const LearningAppShell: React.FC = () => {
  return (
    <AppShell>
      <LearningContent />
    </AppShell>
  );
};
