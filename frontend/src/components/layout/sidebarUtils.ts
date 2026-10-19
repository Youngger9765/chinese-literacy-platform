/**
 * sidebarUtils — shared helpers for Sidebar components.
 *
 * Extracted from Sidebar.tsx (Issue #1937).
 */

/**
 * issue #3633: 我們班／課堂搶答／PK 對戰 (student) and 跨班賽季／課堂搶答
 * (teacher) collapsed into one 「遊戲區」 nav item each, but the old routes
 * still work unchanged. So the 遊戲區 item must stay visually "active"
 * while the viewer is actually on one of the old game pages it replaced —
 * otherwise the sidebar looks wrong the moment someone opens a game.
 */
const GAME_HUB_STUDENT_ACTIVE_PREFIXES = ['/game-hub', '/student/our-class', '/live', '/pk', '/escape-room'];
const GAME_HUB_TEACHER_ACTIVE_PREFIXES = ['/teacher/game-hub', '/teacher/league', '/teacher/live'];

function matchesAnyPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Returns true when the current pathname matches the nav item's path. */
export function isActive(pathname: string, path: string): boolean {
  if (path === '/student' || path === '/teacher-home') {
    return pathname === path;
  }
  // /teacher matches only dashboard and classroom detail
  if (path === '/teacher') {
    return pathname === '/teacher' || /^\/teacher\/classroom\/\d+/.test(pathname);
  }
  if (path === '/game-hub') {
    return matchesAnyPrefix(pathname, GAME_HUB_STUDENT_ACTIVE_PREFIXES);
  }
  if (path === '/teacher/game-hub') {
    return matchesAnyPrefix(pathname, GAME_HUB_TEACHER_ACTIVE_PREFIXES);
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** localStorage key for collapse state */
export const SIDEBAR_STORAGE_KEY = 'sidebar-collapsed';
