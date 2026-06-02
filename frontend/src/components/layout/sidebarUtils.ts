/**
 * sidebarUtils — shared helpers for Sidebar components.
 *
 * Extracted from Sidebar.tsx (Issue #1937).
 */

/** Returns true when the current pathname matches the nav item's path. */
export function isActive(pathname: string, path: string): boolean {
  if (path === '/student' || path === '/teacher-home') {
    return pathname === path;
  }
  // /teacher matches only dashboard and classroom detail
  if (path === '/teacher') {
    return pathname === '/teacher' || /^\/teacher\/classroom\/\d+/.test(pathname);
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** localStorage key for collapse state */
export const SIDEBAR_STORAGE_KEY = 'sidebar-collapsed';
