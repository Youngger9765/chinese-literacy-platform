/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — thin wrapper that puts LearningLayout inside AppShell,
 * used for all /learn/:storyId/* routes. Supports three nav styles:
 *   classic — horizontal StepperNav top bar
 *   map     — Duolingo-style winding path sidebar (#1047)
 *   world   — gamified world-map sidebar with 3 themed worlds (#1049)
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
import LearningPathMap from '../ui/LearningPathMap';
import WorldMap from '../ui/WorldMap';
import LearningPhases from '../ui/LearningPhases';
import type { PathStep } from '../ui/LearningPathMap';
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

/** localStorage key for the nav style preference */
const NAV_STYLE_KEY = 'learning-nav-style';

type NavStyle = 'classic' | 'map' | 'world' | 'phases';

/**
 * Inner content for the learning flow: StepperNav top bar + LearningLayout.
 * Rendered inside AppShell's <main> element.
 *
 * Layout: flex-col — [StepperNav horizontal bar] stacked above [LearningLayout full-width]
 * Alternative map mode: Duolingo-style sidebar path map (#1047).
 * Alternative world mode: gamified world-map sidebar (#1049).
 */
const LearningContent: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

  const [navStyle, setNavStyle] = useState<NavStyle>(() => {
    try {
      const saved = localStorage.getItem(NAV_STYLE_KEY);
      if (saved === 'map') return 'map';
      if (saved === 'world') return 'world';
      if (saved === 'phases') return 'phases';
    } catch { /* non-fatal */ }
    return 'classic';
  });

  const cycleNavStyle = useCallback(() => {
    setNavStyle((prev) => {
      const next: NavStyle =
        prev === 'classic' ? 'map'
        : prev === 'map' ? 'world'
        : prev === 'world' ? 'phases'
        : 'classic';
      try { localStorage.setItem(NAV_STYLE_KEY, next); } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  /** Derive current step ID from URL for sidebar maps */
  const currentStepId = useMemo(() => {
    const stepId = window.location.pathname.split('/').pop() ?? '';
    const found = ACTIVE_STEPS.find((s) => s.id === stepId);
    return found ? found.id : ACTIVE_STEPS[0]?.id ?? '';
  }, [currentView]);

  /** Build path map steps from ACTIVE_STEPS config */
  const pathMapSteps: PathStep[] = useMemo(
    () => ACTIVE_STEPS.map((s) => ({ id: s.id, label: s.label, category: s.category })),
    [],
  );

  /** Completed steps derived from session data */
  const completedSteps = useMemo(() => {
    return new Set<string>(navSession?.completedSteps ?? []);
  }, [navSession?.completedSteps]);

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

  const handleSidebarStepClick = useCallback((stepId: string) => {
    const match = window.location.pathname.match(/\/learn\/([^/]+)/);
    const storyId = match?.[1];
    if (storyId) {
      navigate(`/learn/${storyId}/${stepId}`);
    }
  }, [navigate]);

  /** Toggle button label cycles: classic→地圖, map→世界地圖, world→經典 */
  const navToggleLabel =
    navStyle === 'classic' ? '地圖' : navStyle === 'map' ? '世界地圖' : '經典';

  const navToggleIcon =
    navStyle === 'classic' ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/>
        <path d="M9 3v15"/><path d="M15 6v15"/>
      </svg>
    ) : navStyle === 'map' ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        <path d="M2 12h20"/>
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h16"/>
      </svg>
    );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Nav style cycle button: classic → map → world → classic */}
      <div className="flex items-center justify-end px-3 py-1 bg-white/60 border-b border-gray-100">
        <button
          type="button"
          onClick={cycleNavStyle}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 hover:text-accent hover:bg-accent-bg transition-colors"
          aria-label={`切換到${navToggleLabel}模式`}
        >
          {navToggleIcon}
          {navToggleLabel}
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

          {/* Learning step content — full width below the top nav.
              overflow-y-auto keeps the height capped to the viewport so steps with
              internal scroll containers scroll correctly (#815, #824). */}
          <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
            <LearningLayout />
          </div>
        </>
      ) : (
        /* Sidebar map modes (map / world) */
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Sidebar */}
          <aside
            className="w-full md:w-[280px] lg:w-[320px] shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-white/80 overflow-y-auto"
            aria-label={navStyle === 'world' ? '世界地圖學習路徑' : '學習路徑地圖'}
          >
            <div className="py-4 px-2">
              {navStyle === 'map' ? (
                <LearningPathMap
                  steps={pathMapSteps}
                  completedSteps={completedSteps}
                  currentStepId={currentStepId}
                  onStepClick={handleSidebarStepClick}
                />
              ) : (
                <WorldMap
                  steps={pathMapSteps}
                  completedSteps={completedSteps}
                  currentStepId={currentStepId}
                  onStepClick={handleSidebarStepClick}
                />
              )}
            </div>
          </aside>

          {/* Learning step content */}
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
 * Renders StepperNav as a sidebar alongside LearningLayout.
 */
export const LearningAppShell: React.FC = () => {
  return (
    <AppShell>
      <LearningContent />
    </AppShell>
  );
};
