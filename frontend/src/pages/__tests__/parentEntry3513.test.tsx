/**
 * #3513 — parents had no way in: sign-up only made teachers, and nothing led
 * to the page where the invite code is entered. With the parent portal on,
 * sign-up offers 我是家長 (sent as role "parent") and the login page links to it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const flags = vi.hoisted(() => ({ PARENT_PORTAL_ENABLED: true }));
vi.mock('../../config/featureFlags', () => flags);
const register = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ register, loginWithGoogle: vi.fn(), login: vi.fn(), user: null, token: null }),
}));
vi.mock('../../components/GoogleSignInButton', () => ({ default: () => <div>google-button</div> }));

import RegisterPage from '../RegisterPage';
import LoginPage from '../LoginPage';

const fill = async () => {
  await userEvent.type(screen.getByLabelText('姓名'), '王媽媽');
  await userEvent.type(screen.getByLabelText('電子郵件'), 'mom@example.com');
  const pw = document.querySelectorAll('input[type=password]');
  await userEvent.type(pw[0] as HTMLElement, 'SecurePass123!');
  await userEvent.type(pw[1] as HTMLElement, 'SecurePass123!');
};

describe('#3513 parent entry', () => {
  beforeEach(() => {
    register.mockReset();
    register.mockResolvedValue({ message: 'ok', verification_token: null, auto_verified: true });
    flags.PARENT_PORTAL_ENABLED = true;
  });

  it('我是家長 signs up with role "parent" and hides the Google (teacher) sign-in', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('tab', { name: '我是家長' }));
    expect(screen.getByText('家長註冊')).toBeTruthy();
    expect(screen.queryByText('google-button')).toBeNull();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(register).toHaveBeenCalledWith('mom@example.com', 'SecurePass123!', '王媽媽', 'parent');
  });

  it('the default stays a teacher sign-up (no role sent)', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    expect(screen.getByText('教師註冊')).toBeTruthy();
    await fill();
    await userEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(register).toHaveBeenCalledWith('mom@example.com', 'SecurePass123!', '王媽媽', undefined);
  });

  it('?role=parent opens the parent tab directly', () => {
    render(<MemoryRouter initialEntries={['/register?role=parent']}><RegisterPage /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: '我是家長' }).getAttribute('aria-selected')).toBe('true');
  });

  it('the login page links parents to the parent sign-up', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /輸入老師給的邀請碼/ })).toBeTruthy();
  });

  it('with the parent portal off: no parent tab, no parent link', () => {
    flags.PARENT_PORTAL_ENABLED = false;
    const { unmount } = render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    expect(screen.queryByRole('tab', { name: '我是家長' })).toBeNull();
    unmount();
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /輸入老師給的邀請碼/ })).toBeNull();
  });
});
