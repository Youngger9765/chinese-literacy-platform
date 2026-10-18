/**
 * #3424: 768/1024 班級頁被三欄擠壓
 *
 * Root cause: ClassListSidebar's wrapping <aside> switched in at `lg:`
 * (1024px) -- the SAME breakpoint the app's global nav (Sidebar.tsx) uses
 * for its own expanded w-56 rail (it shows from `md:`, 768px, and stays
 * expanded by default). At 768-1279px both ~224px columns were on screen
 * together, squeezing the page content enough to wrap classroom names
 * mid-word and clip the "重生代碼" button.
 *
 * Fix: the page's own sidebar only switches in at `xl:` (1280px); below
 * that it stays on the single-column + ClassSwitcher-dropdown layout that
 * already worked at 390.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClassroomDetail from '../ClassroomDetail';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'teacher' } }),
}));

vi.mock('../../../services/classroomApi', () => ({
  getClassroomDetail: vi.fn(() => new Promise(() => {})),
  updateClassroom: vi.fn(),
  addStudent: vi.fn(),
  removeStudent: vi.fn(),
  exportClassroomReport: vi.fn(),
  regenerateClassroomCode: vi.fn(),
  deleteClassroom: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

vi.mock('../StudentProgressTab', () => ({ default: () => <div data-testid="student-progress-tab" /> }));
vi.mock('../TextManagementTab', () => ({ default: () => <div data-testid="text-management-tab" /> }));
vi.mock('../StudentListTab', () => ({ default: () => <div data-testid="student-list-tab" /> }));
vi.mock('../ClassroomAnalytics', () => ({ default: () => <div data-testid="classroom-analytics" /> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div data-testid="cross-text-analytics" /> }));
vi.mock('../../components/teacher/AtRiskStudents', () => ({ default: () => <div data-testid="at-risk-students" /> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div data-testid="error-heatmap-tab" /> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div data-testid="co-teaching-tab" /> }));
vi.mock('../panel/TodayOverviewTab', () => ({ default: () => <div data-testid="today-overview-tab" /> }));
vi.mock('../panel/AssignmentsPanel', () => ({ default: () => <div data-testid="assignments-panel" /> }));
vi.mock('../panel/ClassSwitcher', () => ({ default: () => <div data-testid="class-switcher" /> }));
vi.mock('../panel/ClassListSidebar', () => ({ default: () => <div data-testid="class-list-sidebar" /> }));
vi.mock('../panel/StudentsPanel', () => ({ default: () => <div data-testid="students-panel" /> }));

const CLASSROOM: ClassroomDetailResponse = {
  id: 9,
  name: '模擬班',
  school_id: 1,
  teacher_id: 1,
  grade: 5,
  is_active: true,
  created_at: '2026-10-11T00:00:00Z',
  student_count: 0,
  students: [],
};

describe('ClassroomDetail — tablet-width double-sidebar squeeze (#3424)', () => {
  it('the page sidebar column only appears from `xl:`, not `lg:`', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/teacher/classroom/9']}>
        <ClassroomDetail classroomId={9} onBack={vi.fn()} initialClassroom={CLASSROOM} />
      </MemoryRouter>,
    );

    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();
    expect(aside!.className).toMatch(/\bxl:block\b/);
    expect(aside!.className).not.toMatch(/\blg:block\b/);
  });

  it('the mobile/tablet ClassSwitcher dropdown only hides from `xl:`, not `lg:`', () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/teacher/classroom/9']}>
        <ClassroomDetail classroomId={9} onBack={vi.fn()} initialClassroom={CLASSROOM} />
      </MemoryRouter>,
    );

    const switcherWrapper = getByTestId('class-switcher').parentElement!;
    expect(switcherWrapper.className).toMatch(/\bxl:hidden\b/);
    expect(switcherWrapper.className).not.toMatch(/\blg:hidden\b/);
  });
});
