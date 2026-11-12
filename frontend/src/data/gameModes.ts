/**
 * Single registry of every student-facing game mode's game-hub metadata —
 * issue #3663 round 2 ("既獨立且彈性": a new mode should be one registry
 * entry, not a hand-typed object added into StudentGameHubPage.tsx's own
 * array). Round 3 extends this to the TEACHER side
 * (`ClassroomPkSettingsPanel.tsx`'s switch panel,
 * `TeacherGameHubPage.tsx`'s management-page nav) — adding a mode is now
 * one registry entry for students AND teachers.
 *
 * Mirrors by hand (no cross-language codegen this round — nothing
 * generates this file from the Python registry, so a new mode needs an
 * entry in BOTH `modes.py` and here; tracked as a follow-up, not a
 * blocking gap) the facts in `backend/app/services/game_core/modes.py`.
 *
 * `key` uses the same snake_case as the backend's `classrooms.feature_settings`
 * keys (`pk_human`/`league`/`live_quiz`) for the three classroom-gated
 * modes, and the backend's own mode identifier for the other two
 * (`escape_room`/`team_arena`) — it is only ever used as a React list key
 * and an internal lookup key here, never rendered.
 *
 * `label`/`description`/`hubRoute` are this module's single source for the
 * STUDENT game-hub card (`StudentGameHubPage.tsx`). The TEACHER-facing
 * switch titles/descriptions (`teacherSwitch*`) and management-page nav
 * (`teacherHub*`) are separate fields, not shared with these — they use
 * different wording for at least one key on purpose (`pk_human`'s student
 * hub card is titled "PK 對戰", a combined AI+human entry point, while the
 * teacher switch that gates only the human-matchmaking half is titled
 * "真人 PK" — one shared string would change one of the two UIs' visible
 * copy) and the teacher hub's nav buttons route to `/teacher/*`
 * management pages, not the student `hubRoute`. See
 * docs/architecture/game-modules.md for the full reasoning.
 */

export type GameModeKey = 'league' | 'live_quiz' | 'pk_human' | 'escape_room' | 'team_arena';

export interface GameModeHubMeta {
  key: GameModeKey;
  label: string;
  description: string;
  hubRoute: string;
  /** Whether this key is one of `classrooms.feature_settings`'s
   * recognized keys on the backend (`game_core.modes.CLASSROOM_GATED_KEYS`).
   * NOTE: this does NOT mean the hub card itself locks — see module
   * docstring above and `backend/app/services/game_core/modes.py`'s own
   * docstring for the `pk_human` asymmetry (its switch exists, but the
   * combined PK hub card never locks because AI PK inside it is always
   * reachable). Lock state for a card is computed separately, the same
   * way it always was (`computeStudentGameFlags()`). */
  classroomGated: boolean;

  // --- Teacher side (issue #3663 round 3) — undefined for a mode with no
  // teacher-facing switch / no teacher management page. Each pair below
  // is all-set or all-undefined together for a given mode (same invariant
  // the backend enforces at import time via
  // `_assert_teacher_fields_consistent`; this file has no equivalent
  // runtime check, see the "no cross-language codegen" note above). ---

  /** This mode's position in `ClassroomPkSettingsPanel.tsx`'s switches
   * list — NOT the same as this array's own declaration order (see
   * module docstring: the panel's on-screen order is 真人PK/跨班賽季/
   * 課堂搶答, this array orders league/live_quiz first for the student
   * hub's sake). */
  teacherSwitchOrder?: number;
  teacherSwitchTitle?: string;
  teacherSwitchDescription?: string;
  teacherSwitchAriaLabel?: string;

  /** Where `TeacherGameHubPage.tsx`'s nav button for this mode goes —
   * distinct from the student `hubRoute`. `undefined` if this mode has no
   * teacher management page at all (pk_human/escape_room/team_arena
   * today). */
  teacherHubRoute?: string;
  teacherHubLabel?: string;
  teacherHubDescription?: string;
  teacherHubEmoji?: string;
}

export const GAME_MODES: readonly GameModeHubMeta[] = [
  {
    key: 'league',
    label: '跨班賽季',
    description: '和別班比幾週，平常讀課文就累積',
    hubRoute: '/student/our-class',
    classroomGated: true,
    teacherSwitchOrder: 1,
    teacherSwitchTitle: '跨班賽季',
    teacherSwitchDescription: '跟其他班一起比幾週，附故事劇情包，預設關閉',
    teacherSwitchAriaLabel: '跨班賽季開關',
    teacherHubRoute: '/teacher/league',
    teacherHubLabel: '跨班賽季',
    teacherHubDescription: '查看排行榜、建立邀請',
    teacherHubEmoji: '🏆',
  },
  {
    key: 'live_quiz',
    label: '課堂搶答',
    description: '現在全班一起玩，約 10 分鐘',
    hubRoute: '/live',
    classroomGated: true,
    teacherSwitchOrder: 2,
    teacherSwitchTitle: '課堂搶答',
    teacherSwitchDescription: '現在全班一起即時搶答，約 10 分鐘，預設關閉',
    teacherSwitchAriaLabel: '課堂搶答開關',
    teacherHubRoute: '/teacher/live',
    teacherHubLabel: '課堂搶答',
    teacherHubDescription: '主持即時搶答',
    teacherHubEmoji: '🎮',
  },
  {
    key: 'pk_human',
    label: 'PK 對戰',
    description: '一對一，隨時挑戰同學或文學家',
    hubRoute: '/pk',
    classroomGated: true,
    teacherSwitchOrder: 0,
    teacherSwitchTitle: '真人 PK',
    teacherSwitchDescription: '同學之間配對對戰，預設關閉',
    teacherSwitchAriaLabel: '真人 PK 開關',
    // No teacherHub* — there is no `/teacher/pk` management page.
  },
  {
    key: 'escape_room',
    label: '迷城密室',
    description: '闖關解謎，救回被困的同伴',
    hubRoute: '/escape-room',
    classroomGated: false,
  },
  {
    key: 'team_arena',
    label: '多人對抗賽',
    description: '2～5 人一組，答題推塔對抗',
    hubRoute: '/team-arena',
    classroomGated: false,
  },
] as const;

export const CLASSROOM_GATED_MODE_KEYS: readonly GameModeKey[] = GAME_MODES.filter(
  (m) => m.classroomGated,
).map((m) => m.key);

/** `ClassroomPkSettingsPanel.tsx`'s switches, in the panel's own on-screen
 * order (真人PK, 跨班賽季, 課堂搶答 — NOT this array's declaration order). */
export const TEACHER_SWITCH_MODES: readonly GameModeHubMeta[] = GAME_MODES.filter(
  (m) => m.teacherSwitchOrder !== undefined,
)
  .slice()
  .sort((a, b) => (a.teacherSwitchOrder ?? 0) - (b.teacherSwitchOrder ?? 0));

/** `TeacherGameHubPage.tsx`'s management-page nav buttons, in `GAME_MODES`'
 * own declaration order (league then live_quiz today — matches the
 * page's existing left-to-right button order). */
export const TEACHER_HUB_MODES: readonly GameModeHubMeta[] = GAME_MODES.filter(
  (m) => m.teacherHubRoute !== undefined,
);
