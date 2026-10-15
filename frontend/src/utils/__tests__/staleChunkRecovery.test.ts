import { describe, it, expect, vi } from 'vitest';
import { installStaleChunkRecovery, RECOVERY_WINDOW_MS } from '../staleChunkRecovery';

function fakeWindow() {
  const target = new EventTarget();
  const store = new Map<string, string>();
  return {
    addEventListener: target.addEventListener.bind(target),
    dispatch: () => {
      const ev = new Event('vite:preloadError', { cancelable: true });
      target.dispatchEvent(ev);
      return ev;
    },
    location: { reload: vi.fn() },
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
}

describe('stale chunk recovery (field report 2026-10-13)', () => {
  it('a failed chunk load reloads the page once to fetch the new build', () => {
    const w = fakeWindow();
    let t = 1_000_000;
    installStaleChunkRecovery(w as never, () => t);
    const ev = w.dispatch();
    expect(w.location.reload).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not loop: a second failure right after the reload is left to ErrorBoundary', () => {
    const w = fakeWindow();
    let t = 1_000_000;
    installStaleChunkRecovery(w as never, () => t);
    w.dispatch();
    t += 5_000;
    w.dispatch();
    expect(w.location.reload).toHaveBeenCalledTimes(1);
    t += RECOVERY_WINDOW_MS;
    w.dispatch();
    expect(w.location.reload).toHaveBeenCalledTimes(2);
  });
});
