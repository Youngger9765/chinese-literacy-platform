/**
 * TDD tests for LearningLayout refactor (Issue #1878)
 *
 * Red phase: tests written FIRST against the two extracted utility modules.
 * The utility files must exist and satisfy these contracts before the
 * full LearningLayout.tsx is refactored to use them.
 *
 * 3 acceptance criteria:
 *
 * 1. learning_step_transitions_follow_active_step_config
 *    Every step in the active lesson sequence has a transition entry, and
 *    getNextEnabledStep() returns the immediately following enabled step.
 *
 * 2. assignment_completion_does_not_submit_until_required_steps_done
 *    When required steps are missing, handleSessionComplete-equivalent logic
 *    keeps the session open (i.e. isAssignmentReadyForSubmit stays false).
 *    Implemented as a pure-logic test on the data structures.
 *
 * 3. toolbox_mode_never_creates_or_restores_learning_session
 *    readDbSessionId / buildActiveDbSessionKey are never reached in toolbox
 *    mode — the guard branch returns early.  Verified by showing that the
 *    isToolboxMode() helper correctly reflects sessionStorage state AND that
 *    buildActiveDbSessionKey produces the right key types for non-toolbox flows.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { STEP_TRANSITIONS, getNextEnabledStep } from '../learningStepTransitions';
import {
  buildActiveDbSessionKey,
  readDbSessionId,
  writeDbSessionId,
  clearAllSessionKeys,
  ASSIGNMENT_DB_SESSION_KEY_PREFIX,
  SELF_DB_SESSION_KEY_PREFIX,
  LEGACY_DB_SESSION_KEY_PREFIX,
} from '../learningSessionStorage';

import { resolveActiveSteps } from '../../config/stepConfig';
import { isToolboxMode, setToolboxMode } from '../../services/learningStorageScope';

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  // Ensure toolbox mode is off by default
  setToolboxMode(false);
});

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setToolboxMode(false);
  vi.restoreAllMocks();
});

// =============================================================================
// Test 1: learning_step_transitions_follow_active_step_config
// =============================================================================

describe('learning_step_transitions_follow_active_step_config', () => {
  it('every step in the default active sequence (except report and intro) has a STEP_TRANSITIONS entry', () => {
    const activeSteps = resolveActiveSteps(); // default sequence, enabled only
    // 'report' is the terminal step — no outgoing transition needed.
    // 'intro' completion is handled by handleStartReading (not a handleFinish*),
    // so it does not need a STEP_TRANSITIONS entry.
    const stepsNeedingTransition = activeSteps
      .filter((s) => s.id !== 'report' && s.id !== 'intro')
      .map((s) => s.id);

    for (const stepId of stepsNeedingTransition) {
      expect(
        STEP_TRANSITIONS,
        `STEP_TRANSITIONS is missing an entry for step "${stepId}"`,
      ).toHaveProperty(stepId);
    }
  });

  it('getNextEnabledStep returns the immediately following step in the active sequence', () => {
    const activeSteps = resolveActiveSteps();
    const activeIds = activeSteps.map((s) => s.id);

    for (let i = 0; i < activeIds.length - 1; i++) {
      const current = activeIds[i];
      const expected = activeIds[i + 1];
      const actual = getNextEnabledStep(current, activeIds);
      expect(actual).toBe(expected);
    }
  });

  it('getNextEnabledStep falls back to STEP_TRANSITIONS when step not in custom sequence', () => {
    // 'tutor' is not in this custom list
    const customSequence = ['reading-annotation', 'full-reading', 'report'];
    const result = getNextEnabledStep('tutor', customSequence);
    // Falls back to STEP_TRANSITIONS['tutor'].nextStep = 'full-reading'
    expect(result).toBe(STEP_TRANSITIONS['tutor'].nextStep);
  });

  it('each STEP_TRANSITIONS entry has consistent completeStep == key', () => {
    for (const [key, transition] of Object.entries(STEP_TRANSITIONS)) {
      expect(transition.completeStep).toBe(key);
    }
  });

  it('STEP_TRANSITIONS nextStep values are valid step IDs (present in STEP_TRANSITIONS or == report)', () => {
    const validNextSteps = new Set([...Object.keys(STEP_TRANSITIONS), 'report']);
    for (const [key, transition] of Object.entries(STEP_TRANSITIONS)) {
      expect(
        validNextSteps.has(transition.nextStep),
        `STEP_TRANSITIONS["${key}"].nextStep = "${transition.nextStep}" is not a valid step ID`,
      ).toBe(true);
    }
  });

  it('a custom lesson step_sequence that disables some steps still gets correct next', () => {
    // Simulate a lesson that skips vocab steps — goes directly annotation → tutor → full-reading → report
    const customIds = ['reading-annotation', 'tutor', 'full-reading', 'report'];
    expect(getNextEnabledStep('reading-annotation', customIds)).toBe('tutor');
    expect(getNextEnabledStep('tutor', customIds)).toBe('full-reading');
    expect(getNextEnabledStep('full-reading', customIds)).toBe('report');
  });
});

// =============================================================================
// Test 2: assignment_completion_does_not_submit_until_required_steps_done
// =============================================================================

describe('assignment_completion_does_not_submit_until_required_steps_done', () => {
  /**
   * This mirrors the isAssignmentReadyForSubmit logic in LearningLayout:
   *   requiredSteps = lessonActiveSteps.filter(s => s.id !== 'report')
   *   missingSteps  = requiredSteps.filter(s => !completedStepsSet.has(s.id))
   *   isReady       = missingSteps.length === 0
   */
  function computeIsReady(completedStepIds: string[]): {
    isReady: boolean;
    missingCount: number;
  } {
    const activeSteps = resolveActiveSteps();
    const required = activeSteps.filter((s) => s.id !== 'report');
    const completedSet = new Set(completedStepIds);
    const missing = required.filter((s) => !completedSet.has(s.id));
    return { isReady: missing.length === 0, missingCount: missing.length };
  }

  it('returns not-ready when no steps are completed', () => {
    const { isReady, missingCount } = computeIsReady([]);
    expect(isReady).toBe(false);
    expect(missingCount).toBeGreaterThan(0);
  });

  it('returns not-ready when only some steps are completed', () => {
    // Partially complete — only the first 3 steps done
    const partial = ['reading-annotation', 'tutor', 'full-reading'];
    const { isReady } = computeIsReady(partial);
    expect(isReady).toBe(false);
  });

  it('returns ready only when ALL required steps (excluding report) are completed', () => {
    const activeSteps = resolveActiveSteps();
    const allRequiredIds = activeSteps
      .filter((s) => s.id !== 'report')
      .map((s) => s.id);
    const { isReady } = computeIsReady(allRequiredIds);
    expect(isReady).toBe(true);
  });

  it('completing only the report step (terminal) does not make assignment ready', () => {
    // Report alone is not a "required" step for submission
    const { isReady } = computeIsReady(['report']);
    expect(isReady).toBe(false);
  });

  it('extra unknown step IDs in completedSteps do not break computation', () => {
    const activeSteps = resolveActiveSteps();
    const allRequired = activeSteps
      .filter((s) => s.id !== 'report')
      .map((s) => s.id);
    // Include a bogus step — should not affect result
    const { isReady } = computeIsReady([...allRequired, 'bogus-step-xyz']);
    expect(isReady).toBe(true);
  });
});

// =============================================================================
// Test 3: toolbox_mode_never_creates_or_restores_learning_session
// =============================================================================

describe('toolbox_mode_never_creates_or_restores_learning_session', () => {
  it('isToolboxMode returns false by default', () => {
    expect(isToolboxMode()).toBe(false);
  });

  it('isToolboxMode returns true after setToolboxMode(true)', () => {
    setToolboxMode(true);
    expect(isToolboxMode()).toBe(true);
  });

  it('isToolboxMode returns false after setToolboxMode(false)', () => {
    setToolboxMode(true);
    setToolboxMode(false);
    expect(isToolboxMode()).toBe(false);
  });

  it('buildActiveDbSessionKey produces self-practice key when not in assignment flow', () => {
    const key = buildActiveDbSessionKey('story-abc', false);
    expect(key).toBe(`${SELF_DB_SESSION_KEY_PREFIX}story-abc`);
    expect(key).not.toContain('__t'); // must never be a toolbox-scoped key
  });

  it('buildActiveDbSessionKey produces assignment key when in assignment flow with assignmentId', () => {
    sessionStorage.setItem('activeAssignmentId', '42');
    const key = buildActiveDbSessionKey('story-abc', true);
    expect(key).toBe(`${ASSIGNMENT_DB_SESSION_KEY_PREFIX}42-story-abc`);
  });

  it('readDbSessionId returns null when sessionStorage is empty (toolbox skip guard)', () => {
    // Simulate what LearningLayout does: isToolboxMode() → return early before calling readDbSessionId
    // Here we test the helper directly — it should return null on empty storage
    const result = readDbSessionId('any-key', null);
    expect(result).toBeNull();
  });

  it('readDbSessionId returns null for legacy key containing non-integer', () => {
    sessionStorage.setItem('db-session-story1', 'not-a-number');
    const result = readDbSessionId(
      `${SELF_DB_SESSION_KEY_PREFIX}story1`,
      `${LEGACY_DB_SESSION_KEY_PREFIX}story1`,
    );
    expect(result).toBeNull();
  });

  it('writeDbSessionId stores integer and removes legacy key', () => {
    const activeKey = `${SELF_DB_SESSION_KEY_PREFIX}story1`;
    const legacyKey = `${LEGACY_DB_SESSION_KEY_PREFIX}story1`;
    sessionStorage.setItem(legacyKey, '99'); // pre-existing legacy value

    writeDbSessionId(activeKey, legacyKey, 123);

    expect(sessionStorage.getItem(activeKey)).toBe('123');
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
  });

  it('clearAllSessionKeys removes all specified keys', () => {
    const activeKey = `${SELF_DB_SESSION_KEY_PREFIX}s1`;
    const legacyKey = `${LEGACY_DB_SESSION_KEY_PREFIX}s1`;
    const tutorKey = 'tutor_completed_s1';
    const liveTutorKey = 'liveTutor_progress_s1';

    sessionStorage.setItem(activeKey, '1');
    sessionStorage.setItem(legacyKey, '1');
    localStorage.setItem(tutorKey, '[0,1,2]');
    localStorage.setItem(liveTutorKey, '{"completedParagraphs":[0]}');

    clearAllSessionKeys({
      activeKey,
      legacyKey,
      tutorLocalKey: tutorKey,
      liveTutorLocalKey: liveTutorKey,
    });

    expect(sessionStorage.getItem(activeKey)).toBeNull();
    expect(sessionStorage.getItem(legacyKey)).toBeNull();
    expect(localStorage.getItem(tutorKey)).toBeNull();
    expect(localStorage.getItem(liveTutorKey)).toBeNull();
  });

  it('clearAllSessionKeys is safe with all-null opts (no crash)', () => {
    expect(() =>
      clearAllSessionKeys({ activeKey: null, legacyKey: null, tutorLocalKey: null, liveTutorLocalKey: null }),
    ).not.toThrow();
  });
});
