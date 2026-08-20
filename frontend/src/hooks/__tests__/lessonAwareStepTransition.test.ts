/**
 * lessonAwareStepTransition.test.ts (#2752)
 *
 * A 文言文 lesson's own `step_sequence` must win over the global
 * STEP_FINISH_TRANSITIONS table — the concrete failure this locks is
 * `key-passage-reading`, a step SHARED by both genres whose "next" step
 * genuinely differs per lesson type (a table keyed only by step id cannot
 * express that).
 */
import { describe, it, expect } from 'vitest';
import { lessonAwareNextStep } from '../lessonAwareStepTransition';

// Mirrors backend/app/services/lesson_indexes.py::CLASSICAL_STEP_SEQUENCE
const CLASSICAL_STEP_SEQUENCE = [
  'lesson-intro',
  'classical-text',
  'key-passage-reading',
  'classical-sentence-matching',
  'classical-word-matching',
  'keypoints-table',
  'spotlight',
  'comprehension',
  'classical-self-challenge',
  'report',
];

describe('lessonAwareNextStep', () => {
  it('a regular lesson (no step_sequence) falls back to the static default unchanged', () => {
    expect(lessonAwareNextStep('key-passage-reading', null, 'listening')).toBe('listening');
    expect(lessonAwareNextStep('full-text-annotate', undefined, 'paragraph-reading')).toBe('paragraph-reading');
    expect(lessonAwareNextStep('comprehension', [], 'vocab-review')).toBe('vocab-review');
  });

  it('a 文言文 lesson advances within its OWN sequence, not the shared default', () => {
    // The whole point: key-passage-reading's default next (listening) would be
    // wrong here — 文言文 lessons have no listening data at all.
    expect(lessonAwareNextStep('key-passage-reading', CLASSICAL_STEP_SEQUENCE, 'listening'))
      .toBe('classical-sentence-matching');
  });

  it('walks every step in the classical sequence in order', () => {
    expect(lessonAwareNextStep('lesson-intro', CLASSICAL_STEP_SEQUENCE, 'full-text-annotate')).toBe('classical-text');
    expect(lessonAwareNextStep('classical-text', CLASSICAL_STEP_SEQUENCE, 'IGNORED')).toBe('key-passage-reading');
    expect(lessonAwareNextStep('classical-sentence-matching', CLASSICAL_STEP_SEQUENCE, 'IGNORED')).toBe('classical-word-matching');
    expect(lessonAwareNextStep('classical-word-matching', CLASSICAL_STEP_SEQUENCE, 'IGNORED')).toBe('keypoints-table');
    expect(lessonAwareNextStep('spotlight', CLASSICAL_STEP_SEQUENCE, 'IGNORED')).toBe('comprehension');
    expect(lessonAwareNextStep('comprehension', CLASSICAL_STEP_SEQUENCE, 'vocab-review')).toBe('classical-self-challenge');
  });

  it('the last step in a custom sequence has no next — falls through to report', () => {
    expect(lessonAwareNextStep('classical-self-challenge', CLASSICAL_STEP_SEQUENCE, 'IGNORED')).toBe('report');
  });

  it('a step id absent from the custom sequence falls through to report (defensive)', () => {
    expect(lessonAwareNextStep('dictation', CLASSICAL_STEP_SEQUENCE, 'vocab-review')).toBe('report');
  });
});
