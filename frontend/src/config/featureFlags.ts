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
