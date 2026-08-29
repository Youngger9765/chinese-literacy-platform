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
import { storyToLesson } from '../lessonContentAdapter';
import type { Story } from '../../../types';
import rawStory20011 from './fixtures/story-20011-comprehension.json';

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

/**
 * ⚠️ 上面兩組的 fixture 都只餵 `multiple_choice` / `ordering`，從沒餵過
 * `fill_in_blank` —— 而這才是真正咬人的那個。
 *
 * 真實課文（fixture 直接來自 `curl .../api/stories/20011`，未竄改一字）同時有
 * 5 題 multiple_choice **和** 8 題 fill_in_blank（語詞應用，同一個 vocab_bank
 * 9 選項，逐句共用）。`mcqBlocks` 只認 `kind === 'multiple_choice'`，於是分頁
 * 分母對了（`1 / 5`），可是 8 個 fill_in_blank 區塊全部不在 `mcqBlocks` 裡，
 * 被「非選擇題照舊全顯示」那條規則整批放行 —— 畫面變成 1 題 MCQ + 8 題
 * fill_in_blank 一次全部列出，跟 #2763 修之前一樣。
 *
 * 全庫掃過（175 課全掃，2026-08-19）：**126 課（72%）同時有 >1 題 multiple_choice
 * 和 >0 題 fill_in_blank** —— 不是 20011 一課的個案，是這個 filter 少算一種
 * kind 的系統性缺口。
 */
describe('真實課文：multiple_choice 之外，fill_in_blank 也要一題一題（#20011 fixture）', () => {
  const rawFillInBlank = (rawStory20011 as { fill_in_blank: Array<Record<string, unknown>> }).fill_in_blank;
  // 與 `api.ts` apiDetailToStory 相同的 legacy-schema 篩選（#1559/#1563）。
  const fillInBlank = rawFillInBlank.filter(
    (item) => item['_schema'] === 'legacy' || (typeof item['sentence'] === 'string' && !('context_before' in item)),
  ) as Array<{ sentence: string; answer: string }>;

  const story: Story = {
    ...(rawStory20011 as unknown as Story),
    id: String((rawStory20011 as { id: number }).id),
    lesson_code: (rawStory20011 as { grade_code: string }).grade_code,
    multipleChoice: (rawStory20011 as { multiple_choice: Story['multipleChoice'] }).multiple_choice,
    fillInBlank,
    vocabBank: (rawStory20011 as { vocab_bank: Story['vocabBank'] }).vocab_bank,
  } as Story;

  const { lesson, gaps } = storyToLesson(story);

  it('adapter 真的把 story 轉成 Lesson（不是 fixture 打錯字讓它整份 fallback）', () => {
    expect(lesson).not.toBeNull();
    expect(gaps.filter((g) => g.startsWith('adapter output failed'))).toHaveLength(0);
  });

  // `screen.getByText` 用 testing-library 的預設 normalizer 比對，會把句子裡的
  // 全形空格 `　`（（　）的那個空格）壓成一般空格，害查詢字串（原封不動帶
  // `　`）永遠對不上、回傳「找不到」——看起來像「被藏起來了」，其實是
  // 我查詢方式的偽陰性。改用 `container.textContent`（未經 normalizer）直接比對。
  const sentenceVisible = (container: HTMLElement, sentence: string) =>
    container.textContent!.includes(sentence);

  it('一開始只看得到一題 —— 不能同時看到 MCQ 第一題和任何一句 fill_in_blank 的句子', () => {
    const { container } = render(
      <LessonRenderer lesson={lesson as never} lessonCode="G4-L1" sectionLabel="閱讀理解" />,
    );
    // 第一題 MCQ 的題幹要在。
    expect(sentenceVisible(container, '請問「勢均力敵」，可以用哪個詞語替換？')).toBe(true);
    // 8 句 fill_in_blank 的句子，一句都不該在畫面上。
    for (const item of fillInBlank) {
      expect(sentenceVisible(container, item.sentence)).toBe(false);
    }
  });

  it('分頁分母是 MCQ+fill_in_blank 總題數（13），不是只算 MCQ（5）', () => {
    const { container } = render(
      <LessonRenderer lesson={lesson as never} lessonCode="G4-L1" sectionLabel="閱讀理解" />,
    );
    const total = (lesson!.blocks.filter(
      (b) => b.type === 'exercise' && (b.question.kind === 'multiple_choice' || b.question.kind === 'fill_in_blank'),
    )).length;
    expect(total).toBe(13);
    expect(sentenceVisible(container, `1 / ${total}`)).toBe(true);
  });

  it('答完全部 5 題 MCQ、按下一題後，看到的是 fill_in_blank 第一句，不是全部 8 句一次出現', () => {
    const { container } = render(
      <LessonRenderer lesson={lesson as never} lessonCode="G4-L1" sectionLabel="閱讀理解" />,
    );
    // 連續按 5 次「下一題」跳過 5 題 MCQ，落到 fill_in_blank 區。
    for (let i = 0; i < 5; i++) {
      const next = screen.getByRole('button', { name: /下一題/ });
      fireEvent.click(next);
    }
    expect(sentenceVisible(container, fillInBlank[0].sentence)).toBe(true);
    for (const item of fillInBlank.slice(1)) {
      expect(sentenceVisible(container, item.sentence)).toBe(false);
    }
  });
});
