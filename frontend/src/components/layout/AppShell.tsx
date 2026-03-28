/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — thin wrapper that puts LearningLayout inside AppShell,
 * used for all /learn/:storyId/* routes. It also renders the StepperNav as a
 * vertical left sidebar alongside the learning content (moved out of the header).
 */
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { getMyAssignments } from '../../services/assignmentApi';
import { AppView } from '../../types';
import { VIEW_TO_PATH } from '../../config/stepConfig';
import { useAppView } from '../../hooks/useAppView';
import Header from './Header';
import Sidebar from './Sidebar';
import LearningLayout from '../../layouts/LearningLayout';
import StepperNav from '../StepperNav';
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

/**
 * Inner content for the learning flow: StepperNav sidebar + LearningLayout.
 * Rendered inside AppShell's <main> element.
 *
 * Desktop: flex-row — [StepperNav 208px] + [LearningLayout fills rest]
 * Mobile: flex-col — [StepperNav compact bar] stacked above [LearningLayout]
 */
const LearningContent: React.FC = () => {
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

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
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
      {/* Vertical step sidebar (desktop) / compact bar (mobile) */}
      <StepperNav
        currentView={currentView}
        session={navSession}
        selectedStory={navStory}
        onNavigate={handleStepperNavigate}
      />

      {/* Learning step content — scrollable, with bottom padding for mobile tab bar */}
      <div className="flex-1 overflow-y-auto pb-14 md:pb-0">
        <LearningLayout />
      </div>
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
