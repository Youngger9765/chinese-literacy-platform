/**
 * #3411: a just-created classroom must render immediately, without waiting
 * on GET /api/classrooms/:id.
 *
 * Real repro (production, PR #3404/#3409 manual QA, R1): creating a class
 * navigates to /teacher/classroom/<new-id>, but teachers sometimes got
 * bounced back to the list before the new class's data ever rendered --
 * the list's own count already included the new row, yet its card was
 * briefly missing, consistent with a race between the detail page's own
 * data fetch and the navigation that put the teacher there. The exact
 * bounce could not be conclusively isolated after 20+ real-browser repro
 * attempts (see PR description), but the one dependency that's clearly
 * removable is this: the page had NOTHING to show until its own GET
 * resolved. TeacherDashboard already has the full classroom object from
 * the create POST response -- there is no reason to wait on a second
 * round trip to render it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ClassroomDetail from '../ClassroomDetail';
import type { ClassroomDetailResponse } from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'teacher' } }),
}));

// getClassroomDetail is a promise that never resolves -- simulates the GET
// racing with (and losing to) the navigation, or just being slow.
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
vi.mock('../panel/ClassSwitcher', () => ({ default: () => null }));
vi.mock('../panel/ClassListSidebar', () => ({ default: () => null }));
vi.mock('../panel/StudentsPanel', () => ({ default: () => <div data-testid="students-panel" /> }));

const JUST_CREATED: ClassroomDetailResponse = {
  id: 99,
  name: 'QA 測試班',
  school_id: 1,
  teacher_id: 1,
  grade: 5,
  is_active: true,
  created_at: '2026-10-11T00:00:00Z',
  student_count: 0,
  students: [],
};

describe('ClassroomDetail renders initialClassroom immediately (#3411)', () => {
  it('shows the classroom name on first render, with the detail GET still pending', () => {
    render(
      <MemoryRouter initialEntries={['/teacher/classroom/99']}>
        <ClassroomDetail classroomId={99} onBack={vi.fn()} initialClassroom={JUST_CREATED} />
      </MemoryRouter>,
    );
    expect(screen.getByText('QA 測試班')).toBeInTheDocument();
    // StudentListTab is stubbed here; the roster section itself must be on screen
    expect(screen.getByTestId('student-list-tab')).toBeInTheDocument();
  });

  it('without initialClassroom, shows the loading skeleton instead (no regression)', () => {
    render(
      <MemoryRouter initialEntries={['/teacher/classroom/99']}>
        <ClassroomDetail classroomId={99} onBack={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByText('QA 測試班')).not.toBeInTheDocument();
  });
});
