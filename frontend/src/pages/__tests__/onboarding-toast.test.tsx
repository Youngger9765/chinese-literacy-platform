/**
 * Tests for issue #1922: missing success toasts in onboarding flows.
 *
 * 1. Teacher creates a classroom → toast.success with class name
 * 2. Student joins classroom by code → toast.success with class name
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mock classroomApi
// ---------------------------------------------------------------------------
vi.mock('../../services/classroomApi', () => ({
  createClassroom: vi.fn(),
  listMyClassrooms: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  joinClassroomByCode: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock auth and workspace contexts
// ---------------------------------------------------------------------------
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'mock-token',
    user: { id: 1, name: 'Teacher' },
  }),
}));

vi.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeSchoolId: 1,
    hasMultipleSchools: false,
  }),
}));

// Mock SchoolSwitcher (has no behaviour here)
vi.mock('../../components/teacher/SchoolSwitcher', () => ({
  default: () => null,
}));

// Mock UI components to avoid Skeleton/LoadingIndicator pulling extra deps
vi.mock('../../components/ui/Skeleton', () => ({
  Skeleton: () => null,
  SkeletonText: () => null,
}));
vi.mock('../../components/ui/LoadingIndicator', () => ({
  default: () => null,
}));

import * as classroomApi from '../../services/classroomApi';
import TeacherDashboard from '../teacher/TeacherDashboard';
import JoinClassroomPage from '../JoinClassroomPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderTeacherDashboard() {
  return render(
    <MemoryRouter>
      <TeacherDashboard onSelectClassroom={vi.fn()} />
    </MemoryRouter>,
  );
}

function renderJoinClassroomPage() {
  return render(
    <MemoryRouter>
      <JoinClassroomPage />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Teacher create class — toast
// ---------------------------------------------------------------------------
describe('Teacher create classroom — success toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(classroomApi.createClassroom).mockResolvedValue({
      id: 42,
      name: '五年甲班',
      school_id: 1,
      teacher_id: 1,
      grade: 5,
      is_active: true,
      created_at: '2026-05-23T00:00:00Z',
      student_count: 0,
    });
  });

  it('shows success toast after classroom is created', async () => {
    renderTeacherDashboard();

    // Wait for empty state to load
    await waitFor(() => expect(screen.getByText('尚未建立班級')).toBeInTheDocument());

    // Open the create form
    fireEvent.click(screen.getAllByText('建立班級')[0]);

    // Fill in name
    const nameInput = await screen.findByPlaceholderText('例：五年甲班');
    await userEvent.type(nameInput, '五年甲班');

    // Submit
    const submitBtn = screen.getByRole('button', { name: '建立' });
    fireEvent.click(submitBtn);

    // Toast with class name should appear
    await waitFor(() =>
      expect(screen.getByText(/班級「五年甲班」建立成功/)).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Student join class — toast
// ---------------------------------------------------------------------------
describe('Student join classroom — success toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(classroomApi.joinClassroomByCode).mockResolvedValue({
      id: 99,
      name: '五年甲班',
      school_id: 1,
      teacher_id: 2,
      grade: 5,
      is_active: true,
      created_at: '2026-05-23T00:00:00Z',
      student_count: 10,
    });
  });

  it('shows success toast after joining classroom', async () => {
    renderJoinClassroomPage();

    const input = screen.getByPlaceholderText('輸入 6 碼加入代碼');
    await userEvent.type(input, 'ABC123');

    const submitBtn = screen.getByRole('button', { name: '加入班級' });
    fireEvent.click(submitBtn);

    // Toast with class name should appear (may also match inline success message)
    await waitFor(() => {
      const matches = screen.getAllByText(/成功加入「五年甲班」/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});
