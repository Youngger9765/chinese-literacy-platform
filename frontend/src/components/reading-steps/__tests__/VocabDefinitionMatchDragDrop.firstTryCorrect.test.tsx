/**
 * VocabDefinitionMatchDragDrop.firstTryCorrect.test.tsx — #2773
 *
 * Same fix, same reason as the MCQ sibling test: `attemptPlace`'s correct
 * branch sets `correct: true` from the LATEST drop (by design — a student
 * can bounce a wrong chip back and retry). `firstTryCorrect` must stay a
 * separate, write-once field so a retried-into-correct item is still
 * flagged for 錯題解析 / 重做錯題.
 *
 * Uses the tap-to-select-then-tap-to-place fallback (`handleTouchStart` /
 * `handleSlotTap`, wired to plain onClick) instead of native HTML5 drag
 * events — jsdom doesn't implement the drag event sequence, and this is a
 * real, shipped interaction path (mobile/accessibility), not a test-only
 * shortcut. `getAllByText(...)[0]` is required for word chips because
 * `wordBankContent` is rendered twice (desktop + mobile columns, toggled by
 * a Tailwind breakpoint jsdom doesn't apply) — both copies share the same
 * onClick handler, so clicking either has an identical effect on state.
 *
 * Uses fake timers (not a real-wall-clock `await new Promise(setTimeout)`)
 * because this component chains three real setTimeouts per correct drop
 * (~550ms fly-away + 600ms onAllDone-check), which made a real-timer
 * version of this test flaky under load (observed both a pass and a
 * `toHaveBeenCalledOnce()` 0-calls failure across otherwise-identical runs
 * of the same assertions).
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DragDropMode } from '../VocabDefinitionMatchDragDrop';
import type { VocabItem } from '../../../types';

const VOCAB: VocabItem[] = [
  { word: '勤奮', definition: '努力不懈地工作或學習。' },
  { word: '謙虛', definition: '不自誇，虛心接受他人意見。' },
];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DragDropMode — #2773 firstTryCorrect (immutable first-try verdict)', () => {
  it('records firstTryCorrect: false for a slot dropped wrong first, even after a correct retry', async () => {
    const onAllDone = vi.fn();
    render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={[0, 1]}
        shuffledWords={[0, 1]}
        onAllDone={onAllDone}
      />,
    );

    // Wrong: select 謙虛 (vocabIdx 1), drop on defIdx 0's slot (needs 勤奮).
    fireEvent.click(screen.getAllByText('謙虛')[0]);
    fireEvent.click(screen.getByText('努力不懈地工作或學習。'));

    // Past the wrong-drop bounce-back (650ms) before retrying the slot.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    // Retry defIdx 0 correctly, then answer defIdx 1 correctly on the first try.
    fireEvent.click(screen.getAllByText('勤奮')[0]);
    fireEvent.click(screen.getByText('努力不懈地工作或學習。'));
    fireEvent.click(screen.getAllByText('謙虛')[0]);
    fireEvent.click(screen.getByText('不自誇，虛心接受他人意見。'));

    // Each correct drop runs a ~550ms fly-away + 600ms onAllDone-check chain.
    // Advance in smaller increments (not one big jump) — vi.advanceTimersByTimeAsync
    // needs to yield to microtasks between each timer so a later-scheduled
    // setTimeout (the onAllDone check, scheduled INSIDE the setConfirmed
    // callback that itself only runs after the first timer fires) gets
    // registered before the clock advances past it.
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    }

    expect(onAllDone).toHaveBeenCalledOnce();
    const finalAnswers = onAllDone.mock.calls[0][0];
    const def0 = finalAnswers.find((a: { defIndex: number }) => a.defIndex === 0);
    const def1 = finalAnswers.find((a: { defIndex: number }) => a.defIndex === 1);
    expect(def0).toMatchObject({ correct: true, firstTryCorrect: false });
    expect(def1).toMatchObject({ correct: true, firstTryCorrect: true });
  });

  // Caught live on the #2773 PR preview (docs/evidence/qa-2026-08-20/
  // vocab-definition-firsttrycorrect-fixed-but-wrong-word-bug.png), same root
  // cause as the MCQ sibling test: `answeredWordIdx` reflects the LATEST drop,
  // so once the wrong-then-correct retry finishes it holds the CORRECT
  // vocabIdx (0, 勤奮) — using it to render "你選了 X" would show the correct
  // word on both sides. `firstTryAnsweredWordIdx` must hold the actual first
  // wrong pick (1, 謙虛) instead, immutably.
  it('records firstTryAnsweredWordIdx as the FIRST wrong drop (謙虛, idx 1), not the later correct retry (勤奮, idx 0)', async () => {
    const onAllDone = vi.fn();
    render(
      <DragDropMode
        vocab={VOCAB}
        activeDefIndices={[0, 1]}
        shuffledWords={[0, 1]}
        onAllDone={onAllDone}
      />,
    );

    fireEvent.click(screen.getAllByText('謙虛')[0]);
    fireEvent.click(screen.getByText('努力不懈地工作或學習。'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    fireEvent.click(screen.getAllByText('勤奮')[0]);
    fireEvent.click(screen.getByText('努力不懈地工作或學習。'));
    fireEvent.click(screen.getAllByText('謙虛')[0]);
    fireEvent.click(screen.getByText('不自誇，虛心接受他人意見。'));

    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    }

    expect(onAllDone).toHaveBeenCalledOnce();
    const finalAnswers = onAllDone.mock.calls[0][0];
    const def0 = finalAnswers.find((a: { defIndex: number }) => a.defIndex === 0);
    const def1 = finalAnswers.find((a: { defIndex: number }) => a.defIndex === 1);
    expect(def0).toMatchObject({ answeredWordIdx: 0, firstTryAnsweredWordIdx: 1 });
    expect(def1).toMatchObject({ firstTryAnsweredWordIdx: null });
  });
});
