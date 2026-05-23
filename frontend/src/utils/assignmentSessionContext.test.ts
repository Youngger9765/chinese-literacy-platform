/**
 * TDD tests for assignmentSessionContext.ts
 *
 * These three tests verify the session contract that MyAssignments.tsx must
 * honour so LearningLayout works correctly.  They were written BEFORE the
 * refactor and must pass on the original inline logic too.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SESSION_KEY_ACTIVE_ASSIGNMENT_ID,
  SESSION_KEY_ACTIVE_ASSIGNMENT_GOALS,
  SESSION_KEY_ACTIVE_ASSIGNMENT_CONTEXT,
  SESSION_KEY_DB_SESSION_PREFIX,
  dbSessionKey,
  writeAssignmentSessionContext,
} from './assignmentSessionContext';

// Vitest / jsdom provides sessionStorage out of the box.
beforeEach(() => {
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// Test 1: start_assignment_sets_assignment_context_goals_and_session_key
// ---------------------------------------------------------------------------
describe('start_assignment_sets_assignment_context_goals_and_session_key', () => {
  it('writes activeAssignmentId, goals, context blob, and db-session key', () => {
    const assignmentId = 42;
    const storyKey = 'L05';
    const userId = '7';
    const sessionId = 999;

    writeAssignmentSessionContext({
      assignmentId,
      storyKey,
      userId,
      goals: {
        target_cpm: 150,
        target_accuracy: 90,
        difficulty_label: 'medium',
        effective_cpm: 150,
        effective_accuracy: 90,
      },
      sessionId,
    });

    // LearningLayout reads this to auto-submit
    expect(sessionStorage.getItem(SESSION_KEY_ACTIVE_ASSIGNMENT_ID)).toBe('42');

    // AssessmentReport reads this for goal comparison
    const goals = JSON.parse(sessionStorage.getItem(SESSION_KEY_ACTIVE_ASSIGNMENT_GOALS) ?? '{}');
    expect(goals.target_cpm).toBe(150);
    expect(goals.target_accuracy).toBe(90);
    expect(goals.difficulty_label).toBe('medium');
    expect(goals.effective_cpm).toBe(150);
    expect(goals.effective_accuracy).toBe(90);

    // Context blob
    const ctx = JSON.parse(sessionStorage.getItem(SESSION_KEY_ACTIVE_ASSIGNMENT_CONTEXT) ?? '{}');
    expect(ctx.assignmentId).toBe(assignmentId);
    expect(ctx.userId).toBe(userId);
    expect(ctx.storyKey).toBe(storyKey);
    expect(typeof ctx.startedAt).toBe('number');

    // DB session linkage — uses the compound key
    const expectedKey = dbSessionKey(assignmentId, storyKey);
    expect(expectedKey).toBe(`${SESSION_KEY_DB_SESSION_PREFIX}42-L05`);
    expect(sessionStorage.getItem(expectedKey)).toBe('999');
  });

  it('sessionStorage key constants match what LearningLayout expects', () => {
    // Guard: if these constant values ever change the LearningLayout contract breaks.
    expect(SESSION_KEY_ACTIVE_ASSIGNMENT_ID).toBe('activeAssignmentId');
    expect(SESSION_KEY_ACTIVE_ASSIGNMENT_GOALS).toBe('activeAssignmentGoals');
    expect(SESSION_KEY_ACTIVE_ASSIGNMENT_CONTEXT).toBe('activeAssignmentContext');
    expect(SESSION_KEY_DB_SESSION_PREFIX).toBe('assignment-db-session-');
  });
});

// ---------------------------------------------------------------------------
// Test 2: resume_in_progress_backfills_missing_session_id_before_navigation
// ---------------------------------------------------------------------------
describe('resume_in_progress_backfills_missing_session_id_before_navigation', () => {
  it('clears legacy keys when writing a new session id', () => {
    const assignmentId = 10;
    const storyKey = '3';

    // Simulate legacy stale keys in sessionStorage
    sessionStorage.setItem(`${SESSION_KEY_DB_SESSION_PREFIX}${storyKey}`, 'old-val');
    sessionStorage.setItem(`db-session-${storyKey}`, 'also-old');

    writeAssignmentSessionContext({
      assignmentId,
      storyKey,
      userId: '5',
      goals: {
        target_cpm: null,
        target_accuracy: null,
        difficulty_label: null,
        effective_cpm: 120,
        effective_accuracy: 85,
      },
      sessionId: 77,
    });

    // New compound key is set
    expect(sessionStorage.getItem(dbSessionKey(assignmentId, storyKey))).toBe('77');

    // Legacy keys are removed
    expect(sessionStorage.getItem(`${SESSION_KEY_DB_SESSION_PREFIX}${storyKey}`)).toBeNull();
    expect(sessionStorage.getItem(`db-session-${storyKey}`)).toBeNull();
  });

  it('skips db-session keys when sessionId is null (legacy row without session_id)', () => {
    // If we resume an assignment that has no session_id yet, we don't write the
    // db-session key.  After calling startAssignment, caller must call again
    // with the obtained sessionId.
    writeAssignmentSessionContext({
      assignmentId: 99,
      storyKey: 'L10',
      userId: '1',
      goals: {
        target_cpm: 100,
        target_accuracy: 80,
        difficulty_label: null,
        effective_cpm: 100,
        effective_accuracy: 80,
      },
      sessionId: null,
    });

    // ID and goals are still written
    expect(sessionStorage.getItem(SESSION_KEY_ACTIVE_ASSIGNMENT_ID)).toBe('99');
    // No db-session key written
    expect(sessionStorage.getItem(dbSessionKey(99, 'L10'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 3: completed_or_graded_assignment_navigates_to_report_with_context
// ---------------------------------------------------------------------------
describe('completed_or_graded_assignment_navigates_to_report_with_context', () => {
  it('writes full context including session_id before navigating to /report', () => {
    // For submitted/graded assignments the textKey might be a numeric text_id.
    const assignmentId = 55;
    const textId = 123;  // numeric DB text id
    const sessionId = 321;

    writeAssignmentSessionContext({
      assignmentId,
      storyKey: textId,
      userId: '8',
      goals: {
        target_cpm: 180,
        target_accuracy: 95,
        difficulty_label: 'hard',
        effective_cpm: 180,
        effective_accuracy: 95,
      },
      sessionId,
    });

    expect(sessionStorage.getItem(SESSION_KEY_ACTIVE_ASSIGNMENT_ID)).toBe('55');

    const goals = JSON.parse(sessionStorage.getItem(SESSION_KEY_ACTIVE_ASSIGNMENT_GOALS) ?? '{}');
    expect(goals.target_cpm).toBe(180);

    const ctx = JSON.parse(sessionStorage.getItem(SESSION_KEY_ACTIVE_ASSIGNMENT_CONTEXT) ?? '{}');
    expect(ctx.assignmentId).toBe(55);
    // storyKey is always stored as string
    expect(ctx.storyKey).toBe('123');

    // DB session key uses string representation of textId
    expect(sessionStorage.getItem(dbSessionKey(assignmentId, textId))).toBe('321');
  });

  it('dbSessionKey helper formats the key consistently', () => {
    // Both string and number storyKeys produce the same key format.
    expect(dbSessionKey(7, 'abc')).toBe('assignment-db-session-7-abc');
    expect(dbSessionKey(7, 42)).toBe('assignment-db-session-7-42');
  });
});
