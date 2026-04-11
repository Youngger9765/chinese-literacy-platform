/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — thin wrapper that puts LearningLayout inside AppShell,
 * used for all /learn/:storyId/* routes. Supports four nav styles:
 *   classic  — horizontal StepperNav top bar (default)
 *   phases   — vertical 3-phase accordion sidebar (#1048)
 *   duolingo — Duolingo-style winding snake path (#1047)
 *   worldmap — gamified world map sidebar (#1049)
 *   rpg      — RPG adventure map with emoji pixel art (#1055)
 */
import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { getMyAssignments } from '../../services/assignmentApi';
import { fetchGamificationSummary } from '../../services/gamificationApi';
import type { GamificationSummary } from '../../services/gamificationApi';
import { AppView } from '../../types';
import { VIEW_TO_PATH, ACTIVE_STEPS } from '../../config/stepConfig';
import { useAppView } from '../../hooks/useAppView';
import Header from './Header';
import Sidebar from './Sidebar';
import LearningLayout from '../../layouts/LearningLayout';
import StepperNav from '../StepperNav';
import LearningPhases from '../ui/LearningPhases';
import WorldMap from '../ui/WorldMap';
import LearningPathDuolingo from '../ui/LearningPathDuolingo';
import type { LearningPathStep } from '../ui/LearningPathDuolingo';
import RPGAdventureMap from '../ui/RPGAdventureMap';
import XPBar from '../gamification/XPBar';
import StreakIndicator from '../gamification/StreakIndicator';
import { OnboardingWrapper } from '../../pages/app/InlinePages';

/** Compact gamification display for learning path sidebars. */
const SidebarGamification: React.FC = () => {
  const { token, user } = useAuth();
  const { activeView } = useWorkspace();
  const [summary, setSummary] = useState<GamificationSummary | null>(null);

  useEffect(() => {
    if (!token || !user?.id || activeView !== 'student') return;
    let cancelled = false;
    fetchGamificationSummary(user.id, token)
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch(() => { /* non-critical — hide section on error */ });
    return () => { cancelled = true; };
  }, [token, user?.id, activeView]);

  if (!summary) return null;

  return (
    <div className="border-t border-gray-200 px-3 py-3 space-y-2">
      <XPBar levelInfo={summary.level_info} compact />
      <StreakIndicator streak={summary.streak} variant="compact" />
    </div>
  );
};

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

// ── Nav style config ──────────────────────────────────────────────────────

const NAV_STYLE_KEY = 'learning-nav-style';

type NavStyle = 'classic' | 'phases' | 'duolingo' | 'worldmap' | 'rpg';

const NAV_STYLES: { key: NavStyle; label: string; icon: React.ReactNode }[] = [
  {
    key: 'classic',
    label: '經典',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h16"/>
      </svg>
    ),
  },
  {
    key: 'phases',
    label: '階段',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M3 15h18"/>
      </svg>
    ),
  },
  {
    key: 'duolingo',
    label: '闖關',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2.5"/>
        <circle cx="6" cy="12" r="2.5"/>
        <circle cx="18" cy="12" r="2.5"/>
        <circle cx="12" cy="19" r="2.5"/>
        <path d="M12 7.5v9M8.5 13l1.5 4M15.5 13l-1.5 4"/>
      </svg>
    ),
  },
  {
    key: 'worldmap',
    label: '地圖',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/>
        <path d="M9 3v15M15 6v15"/>
      </svg>
    ),
  },
  {
    key: 'rpg',
    label: '冒險',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/>
        <path d="M14 2v6h6M12 18v-6M9 15h6"/>
      </svg>
    ),
  },
];

const VALID_NAV_STYLES = new Set<string>(NAV_STYLES.map((s) => s.key));

// ── LearningContent ───────────────────────────────────────────────────────

const LearningContent: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

  const [navStyle, setNavStyle] = useState<NavStyle>(() => {
    try {
      const saved = localStorage.getItem(NAV_STYLE_KEY);
      if (saved && VALID_NAV_STYLES.has(saved)) return saved as NavStyle;
    } catch { /* non-fatal */ }
    return 'classic';
  });

  const cycleNavStyle = useCallback(() => {
    setNavStyle((prev) => {
      const idx = NAV_STYLES.findIndex((s) => s.key === prev);
      const next = NAV_STYLES[(idx + 1) % NAV_STYLES.length].key;
      try { localStorage.setItem(NAV_STYLE_KEY, next); } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  const currentStepId = useMemo(() => {
    const stepId = window.location.pathname.split('/').pop() ?? '';
    const found = ACTIVE_STEPS.find((s) => s.id === stepId);
    return found ? found.id : ACTIVE_STEPS[0]?.id ?? '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  const mapSteps = useMemo(
    () => ACTIVE_STEPS.map((s) => ({ id: s.id, label: s.label })),
    [],
  );

  const completedSteps = useMemo(() => {
    return new Set<string>(navSession?.completedSteps ?? []);
  }, [navSession?.completedSteps]);

  const duolingoSteps = useMemo((): LearningPathStep[] => {
    let reachedCurrent = false;
    return ACTIVE_STEPS.map((s) => {
      if (completedSteps.has(s.id)) {
        return { ...s, status: 'complete' as const };
      }
      if (s.id === currentStepId && !reachedCurrent) {
        reachedCurrent = true;
        return { ...s, status: 'active' as const };
      }
      return { ...s, status: 'locked' as const };
    });
  }, [completedSteps, currentStepId]);

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

  const handleStepClick = useCallback((stepId: string) => {
    const match = window.location.pathname.match(/\/learn\/([^/]+)/);
    const storyId = match?.[1];
    if (storyId) {
      navigate(`/learn/${storyId}/${stepId}`);
    }
  }, [navigate]);

  const handleDuolingoStart = useCallback((step: LearningPathStep) => {
    handleStepClick(step.id);
  }, [handleStepClick]);

  const currentNavConfig = NAV_STYLES.find((s) => s.key === navStyle)!;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Nav style toggle bar */}
      <div className="flex items-center justify-end px-3 py-1 bg-white/60 border-b border-gray-100">
        <button
          type="button"
          onClick={cycleNavStyle}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 hover:text-accent hover:bg-accent-bg transition-colors"
          aria-label={`目前：${currentNavConfig.label}模式，點擊切換`}
          title={`切換導航模式（目前：${currentNavConfig.label}）`}
        >
          {currentNavConfig.icon}
          {currentNavConfig.label}
        </button>
      </div>

      {/* Classic: horizontal StepperNav top bar */}
      {navStyle === 'classic' && (
        <>
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
      )}

      {/* Phases: 3-phase accordion sidebar */}
      {navStyle === 'phases' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <aside
            className="w-full md:w-[280px] lg:w-[320px] shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-white/80 overflow-y-auto"
            aria-label="學習階段導航"
          >
            <div className="py-4 px-3">
              <LearningPhases
                steps={mapSteps}
                completedSteps={completedSteps}
                currentStepId={currentStepId}
                onStepClick={handleStepClick}
              />
            </div>
            <SidebarGamification />
          </aside>
          <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
            <LearningLayout />
          </div>
        </div>
      )}

      {/* Duolingo: winding snake path sidebar */}
      {navStyle === 'duolingo' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <aside
            className="w-full md:w-[320px] lg:w-[360px] shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-gradient-to-b from-green-50/50 to-white overflow-y-auto"
            aria-label="學習闖關路徑"
          >
            <LearningPathDuolingo
              steps={duolingoSteps}
              onStartStep={handleDuolingoStart}
            />
            <SidebarGamification />
          </aside>
          <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
            <LearningLayout />
          </div>
        </div>
      )}

      {/* World Map: gamified RPG-style map sidebar */}
      {navStyle === 'worldmap' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <aside
            className="w-full md:w-[320px] lg:w-[360px] shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-gradient-to-b from-sky-50/50 to-white overflow-y-auto"
            aria-label="學習世界地圖"
          >
            <WorldMap
              steps={mapSteps}
              completedSteps={completedSteps}
              currentStepId={currentStepId}
              onStepClick={handleStepClick}
            />
            <SidebarGamification />
          </aside>
          <div className="flex-1 flex flex-col overflow-y-auto pb-14 md:pb-0">
            <LearningLayout />
          </div>
        </div>
      )}

      {/* RPG Adventure: emoji pixel art adventure map */}
      {navStyle === 'rpg' && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          <aside
            className="w-full md:w-[320px] lg:w-[360px] shrink-0 border-b md:border-b-0 md:border-r border-gray-200 bg-gradient-to-b from-amber-50/50 to-white overflow-y-auto"
            aria-label="RPG 冒險地圖"
          >
            <RPGAdventureMap
              steps={mapSteps}
              completedSteps={completedSteps}
              currentStepId={currentStepId}
              onStepClick={handleStepClick}
            />
            <SidebarGamification />
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
