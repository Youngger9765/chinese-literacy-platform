/**
 * omoConfidenceThresholds.ts
 *
 * Confidence tier constants for the OMO 3-tier identification UX.
 *
 * Tier logic:
 *   conf >= HIGH  → show prominent single-candidate confirm
 *   conf >= MED   → show top-3 candidate cards (all clickable)
 *   conf < MED    → "unclear image" prompt with retake / manual-pick options
 */

/** High confidence: AI is very sure — show single primary confirm button */
export const OMO_CONF_HIGH = 0.9;

/** Medium confidence: show top-3 clickable candidate cards */
export const OMO_CONF_MEDIUM = 0.4;
