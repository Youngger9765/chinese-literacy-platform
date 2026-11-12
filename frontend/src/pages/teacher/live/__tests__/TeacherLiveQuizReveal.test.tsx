/**
 * TeacherLiveQuizReveal — issue #3631 P0 #2/#3/#5.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeacherLiveQuizReveal from '../TeacherLiveQuizReveal';
import type { LiveQuizState, LiveQuizLeaderboardEntry } from '../../../../services/liveQuizApi';

function leaderboard(n: number): LiveQuizLeaderboardEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    player_id: i + 1,
    display_name: `學生${i + 1}`,
    total_score: 1000 - i * 50,
    rank: i + 1,
  }));
}

function baseState(overrides: Partial<LiveQuizState>): LiveQuizState {
  return {
    code: '123456',
    status: 'reveal',
    version: 1,
    server_now: new Date().toISOString(),
    round_index: 0,
    rounds_total: 3,
    question_started_at: null,
    answer_open_at: null,
    reading_seconds: 2,
    round: {
      item_id: 'x', source_module: 'comprehension', lesson_uid: 'L1', lesson_title: 't',
      stem: '題幹', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }],
      correct_key: 'A', seconds: 30, reading_seconds: 2,
    },
    answered_count: 5,
    players_count: 7,
    is_host: true,
    classroom_id: null,
    settings: {
      seconds: 30, question_count_mode: 'all', shuffle: false,
      show_leaderboard_after_each: true, double_points_last: false,
      streak_bonus: false, practice_mode: false, source_modules: ['comprehension'],
    },
    ended_reason: null,
    ended_by_host: false,
    ...overrides,
  } as LiveQuizState;
}

describe('TeacherLiveQuizReveal — top 5 with scores (P0 #3)', () => {
  it('shows up to 5 players WITH their scores, not just 3 names', () => {
    render(
      <TeacherLiveQuizReveal
        state={baseState({ leaderboard: leaderboard(7) })}
        onNext={vi.fn()}
        advancing={false}
      />,
    );
    expect(screen.getByText('學生1')).toBeTruthy();
    expect(screen.getByText('學生5')).toBeTruthy();
    expect(screen.queryByText('學生6')).toBeNull(); // only top 5
    expect(screen.getByText('1000 分')).toBeTruthy(); // scores ARE shown now
  });
});

describe('TeacherLiveQuizReveal — 看解析 (P0 #2)', () => {
  it('shows a collapsed 看解析 button when the round has explanation text, and expands on click', () => {
    render(
      <TeacherLiveQuizReveal
        state={baseState({
          leaderboard: leaderboard(2),
          round: {
            item_id: 'x', source_module: 'comprehension', lesson_uid: 'L1', lesson_title: 't',
            stem: '題幹', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }],
            correct_key: 'A', seconds: 30, reading_seconds: 2, explanation: '因為課文第二段這樣寫。',
          },
        })}
        onNext={vi.fn()}
        advancing={false}
      />,
    );
    expect(screen.queryByText('因為課文第二段這樣寫。')).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByRole('button', { name: /看解析/ }));
    expect(screen.getByText('因為課文第二段這樣寫。')).toBeTruthy();
  });

  it('shows no 看解析 button when the round has no explanation text', () => {
    render(
      <TeacherLiveQuizReveal state={baseState({ leaderboard: leaderboard(2) })} onNext={vi.fn()} advancing={false} />,
    );
    expect(screen.queryByRole('button', { name: /看解析/ })).toBeNull();
  });
});

describe('TeacherLiveQuizReveal — last round skips straight to podium (P0 #5)', () => {
  it('does NOT render the leaderboard on the last round, even if the host state carries one', () => {
    render(
      <TeacherLiveQuizReveal
        state={baseState({ round_index: 2, rounds_total: 3, leaderboard: leaderboard(5) })}
        onNext={vi.fn()}
        advancing={false}
      />,
    );
    expect(screen.queryByText('目前排行（前五名）')).toBeNull();
    expect(screen.queryByText('學生1')).toBeNull();
    expect(screen.getByRole('button', { name: '查看頒獎台' })).toBeTruthy();
  });

  it('DOES render the leaderboard on a non-last round', () => {
    render(
      <TeacherLiveQuizReveal
        state={baseState({ round_index: 0, rounds_total: 3, leaderboard: leaderboard(5) })}
        onNext={vi.fn()}
        advancing={false}
      />,
    );
    expect(screen.getByText('目前排行（前五名）')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一題' })).toBeTruthy();
  });
});

describe('TeacherLiveQuizReveal — zhuyin target character is marked (#3642)', () => {
  it('marks only the asked character when the stem repeats it', () => {
    const stem = '她卻不改性子，說：不後悔。';
    const targetIndex = stem.lastIndexOf('不');
    const { container } = render(
      <TeacherLiveQuizReveal
        state={baseState({
          round: {
            item_id: 'z', source_module: 'zhuyin', lesson_uid: 'L1', lesson_title: 't',
            stem, options: [{ key: 'A', text: 'ㄅㄨˋ' }, { key: 'B', text: 'ㄅㄨˊ' }],
            correct_key: 'A', seconds: 30, reading_seconds: 2,
            extra: { target_index: targetIndex },
          } as LiveQuizState['round'],
        })}
        onNext={vi.fn()}
        advancing={false}
      />,
    );
    const marked = container.querySelectorAll('[data-testid="stem-target"]');
    expect(marked.length).toBe(1);
    expect(marked[0].textContent).toBe('不');
    // the marked one is the second 不, not the first
    const stemEl = marked[0].parentElement as HTMLElement;
    expect(stemEl.textContent?.indexOf('不後悔')).toBe(targetIndex);
    expect(stemEl.textContent?.slice(0, targetIndex + 1).endsWith('不')).toBe(true);
  });

  it('renders the plain stem when there is no target', () => {
    const { container } = render(
      <TeacherLiveQuizReveal state={baseState({})} onNext={vi.fn()} advancing={false} />,
    );
    expect(container.querySelectorAll('[data-testid="stem-target"]').length).toBe(0);
  });
});

describe('TeacherLiveQuizReveal — how many picked each option (PRD §4 step 4)', () => {
  it('shows the count on every option, including zero', () => {
    const { container } = render(
      <TeacherLiveQuizReveal
        state={baseState({ option_counts: { A: 3, B: 0 } } as Partial<LiveQuizState>)}
        onNext={vi.fn()}
        advancing={false}
      />,
    );
    const counts = Array.from(container.querySelectorAll('[data-testid="option-count"]')).map((e) => e.textContent);
    expect(counts).toEqual(['3 人', '0 人']);
  });

  it('shows no counts when the server sent none', () => {
    const { container } = render(
      <TeacherLiveQuizReveal state={baseState({})} onNext={vi.fn()} advancing={false} />,
    );
    expect(container.querySelectorAll('[data-testid="option-count"]').length).toBe(0);
  });
});
