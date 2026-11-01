/**
 * Tests for ActivateTeacherPage — #3804 self-serve teacher activation.
 *
 * Design reference: docs/prd/2026-11-01-school-as-teacher-attribute-prd.md §10.2–§10.5.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ActivateTeacherPage from '../ActivateTeacherPage';
import * as authApi from '../../services/authApi';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const refreshUserMock = vi.fn().mockResolvedValue(undefined);
const setActiveViewMock = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', refreshUser: refreshUserMock }),
}));

vi.mock('../../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({ setActiveView: setActiveViewMock }),
}));

vi.mock('../../services/authApi', async () => {
  const actual = await vi.importActual<typeof import('../../services/authApi')>('../../services/authApi');
  return {
    ...actual,
    activateTeacher: vi.fn(),
  };
});

describe('ActivateTeacherPage (#3804)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshUserMock.mockResolvedValue(undefined);
  });

  it('renders one school input by default with the activation button', () => {
    render(<ActivateTeacherPage />);
    expect(screen.getByRole('heading', { name: '開通老師身分' })).toBeTruthy();
    expect(screen.getByLabelText('學校 1')).toBeTruthy();
    expect(screen.queryByLabelText('學校 2')).toBeNull();
    expect(screen.getByRole('button', { name: '開通老師身分' })).toBeTruthy();
  });

  it('adding a school field shows a second input; removing it hides it again', () => {
    render(<ActivateTeacherPage />);
    fireEvent.click(screen.getByText('+ 再加一所學校'));
    expect(screen.getByLabelText('學校 2')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('移除學校 2'));
    expect(screen.queryByLabelText('學校 2')).toBeNull();
  });

  it('submitting with no school filled in shows an inline error and does not call the API', async () => {
    render(<ActivateTeacherPage />);
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));
    await waitFor(() => {
      expect(screen.getByText('請至少填寫一所學校')).toBeTruthy();
    });
    expect(authApi.activateTeacher).not.toHaveBeenCalled();
  });

  it('submitting a filled school name calls the API, refreshes the user, switches to teacher view, and navigates to /teacher-home', async () => {
    vi.mocked(authApi.activateTeacher).mockResolvedValueOnce({
      schools: [{ id: 1, name: '大安國小', is_new: true }],
      roles: [],
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ActivateTeacherPage />);

    fireEvent.change(screen.getByLabelText('學校 1'), { target: { value: '大安國小' } });
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => {
      expect(authApi.activateTeacher).toHaveBeenCalledWith('test-token', ['大安國小']);
    });
    await waitFor(() => {
      expect(refreshUserMock).toHaveBeenCalled();
    });
    expect(setActiveViewMock).toHaveBeenCalledWith('teacher');
    expect(screen.getByText('開通成功！')).toBeTruthy();
    expect(screen.getByText('大安國小')).toBeTruthy();

    vi.advanceTimersByTime(1600);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/teacher-home');
    });
    vi.useRealTimers();
  });

  it('a server/network error shows the retry-friendly message and keeps the form', async () => {
    vi.mocked(authApi.activateTeacher).mockRejectedValueOnce(new Error('network down'));
    render(<ActivateTeacherPage />);

    fireEvent.change(screen.getByLabelText('學校 1'), { target: { value: '某國小' } });
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => {
      expect(screen.getByText('開通失敗，請檢查網路連線後再試一次')).toBeTruthy();
    });
    // form is still there, not replaced by the success screen
    expect(screen.getByLabelText('學校 1')).toBeTruthy();
  });

  it('a backend AuthError message (e.g. validation) is shown verbatim', async () => {
    vi.mocked(authApi.activateTeacher).mockRejectedValueOnce(
      new authApi.AuthError('一次最多開通 10 所學校', 422),
    );
    render(<ActivateTeacherPage />);

    fireEvent.change(screen.getByLabelText('學校 1'), { target: { value: '某國小' } });
    fireEvent.click(screen.getByRole('button', { name: '開通老師身分' }));

    await waitFor(() => {
      expect(screen.getByText('一次最多開通 10 所學校')).toBeTruthy();
    });
  });

  it('caps the number of school inputs at 5 (frontend soft cap, §11.2 backend cap is 10)', () => {
    render(<ActivateTeacherPage />);
    for (let i = 0; i < 6; i++) {
      const addButton = screen.queryByText('+ 再加一所學校');
      if (addButton) fireEvent.click(addButton);
    }
    expect(screen.getByLabelText('學校 5')).toBeTruthy();
    expect(screen.queryByLabelText('學校 6')).toBeNull();
    expect(screen.queryByText('+ 再加一所學校')).toBeNull();
  });
});
