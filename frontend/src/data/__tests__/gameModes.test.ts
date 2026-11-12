/**
 * gameModes.ts — issue #3663 round 3. Pins the derived teacher-side lists
 * exactly as they rendered before this round (ClassroomPkSettingsPanel.tsx's
 * SWITCHES array, TeacherGameHubPage.tsx's two nav buttons), so a future
 * edit to the registry can't silently reorder or reword either screen.
 */
import { describe, it, expect } from 'vitest';
import { GAME_MODES, TEACHER_SWITCH_MODES, TEACHER_HUB_MODES } from '../gameModes';

describe('TEACHER_SWITCH_MODES', () => {
  it('orders switches 真人PK, 跨班賽季, 課堂搶答 — the panel\'s pre-registry order', () => {
    expect(TEACHER_SWITCH_MODES.map((m) => m.key)).toEqual(['pk_human', 'league', 'live_quiz']);
  });

  it('carries the exact pre-registry switch text for every entry', () => {
    const byKey = Object.fromEntries(TEACHER_SWITCH_MODES.map((m) => [m.key, m]));
    expect(byKey.pk_human).toMatchObject({
      teacherSwitchTitle: '真人 PK',
      teacherSwitchDescription: '同學之間配對對戰，預設關閉',
      teacherSwitchAriaLabel: '真人 PK 開關',
    });
    expect(byKey.league).toMatchObject({
      teacherSwitchTitle: '跨班賽季',
      teacherSwitchDescription: '跟其他班一起比幾週，附故事劇情包，預設關閉',
      teacherSwitchAriaLabel: '跨班賽季開關',
    });
    expect(byKey.live_quiz).toMatchObject({
      teacherSwitchTitle: '課堂搶答',
      teacherSwitchDescription: '現在全班一起即時搶答，約 10 分鐘，預設關閉',
      teacherSwitchAriaLabel: '課堂搶答開關',
    });
  });
});

describe('TEACHER_HUB_MODES', () => {
  it('lists only league and live_quiz, in that order', () => {
    expect(TEACHER_HUB_MODES.map((m) => m.key)).toEqual(['league', 'live_quiz']);
  });

  it('carries the exact pre-registry nav-button text and route for each', () => {
    const byKey = Object.fromEntries(TEACHER_HUB_MODES.map((m) => [m.key, m]));
    expect(byKey.league).toMatchObject({
      teacherHubRoute: '/teacher/league',
      teacherHubLabel: '跨班賽季',
      teacherHubDescription: '查看排行榜、建立邀請',
      teacherHubEmoji: '🏆',
    });
    expect(byKey.live_quiz).toMatchObject({
      teacherHubRoute: '/teacher/live',
      teacherHubLabel: '課堂搶答',
      teacherHubDescription: '主持即時搶答',
      teacherHubEmoji: '🎮',
    });
  });

  it('pk_human/escape_room/team_arena have no teacher hub entry', () => {
    const hubKeys = TEACHER_HUB_MODES.map((m) => m.key);
    expect(hubKeys).not.toContain('pk_human');
    expect(hubKeys).not.toContain('escape_room');
    expect(hubKeys).not.toContain('team_arena');
  });
});

describe('GAME_MODES — student hub (unchanged by round 3)', () => {
  it('still has 5 modes with the student-facing label/description/route round 2 pinned', () => {
    expect(GAME_MODES).toHaveLength(5);
    const pk = GAME_MODES.find((m) => m.key === 'pk_human');
    expect(pk?.label).toBe('PK 對戰'); // student hub card title, NOT the teacher switch's "真人 PK"
    expect(pk?.description).toBe('一對一，隨時挑戰同學或文學家');
    expect(pk?.hubRoute).toBe('/pk');
  });
});
