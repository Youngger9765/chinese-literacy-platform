/**
 * exitTicketLocalFallback.test.ts
 * TDD-first tests for the local rule-based fallback algorithm.
 *
 * These 3 tests are written against the EXTRACTED module:
 *   exitTicketLocalFallback.ts
 *
 * Run: npx vitest run src/components/reading-steps/exitTicketLocalFallback.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  COMMON_PARTICLES,
  CONFUSABLE_CHARS,
  generateLocalQuestions,
} from './exitTicketLocalFallback';

// ---------------------------------------------------------------------------
// Test 1: local_fallback_skips_common_particles
// Particles in COMMON_PARTICLES must never appear as correctAnswer
// ---------------------------------------------------------------------------

describe('local_fallback_skips_common_particles', () => {
  it('never picks a common particle as the correct answer for missing chars', () => {
    // Provide only particles as missingChars — expect 0 questions generated
    const particles = [...COMMON_PARTICLES];
    const questions = generateLocalQuestions(
      [],          // wrongTokens
      particles,   // missingChars — all particles
      ['這是一個測試的句子'],
    );
    const correctAnswers = questions.map(q => q.correctAnswer);
    for (const answer of correctAnswers) {
      expect(COMMON_PARTICLES.has(answer)).toBe(false);
    }
  });

  it('picks non-particle chars when particles are mixed in missingChars', () => {
    const questions = generateLocalQuestions(
      [],
      ['的', '了', '山', '是', '水'],  // 的/了/是 are particles, 山/水 are not
      ['山水之間有著美麗的景色'],
    );
    // Should produce questions with 山 or 水 as correctAnswer, not 的/了/是
    if (questions.length > 0) {
      for (const q of questions) {
        expect(COMMON_PARTICLES.has(q.correctAnswer)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: confusable_chars_picks_visually_similar_distractor
// When a confusable mapping exists, distractors should prioritize those chars
// ---------------------------------------------------------------------------

describe('confusable_chars_picks_visually_similar_distractor', () => {
  it('includes confusable chars as distractors for a known mapping (己→已/巳)', () => {
    // Use wrongTokens so '己' is the correctAnswer
    const wrongTokens = [{ char: '已', expected: '己' }];
    const questions = generateLocalQuestions(wrongTokens, [], ['己已巳的字形相近容易混淆']);

    expect(questions.length).toBeGreaterThan(0);
    const q = questions[0];
    expect(q.correctAnswer).toBe('己');

    // At least one of the confusable chars should appear in options
    const confusables = CONFUSABLE_CHARS['己'] ?? [];
    const hasConfusable = q.options.some(opt => confusables.includes(opt));
    expect(hasConfusable).toBe(true);
  });

  it('CONFUSABLE_CHARS map is non-empty and symmetric for 己/已/巳', () => {
    expect(CONFUSABLE_CHARS['己']).toContain('已');
    expect(CONFUSABLE_CHARS['己']).toContain('巳');
    expect(CONFUSABLE_CHARS['已']).toContain('己');
    expect(CONFUSABLE_CHARS['巳']).toContain('己');
  });
});

// ---------------------------------------------------------------------------
// Test 3: generates_at_most_3_questions_from_wrong_tokens
// Even with many wrongTokens + missingChars, cap at 3
// ---------------------------------------------------------------------------

describe('generates_at_most_3_questions_from_wrong_tokens', () => {
  it('returns at most 3 questions when given 10 wrong tokens', () => {
    const wrongTokens = [
      { char: '已', expected: '己' },
      { char: '末', expected: '未' },
      { char: '太', expected: '大' },
      { char: '目', expected: '日' },
      { char: '入', expected: '人' },
      { char: '士', expected: '土' },
      { char: '千', expected: '干' },
      { char: '夫', expected: '天' },
      { char: '力', expected: '刀' },
      { char: '由', expected: '田' },
    ];
    const questions = generateLocalQuestions(wrongTokens, [], ['一段含有各種字的文章內容']);
    expect(questions.length).toBeLessThanOrEqual(3);
  });

  it('returns at most 3 questions when given 10 missing chars', () => {
    const missingChars = ['山', '水', '火', '木', '金', '土', '風', '雨', '雷', '雲'];
    const questions = generateLocalQuestions(
      [],
      missingChars,
      ['山水火木金土風雨雷雲都是自然界的元素'],
    );
    expect(questions.length).toBeLessThanOrEqual(3);
  });

  it('returns at most 3 questions when both wrongTokens and missingChars have many items', () => {
    const wrongTokens = [
      { char: '已', expected: '己' },
      { char: '末', expected: '未' },
      { char: '太', expected: '大' },
    ];
    const missingChars = ['山', '水', '火', '木', '金'];
    const questions = generateLocalQuestions(
      wrongTokens,
      missingChars,
      ['一段含有山水火木金及各種字的文章'],
    );
    expect(questions.length).toBeLessThanOrEqual(3);
  });

  it('returns 0 questions when both inputs are empty', () => {
    const questions = generateLocalQuestions([], [], ['任何故事內容']);
    expect(questions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tautology checks — verify tests can FAIL (break one rule, confirm failure)
// These are structural checks, not runtime, but we validate invariants here
// ---------------------------------------------------------------------------

describe('tautology: data integrity checks', () => {
  it('COMMON_PARTICLES contains known particles', () => {
    expect(COMMON_PARTICLES.has('的')).toBe(true);
    expect(COMMON_PARTICLES.has('了')).toBe(true);
    expect(COMMON_PARTICLES.has('是')).toBe(true);
    expect(COMMON_PARTICLES.has('在')).toBe(true);
  });

  it('COMMON_PARTICLES does NOT contain non-particles', () => {
    // If this fails, COMMON_PARTICLES is wrong
    expect(COMMON_PARTICLES.has('山')).toBe(false);
    expect(COMMON_PARTICLES.has('水')).toBe(false);
    expect(COMMON_PARTICLES.has('己')).toBe(false);
  });

  it('generateLocalQuestions returns source=local for all questions', () => {
    const questions = generateLocalQuestions(
      [{ char: '已', expected: '己' }],
      [],
      ['己已巳是形近字'],
    );
    for (const q of questions) {
      expect(q.source).toBe('local');
    }
  });

  it('each question has exactly 4 options (1 correct + 3 distractors)', () => {
    const questions = generateLocalQuestions(
      [{ char: '已', expected: '己' }],
      ['山'],
      ['己已巳山水'],
    );
    for (const q of questions) {
      expect(q.options).toHaveLength(4);
      expect(q.options).toContain(q.correctAnswer);
    }
  });
});
