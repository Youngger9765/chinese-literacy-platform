/**
 * #3438 — `mustChangePassword` must be derived from the authoritative
 * `/users/me` response on EVERY path that establishes a session, not just
 * the `login()` call. This is the hydrate path: token already present in
 * localStorage (e.g. a page reload while the student is still on
 * /change-password), AuthContext re-mounts and goes straight to getMe(),
 * never calling login() again.
 *
 * Before the fix: `mustChangePassword` stayed at its `useState(false)`
 * initial value forever on this path, silently defeating every route
 * guard that depends on it. This test must be RED against the old
 * "independent local state" implementation and GREEN once
 * `mustChangePassword` is derived as `!!user?.must_change_password`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from '../AuthContext';
import * as authApi from '../../services/authApi';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

const baseUser = {
  id: 1,
  email: 's@example.com',
  name: '小明',
  is_active: true,
  onboarding_completed: true,
  roles: [],
  terms_accepted: true,
  terms_accepted_at: '2026-01-01T00:00:00Z',
  terms_version: '1',
  has_classroom: true,
  teacher_gating_enforced: false,
};

describe('#3438 AuthContext derives mustChangePassword from /users/me on hydrate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('⭐ reload with a pending password change → mustChangePassword becomes true (no login() call happened)', async () => {
    localStorage.setItem('lingoleap_token', 'tok');
    vi.spyOn(authApi, 'getMe').mockResolvedValue({
      ...baseUser,
      must_change_password: true,
    } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).not.toBeNull();
    expect(result.current.mustChangePassword).toBe(true);
  });

  it('reload with password already changed → mustChangePassword is false', async () => {
    localStorage.setItem('lingoleap_token', 'tok');
    vi.spyOn(authApi, 'getMe').mockResolvedValue({
      ...baseUser,
      must_change_password: false,
    } as never);

    const { result } = renderHook(() => useAuth(), { wrapper: wrap });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.mustChangePassword).toBe(false);
  });

  it('⛔ never renders as "known" before isLoading settles — mustChangePassword must not be read as a false negative while user is still null', async () => {
    localStorage.setItem('lingoleap_token', 'tok');
    let resolveGetMe!: (v: unknown) => void;
    vi.spyOn(authApi, 'getMe').mockReturnValue(
      new Promise((resolve) => {
        resolveGetMe = resolve;
      }) as never,
    );

    const { result } = renderHook(() => useAuth(), { wrapper: wrap });

    // Still loading — isLoading must be true, not yet settled as false/false.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();

    resolveGetMe({ ...baseUser, must_change_password: true });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.mustChangePassword).toBe(true);
  });
});
