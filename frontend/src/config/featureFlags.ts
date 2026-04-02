/**
 * Centralized frontend feature flags.
 *
 * Parent portal is hidden by default and can be re-enabled with:
 * VITE_PARENT_PORTAL_ENABLED=true
 */

const rawParentPortalFlag = import.meta.env.VITE_PARENT_PORTAL_ENABLED as string | undefined;

export const PARENT_PORTAL_ENABLED = rawParentPortalFlag === 'true';
