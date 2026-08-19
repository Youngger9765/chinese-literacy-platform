/**
 * VocabDefinitionMatchSummary.test.tsx — #2773
 *
 * Locks the fix: the summary must classify 錯題 by `firstTryCorrect`
 * (immutable), not `correct` (overwritten on retry) — otherwise a student
 * who got something wrong once but retried into the right answer vanishes
 * from every "what did I get wrong" signal: the headline lies ("全部答對！"
 * even after a real miss), the review cards never show, and "重做錯題"
 * never appears. Verified live on staging before this fix
 * (/learn/20011/vocab-definition: 2 deliberate first-try misses out of 11
 * still rendered "答對 11 / 11 題" with zero ✗ cards).
 *
 * Wording aligned to vocab-application's FillInBlankExercise summary
 * ("你選了 X → 正確：Y") via the shared WrongAnswerReviewList component
 * (#2773), not the old "正確答案：X | 你的答案：Y" layout.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SummaryScreen } from '../VocabDefinitionMatchSummary';
import type { AnswerRecord } from '../vocabDefinitionMatchLogic';
import type { VocabItem } from '../../../types';

const VOCAB: VocabItem[] = [
  { word: '龍爭虎鬥', definition: '形容像巨龍和猛虎般地相互爭鬥，難分高低。' },
  { word: '捶胸頓足', definition: '捶打胸膛，以腳跺地。形容極為悲憤或悔恨。' },
];

// Mirrors the real staging scenario: both items eventually answered
// correctly (correct: true) but item 0 was wrong on the first try.
const MC_ANSWERS: AnswerRecord[] = [
  { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: false },
  { defIndex: 1, answeredWordIdx: 1, correct: true, firstTryCorrect: true },
];

const noop = () => {};

describe('SummaryScreen — #2773 first-try classification', () => {
  it('does NOT claim 全部答對 when an item was wrong on the first try (even though correct is now true)', () => {
    render(
      <SummaryScreen
        inToolbox={false}
        vocab={VOCAB}
        mcAnswers={MC_ANSWERS}
        dragDropAnswers={[]}
        onRetryModeWrong={noop}
        onRetryAll={noop}
        onFinish={noop}
      />,
    );
    expect(screen.queryByText('全部答對！')).toBeNull();
    expect(screen.getByText('你完成了！')).toBeInTheDocument();
  });

  it('shows the 重做錯題 button when a first-try miss exists, even though correct is all true', () => {
    render(
      <SummaryScreen
        inToolbox={false}
        vocab={VOCAB}
        mcAnswers={MC_ANSWERS}
        dragDropAnswers={[]}
        onRetryModeWrong={noop}
        onRetryAll={noop}
        onFinish={noop}
      />,
    );
    expect(screen.getByText('重做錯題')).toBeInTheDocument();
  });

  it('renders the wrong item using "你選了 X → 正確：Y" wording (aligned to vocab-application)', () => {
    render(
      <SummaryScreen
        inToolbox={false}
        vocab={VOCAB}
        mcAnswers={MC_ANSWERS}
        dragDropAnswers={[]}
        onRetryModeWrong={noop}
        onRetryAll={noop}
        onFinish={noop}
      />,
    );
    // defIndex 0's studentAnswerText is vocab[0].word ('龍爭虎鬥') since
    // answeredWordIdx === 0 in the fixture above (last attempt happened to
    // also be word 0 — the point under test is the wording, not the value).
    expect(screen.getByText(/你選了/)).toBeInTheDocument();
    expect(screen.getByText(/^正確：/)).toBeInTheDocument();
  });

  it('does not call the wrong item correct just because it was eventually retried right', () => {
    render(
      <SummaryScreen
        inToolbox={false}
        vocab={VOCAB}
        mcAnswers={MC_ANSWERS}
        dragDropAnswers={[]}
        onRetryModeWrong={noop}
        onRetryAll={noop}
        onFinish={noop}
      />,
    );
    // The wrong-first-try definition text still renders inside an amber
    // (wrong-styled) card, not a green one.
    const promptEl = screen.getByText(VOCAB[0].definition);
    const card = promptEl.closest('div')?.parentElement?.parentElement;
    expect(card?.className).toContain('bg-amber-50');
  });

  it('shows 全部答對 headline when every item was correct on the first try', () => {
    const allFirstTryCorrect: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: true },
      { defIndex: 1, answeredWordIdx: 1, correct: true, firstTryCorrect: true },
    ];
    render(
      <SummaryScreen
        inToolbox={false}
        vocab={VOCAB}
        mcAnswers={allFirstTryCorrect}
        dragDropAnswers={[]}
        onRetryModeWrong={noop}
        onRetryAll={noop}
        onFinish={noop}
      />,
    );
    expect(screen.getByText('全部答對！')).toBeInTheDocument();
    expect(screen.queryByText('重做錯題')).toBeNull();
  });

  it('still shows drag-drop per-attempt coaching text (extraNote) for a wrong drag-drop item', () => {
    const dragDropWithAttempts: AnswerRecord[] = [
      { defIndex: 0, answeredWordIdx: 0, correct: true, firstTryCorrect: false, wrongAttempts: 2 },
    ];
    render(
      <SummaryScreen
        inToolbox={false}
        vocab={VOCAB}
        mcAnswers={[]}
        dragDropAnswers={dragDropWithAttempts}
        onRetryModeWrong={noop}
        onRetryAll={noop}
        onFinish={noop}
      />,
    );
    expect(screen.getByText('下次小心喔～')).toBeInTheDocument();
  });
});
