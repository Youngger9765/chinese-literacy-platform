/**
 * #4050 bug 3: a late answer the server rejects with 409 (the window
 * closed between the student's click and the request landing — see
 * engine.py submit_match_answer's "This round is already being revealed"
 * / "This match has already ended" paths) used to show the GENERIC error
 * banner ("發生錯誤，請稍後再試一次" — pkApi.ts's studentFacingMessage swaps
 * any non-Chinese backend detail for this) AT THE SAME TIME the round's
 * reveal message said "答錯了，下一題加油！" — because the backfilled
 * no-answer entry (choice_key: null) made `my_choice_key === correct_key`
 * false, same as a genuine wrong answer.
 *
 * Fix: (1) a 409 from submitPkAnswer is a timing race, not a real error —
 * don't show the generic banner for it. (2) the per-round reveal message
 * keys off `round.my_choice_key == null` FIRST (covers both "clicked too
 * late and got 409'd" and "never clicked at all" — both end up with no
 * recorded answer) and only falls back to 答對/答錯 once there IS a
 * recorded choice.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PkMatchState } from '../../../services/pkApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '小明' },
    token: 'fake-token',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

const baseRound = {
  item_id: 'r1',
  source_module: 'vocab_definitions',
  lesson_title: '課文',
  stem: '題目',
  options: [
    { key: 'A', text: '甲' },
    { key: 'B', text: '乙' },
  ],
  seconds: 20,
};

const activeState: PkMatchState = {
  match_id: 1,
  status: 'active',
  version: 1,
  server_now: new Date().toISOString(),
  round_index: 0,
  rounds_total: 5,
  revealing: false,
  round_started_at: new Date().toISOString(),
  seconds: 20,
  round: { ...baseRound, my_choice_key: null, my_answered: false },
  my_name: '小明',
  opponent_name: '李白',
  my_score: 0,
  opponent_score: 0,
  opponent_type: 'AI',
  bot_tier: 7,
  suggest_ai: false,
  ai_expression: 'thinking',
};

function revealingState(myChoiceKey: string | null): PkMatchState {
  return {
    ...activeState,
    revealing: true,
    round: {
      ...baseRound,
      my_choice_key: myChoiceKey,
      my_answered: myChoiceKey != null,
      correct_key: 'A',
      opponent_choice_key: 'A',
      opponent_is_correct: true,
    },
  };
}

vi.mock('../../../services/pkApi', () => ({
  PkApiError: class PkApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getPkMatchState: vi.fn(() => Promise.resolve(activeState)),
  submitPkAnswer: vi.fn(() => new Promise(() => {})),
  getPkMatchResult: vi.fn(() => new Promise(() => {})),
}));

function renderMatch() {
  return render(
    <MemoryRouter initialEntries={['/pk/match/1']}>
      <Routes>
        <Route path="/pk/match/:matchId" element={<StudentPkMatch />} />
      </Routes>
    </MemoryRouter>,
  );
}

import StudentPkMatch from '../StudentPkMatch';

describe('StudentPkMatch — #4050 timeout race (409 submit)', () => {
  it('does not show the generic error banner when submitPkAnswer 409s (timing race, not a real error)', async () => {
    const { getPkMatchState, submitPkAnswer, PkApiError } = await import('../../../services/pkApi');
    (getPkMatchState as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(activeState);
    (submitPkAnswer as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new PkApiError('發生錯誤，請稍後再試一次', 409),
    );

    renderMatch();

    const optionButton = await screen.findByRole('button', { name: /甲/ });
    fireEvent.click(optionButton);

    await waitFor(() => expect(submitPkAnswer).toHaveBeenCalled());
    // Let the rejection's .catch() handler run.
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('發生錯誤，請稍後再試一次')).toBeNull();
    expect(screen.queryByText('送出失敗，請重試')).toBeNull();
  });
});

describe('StudentPkMatch — #4050 unanswered round reveals as 時間到, not 答錯', () => {
  it('shows 時間到 (not 答錯) when the round reveals with no recorded answer', async () => {
    const { getPkMatchState } = await import('../../../services/pkApi');
    (getPkMatchState as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(revealingState(null));

    renderMatch();

    await screen.findByText(/時間到/);
    expect(screen.queryByText('答錯了，下一題加油！')).toBeNull();
  });

  it('positive control: a genuinely wrong recorded answer still reveals as 答錯', async () => {
    const { getPkMatchState } = await import('../../../services/pkApi');
    (getPkMatchState as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(revealingState('B'));

    renderMatch();

    await screen.findByText('答錯了，下一題加油！');
    expect(screen.queryByText(/時間到/)).toBeNull();
  });

  it('positive control: a correct recorded answer still reveals as 答對了', async () => {
    const { getPkMatchState } = await import('../../../services/pkApi');
    (getPkMatchState as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(revealingState('A'));

    renderMatch();

    await screen.findByText('答對了！');
    expect(screen.queryByText(/時間到/)).toBeNull();
  });
});
