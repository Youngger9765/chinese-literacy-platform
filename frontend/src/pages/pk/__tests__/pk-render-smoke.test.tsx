/**
 * pk-render-smoke.test.tsx — same spirit as src/__smoke__/render-smoke.test.tsx
 * (Gate ① of the frontend render-safety net, #2279/#2289): mount each PK
 * page + the shared PK components and assert none of them throw at mount
 * (TDZ / missing-provider / import-order bugs). Not a functional test —
 * API calls are mocked to never resolve so each page stays in its initial
 * loading state; real end-to-end behaviour is verified against staging
 * separately (see PR description).
 */
import React from 'react';
import { describe, it, vi, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '小明' },
    token: 'fake-token',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// Every pkApi call returns a promise that never resolves -- pages stay in
// their initial loading state, which is exactly what a mount-smoke test
// wants to exercise (no async act() wrangling needed).
vi.mock('../../../services/pkApi', () => ({
  PkApiError: class PkApiError extends Error {},
  joinPkQueue: vi.fn(() => new Promise(() => {})),
  pollPkQueue: vi.fn(() => new Promise(() => {})),
  cancelPkQueue: vi.fn(() => new Promise(() => {})),
  createPkInvite: vi.fn(() => new Promise(() => {})),
  getPkOpponents: vi.fn(() => new Promise(() => {})),
  challengePkAi: vi.fn(() => new Promise(() => {})),
  getPkMatchState: vi.fn(() => new Promise(() => {})),
  submitPkAnswer: vi.fn(() => new Promise(() => {})),
  getPkMatchResult: vi.fn(() => new Promise(() => {})),
  getPkHistory: vi.fn(() => new Promise(() => {})),
  getPkRatingMe: vi.fn(() => new Promise(() => {})),
  getClassroomPkActivity: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../../services/learning/session', () => ({
  fetchMyEnrolledClassrooms: vi.fn(() => new Promise(() => {})),
}));

import StudentPkEntry from '../StudentPkEntry';
import StudentPkQueueWait from '../StudentPkQueueWait';
import StudentPkOpponentSelect from '../StudentPkOpponentSelect';
import StudentPkMatch from '../StudentPkMatch';
import PkVsScreen from '../../../components/pk/PkVsScreen';
import PkFigureIntro from '../../../components/pk/PkFigureIntro';
import PkOptionButtons from '../../../components/pk/PkOptionButtons';
import PkScoreBar from '../../../components/pk/PkScoreBar';
import PkCountdownRing from '../../../components/pk/PkCountdownRing';
import PkComboBadge from '../../../components/pk/PkComboBadge';
import PkResultScreen from '../../../components/pk/PkResultScreen';
import { PK_FIGURES } from '../../../data/pkFigures';
import type { PkMatchResult } from '../../../services/pkApi';

function renderAt(path: string, routePath: string, Element: React.FC) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<Element />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PK pages mount without throwing', () => {
  it('StudentPkEntry', () => {
    expect(() => renderAt('/pk', '/pk', StudentPkEntry)).not.toThrow();
  });

  it('StudentPkQueueWait', () => {
    expect(() => renderAt('/pk/queue/1', '/pk/queue/:queueId', StudentPkQueueWait)).not.toThrow();
  });

  it('StudentPkOpponentSelect', () => {
    expect(() =>
      renderAt('/pk/opponents?scopeType=grade_pool&scopeRef=4', '/pk/opponents', StudentPkOpponentSelect),
    ).not.toThrow();
  });

  it('StudentPkMatch (resume, no location.state)', () => {
    expect(() => renderAt('/pk/match/1', '/pk/match/:matchId', StudentPkMatch)).not.toThrow();
  });
});

describe('PK shared components mount without throwing', () => {
  it('PkVsScreen', () => {
    expect(() =>
      render(
        <PkVsScreen
          myName="小明"
          opponentName="李白"
          opponentIsAi
          opponentTier={7}
          onDone={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it('PkFigureIntro — every figure, first time and repeat', () => {
    for (const figure of PK_FIGURES) {
      expect(() => render(<PkFigureIntro figure={figure} firstTime onDone={() => {}} />)).not.toThrow();
      expect(() => render(<PkFigureIntro figure={figure} firstTime={false} onDone={() => {}} />)).not.toThrow();
    }
  });

  it('PkOptionButtons', () => {
    const options = [
      { key: 'A', text: '甲' },
      { key: 'B', text: '乙' },
    ];
    expect(() =>
      render(<PkOptionButtons options={options} selectedKey={null} disabled={false} onSelect={() => {}} />),
    ).not.toThrow();
    expect(() =>
      render(
        <PkOptionButtons options={options} selectedKey="A" correctKey="B" disabled onSelect={() => {}} />,
      ),
    ).not.toThrow();
  });

  it('PkScoreBar', () => {
    expect(() => render(<PkScoreBar label="你" score={2000} maxScore={5000} />)).not.toThrow();
  });

  it('PkCountdownRing', () => {
    const now = new Date().toISOString();
    expect(() => render(<PkCountdownRing roundStartedAt={now} seconds={20} serverNow={now} />)).not.toThrow();
  });

  it('PkComboBadge', () => {
    expect(() => render(<PkComboBadge combo={0} />)).not.toThrow();
    expect(() => render(<PkComboBadge combo={3} />)).not.toThrow();
  });

  it('PkResultScreen — win/draw/loss', () => {
    const base: PkMatchResult = {
      match_id: 1,
      outcome: 'win',
      my_score: 5000,
      opponent_score: 3000,
      opponent_type: 'AI',
      bot_tier: 1,
      rating_before: 1000,
      rating_after: 1012,
      rounds: [
        {
          round_index: 0,
          stem: '題目',
          options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
          correct_key: 'A',
          my_choice_key: 'A',
          my_is_correct: true,
          opponent_choice_key: 'B',
          opponent_is_correct: false,
        },
      ],
      newly_unlocked_tier: 1,
    };
    for (const outcome of ['win', 'draw', 'loss'] as const) {
      expect(() =>
        render(
          <PkResultScreen
            result={{ ...base, outcome }}
            onRematch={() => {}}
            onChangeOpponent={() => {}}
            onBack={() => {}}
          />,
        ),
      ).not.toThrow();
    }
  });
});
