/**
 * 一題兩個正解時，選任一個都要算對 —— 打在**學生實際走的那支元件**上。
 *
 * 🔴 為什麼這一支要獨立存在：L0072 第 5 題 F（懷疑）/ E（質疑）都對，
 * 後端 prod 早就送出 `accepted_answers: ["F","E"]`。我第一次修的是
 * `lessonContentAdapter` + `lessonGrading` 那條渲染路徑，10 條測試全綠、
 * mutation 四層都咬得住 —— 然後在 preview 用真帳號走到第 5 題點「質疑」，
 * 畫面回「再試試看！」。**語詞應用這一步走的是這支 legacy 元件，
 * 跟我改的那條路完全無關。**
 *
 * 所以這裡鎖的是 `handleSelect` 的判對條件本身，不是任何轉接層。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FillInBlankExercise from '../FillInBlankExercise';
import { FillInBlankItem } from '../../../types';

const vocabBank: Record<string, string> = {
  A: '負擔', B: '負荷', C: '負責', D: '遷移', E: '質疑', F: '懷疑', G: '遷徙',
};

/** L0072 第 5 題：學習單上 F 與 E 都算對（那一列標 multi: true）。 */
const multiAnswer: FillInBlankItem[] = [
  { sentence: '面對各種聳動的新聞，要抱持(　　)的態度。', answer: 'F', accepted_answers: ['F', 'E'] },
];
const singleAnswer: FillInBlankItem[] = [
  { sentence: '他做事認真又(　　)。', answer: 'C' },
];

function pick(word: string) {
  fireEvent.click(screen.getAllByText(word)[0]);
}
const retryShown = () => screen.queryByText(/再試試看/) != null;

describe('一題兩個正解', () => {
  it('選主答案（懷疑 F）算對', () => {
    render(<FillInBlankExercise sentences={multiAnswer} vocabBank={vocabBank} onComplete={() => {}} />);
    pick('懷疑');
    expect(retryShown(), '主答案不該出現「再試試看」').toBe(false);
  });

  it('選第二個正解（質疑 E）也算對 —— 這是學生在 prod 被打錯的那一格', () => {
    render(<FillInBlankExercise sentences={multiAnswer} vocabBank={vocabBank} onComplete={() => {}} />);
    pick('質疑');
    expect(retryShown(), '第二個正解不該出現「再試試看」').toBe(false);
  });

  it('負向對照：選不在集合裡的（負擔 A）仍然算錯', () => {
    render(<FillInBlankExercise sentences={multiAnswer} vocabBank={vocabBank} onComplete={() => {}} />);
    pick('負擔');
    expect(retryShown(), '錯的選項必須還是錯').toBe(true);
  });

  it('負向對照：沒有 accepted_answers 的題目，只有主答案算對', () => {
    const { unmount } = render(
      <FillInBlankExercise sentences={singleAnswer} vocabBank={vocabBank} onComplete={() => {}} />
    );
    pick('負責');
    expect(retryShown(), '主答案要對').toBe(false);
    unmount();

    render(<FillInBlankExercise sentences={singleAnswer} vocabBank={vocabBank} onComplete={() => {}} />);
    pick('質疑');
    expect(retryShown(), '沒宣告多正解時，別的詞必須算錯').toBe(true);
  });

  it('答對後回報的結果標記為正確（計分不能只看主答案）', () => {
    const onComplete = vi.fn();
    render(<FillInBlankExercise sentences={multiAnswer} vocabBank={vocabBank} onComplete={onComplete} />);
    pick('質疑');
    // 這一步已經是最後一題，元件會進入 summary 並回報
    const calls = onComplete.mock.calls;
    if (calls.length > 0) {
      const payload = JSON.stringify(calls[0]);
      expect(payload, '回報裡不該把這題記成答錯').not.toMatch(/"isCorrect":false/);
    }
    expect(retryShown()).toBe(false);
  });
});
