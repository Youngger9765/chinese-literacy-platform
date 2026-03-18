/**
 * AppShell — the authenticated app chrome (header + sidebar + main area).
 *
 * LearningAppShell — thin wrapper that puts LearningLayout inside AppShell,
 * used for all /learn/:storyId/* routes.
 */
import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { hasRole } from '../../services/authApi';
import { getMyAssignments } from '../../services/assignmentApi';
import { AppView } from '../../types';
import Header from './Header';
import Sidebar from './Sidebar';
import FeedbackButton from '../FeedbackButton';
import LearningLayout from '../../layouts/LearningLayout';
import { OnboardingWrapper } from '../../pages/app/InlinePages';

/** The authenticated app shell with header + sidebar. */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  // Pending assignment count for the student nav badge
  const [pendingAssignmentCount, setPendingAssignmentCount] = useState(0);
  const isStudentOnly =
    user !== null &&
    !hasRole(user, 'teacher', 'system_admin', 'principal', 'director', 'org_owner', 'org_admin', 'homeroom_teacher');

  const refreshPendingCount = useCallback(async () => {
    if (!token || !isStudentOnly) return;
    try {
      const assignments = await getMyAssignments(token);
      const count = assignments.filter(
        (a) => a.status === 'pending' || a.status === 'in_progress',
      ).length;
      setPendingAssignmentCount(count);
    } catch {
      // Silently ignore — badge is non-critical
    }
  }, [token, isStudentOnly]);

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
      // Learning step navigation: extract storyId from current URL
      case AppView.INTRO:
      case AppView.TUTOR:
      case AppView.COMPREHENSION:
      case AppView.VOCAB:
      case AppView.DICTATION:
      case AppView.FULL_READING:
      case AppView.REPORT: {
        const match = window.location.pathname.match(/\/learn\/([^/]+)/);
        const storyId = match?.[1];
        if (storyId) {
          const stepPath: Record<string, string> = {
            [AppView.INTRO]: 'intro',
            [AppView.TUTOR]: 'tutor',
            [AppView.COMPREHENSION]: 'comprehension',
            [AppView.VOCAB]: 'vocab',
            [AppView.DICTATION]: 'dictation',
            [AppView.FULL_READING]: 'full-reading',
            [AppView.REPORT]: 'report',
          };
          navigate(`/learn/${storyId}/${stepPath[view]}`);
        }
        break;
      }
      default:
        break;
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

      {/* Header — extracted to components/layout/Header.tsx */}
      <Header onStepperNavigate={handleStepperNavigate} />

      {/* Body: sidebar + main content */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar pendingAssignmentCount={pendingAssignmentCount} />

        <main
          id="main-content"
          role="main"
          aria-label="主要內容"
          className="flex-1 flex flex-col overflow-hidden pb-14 md:pb-0"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>

      {/* Onboarding overlay for first-time students */}
      <Suspense fallback={null}>
        <OnboardingWrapper />
      </Suspense>

      {/* Feedback button — visible to all authenticated users */}
      <FeedbackButton />
    </div>
  );
};

/**
 * AppShell wrapper specifically for the learning flow.
 * Passes session and selectedStory to StepperNav via LearningLayout context.
 */
export const LearningAppShell: React.FC = () => {
  return (
    <AppShell>
      <LearningLayout />
    </AppShell>
  );
};
