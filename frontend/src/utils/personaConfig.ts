/**
 * Frontend persona thresholds — mirrors backend/app/services/persona.py
 * Issue #54: Unified "warm but firm" AI tutor persona across all steps.
 */

// LiveTutor per-line reading thresholds (frontend fallback defaults).
// Primary thresholds should come from backend /api/reading/evaluate response.
export const READING_EXCELLENT = 0.80; // ≥80%: 很棒
export const READING_PASS = 0.60; // ≥60%: 很好，過關
// <60%: 重唸

// FullReading fluency thresholds
export const FULLREADING_CPM_PASS = 120;
export const FULLREADING_ACCURACY_PASS = 0.80;

// AssessmentReport CPM tiers
export const CPM_VERY_FAST = 180;
export const CPM_FAST = 130;
export const CPM_MEDIUM = 90;
export const CPM_SLOW = 50;
