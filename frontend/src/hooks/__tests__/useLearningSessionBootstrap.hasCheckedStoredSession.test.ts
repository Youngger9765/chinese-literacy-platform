/**
 * TDD regression test for Issue #3707.
 *
 * Bug: on the very first render after a student reopens a lesson,
 * `dbSessionId` starts as `null` (its useState default) even when
 * sessionStorage already has a saved session id for this story — the
 * restore-from-sessionStorage effect hasn't run yet. LearningLayout's
 * `waitingForProgress` gate (`dbSessionId !== null && isProgressLoading`)
 * treats that transient null exactly like "there is genuinely no session",
 * so it renders the step page's Outlet immediately instead of waiting.
 * The step page mounts, its own "report initial state" effect fires with
 * the still-empty default stepProgressState, and that captured-empty
 * payload is what the 5s-debounced PUT eventually sends — overwriting the
 * student's real progress with steps_completed: [] (see #3694/#3707).
 *
 * Fix: `useLearningSessionBootstrap` exposes `hasCheckedStoredSession` —
 * false until the sessionStorage lookup has actually run once, true
 * afterwards regardless of outcome. LearningLayout folds this into
 * `waitingForProgress` so the step page never mounts before we know
 * whether an existing session (and its progress) needs to be restored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLearningSessionBootstrap } from '../useLearningSessionBootstrap';
import { SELF_DB_SESSION_KEY_PREFIX } from '../../layouts/learningSessionStorage';

vi.mock('../../services/api', () => ({
  fetchStory: vi.fn().mockResolvedValue({ id: 'story-1', stepSequence: null }),
  saveActiveSession: vi.fn(),
}));

const noopNavigate = vi.fn();

describe('useLearningSessionBootstrap — hasCheckedStoredSession (#3707)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reports hasCheckedStoredSession=true with the restored dbSessionId once settled, even when a session is already stored', async () => {
    // Student reopening a lesson they already started — sessionStorage has a
    // real dbSessionId from the previous visit, exactly like the recheck.mjs
    // reopen scenario.
    sessionStorage.setItem(`${SELF_DB_SESSION_KEY_PREFIX}story-1`, '987');

    const { result } = renderHook(() =>
      useLearningSessionBootstrap({
        storyId: 'story-1',
        user: { id: 'u1' } as never,
        token: 'tok',
        navigate: noopNavigate,
      }),
    );

    await waitFor(() => {
      expect(result.current.hasCheckedStoredSession).toBe(true);
    });
    expect(result.current.dbSessionId).toBe(987);
  });

  it('never reports a settled dbSessionId before hasCheckedStoredSession flips true — a consumer must not treat an unchecked null as "no session"', async () => {
    sessionStorage.setItem(`${SELF_DB_SESSION_KEY_PREFIX}story-1`, '987');

    const { result } = renderHook(() =>
      useLearningSessionBootstrap({
        storyId: 'story-1',
        user: { id: 'u1' } as never,
        token: 'tok',
        navigate: noopNavigate,
      }),
    );

    // The regression this locks: it must never be possible to observe
    // dbSessionId === null (the "no session" value) while
    // hasCheckedStoredSession is already true AND there really is a stored
    // session — i.e. once settled, the restored id must win.
    await waitFor(() => {
      expect(result.current.hasCheckedStoredSession).toBe(true);
      expect(result.current.dbSessionId).not.toBeNull();
    });
  });
});

describe('useLearningSessionBootstrap — hasCheckedForOrphanedSession (#3707 sibling race)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('flips true once the orphaned-session lookup settles, after creating a new session', async () => {
    // sessionStorage has nothing for this story — hasCheckedStoredSession
    // will settle with dbSessionId === null, which is exactly the
    // precondition for the follow-up orphaned-session lookup effect.
    const fetchMock = vi.fn()
      // GET .../sessions?...&status=in_progress&limit=1 — none found
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      // POST .../sessions — creates a new one
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 555 }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLearningSessionBootstrap({
        storyId: 'story-2',
        user: { id: 'u1' } as never,
        token: 'tok',
        navigate: noopNavigate,
      }),
    );

    await waitFor(() => {
      expect(result.current.hasCheckedForOrphanedSession).toBe(true);
    });
    expect(result.current.dbSessionId).toBe(555);
  });

  it('still flips true (does not hang forever) when the lookup fails outright', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLearningSessionBootstrap({
        storyId: 'story-3',
        user: { id: 'u1' } as never,
        token: 'tok',
        navigate: noopNavigate,
      }),
    );

    await waitFor(() => {
      expect(result.current.hasCheckedForOrphanedSession).toBe(true);
    });
    // Non-fatal per the hook's own contract — local progress still works
    // without a DB session; it must not silently invent one.
    expect(result.current.dbSessionId).toBeNull();
  });
});
