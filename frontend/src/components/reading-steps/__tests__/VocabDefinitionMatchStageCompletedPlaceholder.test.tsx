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
