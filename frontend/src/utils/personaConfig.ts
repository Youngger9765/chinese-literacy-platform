/**
 * Frontend persona config — aligned with backend/app/services/persona.py
 * Issue #54: Unified "warm but firm" AI tutor personality
 */

// Reading thresholds (LiveTutor per-line)
export const READING_EXCELLENT = 0.80;  // >=80%: very good
export const READING_PASS = 0.60;       // >=60%: pass
// <60%: retry

// FullReading fluency thresholds
export const FULLREADING_CPM_PASS = 120;
export const FULLREADING_ACCURACY_PASS = 0.80;

// AssessmentReport CPM tiers
export const CPM_VERY_FAST = 180;
export const CPM_FAST = 130;
export const CPM_MEDIUM = 90;
export const CPM_SLOW = 50;
