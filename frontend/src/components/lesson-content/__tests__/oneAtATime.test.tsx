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

/**
 * ⚠️ 上面那組的 fixture **全是選擇題**，所以第一版的判準
 * （`exerciseBlocks.every(是選擇題)`）在測試裡永遠成立、永遠綠。
 *
 * 真實的 20001 同時有 5 題 MCQ 和 6 個聚光燈 block，兩者都算 exercise，
 * `.every()` 於是正確地回 false —— **部署了、chunk 裡有那段 code、55 條測試全綠，
 * 而學生看到的還是五題一次列出來。** 是線上 QA 才發現的。
 *
 * 這一組餵混合型：判準改成「選擇題有幾題」，非選擇題的照舊全顯示。
 */
describe('混著非選擇題時，選擇題仍然一題一題', () => {
  // ⚠️ kind 要用 `ExerciseBlockView` 真的支援的（custom / guided_steps /
  // graphic_text_integration / multiple_choice / ordering / trait_inference）。
  // 第一版我寫 `short_answer` —— 那個 kind 不存在，畫不出來，於是負向對照紅得
  // 像是我的分頁把它藏起來了。**編一個不存在的形狀去測，紅的訊息會指向錯的地方。**
  const ordering = {
    id: 't1', type: 'exercise', kind: 'exercise', grader: 'ordered',
    answerSpace: 'order', answer: [0, 1],
    // `ordering` 讀的是 `instruction` 與字串陣列 `items` —— 不是 `question` 和物件。
    // 我連著兩次憑印象編 fixture，兩次紅的訊息都指向錯的地方
    // （先是「找不到文字」，再是 React「物件不能當 child」）。
    // 形狀要去 `ExerciseBlockView` 對應那個 `kind` 的分支看，不要用猜的。
    question: { kind: 'ordering', instruction: '把句子排好', items: ['甲', '乙'] },
  };
  const MIXED = {
    lessonCode: 'G4-L10',
    title: null,
    blocks: [mcq('q1', '第一題問什麼'), ordering, mcq('q2', '第二題問什麼'), mcq('q3', '第三題問什麼')],
  };

  it('分頁照樣啟用（不因為混了一個非選擇題就整份不分頁）', () => {
    render(<LessonRenderer lesson={MIXED as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />);
    expect(screen.getByText('第一題問什麼')).toBeTruthy();
    expect(screen.queryByText('第二題問什麼')).toBeNull();
    expect(screen.getByText(/1\s*\/\s*3/)).toBeTruthy();   // 分母是 MCQ 題數，不是 4
  });

  it('非選擇題的區塊不會被藏起來（負向對照）', () => {
    render(<LessonRenderer lesson={MIXED as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />);
    expect(screen.getByText('把句子排好')).toBeTruthy();
  });
});
