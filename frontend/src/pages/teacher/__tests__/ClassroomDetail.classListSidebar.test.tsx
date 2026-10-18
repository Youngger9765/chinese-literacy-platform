import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  listMyClassrooms: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ClassroomApiError';
      this.status = status;
    }
  },
}));

vi.mock('../StudentListTab', () => ({ default: () => <div data-testid="student-list-tab" /> }));
vi.mock('../ClassroomTabs', () => ({
  // The class column is now handed to ClassroomTabs (Junyi-parity layout), so
  // the stub renders it to keep checking that ClassroomDetail wires it up.
  default: ({ sidebar }: { sidebar?: React.ReactNode }) => <div data-testid="classroom-tabs">{sidebar}</div>,
  resolveInitialView: () => null,
  resolveTabKey: () => 'settings',
}));

const MOCK_CLASSROOM = {
  id: 2, name: '五年乙班', school_id: 1, teacher_id: 1, grade: 5,
  is_active: true, created_at: '2026-01-01T00:00:00Z', student_count: 1,
  students: [{ id: 10, name: 'A', email: 'a@x.com', enrolled_at: '2026-01-01T00:00:00Z' }],
  join_code: 'ABC123',
};

describe('ClassroomDetail — desktop left class list wiring (#3401)', () => {
  beforeEach(() => {
    vi.mocked(classroomApi.getClassroomDetail).mockResolvedValue(MOCK_CLASSROOM as never);
    vi.mocked(classroomApi.listMyClassrooms).mockResolvedValue({
      items: [
        { id: 1, name: '四年甲班', school_id: 1, teacher_id: 1, grade: 4, is_active: true, created_at: '', student_count: 0 },
        MOCK_CLASSROOM,
      ],
      total: 2,
    } as never);
  });

  it('renders the desktop class list sidebar alongside the roster/tabs when there are 2+ classrooms', async () => {
    render(
      <MemoryRouter initialEntries={['/teacher/classroom/2']}>
        <ClassroomDetail classroomId={2} onBack={vi.fn()} />
      </MemoryRouter>,
    );
    const sidebarEntry = await screen.findByRole('button', { name: /四年甲班/ });
    expect(sidebarEntry).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /五年乙班/ })).toHaveAttribute('aria-current', 'true');
  });
});
