/**
 * Which learning steps a QR-code visitor may open.
 *
 * The paper worksheets carry two codes: one for the whole text and one for the
 * 念順順 key passage. The whole-text one worked anonymously; the passage one
 * walked straight into a login box, which makes it useless on paper.
 *
 * The owner's rule is 聽=免登入, 練習=要登入, and the passage step is both — it
 * plays the passage *and* records the student reading it. So the step opens
 * anonymously in a listen-only form; the recording half stays behind the login.
 */
import { describe, it, expect } from 'vitest';

import { isPublicLearningStep, PUBLIC_LEARNING_STEPS } from '../../config/stepConfig';

describe('isPublicLearningStep', () => {
  it('opens both steps a QR code can point at', () => {
    expect(isPublicLearningStep('full-text-annotate')).toBe(true);
    expect(isPublicLearningStep('key-passage-reading')).toBe(true);
  });

  it('accepts the legacy ids still printed on paper', () => {
    expect(isPublicLearningStep('reading-annotation')).toBe(true);
    expect(isPublicLearningStep('full-reading')).toBe(true);
  });

  it.each([
    ['character-practice', 'writes practice results'],
    ['dictation', 'writes練習 results'],
    ['report', "shows one student's own data"],
    ['comprehension', 'answers are scored against a user'],
    ['lesson-intro', 'no QR code points here'],
    ['paragraph-reading', 'disabled step, records audio'],
  ])('keeps %s private (%s)', (step) => {
    expect(isPublicLearningStep(step)).toBe(false);
  });

  it('stays small — every entry needs the 聽=免登入 argument made for it', () => {
    // A guard against the set quietly growing. Adding one is a decision about
    // what an anonymous visitor may reach, not a config tweak.
    expect(PUBLIC_LEARNING_STEPS.size).toBe(2);
  });
});
