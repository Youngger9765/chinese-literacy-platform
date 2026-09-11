/**
 * 答錯之後補救管道要還在（#3158）
 *
 * 這顆「問 AI 助教，一起想想看」按鈕**已經死過兩次**：
 *
 *   第一次（#2199 之後）條件是 `revealed && !isCorrect`，而 revealed 改成只在答對時
 *   為 true，於是條件恆為 false，按鈕變死碼。修法是改看 `wrongFeedback`。
 *
 *   第二次（本票）`wrongFeedback` 在 900ms 後被同一個 setTimeout 清掉，所以按鈕的
 *   存活時間就是那 900 毫秒。而且過了之後點也沒用 —— `openRescue()` 第一行是
 *   `if (!selected) return;`，而那個 timeout 同時清掉 selected。
 *
 * ⛔ 所以這裡**不准只鎖「條件為 true」**。要鎖的是「答錯之後按鈕還在、而且點得動」，
 *    並且要跨過那個視覺閃爍的時間點再驗一次。
 *
 * 第二件事：解說原本只在 `revealed` 時顯示，而 revealed 只在答對時為 true，
 * 所以答錯的孩子看不到正解也看不到解說，還能無限重選而分數照加。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import MultipleChoiceExercise from '../MultipleChoiceExercise';
import { MultipleChoiceItem } from '../../../types';
import { recordMcqAttempt } from '../../../services/learningApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));
vi.mock('../../../services/learningApi', () => ({
  recordMcqAttempt: vi.fn(),
  mcqRescueStart: vi.fn(async () => ({ session_id: 1, message: '我們一起想想看' })),
  mcqRescueRespond: vi.fn(async () => ({ message: '再想一下' })),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

const questions: MultipleChoiceItem[] = [
  {
    question: '文章的主題是什麼？',
    options: ['自然環境', '科技發展', '人際關係', '歷史文化'],
    answer: 'B',
    explanation: '文章主要討論科技對社會的影響。',
  },
];

/** 兩題版本 —— 換題重置那條路要有兩題才走得到（見最後一組測試） */
const twoQuestions: MultipleChoiceItem[] = [
  questions[0],
  {
    question: '作者的態度是？',
    options: ['樂觀', '悲觀', '中立', '批判'],
    answer: 'A',
    explanation: '作者對未來持樂觀態度。',
  },
];

const RESCUE = /問 AI 助教/;
const FLASH_MS = 900;   // 視覺閃爍的長度，按鈕不該跟它同生共死

beforeEach(() => { vi.mocked(recordMcqAttempt).mockClear(); vi.useFakeTimers(); });
afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

/** 點一個錯的選項（正解是 B／科技發展，所以點 A／自然環境） */
function answerWrong() {
  fireEvent.click(screen.getByText('自然環境'));
}

describe('答錯之後補救按鈕要活著', () => {
  it('正向對照：答錯當下按鈕會出現（不然下面的斷言什麼都不證明）', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    expect(screen.queryByRole('button', { name: RESCUE })).toBeNull();
    answerWrong();
    expect(screen.getByRole('button', { name: RESCUE })).toBeTruthy();
  });

  it('⭐ 過了視覺閃爍的 900 毫秒之後，按鈕還要在', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    answerWrong();
    act(() => { vi.advanceTimersByTime(FLASH_MS + 400); });
    expect(
      screen.queryByRole('button', { name: RESCUE }),
      '按鈕在 900ms 後消失了 —— 就是 #3158 那個 bug',
    ).not.toBeNull();
  });

  it('⭐ 過了 900 毫秒之後點下去要真的打開對話，不是空操作', async () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    answerWrong();
    act(() => { vi.advanceTimersByTime(FLASH_MS + 400); });
    const btn = screen.getByRole('button', { name: RESCUE });
    await act(async () => { fireEvent.click(btn); });
    // 對話開了之後按鈕會消失（條件帶 !rescueOpen），這是「真的打開了」的訊號
    expect(
      screen.queryByRole('button', { name: RESCUE }),
      '點了沒反應 —— openRescue 被 `if (!selected) return` 擋掉了',
    ).toBeNull();
  });

  it('視覺閃爍本身還是要在 900 毫秒後停（既有行為，不可退化）', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    answerWrong();
    expect(screen.getByText(/再選一次/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(FLASH_MS + 100); });
    expect(screen.queryByText(/再選一次/), '閃爍沒停 —— 學生會以為卡住').toBeNull();
  });

  it('答對的時候不該出現補救按鈕', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    fireEvent.click(screen.getByText('科技發展'));   // B = 正解
    expect(screen.queryByRole('button', { name: RESCUE })).toBeNull();
  });
});

describe('答錯的孩子也要看得到解說', () => {
  it('正向對照：答對時解說會出現', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    fireEvent.click(screen.getByText('科技發展'));
    expect(screen.getByText(/文章主要討論科技對社會的影響/)).toBeTruthy();
  });

  it('第一次答錯不揭露答案（#2199 的設計，讓他再試一次）', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    answerWrong();
    expect(screen.queryByText(/文章主要討論科技對社會的影響/)).toBeNull();
  });

  it('⭐ 同一題答錯第二次之後要揭露解說，不要讓他無限猜', () => {
    render(<MultipleChoiceExercise questions={questions} onComplete={() => {}} />);
    answerWrong();
    act(() => { vi.advanceTimersByTime(FLASH_MS + 100); });
    fireEvent.click(screen.getByText('人際關係'));   // C，第二次也錯
    act(() => { vi.advanceTimersByTime(FLASH_MS + 100); });
    expect(
      screen.queryByText(/文章主要討論科技對社會的影響/),
      '答錯兩次還是看不到解說 —— 孩子學不到東西卻能無限重選',
    ).not.toBeNull();
  });
});

describe('換題要重置，不准跨題污染', () => {
  // ⚠️ 這一組是突變測試逼出來的。原本整個檔案只用一題，所以「換題重置」那兩行
  //    拿掉之後**沒有任何測試變紅** —— 鎖有洞而我看不到。有洞的鎖跟沒有鎖一樣。
  function goNext() {
    fireEvent.click(screen.getByRole('button', { name: /下一題|繼續|下一個/ }));
  }

  it('第一題答錯後換題，第二題不該一開始就有補救按鈕', () => {
    render(<MultipleChoiceExercise questions={twoQuestions} onComplete={() => {}} />);
    answerWrong();                                   // 第一題錯
    expect(screen.getByRole('button', { name: RESCUE })).toBeTruthy();   // 正向對照
    act(() => { vi.advanceTimersByTime(FLASH_MS + 100); });
    fireEvent.click(screen.getByText('科技發展'));    // 第一題答對才能前進
    act(() => { vi.advanceTimersByTime(100); });
    goNext();
    expect(screen.getByText(/作者的態度是/)).toBeTruthy();               // 真的換題了
    expect(
      screen.queryByRole('button', { name: RESCUE }),
      '第二題還沒作答就出現補救按鈕 —— lastWrongChoice 沒有跨題重置',
    ).toBeNull();
  });

  it('第一題錯過之後，第二題的解說不該一開始就揭露', () => {
    render(<MultipleChoiceExercise questions={twoQuestions} onComplete={() => {}} />);
    answerWrong();
    act(() => { vi.advanceTimersByTime(FLASH_MS + 100); });
    fireEvent.click(screen.getByText('人際關係'));    // 第一題再錯一次 → wrongCount 2
    act(() => { vi.advanceTimersByTime(FLASH_MS + 100); });
    expect(screen.queryByText(/文章主要討論科技對社會的影響/)).not.toBeNull();  // 正向對照
    fireEvent.click(screen.getByText('科技發展'));
    act(() => { vi.advanceTimersByTime(100); });
    goNext();
    expect(
      screen.queryByText(/作者對未來持樂觀態度/),
      '第二題還沒作答就揭露解說 —— wrongCount 沒有跨題重置',
    ).toBeNull();
  });
});
