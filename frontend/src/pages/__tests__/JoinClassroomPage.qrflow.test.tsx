/**
 * JoinClassroomPage — arriving via a QR-scanned URL (#3081 AC2 / AC4).
 *
 * A teacher projects a QR built from `/join?code=XXXXXX` (see
 * ClassroomJoinQrButton). This file locks the student-side half of that
 * flow: the code prefilled, the classroom name shown before committing
 * (AC2 -- "避免掃錯班"), and an already-enrolled rescan treated as a
 * friendly no-op rather than an error (AC4).
 *
 * This REPLACES the PR's original regression lock #3. The original lock
 * ("409 shows 你已經加入這個班級了") already exists and already passes in
 * JoinClassroomPage.test.tsx *without* any of this PR's code -- it locks
 * behavior from #1646, not this PR's change, and would give false credit
 * (no red, no credit). The lock this PR actually needs is the *new* code
 * path: arriving via a URL rather than typing, ending in the same
 * already-enrolled state.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import JoinClassroomPage from '../JoinClassroomPage';
import * as classroomApi from '../../services/classroomApi';

// Mutable so each test can point ?code= at a different value -- the
// `vi.mock` factory closure reads this by reference, not by the value at
// mock-registration time.
let urlSearch = '';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(urlSearch), vi.fn()],
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 99, role: 'student' } }),
}));

vi.mock('../../services/classroomApi', () => ({
  joinClassroomByCode: vi.fn(),
  previewClassroomByCode: vi.fn(),
  ClassroomApiError: class ClassroomApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
      this.name = 'ClassroomApiError';
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  urlSearch = '';
});

describe('JoinClassroomPage — QR entry (#3081)', () => {
  it('prefills the code from the URL and shows the classroom name before joining (AC2)', async () => {
    urlSearch = 'code=abc123'; // lower-case, as a phone's URL bar might show it
    vi.mocked(classroomApi.previewClassroomByCode).mockResolvedValueOnce({ id: 7, name: '五年甲班' });

    render(<JoinClassroomPage />);

    await waitFor(() =>
      expect(classroomApi.previewClassroomByCode).toHaveBeenCalledWith('test-token', 'ABC123'),
    );
    await waitFor(() => expect(screen.getByText('五年甲班')).toBeInTheDocument(), { timeout: 3000 });

    // The whole point of AC2: nothing to type, so there is no code textbox.
    expect(screen.queryByPlaceholderText('輸入 6 碼加入代碼')).toBeNull();

    vi.mocked(classroomApi.joinClassroomByCode).mockResolvedValueOnce({
      id: 7,
      name: '五年甲班',
      school_id: 1,
      teacher_id: 1,
      grade: 5,
      join_code: 'ABC123',
      is_active: true,
      created_at: new Date().toISOString(),
      student_count: 11,
    } as any);

    fireEvent.click(screen.getByRole('button', { name: '確認加入' }));

    await waitFor(() =>
      expect(classroomApi.joinClassroomByCode).toHaveBeenCalledWith('test-token', 'ABC123'),
    );
    await waitFor(() => expect(screen.getAllByText(/成功加入「五年甲班」/)[0]).toBeInTheDocument(), { timeout: 3000 });
  });

  it(
    'regression lock: rescanning a QR for a classroom the student is already ' +
    'in shows a friendly message, not the manual-entry error banner (AC4)',
    async () => {
      urlSearch = 'code=abc123';
      vi.mocked(classroomApi.previewClassroomByCode).mockResolvedValueOnce({ id: 7, name: '五年甲班' });
      const { ClassroomApiError } = await import('../../services/classroomApi');
      vi.mocked(classroomApi.joinClassroomByCode).mockRejectedValueOnce(
        new ClassroomApiError('Already enrolled', 409),
      );

      render(<JoinClassroomPage />);
      await waitFor(() => expect(screen.getByText('五年甲班')).toBeInTheDocument(), { timeout: 3000 });

      fireEvent.click(screen.getByRole('button', { name: '確認加入' }));

      const message = await screen.findByText(/你已經加入這個班級了/, {}, { timeout: 3000 });
      // Not the manual-entry hard-error styling (bg-red-50) -- AC4 explicitly
      // asks for "不報錯" (not framed as an error).
      expect(message.closest('div')?.className ?? '').not.toContain('bg-red-50');
    },
  );

  it('falls back to the manual form when the scanned code is invalid (previewClassroomByCode 404s)', async () => {
    urlSearch = 'code=zzzzzz';
    const { ClassroomApiError } = await import('../../services/classroomApi');
    vi.mocked(classroomApi.previewClassroomByCode).mockRejectedValueOnce(
      new ClassroomApiError('Invalid join code', 404),
    );

    render(<JoinClassroomPage />);

    const input = await screen.findByPlaceholderText('輸入 6 碼加入代碼');
    expect(screen.getByText(/找不到此加入代碼/)).toBeInTheDocument();
    // The scanned code stays in the box for the student to fix a typo,
    // rather than being silently wiped.
    expect(input).toHaveValue('ZZZZZZ');
  });

  it('lets the student switch to manual entry even when the preview succeeded (wrong row projected)', async () => {
    urlSearch = 'code=abc123';
    vi.mocked(classroomApi.previewClassroomByCode).mockResolvedValueOnce({ id: 7, name: '五年甲班' });

    render(<JoinClassroomPage />);
    await waitFor(() => expect(screen.getByText('五年甲班')).toBeInTheDocument(), { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: /改用手動輸入/ }));
    expect(screen.getByPlaceholderText('輸入 6 碼加入代碼')).toBeInTheDocument();
  });
});
