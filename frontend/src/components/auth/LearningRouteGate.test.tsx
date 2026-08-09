/**
 * LearningRouteGate — who may open a learning step without logging in.
 *
 * A student scans a QR code printed on a paper worksheet. They have no account
 * and no session. If the whole /learn subtree stays behind ProtectedRoute they
 * land on /login, and the QR code is pointless.
 *
 * So exactly one step — 讀全文-做記號 (full-text-annotate) — is readable and
 * listenable anonymously. Everything else keeps redirecting to /login, because
 * every other step writes something (annotations, recordings, scores) that
 * needs a user to write it against.
 *
 * These tests are the access-control boundary. Each one is mutation-checked:
 * see the header comment in LearningRouteGate itself for what breaks them.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import { LearningRouteGate } from './RouteGuards';

// The gate only asks AuthContext three questions; stub those rather than
// standing up the real provider (which would need a token endpoint).
const mockAuth = vi.fn();
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth(),
}));

// The guest page pulls a story over the network; we only care that the gate
// chose it, not what it renders.
vi.mock('../../pages/GuestReadingPage', () => ({
  default: () => <div>GUEST-READER</div>,
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/learn/:storyId/*"
          element={
            <LearningRouteGate>
              <div>PROTECTED-SHELL</div>
            </LearningRouteGate>
          }
        />
        <Route path="/login" element={<div>LOGIN-PAGE</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LearningRouteGate', () => {
  describe('anonymous visitor', () => {
    beforeEach(() => {
      mockAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: false,
        needsTermsAcceptance: false,
      });
    });

    it('lets a QR visitor read 讀全文-做記號 without logging in', async () => {
      renderAt('/learn/1/full-text-annotate');
      // The guest page is a lazy chunk, so it arrives a tick after the gate
      // decides — the spinner in between is the real behaviour too.
      expect(await screen.findByText('GUEST-READER')).toBeInTheDocument();
      expect(screen.queryByText('LOGIN-PAGE')).not.toBeInTheDocument();
    });

    it('honours the legacy id in QR codes already printed on paper', async () => {
      // reading-annotation is the pre-rename id; worksheets carrying it must
      // not start demanding a login.
      renderAt('/learn/1/reading-annotation');
      expect(await screen.findByText('GUEST-READER')).toBeInTheDocument();
    });

    it.each([
      ['key-passage-reading', 'recording is scored against a user'],
      ['character-practice', 'writes practice results'],
      ['report', 'shows one specific student’s data'],
      ['lesson-intro', 'not the step the QR code targets'],
    ])('still sends %s to /login (%s)', (step) => {
      renderAt(`/learn/1/${step}`);
      expect(screen.getByText('LOGIN-PAGE')).toBeInTheDocument();
      expect(screen.queryByText('GUEST-READER')).not.toBeInTheDocument();
    });

    it('does not leak the shell to an anonymous visitor on the public step', async () => {
      // The guest page is a separate, self-contained reader. The authenticated
      // shell creates DB learning sessions and must never mount without a user.
      renderAt('/learn/1/full-text-annotate');
      await screen.findByText('GUEST-READER');
      expect(screen.queryByText('PROTECTED-SHELL')).not.toBeInTheDocument();
    });
  });

  describe('signed-in user', () => {
    it('gets the normal shell on the public step, not the guest reader', () => {
      mockAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        needsTermsAcceptance: false,
      });
      renderAt('/learn/1/full-text-annotate');
      expect(screen.getByText('PROTECTED-SHELL')).toBeInTheDocument();
      expect(screen.queryByText('GUEST-READER')).not.toBeInTheDocument();
    });

    it('is still held at the terms gate', () => {
      mockAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        needsTermsAcceptance: true,
      });
      renderAt('/learn/1/character-practice');
      expect(screen.queryByText('PROTECTED-SHELL')).not.toBeInTheDocument();
    });
  });

  it('shows nothing decisive while auth is still resolving', () => {
    // Rendering the guest page during the loading window would flash an
    // anonymous reader at a user who is in fact signed in.
    mockAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      needsTermsAcceptance: false,
    });
    renderAt('/learn/1/full-text-annotate');
    expect(screen.queryByText('GUEST-READER')).not.toBeInTheDocument();
    expect(screen.queryByText('LOGIN-PAGE')).not.toBeInTheDocument();
  });
});
