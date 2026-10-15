/**
 * Recover from "stale chunk after deploy".
 *
 * Every deploy replaces the hashed JS chunks. A tab (or a cached index.html)
 * from the previous build still points at the old chunk names; the first
 * lazy route it opens 404s, React throws, and ErrorBoundary's auto-reloads
 * can't fix it while the browser keeps serving the old index.html from cache.
 * Field report 2026-10-13: a class hit the error page 58 min after a prod
 * deploy (index.html was cached for 1 h; 18 deploys happened in school hours).
 *
 * Vite fires `vite:preloadError` when a dynamic import fails. We reload once
 * to fetch the current index.html (now served no-cache, see firebase.json),
 * and refuse to loop: at most one recovery reload per RECOVERY_WINDOW_MS.
 */
export const STALE_CHUNK_RELOAD_KEY = 'stale_chunk_reload_at';
export const RECOVERY_WINDOW_MS = 30_000;

type RecoveryWindow = Pick<Window, 'addEventListener'> & {
  location: Pick<Location, 'reload'>;
  sessionStorage: Pick<Storage, 'getItem' | 'setItem'>;
};

export function installStaleChunkRecovery(win: RecoveryWindow = window, now: () => number = Date.now): void {
  win.addEventListener('vite:preloadError', (event: Event) => {
    let last = 0;
    try {
      last = Number(win.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) ?? 0) || 0;
    } catch {
      // storage unavailable — fall through and still try once
    }
    if (now() - last < RECOVERY_WINDOW_MS) return; // already tried; let ErrorBoundary show the page
    try {
      win.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(now()));
    } catch {
      // ignore
    }
    event.preventDefault();
    win.location.reload();
  });
}
