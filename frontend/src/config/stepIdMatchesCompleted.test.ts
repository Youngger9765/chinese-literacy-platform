/**
 * TDD tests for #3682 fix C (part 3) — backward-compat bare↔composite step
 * id matching for completion checks.
 *
 * Why this is needed in addition to fix C parts 1+2 (which make NEW saves
 * correctly round-keyed): sessions that were already in progress BEFORE
 * those fixes shipped have real, already-persisted bare `steps_completed`
 * entries for what is now a composite requirement (recheck-prod.log's own
 * audited session: steps_completed had bare 'comprehension', but the
 * lesson's resolved step sequence requires 'comprehension#pjhxh'). Without
 * this equivalence, those already-affected students would be PERMANENTLY
 * stuck even after the write-path fix ships — only newly-made progress uses
 * the correct key; their past bare entry would never satisfy the
 * (correctly composite) requirement again.
 *
 * Deliberately scoped to be safe for TRUE multi-passage ambiguity: a bare
 * entry only satisfies a composite requirement when this lesson has
 * EXACTLY ONE required step sharing that base id — i.e. there is no
 * question of WHICH round the legacy bare entry was for.
 */
import { describe, it, expect } from 'vitest';
import { stepIdMatchesCompleted } from './stepConfig';

describe('stepIdMatchesCompleted (#3682 fix C part 3)', () => {
  it('exact match always satisfies', () => {
    expect(stepIdMatchesCompleted('comprehension', new Set(['comprehension']), ['comprehension'])).toBe(true);
    expect(
      stepIdMatchesCompleted('comprehension#pjhxh', new Set(['comprehension#pjhxh']), ['comprehension#pjhxh']),
    ).toBe(true);
  });

  it('a bare completed entry satisfies a composite requirement when the lesson has only ONE step with that base id', () => {
    const allRequired = ['full-text-annotate#qeqwt', 'key-passage-reading#h6xnk', 'comprehension#pjhxh', 'report#pjhxh'];
    const completed = new Set(['full-text-annotate#qeqwt', 'key-passage-reading#h6xnk', 'comprehension']);
    expect(stepIdMatchesCompleted('comprehension#pjhxh', completed, allRequired)).toBe(true);
  });

  it('does NOT let a bare completed entry satisfy a composite requirement when the lesson genuinely has MULTIPLE rounds of that same step (ambiguous)', () => {
    const allRequired = ['comprehension#round1', 'comprehension#round2', 'comprehension#round3'];
    const completed = new Set(['comprehension']); // legacy bare entry — we don't know which round it was for
    expect(stepIdMatchesCompleted('comprehension#round1', completed, allRequired)).toBe(false);
    expect(stepIdMatchesCompleted('comprehension#round2', completed, allRequired)).toBe(false);
  });

  it('returns false when nothing matches at all', () => {
    expect(stepIdMatchesCompleted('comprehension#pjhxh', new Set(['spotlight#pjhxh']), ['comprehension#pjhxh'])).toBe(false);
  });

  it('a bare requirement is unaffected by this equivalence (only composite requiredId triggers the bare-fallback path)', () => {
    expect(stepIdMatchesCompleted('comprehension', new Set(['comprehension#pjhxh']), ['comprehension'])).toBe(false);
  });
});
