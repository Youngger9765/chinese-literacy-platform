/**
 * PkResultScreen — #4050 wording fixes.
 *
 * (1) The decided-by-time tie note used to just say "分數打平，由作答總時間
 * 快慢決定勝負" without naming who was actually faster — staging QA: "平手
 * 說明沒講誰比較快".
 * (2) The per-round list labeled EVERY non-correct round "✗ 答錯", even one
 * the student never got to answer (timed out / server-rejected a late
 * click, #4050 bug 3) — that must read as a neutral "時間到", not a wrong
 * answer.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PkResultScreen from '../PkResultScreen';
import type { PkMatchResult, PkRoundResult } from '../../../services/pkApi';

const noop = () => {};

function makeRound(overrides: Partial<PkRoundResult>): PkRoundResult {
  return {
    round_index: 0,
    stem: '題目',
    options: [
      { key: 'A', text: '甲' },
      { key: 'B', text: '乙' },
    ],
    correct_key: 'A',
    my_choice_key: 'A',
    my_is_correct: true,
    opponent_choice_key: 'A',
    opponent_is_correct: true,
    ...overrides,
  };
}

function makeResult(overrides: Partial<PkMatchResult>): PkMatchResult {
  return {
    match_id: 1,
    outcome: 'win',
    my_score: 3000,
    opponent_score: 3000,
    opponent_type: 'player',
    bot_tier: null,
    rating_before: 1000,
    rating_after: 1012,
    rounds: [makeRound({})],
    newly_unlocked_tier: null,
    ...overrides,
  };
}

describe('PkResultScreen — #4050 tie note names the faster side', () => {
  it('names ME as faster when I won on a tied score', () => {
    render(
      <PkResultScreen
        result={makeResult({ outcome: 'win', my_score: 3000, opponent_score: 3000 })}
        myName="小明"
        opponentName="小華"
        onRematch={noop}
        onChangeOpponent={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText(/小明.*作答比較快/)).toBeTruthy();
  });

  it('names the OPPONENT as faster when I lost on a tied score', () => {
    render(
      <PkResultScreen
        result={makeResult({ outcome: 'loss', my_score: 3000, opponent_score: 3000 })}
        myName="小明"
        opponentName="小華"
        onRematch={noop}
        onChangeOpponent={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText(/小華.*作答比較快/)).toBeTruthy();
  });

  it('a true draw (not decided by time) shows no faster-side note at all', () => {
    render(
      <PkResultScreen
        result={makeResult({ outcome: 'draw', my_score: 3000, opponent_score: 3000 })}
        myName="小明"
        opponentName="小華"
        onRematch={noop}
        onChangeOpponent={noop}
        onBack={noop}
      />,
    );
    expect(screen.queryByText(/作答比較快/)).toBeNull();
  });

  it('a decisive (non-tied) score shows no "分數打平" note', () => {
    render(
      <PkResultScreen
        result={makeResult({ outcome: 'win', my_score: 4000, opponent_score: 3000 })}
        myName="小明"
        opponentName="小華"
        onRematch={noop}
        onChangeOpponent={noop}
        onBack={noop}
      />,
    );
    expect(screen.queryByText(/分數打平/)).toBeNull();
  });
});

describe('PkResultScreen — #4050 an unanswered round is 時間到, not 答錯', () => {
  it('shows 時間到 for a round with no recorded choice', () => {
    render(
      <PkResultScreen
        result={makeResult({
          rounds: [makeRound({ round_index: 0, my_choice_key: null, my_is_correct: false })],
        })}
        onRematch={noop}
        onChangeOpponent={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText(/時間到/)).toBeTruthy();
    expect(screen.queryByText(/✗ 答錯/)).toBeNull();
  });

  it('positive control: a genuinely wrong recorded answer still shows ✗ 答錯', () => {
    render(
      <PkResultScreen
        result={makeResult({
          rounds: [makeRound({ round_index: 0, my_choice_key: 'B', my_is_correct: false })],
        })}
        onRematch={noop}
        onChangeOpponent={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText(/✗ 答錯/)).toBeTruthy();
    expect(screen.queryByText(/時間到/)).toBeNull();
  });

  it('positive control: a correct answer still shows ✓ 答對', () => {
    render(
      <PkResultScreen
        result={makeResult({
          rounds: [makeRound({ round_index: 0, my_choice_key: 'A', my_is_correct: true })],
        })}
        onRematch={noop}
        onChangeOpponent={noop}
        onBack={noop}
      />,
    );
    expect(screen.getByText(/✓ 答對/)).toBeTruthy();
  });
});
