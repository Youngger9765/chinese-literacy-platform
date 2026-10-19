/**
 * sidebarUtils — game-hub active-highlight prefixes (issue #3633).
 *
 * The student/teacher sidebars collapse 我們班/課堂搶答/PK 對戰 (student) and
 * 跨班賽季/課堂搶答 (teacher) into one 「遊戲區」 nav item each, but the old
 * routes still work unchanged (issue #3633: "舊網址照常可用"). So the 遊戲區
 * item must stay visually "active" while the student/teacher is actually on
 * one of those old pages — otherwise the sidebar looks wrong the moment
 * someone navigates into a game.
 */
import { describe, it, expect } from 'vitest';
import { isActive } from '../sidebarUtils';

describe('isActive — /game-hub stays active on the old student game routes (#3633)', () => {
  it.each([
    '/game-hub',
    '/student/our-class',
    '/live',
    '/live/ABC123',
    '/pk',
    '/pk/queue/5',
    '/pk/opponents',
    '/pk/match/9',
    '/escape-room',
    '/escape-room/run/9',
  ])('pathname=%s → active', (pathname) => {
    expect(isActive(pathname, '/game-hub')).toBe(true);
  });

  it.each(['/assignments', '/library', '/student', '/join', '/learning-history'])(
    'pathname=%s → NOT active',
    (pathname) => {
      expect(isActive(pathname, '/game-hub')).toBe(false);
    },
  );
});

describe('isActive — /teacher/game-hub stays active on the old teacher game routes (#3633)', () => {
  it.each([
    '/teacher/game-hub',
    '/teacher/league',
    '/teacher/live',
    '/teacher/live/ABC123',
    '/teacher/live/history',
    '/teacher/live/history/ABC123',
  ])('pathname=%s → active', (pathname) => {
    expect(isActive(pathname, '/teacher/game-hub')).toBe(true);
  });

  it.each(['/teacher', '/teacher/assignments', '/teacher/classroom/5'])(
    'pathname=%s → NOT active',
    (pathname) => {
      expect(isActive(pathname, '/teacher/game-hub')).toBe(false);
    },
  );
});

describe('isActive — pre-existing behaviour is unchanged for unrelated paths', () => {
  it('still does exact match for /student', () => {
    expect(isActive('/student', '/student')).toBe(true);
    expect(isActive('/student/our-class', '/student')).toBe(false);
  });

  it('still matches /teacher dashboard + classroom detail', () => {
    expect(isActive('/teacher', '/teacher')).toBe(true);
    expect(isActive('/teacher/classroom/42', '/teacher')).toBe(true);
    expect(isActive('/teacher/league', '/teacher')).toBe(false);
  });

  it('still does generic prefix match for ordinary items', () => {
    expect(isActive('/assignments', '/assignments')).toBe(true);
    expect(isActive('/assignments/5', '/assignments')).toBe(true);
    expect(isActive('/library', '/assignments')).toBe(false);
  });
});
