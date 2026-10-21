/**
 * StudentPkMatch zhuyin target-character marking — issue #3663 round 2.
 *
 * This path had ZERO test coverage before this file: the component used to
 * carry its own inline `renderStemWithTarget()` copy of the same logic
 * `components/live-quiz/StemWithTarget.tsx` already had tests for
 * (`TeacherLiveQuizQuestion.zhuyinMark.test.tsx`,
 * `TeacherLiveQuizReveal.test.tsx`, `StudentTeamArenaPlay.zhuyinMark.test.tsx`)
 * — PK's own copy was never directly exercised. Written as a
 * characterization test BEFORE unifying onto the shared component (dev
 * doctrine: "no red, no credit" / "add characterization tests before
 * moving code where coverage is thin"), then kept as the regression lock
 * for that unification.
 *
 * #3602 "also" / staging QA: "畫面上看不到問的是「適」還是「的」...學生沒辦法
 * 作答" — a zhuyin round's stem is a plain sentence with no visual marker
 * for which character is asked about without this.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

const zhuyinState: PkMatchState = {
  match_id: 1,
  status: 'active',
  version: 1,
  server_now: new Date().toISOString(),
  round_index: 0,
  rounds_total: 5,
  revealing: false,
  round_started_at: new Date().toISOString(),
  seconds: 20,
  round: {
    item_id: 'r1',
    source_module: 'zhuyin',
    lesson_title: '課文',
    // "走路東倒西歪" — target_index 3 is "倒" (0-indexed), same fixture
    // shape as the live-quiz/team_arena zhuyin-mark tests.
    stem: '走路東倒西歪',
    options: [
      { key: 'A', text: 'ㄉㄠˇ' },
      { key: 'B', text: 'ㄉㄠˋ' },
    ],
    seconds: 20,
    my_choice_key: null,
    my_answered: false,
    extra: { target_index: 3 },
  },
  my_name: '小明',
  opponent_name: '李白',
  my_score: 0,
  opponent_score: 0,
  opponent_type: 'AI',
  bot_tier: 7,
  suggest_ai: false,
  ai_expression: 'thinking',
};

vi.mock('../../../services/pkApi', () => ({
  PkApiError: class PkApiError extends Error {},
  getPkMatchState: vi.fn(() => Promise.resolve(zhuyinState)),
  submitPkAnswer: vi.fn(() => new Promise(() => {})),
  getPkMatchResult: vi.fn(() => new Promise(() => {})),
}));

import StudentPkMatch from '../StudentPkMatch';

describe('StudentPkMatch — zhuyin stem target marking (#3663 StemWithTarget unification)', () => {
  it('marks stem[target_index] ("倒") with the stem-target testid, keeping PK\'s own visual weight', async () => {
    const { findByTestId } = render(
      <MemoryRouter initialEntries={['/pk/match/1']}>
        <Routes>
          <Route path="/pk/match/:matchId" element={<StudentPkMatch />} />
        </Routes>
      </MemoryRouter>,
    );

    const mark = await findByTestId('stem-target');
    expect(mark.textContent).toBe('倒');
    // PK's pre-existing visual weight (font-bold + underline-offset-2),
    // NOT live-quiz/team_arena's default (decoration-4 + underline-offset-8)
    // — this is the whole point of StemWithTarget's className prop: no
    // screen's rendered output changes when it starts reusing the shared
    // component.
    expect(mark.className).toBe('font-bold text-accent underline underline-offset-2');
  });

  it('renders no stem-target span when the round has no target_index (non-zhuyin modules unaffected)', async () => {
    const { getPkMatchState } = await import('../../../services/pkApi');
    (getPkMatchState as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...zhuyinState,
      round: { ...zhuyinState.round, source_module: 'vocab_definitions', extra: undefined },
    });

    const { queryByTestId } = render(
      <MemoryRouter initialEntries={['/pk/match/2']}>
        <Routes>
          <Route path="/pk/match/:matchId" element={<StudentPkMatch />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(queryByTestId('stem-target')).toBeNull());
  });
});
