import { useLocation } from 'react-router-dom';
import { AppView } from '../types';
import { PATH_TO_VIEW } from '../config/stepConfig';

/**
 * Derive the current AppView from the route path.
 * Used by StepperNav and header to highlight the active nav item.
 */
export function useAppView(): AppView {
  const { pathname } = useLocation();

  if (pathname === '/') return AppView.HOME;
  if (pathname === '/student') return AppView.STUDENT_HOME;
  if (pathname === '/teacher-home') return AppView.TEACHER_HOME;
  if (pathname === '/achievements') return AppView.ACHIEVEMENTS;
  if (pathname === '/library') return AppView.LIBRARY;
  if (pathname === '/write') return AppView.WRITE;
  if (pathname === '/teacher') return AppView.TEACHER_DASHBOARD;
  if (pathname.startsWith('/teacher/classroom/')) return AppView.CLASSROOM_DETAIL;
  if (pathname === '/admin') return AppView.ADMIN_DASHBOARD;
  if (pathname === '/assignments') return AppView.MY_ASSIGNMENTS;
  if (pathname === '/vocabulary') return AppView.MY_VOCABULARY;
  if (pathname === '/history') return AppView.LEARNING_HISTORY;
  if (pathname === '/progress') return AppView.STUDENT_PROGRESS;
  if (pathname === '/parent') return AppView.PARENT_DASHBOARD;
  if (pathname.startsWith('/sessions/') && pathname.endsWith('/dialogue')) return AppView.DIALOGUE_HISTORY;
  if (pathname === '/classroom-dashboard') return AppView.STUDENT_CLASSROOM_DASHBOARD;
  if (pathname === '/profile') return AppView.STUDENT_PROFILE;

  // Learning flow: /learn/:storyId/<step>
  // Use PATH_TO_VIEW from stepConfig so any new step is automatically mapped
  // without needing a manual update here.
  if (pathname.includes('/learn/')) {
    const stepId = pathname.split('/').pop() ?? '';
    const view = PATH_TO_VIEW[stepId];
    if (view !== undefined) return view;
  }

  return AppView.HOME;
}
