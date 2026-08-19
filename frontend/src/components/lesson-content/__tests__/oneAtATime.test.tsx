/**
 * 閱讀理解一次把所有題目列出來。
 *
 * Young 2026-08-19，`/learn/20001/comprehension`：
 * > 閱讀理解這邊都是選擇題，可以一題一題出嗎？
 *
 * `LessonRenderer` 的 `exerciseBlocks.map(...)` 把整份練習一次畫完。
 * 旁邊那條路（`MultipleChoiceExercise`）早就是 `questions[current]` 一次一題 ——
 * 又是同一件事有兩種做法，而學生走到哪條路是看資料形狀決定的。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LessonRenderer from '../LessonRenderer';

const mcq = (id: string, q: string) => ({
  id, type: 'exercise', kind: 'exercise', grader: 'exact',
  answerSpace: 'choice', answer: 0,
  question: { kind: 'multiple_choice', question: q, options: ['甲', '乙'] },
});

const LESSON = {
  lessonCode: 'G4-L10',
  title: null,
  blocks: [mcq('q1', '第一題問什麼'), mcq('q2', '第二題問什麼'), mcq('q3', '第三題問什麼')],
};

describe('練習一次出一題', () => {
  it('一開始只看得到第一題', () => {
    render(<LessonRenderer lesson={LESSON as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />);
    expect(screen.getByText('第一題問什麼')).toBeTruthy();
    expect(screen.queryByText('第二題問什麼')).toBeNull();
    expect(screen.queryByText('第三題問什麼')).toBeNull();
  });

  it('看得到自己走到哪裡', () => {
    render(<LessonRenderer lesson={LESSON as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />);
    expect(screen.getByText(/1\s*\/\s*3/)).toBeTruthy();
  });

  it('答完可以前進到下一題', () => {
    render(<LessonRenderer lesson={LESSON as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />);
    fireEvent.click(screen.getAllByText('甲')[0]);
    const next = screen.getByRole('button', { name: /下一題/ });
    fireEvent.click(next);
    expect(screen.getByText('第二題問什麼')).toBeTruthy();
    expect(screen.queryByText('第一題問什麼')).toBeNull();
  });

  it('只有一題時不出現分頁（負向對照）', () => {
    render(
      <LessonRenderer
        lesson={{ ...LESSON, blocks: [mcq('q1', '唯一一題')] } as never}
        lessonCode="G4-L10"
        sectionLabel="閱讀理解"
      />,
    );
    expect(screen.queryByRole('button', { name: /下一題/ })).toBeNull();
  });
});
