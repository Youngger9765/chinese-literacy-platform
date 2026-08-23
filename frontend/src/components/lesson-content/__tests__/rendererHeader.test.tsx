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

/**
 * ⚠️ 上面那組只涵蓋單欄分支 —— 測試資料沒有課文區塊，所以走單欄。
 * 閱讀理解頁**有**課文，走雙欄，而雙欄的欄標題是另一處寫死的字串。
 * 上一個 commit 只改了單欄，本機全綠，**線上 QA 才抓到標題還是「閱讀聚光燈」**。
 *
 * 這組帶課文區塊強制走雙欄。沒有它，同樣的半修會再發生一次而測試不會說話。
 */
describe('雙欄版面的欄標題也要跟著 step', () => {
  const WITH_READING = {
    lessonCode: 'G4-L10',
    title: null,
    blocks: [
      { id: 'p1', type: 'passage', kind: 'passage', text: '十秒鐘，看似短暫。' },
      LESSON.blocks[0],
    ],
  };

  it('閱讀理解頁的作答欄標題是「閱讀理解」', () => {
    render(
      <LessonRenderer lesson={WITH_READING as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />,
    );
    expect(screen.queryByText('閱讀聚光燈')).toBeNull();
    expect(screen.getAllByText('閱讀理解').length).toBeGreaterThan(0);
  });

  it('聚光燈頁照舊（正向對照）', () => {
    render(
      <LessonRenderer lesson={WITH_READING as never} lessonCode="G4-L10" sectionLabel="閱讀聚光燈" />,
    );
    expect(screen.getAllByText('閱讀聚光燈').length).toBeGreaterThan(0);
  });
});

/**
 * 「閱讀學習 ＋ 課名」那條頁首，在學習流程裡是第三次出現的課名。
 *
 * #2897：學習頂欄已經寫著《贏得喝采的輸家》· 閱讀理解 7/10 ＋ 一行提示。
 * `LessonRenderer` 自己又印一次課名，還多一個對學生沒有意義的 eyebrow
 * 「閱讀學習」—— 而十一步裡只有 `comprehension` 與 `spotlight` 這兩步有，
 * 因為只有它們用這個 renderer。
 *
 * 這條頁首是給 `DevLessonPage` 那種沒有頂欄的獨立頁用的，所以預設關閉、
 * 由那頁自己打開。預設值本身就是鎖：新的學習步驟接上來時不會再默默多一份課名。
 */
describe('閱讀學習頁首（#2897）', () => {
  const TITLED = { ...LESSON, title: '贏得喝采的輸家' };

  it('預設不印「閱讀學習」eyebrow，也不重複課名', () => {
    render(<LessonRenderer lesson={TITLED as never} lessonCode="G4-L10" sectionLabel="閱讀理解" />);
    expect(screen.queryByText('閱讀學習')).toBeNull();
    expect(screen.queryByText('贏得喝采的輸家')).toBeNull();
  });

  it('showLessonHeader 打開時才印（正向對照 —— 少了這條，整個元件壞掉也會「通過」）', () => {
    render(
      <LessonRenderer
        lesson={TITLED as never}
        lessonCode="G4-L10"
        sectionLabel="閱讀理解"
        showLessonHeader
      />,
    );
    expect(screen.getByText('閱讀學習')).toBeTruthy();
    expect(screen.getByText('贏得喝采的輸家')).toBeTruthy();
  });
});
