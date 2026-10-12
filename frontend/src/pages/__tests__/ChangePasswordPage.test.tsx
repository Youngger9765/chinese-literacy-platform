/**
 * ChangePasswordPage — must work WITHOUT `loginPassword` (#3438).
 *
 * `loginPassword` is the plaintext password captured in memory at the
 * moment `login()` ran. It does not survive a page reload (AuthContext's
 * hydrate path never sets it). Once `mustChangePassword` is correctly
 * derived from the server on every page load (the AuthContext half of
 * #3438), a student who reloads while on this page will correctly still
 * have `mustChangePassword: true` — but `loginPassword` will be `null`.
 *
 * Before the fix, this page's own early-return guard required
 * `loginPassword` to be truthy, so it would incorrectly show "無需變更密碼"
 * and send the student back to a home page they aren't allowed into yet —
 * a dead end. This test simulates exactly that reload scenario
 * (`mustChangePassword: true`, `loginPassword: null`) and requires the
 * real form to render, and to work by asking the user to type their
 * CURRENT password directly instead of relying on a remembered one.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChangePasswordPage from '../ChangePasswordPage';
import * as authApi from '../../services/authApi';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const clearMustChangePassword = vi.fn();
const refreshUser = vi.fn().mockResolvedValue(undefined);

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    token: 'tok',
    mustChangePassword: true,
    loginPassword: null, // simulates a reload — nothing remembered from login()
    clearMustChangePassword,
    refreshUser,
  }),
}));

vi.mock('../../services/authApi', async () => {
  const actual = await vi.importActual<typeof import('../../services/authApi')>('../../services/authApi');
  return { ...actual, changePassword: vi.fn() };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ChangePasswordPage />
    </MemoryRouter>,
  );
}

describe('#3438 ChangePasswordPage works after a reload (no loginPassword in memory)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshUser.mockResolvedValue(undefined);
  });

  it('⭐ renders the real form, NOT "無需變更密碼" — mustChangePassword true is enough even with loginPassword null', () => {
    renderPage();
    expect(screen.queryByText('無需變更密碼')).not.toBeInTheDocument();
    expect(screen.getByLabelText('目前密碼')).toBeInTheDocument();
    expect(screen.getByLabelText('新密碼')).toBeInTheDocument();
  });

  it('submits with the self-entered current password, not a remembered loginPassword', async () => {
    vi.mocked(authApi.changePassword).mockResolvedValue(undefined);
    renderPage();

    fireEvent.change(screen.getByLabelText('目前密碼'), { target: { value: 'MyCurrentPw1' } });
    fireEvent.change(screen.getByLabelText('新密碼'), { target: { value: 'BrandNewPassword456' } });
    fireEvent.change(screen.getByLabelText('確認新密碼'), { target: { value: 'BrandNewPassword456' } });
    fireEvent.click(screen.getByRole('button', { name: /設定新密碼/ }));

    await waitFor(() =>
      expect(authApi.changePassword).toHaveBeenCalledWith('MyCurrentPw1', 'BrandNewPassword456', 'tok'),
    );
    await waitFor(() => expect(refreshUser).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('rejects empty current-password before calling the API', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('新密碼'), { target: { value: 'BrandNewPassword456' } });
    fireEvent.change(screen.getByLabelText('確認新密碼'), { target: { value: 'BrandNewPassword456' } });
    fireEvent.click(screen.getByRole('button', { name: /設定新密碼/ }));

    await waitFor(() => expect(screen.getByText('請輸入目前的密碼')).toBeInTheDocument());
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it('rejects new password equal to the self-entered current password', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('目前密碼'), { target: { value: 'SamePassword1' } });
    fireEvent.change(screen.getByLabelText('新密碼'), { target: { value: 'SamePassword1' } });
    fireEvent.change(screen.getByLabelText('確認新密碼'), { target: { value: 'SamePassword1' } });
    fireEvent.click(screen.getByRole('button', { name: /設定新密碼/ }));

    await waitFor(() => expect(screen.getByText('新密碼不能與舊密碼相同')).toBeInTheDocument());
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });
});
