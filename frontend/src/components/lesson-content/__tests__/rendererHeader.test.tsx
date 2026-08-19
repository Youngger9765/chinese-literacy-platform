/**
 * 閱讀理解頁的標題印著「閱讀聚光燈」。
 *
 * Young 2026-08-19，`/learn/20001/comprehension`：
 *
 *     閱讀學習 / 十秒的背後
 *     [highlight] 閱讀聚光燈          ← 這是閱讀理解頁
 *     menu_book 參考課文
 *     下列哪個詞語使用正確？
 *
 * > 閱讀理解，為什麼標題是 閱讀聚光燈？？？？？？？
 *
 * `LessonRenderer` 把卡片標題寫死：
 *
 *     exerciseBlocks.length > 0 ? { icon: 'highlight', label: '閱讀聚光燈' }
 *                               : { icon: 'menu_book', label: '參考課文' }
 *
 * 它同時服務聚光燈頁與閱讀理解頁，卻假設「有練習題 ⇒ 我是聚光燈」。
 * 閱讀理解也有練習題，於是掛上別人的名字。
 *
 * ⚠️ 只把字串改掉不算修好 —— 那會變成「標題對了但內容還是聚光燈」的假修好。
 * 呼叫端要能說出自己是誰，因為只有它知道。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LessonRenderer from '../LessonRenderer';

const LESSON = {
  lessonCode: 'G4-L10',
  title: null,
  blocks: [
    {
      id: 'q1', type: 'exercise', kind: 'exercise', grader: 'exact',
      answerSpace: 'choice', answer: 0,
      question: { kind: 'multiple_choice', question: '下列哪個詞語使用正確？', options: ['甲', '乙'] },
    },
  ],
};

describe('LessonRenderer 的卡片標題要跟著它服務的 step', () => {
  it('閱讀理解頁不可以說自己是閱讀聚光燈', () => {
    render(<LessonRenderer lesson={LESSON as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />);
    expect(screen.queryByText('閱讀聚光燈')).toBeNull();
    expect(screen.getByText('閱讀理解')).toBeTruthy();
  });

  it('聚光燈頁照舊叫閱讀聚光燈（正向對照）', () => {
    render(<LessonRenderer lesson={LESSON as never} lessonCode="G4-L10" sectionLabel="閱讀聚光燈" />);
    expect(screen.getByText('閱讀聚光燈')).toBeTruthy();
  });

  it('沒有指定時維持原本的行為（不強迫每個呼叫端立刻改）', () => {
    render(<LessonRenderer lesson={LESSON as never} lessonCode="G4-L10" />);
    expect(screen.getByText('閱讀聚光燈')).toBeTruthy();
  });
});
