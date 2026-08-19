/**
 * StageCompletedPlaceholder.test.tsx — #2773
 *
 * This is the FIRST screen a student sees after finishing 選擇題 or 拖拉配對
 * (before the combined SummaryScreen). Same bug, same fix as
 * VocabDefinitionMatchSummary.test.tsx: classification must key off
 * `firstTryCorrect`, not `correct` (which is always eventually true once a
 * student retries into the right answer). This is the exact screen
 * screenshotted live on staging showing "答對 11 / 11 題" with zero ✗ cards
 * despite 2 deliberate first-try misses (docs/evidence/qa-2026-08-20/).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StageCompletedPlaceholder } from '../VocabDefinitionMatch';
import type { AnswerRecord } from '../vocabDefinitionMatchLogic';
import type { VocabItem } from '../../../types';

const VOCAB: VocabItem[] = [
  { word: '龍爭虎鬥', definition: '形容像巨龍和猛虎般地相互爭鬥，難分高低。' },
  { word: '捶胸頓足', definition: '捶打胸膛，以腳跺地。形容極為悲憤或悔恨。' },
];

const noop = () => {};

describe('StageCompletedPlaceholder — #2773 first-try classification', () => {
  it('does not claim a perfect score when an item was wrong on the first try', () => {
    const answers: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: false },
      { defIndex: 1, answeredWordIdx: 1, correct: true, firstTryCorrect: true },
    ];
    render(
      <StageCompletedPlaceholder
        title="選擇題"
        vocab={VOCAB}
        answers={answers}
        otherModeLabel="拖拉配對"
        otherDone={false}
        onGoOther={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText('答對 1 / 2 題')).toBeInTheDocument();
    expect(screen.getByText(/你選了/)).toBeInTheDocument();
  });

  // Caught live on the #2773 PR preview itself (docs/evidence/qa-2026-08-20/
  // vocab-definition-firsttrycorrect-fixed-but-wrong-word-bug.png) — THIS
  // exact screen showed "你選了 龍爭虎鬥 → 正確：龍爭虎鬥" (the correct word
  // on both sides) because studentWord read `answeredWordIdx` (the LATEST,
  // now-correct, retry) instead of `firstTryAnsweredWordIdx` (the actual
  // first wrong pick). Fixture: answeredWordIdx=0 (correct word after
  // retry), firstTryAnsweredWordIdx=1 (the real first wrong pick) — the two
  // words differ on purpose so this can't pass by coincidence.
  it('shows the actual FIRST wrong pick, not the word retried correctly afterward', () => {
    const answers: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: false, firstTryAnsweredWordIdx: 1 },
      { defIndex: 1, answeredWordIdx: 1, correct: true, firstTryCorrect: true, firstTryAnsweredWordIdx: null },
    ];
    render(
      <StageCompletedPlaceholder
        title="選擇題"
        vocab={VOCAB}
        answers={answers}
        otherModeLabel="拖拉配對"
        otherDone={false}
        onGoOther={noop}
        onRetry={noop}
      />,
    );
    const item0Card = screen.getByText(VOCAB[0].definition).closest('div');
    expect(item0Card?.textContent).toContain('捶胸頓足');
    expect(item0Card?.textContent).not.toContain('你選了 龍爭虎鬥');
  });

  it('shows a perfect score only when every item was correct on the first try', () => {
    const answers: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: true },
      { defIndex: 1, answeredWordIdx: 1, correct: true, firstTryCorrect: true },
    ];
    render(
      <StageCompletedPlaceholder
        title="選擇題"
        vocab={VOCAB}
        answers={answers}
        otherModeLabel="拖拉配對"
        otherDone={false}
        onGoOther={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText('答對 2 / 2 題')).toBeInTheDocument();
    expect(screen.queryByText(/你選了/)).toBeNull();
  });
});
