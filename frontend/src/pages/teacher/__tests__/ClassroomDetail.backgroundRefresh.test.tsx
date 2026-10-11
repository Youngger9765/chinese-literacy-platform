/**
 * Regression lock for #3378: a background refresh (e.g. `onStudentsImported`
 * firing after batch-creating student accounts) used to flash the full-page
 * loading skeleton, which unmounted StudentListTab/AddStudentsPanel and wiped
 * its local `result` state — so the "已建立 N 個帳號" banner and the
 * "列印帳密卡" button it contains (R2/R3) could never actually be seen by a
 * teacher, because the remount happened before the state could render.
 *
 * ClassroomDetail.tsx used to early-return the skeleton whenever
 * `isLoading` was true, with no regard for whether `classroom` already had
 * data. The fix narrows that to `isLoading && !classroom` — a background
 * refresh of an already-loaded classroom must not unmount the tree.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ClassroomDetail from '../ClassroomDetail';
import * as classroomApi from '../../../services/classroomApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, role: 'teacher' } }),
}));

vi.mock('../../../services/classroomApi', () => ({
  getClassroomDetail: vi.fn(),
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

// The real AddStudentsPanel keeps a local `result` state that must survive
// the post-create reload. We don't need the real panel to prove the bug —
// a mount counter on StudentListTab (its direct parent) is a more precise,
// implementation-agnostic way to assert "was this subtree ever unmounted".
let studentListTabMounts = 0;
vi.mock('../StudentListTab', () => ({
  default: (props: { onStudentsImported: () => void }) => {
    React.useEffect(() => {
      studentListTabMounts += 1;
    }, []);
    return (
      <div data-testid="student-list-tab">
        <button onClick={() => props.onStudentsImported()}>模擬建立學生帳號後的刷新</button>
      </div>
    );
  },
}));

vi.mock('../ClassroomAnalytics', () => ({ default: () => <div data-testid="classroom-analytics" /> }));
vi.mock('../CrossTextAnalytics', () => ({ default: () => <div data-testid="cross-text-analytics" /> }));
vi.mock('../../components/teacher/AtRiskStudents', () => ({ default: () => <div data-testid="at-risk-students" /> }));
vi.mock('../ErrorHeatmapTab', () => ({ default: () => <div data-testid="error-heatmap-tab" /> }));
vi.mock('../CoTeachingTab', () => ({ default: () => <div data-testid="co-teaching-tab" /> }));
vi.mock('../panel/TodayOverviewTab', () => ({ default: () => <div data-testid="today-overview-tab" /> }));
vi.mock('../panel/AssignmentsPanel', () => ({ default: () => <div data-testid="assignments-panel" /> }));
vi.mock('../panel/ClassSwitcher', () => ({ default: () => null }));
vi.mock('../panel/StudentsPanel', () => ({ default: () => <div data-testid="students-panel" /> }));

const MOCK_CLASSROOM = {
  id: 42,
  name: '三年甲班',
  school_id: 1,
  teacher_id: 1,
  grade: 3,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  student_count: 0,
  students: [],
  join_code: 'ABC123',
  school_name: '測試國小',
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/teacher/classroom/42']}>
      <ClassroomDetail classroomId={42} onBack={vi.fn()} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  studentListTabMounts = 0;
  // Empty roster so the "加學生" section auto-expands (#3378 behaviour) --
  // that's exactly the state a teacher is in right after creating a class
  // and then batch-creating student accounts.
  vi.mocked(classroomApi.getClassroomDetail).mockResolvedValue({
    ...MOCK_CLASSROOM,
    students: [],
  } as never);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClassroomDetail background refresh does not remount the roster (#3378)', () => {
  it('keeps StudentListTab mounted across onStudentsImported (post-create reload)', async () => {
    renderDetail();
    // Wait for the roster section itself (not just the classroom name) --
    // it only appears once the `isEmptyClass` effect flips isRosterOpen,
    // one render tick after the classroom name first becomes visible.
    await waitFor(() => screen.getByTestId('student-list-tab'));
    await waitFor(() => expect(studentListTabMounts).toBe(1));
    expect(screen.getByText('三年甲班')).toBeInTheDocument();
    expect(studentListTabMounts).toBe(1);

    await userEvent.click(screen.getByText('模擬建立學生帳號後的刷新'));

    await waitFor(() => {
      expect(vi.mocked(classroomApi.getClassroomDetail)).toHaveBeenCalledTimes(2);
    });
    // The classroom name must have stayed visible throughout -- it must never
    // have been replaced by the loading skeleton (which has no such text).
    expect(screen.getByText('三年甲班')).toBeInTheDocument();
    expect(screen.getByTestId('student-list-tab')).toBeInTheDocument();
    expect(studentListTabMounts).toBe(1);
  });
});
