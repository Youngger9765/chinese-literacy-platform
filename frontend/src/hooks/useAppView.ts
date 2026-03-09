import { useLocation } from 'react-router-dom';
import { AppView } from '../types';

/**
 * Derive the current AppView from the route path.
 * Used by StepperNav and header to highlight the active nav item.
 */
export function useAppView(): AppView {
  const { pathname } = useLocation();

  if (pathname === '/') return AppView.HOME;
  if (pathname === '/library') return AppView.LIBRARY;
  if (pathname === '/write') return AppView.WRITE;
  if (pathname === '/teacher') return AppView.TEACHER_DASHBOARD;
  if (pathname.startsWith('/teacher/classroom/')) return AppView.CLASSROOM_DETAIL;
  if (pathname === '/admin') return AppView.ADMIN_DASHBOARD;
  if (pathname === '/assignments') return AppView.MY_ASSIGNMENTS;
  if (pathname === '/vocabulary') return AppView.MY_VOCABULARY;
  if (pathname === '/history') return AppView.LEARNING_HISTORY;
  if (pathname === '/progress') return AppView.STUDENT_PROGRESS;
  if (pathname.startsWith('/sessions/') && pathname.endsWith('/dialogue')) return AppView.DIALOGUE_HISTORY;


  // Learning flow: /learn/:storyId/<step>
  if (pathname.includes('/learn/')) {
    if (pathname.endsWith('/intro')) return AppView.INTRO;
    if (pathname.endsWith('/tutor')) return AppView.TUTOR;
    if (pathname.endsWith('/comprehension')) return AppView.COMPREHENSION;
    if (pathname.endsWith('/vocab')) return AppView.VOCAB;
    if (pathname.endsWith('/full-reading')) return AppView.FULL_READING;
    if (pathname.endsWith('/report')) return AppView.REPORT;
  }

  return AppView.HOME;
}
