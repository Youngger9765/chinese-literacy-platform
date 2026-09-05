/**
 * 一題多個正解（學習單上標 `multi: true` 的那種）—— 學生選任一個都該算對。
 *
 * 🔴 為什麼有這一支：L0072 第 5 題「面對各種聳動的新聞，要抱持（　）的態度」
 * 學習單上 F（懷疑）與 E（質疑）都算對，抽取器也忠實抽出 `['F','E']`。
 * 但那個列表一路到 prod 都沒有任何消費端 —— 後端寫進 `accepted_answers`、
 * 前端型別把它丟掉、adapter 只取 `letterToIndex(item.answer)` 單一個，
 * 於是**兩個正解裡只有一個判得對，另一個學生照樣被打錯**。
 *
 * 這支鎖的是整條路徑，不是單一函式：型別要帶得過來、adapter 要轉成索引集合、
 * 評分要認那個集合。少接一層就會回到「抽對了卻沒人接」。
 */
import { describe, it, expect } from 'vitest';
import { grade } from '../lessonGrading';
import { storyToLesson } from '../lessonContentAdapter';
import { ExerciseBlock } from '../../../schema/lessonContent';

const VOCAB = { A: '推敲', B: '斟酌', C: '揣摩', D: '思量', E: '質疑', F: '懷疑', G: '評估' };
// vocabBank 依鍵排序後的位置：A=0 B=1 C=2 D=3 E=4 F=5 G=6
const IDX_E = 4;
const IDX_F = 5;

function choiceExercise(extra: Record<string, unknown>) {
  return ExerciseBlock.parse({
    id: 'ex-fib-5',
    type: 'exercise',
    question: { kind: 'fill_in_blank', sentence: '要抱持（　）的態度', vocabBank: VOCAB },
    answerSpace: 'choice',
    answer: IDX_F,
    grader: 'exact',
    anchors: [],
    ...extra,
  });
}

describe('一題多正解：schema 帶得過來', () => {
  it('acceptedAnswers 是 ExerciseBlock 的合法欄位', () => {
    // .strict() —— 沒宣告的欄位會直接 throw，所以這條同時證明欄位存在
    const ex = choiceExercise({ acceptedAnswers: [IDX_F, IDX_E] });
    expect(ex.acceptedAnswers).toEqual([IDX_F, IDX_E]);
  });

  it('沒有 acceptedAnswers 時仍然合法（絕大多數題目只有一個正解）', () => {
    expect(choiceExercise({}).acceptedAnswers).toBeUndefined();
  });
});

describe('一題多正解：評分認整個集合', () => {
  it('選 F（主答案）算對', () => {
    expect(grade(choiceExercise({ acceptedAnswers: [IDX_F, IDX_E] }), IDX_F).verdict).toBe(true);
  });

  it('選 E（另一個正解）也算對 —— 這就是 L0072 學生被打錯的那一格', () => {
    expect(grade(choiceExercise({ acceptedAnswers: [IDX_F, IDX_E] }), IDX_E).verdict).toBe(true);
  });

  it('負向對照：選不在集合裡的 A 仍然算錯', () => {
    expect(grade(choiceExercise({ acceptedAnswers: [IDX_F, IDX_E] }), 0).verdict).toBe(false);
  });

  it('負向對照：沒有 acceptedAnswers 的題目，只有主答案算對', () => {
    const ex = choiceExercise({});
    expect(grade(ex, IDX_F).verdict).toBe(true);
    expect(grade(ex, IDX_E).verdict).toBe(false);
  });
});

describe('一題多正解：adapter 把後端的字母轉成索引', () => {
  const story = {
    id: '20072',
    title: '重複朗讀的重要性',
    lesson_code: 'G5-L07',
    paragraphs: ['柳丁和文旦看起來像，吃起來卻不一樣。'],
    vocabBank: VOCAB,
    fillInBlank: [
      { sentence: '第一題', answer: 'C' },
      { sentence: '要抱持（　）的態度', answer: 'F', accepted_answers: ['F', 'E'] },
    ],
  };

  it('帶 accepted_answers 的題目轉出索引集合', () => {
    const r = storyToLesson(story as never);
    const ex = r.lesson?.blocks.find((b) => b.id === 'ex-fib-2');
    expect(ex, 'ex-fib-2 應該存在').toBeTruthy();
    expect((ex as { acceptedAnswers?: number[] }).acceptedAnswers).toEqual([IDX_F, IDX_E]);
  });

  it('負向對照：沒帶 accepted_answers 的題目不長出這個欄位', () => {
    const r = storyToLesson(story as never);
    const ex = r.lesson?.blocks.find((b) => b.id === 'ex-fib-1');
    expect((ex as { acceptedAnswers?: number[] }).acceptedAnswers).toBeUndefined();
  });

  // 這條守的是 adapter 的 `.every()` —— 只要有一個字母轉不出索引，整個集合作廢。
  // 沒有它，把 `.every()` 換成 `.filter(m => m != null)`（放半套集合過去）不會有任何測試變紅，
  // 而那個半套集合會讓某個正解無聲消失：學生選它，畫面說錯。
  it('負向對照：集合裡有轉不出索引的代號 → 整個集合作廢，並留下 gap', () => {
    const broken = {
      ...story,
      fillInBlank: [{ sentence: '壞掉的那題', answer: 'F', accepted_answers: ['F', '?'] }],
    };
    const r = storyToLesson(broken as never);
    const ex = r.lesson!.blocks.find((b) => b.id === 'ex-fib-1')!;
    expect((ex as { acceptedAnswers?: number[] }).acceptedAnswers,
      '半套集合不可以進到評分').toBeUndefined();
    expect(r.gaps.some((g) => g.includes('accepted_answers')),
      '作廢要留下 gap，不可以無聲吞掉').toBe(true);
    // 作廢之後仍然照單一主答案判分 —— 不是整題壞掉
    expect(grade(ex as never, IDX_F).verdict).toBe(true);
    expect(grade(ex as never, IDX_E).verdict).toBe(false);
  });

  it('端到端：adapter 出來的那題，選 E 判對', () => {
    const r = storyToLesson(story as never);
    const ex = r.lesson!.blocks.find((b) => b.id === 'ex-fib-2')!;
    expect(grade(ex as never, IDX_E).verdict).toBe(true);
  });
});
