/**
 * StudentPkMatch battle-phase large AI portrait — PK gamification MVP
 * (launch-plan, 2026-10-17): the old implementation only ever showed a tiny
 * 8x8px avatar next to the score bar during the AI's turn, and that avatar
 * silently disappeared on a resume (hard reload mid-match — no
 * `location.state`, see the component's own header comment) because it was
 * derived solely from `location.state.tier` instead of the `/state` poll's
 * own `bot_tier` field. This test asserts the LARGE portrait panel renders
 * off the poll response (robust across resume) and tracks
 * `state.ai_expression` through resolveAiExpression.
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

const baseState: PkMatchState = {
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
    source_module: 'vocab_definitions',
    lesson_title: '課文',
    stem: '題目',
    options: [
      { key: 'A', text: '甲' },
      { key: 'B', text: '乙' },
    ],
    seconds: 20,
    my_choice_key: null,
    my_answered: false,
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
  getPkMatchState: vi.fn(() => Promise.resolve(baseState)),
  submitPkAnswer: vi.fn(() => new Promise(() => {})),
  getPkMatchResult: vi.fn(() => new Promise(() => {})),
}));

import StudentPkMatch from '../StudentPkMatch';

describe('StudentPkMatch battle-phase AI portrait', () => {
  it('renders the large AI portrait resolved from state.bot_tier even with no location.state (resume)', async () => {
    const { getAllByAltText, getAllByTestId } = render(
      <MemoryRouter initialEntries={['/pk/match/1']}>
        <Routes>
          <Route path="/pk/match/:matchId" element={<StudentPkMatch />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      // The opponent now appears on the right twice (compact row on phones,
      // side column on wide screens; CSS shows one). Both must resolve.
      const imgs = getAllByAltText('李白') as HTMLImageElement[];
      expect(imgs.length).toBe(2);
      const img = imgs[0];
      // tier 7 -> the PNG override (data/pkFigures.ts), and ai_expression
      // 'thinking' from the poll response above -- both the asset-resolution
      // AND the expression-for-event wiring are exercised by this one path.
      for (const i of imgs) expect(i.getAttribute('src')).toBe('/story-assets/pk-li-bai/portrait-thinking.png');
      expect(img).toBeTruthy();
      // the student is never on the opponent side
      expect(getAllByTestId('pk-panel-me').length).toBe(2);
    });
  });
});
