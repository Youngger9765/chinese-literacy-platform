/** #3642 — the projector question screen marks the asked 注音 character. */
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeacherLiveQuizQuestion from '../TeacherLiveQuizQuestion';
import type { LiveQuizState } from '../../../../services/liveQuizApi';

const stem = '她卻不改性子，說：不後悔。';
const targetIndex = stem.lastIndexOf('不');

function state(withOptions: boolean): LiveQuizState {
  return {
    code: '123456', status: 'question', version: 1, server_now: new Date().toISOString(),
    round_index: 0, rounds_total: 3, question_started_at: new Date().toISOString(),
    answer_open_at: withOptions ? new Date().toISOString() : null, reading_seconds: 2,
    round: {
      item_id: 'z', source_module: 'zhuyin', lesson_uid: 'L1', lesson_title: 't', stem,
      ...(withOptions ? { options: [{ key: 'A', text: 'ㄅㄨˋ' }, { key: 'B', text: 'ㄅㄨˊ' }] } : {}),
      seconds: 30, reading_seconds: 2, extra: { target_index: targetIndex },
    },
    answered_count: 0, players_count: 3, is_host: true, classroom_id: null,
    settings: {
      seconds: 30, question_count_mode: 'all', shuffle: false, show_leaderboard_after_each: true,
      double_points_last: false, streak_bonus: false, practice_mode: false, source_modules: ['zhuyin'],
    },
    ended_reason: null, ended_by_host: false,
  } as unknown as LiveQuizState;
}

describe('TeacherLiveQuizQuestion marks the asked character (#3642)', () => {
  for (const withOptions of [false, true]) {
    it(withOptions ? 'answer window' : 'reading phase', () => {
      const { container } = render(
        <TeacherLiveQuizQuestion state={state(withOptions)} onReveal={vi.fn()} revealing={false} />,
      );
      const marked = container.querySelectorAll('[data-testid="stem-target"]');
      expect(marked.length).toBe(1);
      expect(marked[0].textContent).toBe('不');
    });
  }
});
