/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — thin wrapper that puts LearningLayout inside AppShell,
 * used for all /learn/:storyId/* routes. Supports two nav styles:
 *   classic — horizontal StepperNav top bar (default)
 *   map     — Duolingo-style winding path sidebar (#1047)
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

/** localStorage key for the nav style preference. */
const NAV_STYLE_KEY = 'learning-nav-style';

type NavStyle = 'classic' | 'map';

/**
 * Inner content for the learning flow: StepperNav top bar + LearningLayout.
 * Rendered inside AppShell's <main> element.
 *
 * Nav style options (persisted to localStorage):
 *   classic — horizontal StepperNav top bar (default)
 *   map     — Duolingo-style winding path sidebar (#1047)
 */
const LearningContent: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

  // ── Nav style toggle ───────────────────────────────────────────────────────

  const [navStyle, setNavStyle] = useState<NavStyle>(() => {
    try {
      const saved = localStorage.getItem(NAV_STYLE_KEY);
      if (saved === 'map') return 'map';
    } catch { /* non-fatal */ }
    return 'classic';
  });

  const toggleNavStyle = useCallback(() => {
    setNavStyle((prev) => {
      const next: NavStyle = prev === 'classic' ? 'map' : 'classic';
      try { localStorage.setItem(NAV_STYLE_KEY, next); } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  // ── Path map data (from config — never hardcoded) ──────────────────────────

  /** Current step ID derived from URL path segment. */
  const currentStepId = useMemo(() => {
    const segment = window.location.pathname.split('/').pop() ?? '';
    const found = ACTIVE_STEPS.find((s) => s.id === segment);
    return found ? found.id : (ACTIVE_STEPS[0]?.id ?? '');
  }, [currentView]); // re-derive whenever the view changes

  const pathMapSteps: PathStep[] = useMemo(
    () => ACTIVE_STEPS.map((s) => ({ id: s.id, label: s.label, category: s.category })),
    [],
  );

  const completedSteps = useMemo(
    () => new Set<string>(navSession?.completedSteps ?? []),
    [navSession?.completedSteps],
  );

  // ── Navigation handlers ────────────────────────────────────────────────────

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

  const handlePathMapClick = useCallback((stepId: string) => {
    const match = window.location.pathname.match(/\/learn\/([^/]+)/);
    const storyId = match?.[1];
    if (storyId) {
      navigate(`/learn/${storyId}/${stepId}`);
    }
  }, [navigate]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Nav style toggle — top-right corner, minimal footprint */}
      <div className="flex items-center justify-end px-3 py-1 bg-white/60 border-b border-gray-100 shrink-0">
        <button
          type="button"
          onClick={toggleNavStyle}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 hover:text-accent hover:bg-accent/10 transition-colors"
          aria-label={navStyle === 'classic' ? '切換到地圖模式' : '切換到經典模式'}
          title={navStyle === 'classic' ? '切換到地圖模式' : '切換到經典模式'}
        >
          {navStyle === 'classic' ? (
            <>
              {/* Map icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/>
                <path d="M9 3v15"/>
                <path d="M15 6v15"/>
              </svg>
              地圖
            </>
          ) : (
            <>
              {/* List icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
              經典
            </>
          )}
        </button>
      </div>

      {navStyle === 'classic' ? (
        <>
          {/* Classic mode: horizontal StepperNav at top */}
          <StepperNav
            currentView={currentView}
            session={navSession}
            selectedStory={navStory}
            onNavigate={handleStepperNavigate}
          />

          {/* Learning step content — full width below the top nav.
              overflow-y-auto keeps height capped to viewport so steps with
              internal scroll containers scroll correctly (#815, #824). */}
          <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
            <LearningLayout />
          </div>
        </>
      ) : (
        /* Map mode: winding path sidebar + content side by side (desktop);
           stacked vertically on mobile. */
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Path map sidebar */}
          <aside
            className="w-full md:w-[280px] lg:w-[320px] shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-white/80 overflow-y-auto"
            aria-label="學習路徑地圖"
          >
            <div className="py-4 px-2">
              <LearningPathMap
                steps={pathMapSteps}
                completedSteps={completedSteps}
                currentStepId={currentStepId}
                onStepClick={handlePathMapClick}
              />
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
 * Renders StepperNav or LearningPathMap sidebar alongside LearningLayout.
 */
export const LearningAppShell: React.FC = () => {
  return (
    <AppShell>
      <LearningContent />
    </AppShell>
  );
};
