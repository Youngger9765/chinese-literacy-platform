import { useLocation } from 'react-router-dom';
import { AppView } from '../types';

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
  if (pathname === '/history') return AppView.MY_ASSIGNMENTS;
  if (pathname === '/progress') return AppView.MY_ASSIGNMENTS;
  if (pathname === '/parent') return AppView.PARENT_DASHBOARD;
  if (pathname === '/classroom-dashboard') return AppView.STUDENT_CLASSROOM_DASHBOARD;
  if (pathname === '/profile') return AppView.STUDENT_PROFILE;

  // Learning flow: /learn/:storyId/<step>
  if (pathname.includes('/learn/')) {
    if (pathname.endsWith('/intro')) return AppView.INTRO;
    if (pathname.endsWith('/tutor')) return AppView.TUTOR;
    if (pathname.endsWith('/comprehension')) return AppView.COMPREHENSION;
    if (pathname.endsWith('/vocab')) return AppView.VOCAB;
    if (pathname.endsWith('/dictation')) return AppView.DICTATION;
    if (pathname.endsWith('/full-reading')) return AppView.FULL_READING;
    if (pathname.endsWith('/report')) return AppView.REPORT;
  }

  return AppView.HOME;
}
