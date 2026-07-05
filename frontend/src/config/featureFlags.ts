/**
 * Centralized frontend feature flags.
 *
 * Parent portal is hidden by default and can be re-enabled with:
 * VITE_PARENT_PORTAL_ENABLED=true
 *
 * Fill-in-blank ABCD badges A/B (#2082):
 * - FILLBLANK_SHOW_ABCD=false (default) → simple options, no letter badges
 * - FILLBLANK_SHOW_ABCD=true  → show ABCD letter badges (matches physical worksheet)
 * Toggle via VITE_FILLBLANK_SHOW_ABCD=true at build time, or override at runtime
 * via localStorage key "flag_FILLBLANK_SHOW_ABCD" = "true" | "false".
 */

const rawParentPortalFlag = import.meta.env.VITE_PARENT_PORTAL_ENABLED as string | undefined;

export const PARENT_PORTAL_ENABLED = rawParentPortalFlag === 'true';

// FILLBLANK_SHOW_ABCD: show letter badge (A/B/C/D) on fill-blank answer options.
// Default false → simpler UI. Set VITE_FILLBLANK_SHOW_ABCD=true to enable.
// Runtime override via localStorage: flag_FILLBLANK_SHOW_ABCD = "true" | "false"
const _rawAbcd = import.meta.env.VITE_FILLBLANK_SHOW_ABCD as string | undefined;
const _lsAbcd =
  typeof window !== 'undefined'
    ? window.localStorage?.getItem('flag_FILLBLANK_SHOW_ABCD')
    : null;
export const FILLBLANK_SHOW_ABCD: boolean =
  _lsAbcd != null ? _lsAbcd === 'true' : _rawAbcd === 'true';

// LESSON_RENDERER_V1: Phase-2 unified block-based lesson renderer (閱讀聚光燈 refactor).
// Default ON (go-live). StrategyExercisePage / ComprehensionMcqPage render the new
// LessonRenderer (via storyToLesson) and fall back to the legacy path
// (ComprehensionLayout / BlockSequenceRenderer / StrategyExercise) whenever the adapter
// can't produce a valid Lesson — so a bad lesson degrades to legacy, never white-screens.
// To force the legacy path: VITE_LESSON_RENDERER_V1=false at build time, or per-browser
// at runtime via localStorage key "flag_LESSON_RENDERER_V1" = "true" | "false".
const _rawLesson = import.meta.env.VITE_LESSON_RENDERER_V1 as string | undefined;
const _lsLesson =
  typeof window !== 'undefined'
    ? window.localStorage?.getItem('flag_LESSON_RENDERER_V1')
    : null;
export const LESSON_RENDERER_V1: boolean =
  _lsLesson != null
    ? _lsLesson === 'true'
    : _rawLesson != null
      ? _rawLesson === 'true'
      : true; // default ON (go-live); localStorage / VITE_LESSON_RENDERER_V1 override

// FILLBLANK_OPTION_MODE: how answer options are presented (#7 教授「選項呈現兩案」).
//   'all'      → show every bank word; used ones grey out (current default)
//   'random4'  → show 4 options per question (correct + 3 random decoys) = 案 (a) 降難度
//   'disappear'→ show all; used words are removed (not greyed) = 案 (b)
// 兩案併陳供 A/B：default 'all', switch via VITE_FILLBLANK_OPTION_MODE or
// localStorage key "flag_FILLBLANK_OPTION_MODE".
export type FillBlankOptionMode = 'all' | 'random4' | 'disappear';
const _rawOptMode = import.meta.env.VITE_FILLBLANK_OPTION_MODE as string | undefined;
const _lsOptMode =
  typeof window !== 'undefined'
    ? window.localStorage?.getItem('flag_FILLBLANK_OPTION_MODE')
    : null;
const _optMode = (_lsOptMode ?? _rawOptMode) as string | null | undefined;
export const FILLBLANK_OPTION_MODE: FillBlankOptionMode =
  _optMode === 'random4' || _optMode === 'disappear' ? _optMode : 'all';
