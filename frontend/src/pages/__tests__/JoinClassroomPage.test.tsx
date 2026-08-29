/**
 * Tests for JoinClassroomPage success message — Issue #1646
 * Verifies that the success message shows the actual classroom name
 * (result.name from ClassroomResponse) instead of "undefined".
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JoinClassroomPage from '../JoinClassroomPage';
import * as classroomApi from '../../services/classroomApi';

// --- Mocks ---

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 99, role: 'student' } }),
}));

vi.mock('../../services/classroomApi', () => ({
  joinClassroomByCode: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ClassroomApiError';
    }
  },
}));

// --- Helpers ---

function fillAndSubmit(code: string) {
  const input = screen.getByPlaceholderText('輸入 6 碼加入代碼');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.submit(input.closest('form')!);
}

// --- Tests ---

describe('JoinClassroomPage — success message (Issue #1646)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the classroom name from result.name in success message', async () => {
    // Backend returns ClassroomResponse which has `name` field (not classroom_name)
    vi.mocked(classroomApi.joinClassroomByCode).mockResolvedValueOnce({
      id: 42,
      name: '測試班級 5A',
      school_id: 1,
      teacher_id: 7,
      grade: 5,
      join_code: 'ABC123',
      is_active: true,
      created_at: new Date().toISOString(),
      student_count: 10,
    } as any);

    render(<JoinClassroomPage />);
    fillAndSubmit('ABC123');

    await waitFor(() => {
      expect(screen.getAllByText(/成功加入「測試班級 5A」！/)[0]).toBeInTheDocument();
    });

    // Must NOT show "undefined"
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('does NOT show "undefined" when classroom has a name', async () => {
    vi.mocked(classroomApi.joinClassroomByCode).mockResolvedValueOnce({
      id: 1,
      name: 'Bulk驗證 2026-05-16',
      school_id: 1,
      teacher_id: 1,
      grade: null,
      join_code: 'XY9Z01',
      is_active: true,
      created_at: new Date().toISOString(),
      student_count: 30,
    } as any);

    render(<JoinClassroomPage />);
    fillAndSubmit('XY9Z01');

    await waitFor(() => {
      const msg = screen.queryByText(/undefined/);
      expect(msg).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getAllByText(/成功加入「Bulk驗證 2026-05-16」！/)[0]).toBeInTheDocument();
    });
  });

  it('shows error when join code is invalid (404)', async () => {
    const { ClassroomApiError } = await import('../../services/classroomApi');
    vi.mocked(classroomApi.joinClassroomByCode).mockRejectedValueOnce(
      new ClassroomApiError('Not found', 404),
    );

    render(<JoinClassroomPage />);
    fillAndSubmit('XXXXXX');

    await waitFor(() => {
      expect(screen.getByText(/找不到此加入代碼/)).toBeInTheDocument();
    });
  });

  it('shows error when already enrolled (409)', async () => {
    const { ClassroomApiError } = await import('../../services/classroomApi');
    vi.mocked(classroomApi.joinClassroomByCode).mockRejectedValueOnce(
      new ClassroomApiError('Already enrolled', 409),
    );

    render(<JoinClassroomPage />);
    fillAndSubmit('ABC123');

    await waitFor(() => {
      expect(screen.getByText(/你已經加入這個班級了/)).toBeInTheDocument();
    });
  });
});
