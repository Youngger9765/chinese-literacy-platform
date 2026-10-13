/**
 * #3515 — the student welcome tour (「XX 同學！這裡是你的國語文朗讀練習基地」)
 * opened over the parent page for every new parent: the tour showed to anyone
 * who wasn't a teacher or admin. Students still get it; parents don't.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const auth = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: auth.user, token: 't', refreshUser: vi.fn() }),
}));
vi.mock('../../../components/OnboardingGuide', () => ({ default: () => <div>student-tour</div> }));

import { OnboardingWrapper } from '../InlinePages';

const user = (roles: string[]) => ({ id: 1, name: 'X', onboarding_completed: false, roles: roles.map((r) => ({ role_name: r })) });

describe('#3515 onboarding tour audience', () => {
  beforeEach(() => { auth.user = null; });
  it('a parent does not get the student tour', async () => {
    auth.user = user(['parent']);
    render(<React.Suspense fallback={null}><OnboardingWrapper /></React.Suspense>);
    // The tour is lazy-loaded; give it time to appear before asserting it didn't.
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText('student-tour')).toBeNull();
  });
  it('a student still gets it (control)', async () => {
    auth.user = user(['student']);
    render(<React.Suspense fallback={null}><OnboardingWrapper /></React.Suspense>);
    await waitFor(() => expect(screen.getByText('student-tour')).toBeTruthy());
  });
});
