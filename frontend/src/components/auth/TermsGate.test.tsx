/**
 * TermsGate -- must not cover the /change-password page with its full-screen
 * modal while a password change is pending (#3412 follow-up).
 *
 * ProtectedRoute already forces a student with mustChangePassword=true onto
 * /change-password and skips its own ToS redirect entirely while that's
 * pending. But TermsGate is a SEPARATE gate (rendered once at the App root,
 * on top of every route) with its own, independent needsTermsAcceptance
 * check -- it only ever excluded the literal '/terms' path from its own
 * modal, never '/change-password' and never mustChangePassword. A fresh
 * batch-created student has both pending at once, so the opaque,
 * full-viewport TermsModal still rendered OVER the change-password form,
 * making it physically unreachable until the student dealt with the terms
 * modal first -- the exact inversion of the priority order ProtectedRoute
 * was just fixed to guarantee.
 *
 * Verified visually on staging after the ProtectedRoute fix: a fresh
 * batch-created student landed on /change-password (correct), but the
 * terms modal was still painted full-screen on top of it.
 *
 * TermsModal is behind React.lazy()/Suspense -- every assertion below
 * flushes with `await act(async () => {})` right after render so the
 * dynamic import has settled one way or the other BEFORE we assert on its
 * absence. Skipping that flush makes an "absent" assertion pass vacuously
 * (the lazy chunk just hasn't resolved yet), which is exactly the kind of
 * false-green this bug needs a real regression lock against.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsGate from './TermsGate';

let mockAuth: {
  needsTermsAcceptance: boolean;
  mustChangePassword: boolean;
  acceptTerms: () => Promise<void>;
};

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('../TermsModal', () => ({
  default: () => <div data-testid="terms-modal">TERMS MODAL</div>,
}));

async function renderAt(pathname: string) {
  const utils = render(
    <MemoryRouter initialEntries={[pathname]}>
      <TermsGate>
        <div data-testid="page-content">page content</div>
      </TermsGate>
    </MemoryRouter>,
  );
  // Let the lazy TermsModal chunk settle before any assertion.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

describe('TermsGate does not shadow a pending forced password change (#3412)', () => {
  it('both pending, on /change-password: the terms modal must not cover the form', async () => {
    mockAuth = { needsTermsAcceptance: true, mustChangePassword: true, acceptTerms: vi.fn() };
    await renderAt('/change-password');
    expect(screen.getByTestId('page-content')).toBeInTheDocument();
    expect(screen.queryByTestId('terms-modal')).not.toBeInTheDocument();
  });

  it('both pending, on any other page: the terms modal also stays hidden while password change is pending', async () => {
    mockAuth = { needsTermsAcceptance: true, mustChangePassword: true, acceptTerms: vi.fn() };
    await renderAt('/library');
    expect(screen.queryByTestId('terms-modal')).not.toBeInTheDocument();
  });

  it('terms-only (no regression): the modal still shows on a normal page once password change is done', async () => {
    mockAuth = { needsTermsAcceptance: true, mustChangePassword: false, acceptTerms: vi.fn() };
    await renderAt('/library');
    expect(screen.getByTestId('terms-modal')).toBeInTheDocument();
  });

  it('terms-only (no regression): the modal still hides on /terms itself', async () => {
    mockAuth = { needsTermsAcceptance: true, mustChangePassword: false, acceptTerms: vi.fn() };
    await renderAt('/terms');
    expect(screen.queryByTestId('terms-modal')).not.toBeInTheDocument();
  });

  it('neither pending: no modal anywhere', async () => {
    mockAuth = { needsTermsAcceptance: false, mustChangePassword: false, acceptTerms: vi.fn() };
    await renderAt('/library');
    expect(screen.queryByTestId('terms-modal')).not.toBeInTheDocument();
  });
});
