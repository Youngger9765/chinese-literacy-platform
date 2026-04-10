/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — thin wrapper that puts LearningLayout inside AppShell,
 * used for all /learn/:storyId/* routes. Supports two nav styles:
 *   classic — horizontal StepperNav top bar (default)
 *   phases  — vertical 3-phase accordion sidebar (#1048)
 */
import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
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
import LearningPhases from '../ui/LearningPhases';
import { OnboardingWrapper } from '../../pages/app/InlinePages';

/** The authenticated app shell with header + sidebar. */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  const { activeView } = useWorkspace();
  const navigate = useNavigate();

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

  return (
    <div className="h-screen flex flex-col bg-amber-50 text-gray-900 font-sans overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded focus:font-medium focus:text-sm focus:shadow-lg"
      >
        跳至主要內容
      </a>

      <Header onStepperNavigate={handleStepperNavigate} />

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

      <Suspense fallback={null}>
        <OnboardingWrapper />
      </Suspense>
    </div>
  );
};

/** localStorage key for the nav style preference */
const NAV_STYLE_KEY = 'learning-nav-style';

type NavStyle = 'classic' | 'phases';

/**
 * Inner content for the learning flow.
 * Supports two nav styles:
 *   classic — horizontal StepperNav top bar (default)
 *   phases  — vertical 3-phase accordion sidebar (#1048)
 */
const LearningContent: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

  const [navStyle, setNavStyle] = useState<NavStyle>(() => {
    try {
      const saved = localStorage.getItem(NAV_STYLE_KEY);
      if (saved === 'phases') return 'phases';
    } catch { /* non-fatal */ }
    return 'classic';
  });

  const toggleNavStyle = useCallback(() => {
    setNavStyle((prev) => {
      const next: NavStyle = prev === 'classic' ? 'phases' : 'classic';
      try { localStorage.setItem(NAV_STYLE_KEY, next); } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  /** Derive current step ID from URL for the phases sidebar */
  const currentStepId = useMemo(() => {
    const stepId = window.location.pathname.split('/').pop() ?? '';
    const found = ACTIVE_STEPS.find((s) => s.id === stepId);
    return found ? found.id : ACTIVE_STEPS[0]?.id ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  /** Steps data for LearningPhases */
  const phaseSteps = useMemo(
    () => ACTIVE_STEPS.map((s) => ({ id: s.id, label: s.label })),
    [],
  );

  /** Completed steps derived from session data */
  const completedSteps = useMemo(() => {
    return new Set<string>(navSession?.completedSteps ?? []);
  }, [navSession?.completedSteps]);

  const handleStepperNavigate = useCallback((view: AppView) => {
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
  }, [navigate]);

  const handlePhaseStepClick = useCallback((stepId: string) => {
    const match = window.location.pathname.match(/\/learn\/([^/]+)/);
    const storyId = match?.[1];
    if (storyId) {
      navigate(`/learn/${storyId}/${stepId}`);
    }
  }, [navigate]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Nav style toggle button */}
      <div className="flex items-center justify-end px-3 py-1 bg-white/60 border-b border-gray-100">
        <button
          type="button"
          onClick={toggleNavStyle}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 hover:text-accent hover:bg-accent-bg transition-colors"
          aria-label={navStyle === 'classic' ? '切換到階段模式' : '切換到經典模式'}
        >
          {navStyle === 'classic' ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18M3 15h18"/>
              </svg>
              階段
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
              經典
            </>
          )}
        </button>
      </div>

      {navStyle === 'classic' ? (
        <>
          {/* Horizontal step nav bar at the top */}
          <StepperNav
            currentView={currentView}
            session={navSession}
            selectedStory={navStory}
            onNavigate={handleStepperNavigate}
          />

          <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
            <LearningLayout />
          </div>
        </>
      ) : (
        /* Phases mode: 3-phase accordion sidebar on desktop, stacked on mobile */
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <aside
            className="w-full md:w-[280px] lg:w-[320px] shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-white/80 overflow-y-auto"
            aria-label="學習階段導航"
          >
            <div className="py-4 px-3">
              <LearningPhases
                steps={phaseSteps}
                completedSteps={completedSteps}
                currentStepId={currentStepId}
                onStepClick={handlePhaseStepClick}
              />
            </div>
          </aside>

          <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
            <LearningLayout />
          </div>
        </div>
      )}
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
