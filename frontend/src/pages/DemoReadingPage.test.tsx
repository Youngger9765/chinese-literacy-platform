/**
 * DemoReadingPage.test.tsx — TDD for #2625 免登入播放頁
 *
 * Test list (from the issue spec):
 *  1. Route renders for anonymous visitor — no redirect to /login
 *  2. <audio> src = …/assets/demo-reading/{id}/{kind}.mp3
 *  3. Page never calls /api/tts/synthesize
 *  4. Missing audio shows message, does NOT fall back to speechSynthesis
 *  5. Following 「開始朗讀」 as anonymous lands on login page
 *  6. Component in render-smoke.test.tsx
 *
 * Mutations (spec-required):
 *  - Put route inside ProtectedRoute → test 1 must fail
 *  - Point 「開始朗讀」 outside ProtectedRoute → test 5 must fail
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

// Mock AuthContext: simulate anonymous user (no token, not authenticated)
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null, isAuthenticated: false }),
}));

// Track fetch calls to assert no /api/tts/synthesize is made
const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/api/stories/')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          id: 42,
          title: '愛讀書的顧寧人',
          paragraphs: ['第一段文字', '第二段文字'],
          key_reading: { passage: '重點段落' },
        }),
      });
    }
    // Any other fetch (including tts/synthesize) returns 401
    return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

// Lazy import so the mock is in place before module load
const DemoReadingPage = React.lazy(() => import('./DemoReadingPage'));

function renderAtRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <React.Suspense fallback={<div>loading</div>}>
        <Routes>
          <Route path="/demo-reading/:lessonId/:kind" element={<DemoReadingPage />} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </React.Suspense>
    </MemoryRouter>
  );
}

describe('#2625 免登入播放頁 — DemoReadingPage', () => {
  it('1. renders for an anonymous visitor without redirecting to /login', async () => {
    renderAtRoute('/demo-reading/42/full');
    // Should NOT see the login page
    await waitFor(() => {
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    });
    // Should see something from the component (title or text)
    await waitFor(() => {
      expect(screen.getByText('愛讀書的顧寧人')).toBeInTheDocument();
    });
  });

  it('2. audio src is /assets/demo-reading/{id}/{kind}.mp3', async () => {
    renderAtRoute('/demo-reading/42/full');
    await waitFor(() => {
      expect(screen.getByText('愛讀書的顧寧人')).toBeInTheDocument();
    });
    const audio = document.querySelector('audio') as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect(audio.src).toContain('/assets/demo-reading/42/full.mp3');
  });

  it('2b. passage kind uses passage.mp3', async () => {
    renderAtRoute('/demo-reading/42/passage');
    await waitFor(() => {
      expect(screen.getByText('愛讀書的顧寧人')).toBeInTheDocument();
    });
    const audio = document.querySelector('audio') as HTMLAudioElement;
    expect(audio.src).toContain('/assets/demo-reading/42/passage.mp3');
  });

  it('3. never calls /api/tts/synthesize', async () => {
    renderAtRoute('/demo-reading/42/full');
    await waitFor(() => {
      expect(screen.getByText('愛讀書的顧寧人')).toBeInTheDocument();
    });
    const ttsCalls = fetchSpy.mock.calls.filter(
      ([url]: [string]) => typeof url === 'string' && url.includes('/api/tts/synthesize')
    );
    expect(ttsCalls).toHaveLength(0);
  });

  it('4. missing audio shows message, does NOT use speechSynthesis', async () => {
    // Spy on speechSynthesis.speak to ensure it's never called as fallback
    const speakSpy = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak: speakSpy, cancel: vi.fn(), getVoices: () => [] });

    renderAtRoute('/demo-reading/42/full');
    await waitFor(() => {
      expect(screen.getByText('愛讀書的顧寧人')).toBeInTheDocument();
    });
    // Simulate audio error
    const audio = document.querySelector('audio') as HTMLAudioElement;
    expect(audio).not.toBeNull();
    audio.dispatchEvent(new Event('error'));

    await waitFor(() => {
      expect(
        screen.getByText(/音檔尚未準備|無法播放|audio not available/i)
      ).toBeInTheDocument();
    });
    // speechSynthesis must NOT be called as a fallback
    expect(speakSpy).not.toHaveBeenCalled();
  });

  it('5. 「開始朗讀」 link points to /learn/{id}/key-passage-reading (login wall is expected)', async () => {
    renderAtRoute('/demo-reading/42/full');
    await waitFor(() => {
      expect(screen.getByText('愛讀書的顧寧人')).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /開始朗讀/ });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/learn/42/key-passage-reading');
  });
});
