/**
 * Header — slim global app bar.
 *
 * Layout (left → center → right):
 *   Logo | StepperNav (learning mode) or context title | User + Logout
 *
 * The header intentionally contains only global chrome (identity, context,
 * logout).  Page-level navigation lives in Sidebar.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { hasRole } from '../../services/authApi';
import { useAppView } from '../../hooks/useAppView';
import { AppView } from '../../types';
import StepperNav from '../StepperNav';
import NotificationBell from '../teacher/NotificationBell';

// ---------------------------------------------------------------------------
// Data-driven nav items for the header right rail (legacy fallback items
// that are NOT in the sidebar — e.g. teacher notification bell).
// Most page-level links have been moved to Sidebar; only global-chrome items
// live here.
// ---------------------------------------------------------------------------

export interface HeaderProps {
  /** Called when StepperNav step button is clicked. */
  onStepperNavigate: (view: AppView) => void;
}

const Header: React.FC<HeaderProps> = ({ onStepperNavigate }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const currentView = useAppView();
  const { session: navSession, selectedStory: navStory } = useLearningNav();

  const isTeacher = hasRole(
    user,
    'teacher',
    'system_admin',
    'principal',
    'director',
    'org_owner',
    'org_admin',
    'homeroom_teacher',
  );

  // Learning step views — stepper is shown in header when a story is active
  const learningViews: AppView[] = [
    AppView.ADMIN_DASHBOARD,
    AppView.TEACHER_DASHBOARD,
    AppView.CLASSROOM_DETAIL,
    AppView.MY_ASSIGNMENTS,
    AppView.MY_VOCABULARY,
    AppView.LEARNING_HISTORY,
    AppView.DIALOGUE_HISTORY,
    AppView.STUDENT_PROGRESS,
    AppView.STUDENT_HOME,
    AppView.TEACHER_HOME,
    AppView.STUDENT_CLASSROOM_DASHBOARD,
    AppView.STUDENT_PROFILE,
  ];

  const showStepper = navStory != null && !learningViews.includes(currentView);
  const contextTitle = navStory?.title ?? null;

  return (
    <header
      role="banner"
      aria-label="應用程式標頭"
      className="bg-white border-b border-gray-200 h-12 flex items-center justify-between px-4 shrink-0 z-30"
    >
      {/* Logo — keyboard-accessible home link */}
      <button
        type="button"
        className="flex items-center gap-2 shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        onClick={() => navigate('/')}
        aria-label="LingoLeap 首頁"
      >
        <div
          className="bg-accent w-6 h-6 rounded flex items-center justify-center"
          aria-hidden="true"
        >
          <span className="text-white font-bold text-xs">L</span>
        </div>
        <span className="text-sm font-bold text-gray-800 hidden sm:block">
          AI Reading Tutor
        </span>
      </button>

      {/* Center — StepperNav in learning mode, or context title otherwise */}
      <div className="flex-1 flex items-center justify-center px-4 min-w-0">
        {showStepper ? (
          <StepperNav
            currentView={currentView}
            session={navSession}
            selectedStory={navStory}
            onNavigate={onStepperNavigate}
          />
        ) : contextTitle ? (
          <span
            className="text-sm font-medium text-gray-500 truncate"
            aria-live="polite"
          >
            {contextTitle}
          </span>
        ) : null}
      </div>

      {/* Right rail — notifications (teacher) + user info + logout */}
      <div
        role="navigation"
        aria-label="全局操作列"
        className="flex items-center gap-1 shrink-0"
      >
        {/* Teacher notification bell */}
        {isTeacher && (
          <NotificationBell
            onNavigateToStudent={(classroomId) =>
              navigate(`/teacher/classroom/${classroomId}`)
            }
          />
        )}

        <div className="w-px h-4 bg-gray-200" aria-hidden="true" />

        {/* User name */}
        {user && (
          <span
            className="text-xs text-gray-500 hidden sm:block"
            aria-label={`已登入為 ${user.name}`}
          >
            {user.name}
          </span>
        )}

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          登出
        </button>
      </div>
    </header>
  );
};

export default Header;
