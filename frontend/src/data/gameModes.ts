/**
 * Single registry of every student-facing game mode's game-hub metadata —
 * issue #3663 round 2 ("既獨立且彈性": a new mode should be one registry
 * entry, not a hand-typed object added into StudentGameHubPage.tsx's own
 * array). Mirrors by hand (no cross-language codegen this round — nothing
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
 * STUDENT game-hub card (`StudentGameHubPage.tsx`) only. They are
 * deliberately NOT shared with `ClassroomPkSettingsPanel.tsx`'s switch
 * titles/descriptions (teacher-facing "toggle" copy) or
 * `TeacherGameHubPage.tsx`'s two management-page nav buttons — both use
 * different wording for at least one key on purpose (`pk_human`'s hub
 * card is titled "PK 對戰", a combined AI+human entry point, while the
 * teacher switch that gates only the human-matchmaking half is titled
 * "真人 PK" — forcing one shared string would change one of the two
 * UIs' visible copy) and the teacher hub's two buttons route to
 * `/teacher/*` management pages, not the student hub_route. See
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
}

export const GAME_MODES: readonly GameModeHubMeta[] = [
  {
    key: 'league',
    label: '跨班賽季',
    description: '和別班比幾週，平常讀課文就累積',
    hubRoute: '/student/our-class',
    classroomGated: true,
  },
  {
    key: 'live_quiz',
    label: '課堂搶答',
    description: '現在全班一起玩，約 10 分鐘',
    hubRoute: '/live',
    classroomGated: true,
  },
  {
    key: 'pk_human',
    label: 'PK 對戰',
    description: '一對一，隨時挑戰同學或文學家',
    hubRoute: '/pk',
    classroomGated: true,
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
