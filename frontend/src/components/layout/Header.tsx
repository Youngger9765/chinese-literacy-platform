/**
 * Header — slim global app bar.
 *
 * Layout (left → center → right):
 *   Logo | context title (story name when in learning mode) | User + Logout
 *
 * The StepperNav has moved out of the header into a vertical left sidebar
 * that sits alongside the learning content area (see LearningAppShell in
 * AppShell.tsx). The header now only shows global chrome: identity, context
 * title, notifications, and logout.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLearningNav } from '../../contexts/LearningNavContext';
import { hasRole } from '../../services/authApi';
import { AppView } from '../../types';
import NotificationBell from '../teacher/NotificationBell';

export interface HeaderProps {
  /** Kept for API compatibility with AppShell — no longer used by Header itself. */
  onStepperNavigate: (view: AppView) => void;
}

const Header: React.FC<HeaderProps> = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { selectedStory: navStory } = useLearningNav();

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

  // In learning mode show the story title as context; otherwise nothing in center.
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

      {/* Center — story title when in learning mode */}
      {contextTitle && (
        <div className="flex-1 flex items-center justify-center px-4 min-w-0">
          <span
            className="text-sm font-medium text-gray-500 truncate"
            aria-live="polite"
          >
            {contextTitle}
          </span>
        </div>
      )}

      {/* Right rail — notifications (teacher) + user info + logout */}
      <div
        role="navigation"
        aria-label="全局操作列"
        className="flex items-center gap-1 shrink-0 ml-auto"
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
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors rounded px-2 py-1.5 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          登出
        </button>
      </div>
    </header>
  );
};

export default Header;
