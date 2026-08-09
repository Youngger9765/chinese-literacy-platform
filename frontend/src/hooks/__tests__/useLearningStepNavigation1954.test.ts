/**
 * TDD characterization tests for Issue #1954
 * Split useLearningStepNavigation.ts (520 LOC) into:
 *
 *   1. stepNavigationTransitions  — pure step→nextStep table (pure module)
 *   2. buildStepFinishPayload     — helper: produces persistStepProgressState opts
 *   3. useStepNavigationHandlers  — composer hook (existing interface preserved)
 *
 * Strategy: test the pure logic modules in isolation.
 * The hook itself uses React internals (useCallback/useRef) and would require
 * renderHook; the pure helpers are the real risk surface.
 *
 * RED phase: written against the *extracted* modules that don't exist yet.
 * These will fail until implementation (Phase 2).
 */

import { describe, it, expect } from 'vitest';

// These imports will be RED until the files are created
import {
  STEP_FINISH_TRANSITIONS,
  getDefaultNextStep,
} from '../stepNavigationTransitions';

import {
  buildStepFinishPayload,
} from '../stepHandlerUtils';

// ─── Test 1: stepNavigationTransitions — pure table ──────────────────────────

describe('STEP_FINISH_TRANSITIONS table', () => {
  it('covers all 13 expected step ids', () => {
    const expectedKeys = [
      'paragraph-reading',
      'comprehension',
      'character-practice',
      'key-passage-reading',
      'listening',
      'full-text-annotate',
      'vocab-definition',
      'vocab-application',
      'keypoints-table',
      'spotlight',
      'sentence-practice',
      'vocab-review',
      'knowledge-station',
    ];
    for (const key of expectedKeys) {
      expect(STEP_FINISH_TRANSITIONS).toHaveProperty(key);
    }
  });

  it('each entry has completeStep, nextStep, stepDataKey fields', () => {
    for (const [id, entry] of Object.entries(STEP_FINISH_TRANSITIONS)) {
      expect(entry).toHaveProperty('completeStep', expect.any(String));
      expect(entry).toHaveProperty('nextStep', expect.any(String));
      expect(entry).toHaveProperty('stepDataKey', expect.any(String));
      // completeStep should match the map key
      expect(entry.completeStep).toBe(id);
    }
  });

  it('reading-annotation → nextStep is tutor', () => {
    expect(STEP_FINISH_TRANSITIONS['full-text-annotate'].nextStep).toBe('paragraph-reading');
  });

  it('tutor → nextStep is full-reading', () => {
    expect(STEP_FINISH_TRANSITIONS['paragraph-reading'].nextStep).toBe('key-passage-reading');
  });

  it('knowledge-station → nextStep is report', () => {
    expect(STEP_FINISH_TRANSITIONS['knowledge-station'].nextStep).toBe('report');
  });

  it('comprehension → nextStep is vocab-word-search', () => {
    expect(STEP_FINISH_TRANSITIONS['comprehension'].nextStep).toBe('vocab-review');
  });

  it('vocab-word-search → nextStep is knowledge-station', () => {
    expect(STEP_FINISH_TRANSITIONS['vocab-review'].nextStep).toBe('knowledge-station');
  });
});

// ─── Test 2: getDefaultNextStep — fallback logic ──────────────────────────────

describe('getDefaultNextStep', () => {
  it('returns the mapped nextStep for a known step', () => {
    expect(getDefaultNextStep('paragraph-reading')).toBe('key-passage-reading');
    expect(getDefaultNextStep('comprehension')).toBe('vocab-review');
    expect(getDefaultNextStep('knowledge-station')).toBe('report');
  });

  it('returns report as fallback for an unknown step', () => {
    expect(getDefaultNextStep('nonexistent-step')).toBe('report');
  });

  it('is a pure function (no side effects)', () => {
    const result1 = getDefaultNextStep('paragraph-reading');
    const result2 = getDefaultNextStep('paragraph-reading');
    expect(result1).toBe(result2);
  });
});

// ─── Test 3: buildStepFinishPayload — payload factory ────────────────────────

describe('buildStepFinishPayload', () => {
  it('returns completeStep and nextStep from the transition table', () => {
    const payload = buildStepFinishPayload('full-text-annotate', {});
    expect(payload.completeStep).toBe('full-text-annotate');
    expect(payload.nextStep).toBe('paragraph-reading');
  });

  it('includes stepDataPatch with the stepDataKey set to provided data', () => {
    const data = { completed: true, score: 95 };
    const payload = buildStepFinishPayload('comprehension', data);
    expect(payload.stepDataPatch).toEqual({ comprehension: data });
  });

  it('uses empty object as default stepData when none provided', () => {
    const payload = buildStepFinishPayload('keypoints-table', {});
    expect(payload.stepDataPatch).toEqual({ 'keypoints-table': {} });
  });

  it('produces correct currentStep (nextStep) for persistStepProgressState', () => {
    // persistStepProgressState `currentStep` = the step we navigate TO
    const payload = buildStepFinishPayload('vocab-application', {});
    expect(payload.currentStep).toBe('keypoints-table');
    expect(payload.completeStep).toBe('vocab-application');
  });

  it('falls back to report for unknown step', () => {
    const payload = buildStepFinishPayload('unknown-step', { foo: 'bar' });
    expect(payload.nextStep).toBe('report');
    expect(payload.completeStep).toBe('unknown-step');
  });

  it('full-reading uses nextStep listening', () => {
    const payload = buildStepFinishPayload('key-passage-reading', { result: { score: 80 } });
    expect(payload.nextStep).toBe('listening');
    expect(payload.stepDataPatch).toEqual({ 'key-passage-reading': { result: { score: 80 } } });
  });

  it('sentence-practice uses nextStep vocab-definition', () => {
    const payload = buildStepFinishPayload('sentence-practice', { completed: true });
    expect(payload.nextStep).toBe('vocab-definition');
  });

  it('vocab-word-search: nextStep is knowledge-station', () => {
    const payload = buildStepFinishPayload('vocab-review', { completed: true });
    expect(payload.nextStep).toBe('knowledge-station');
  });
});

// ─── Test 4: sequence correctness ────────────────────────────────────────────

describe('default step sequence contract', () => {
  /**
   * Verifies the complete chain is consistent end-to-end:
   * reading-annotation → tutor → full-reading → listening → vocab →
   * vocab-definition → vocab-application → story-structure →
   * reading-strategy → comprehension → vocab-word-search →
   * knowledge-station → report
   */
  const expectedChain: [string, string][] = [
    ['full-text-annotate', 'paragraph-reading'],
    ['paragraph-reading', 'key-passage-reading'],
    ['key-passage-reading', 'listening'],
    ['listening', 'character-practice'],
    ['character-practice', 'vocab-definition'],
    ['vocab-definition', 'vocab-application'],
    ['vocab-application', 'keypoints-table'],
    ['keypoints-table', 'spotlight'],
    ['spotlight', 'comprehension'],
    ['comprehension', 'vocab-review'],
    ['vocab-review', 'knowledge-station'],
    ['knowledge-station', 'report'],
  ];

  for (const [from, to] of expectedChain) {
    it(`${from} → ${to}`, () => {
      expect(getDefaultNextStep(from)).toBe(to);
    });
  }
});
