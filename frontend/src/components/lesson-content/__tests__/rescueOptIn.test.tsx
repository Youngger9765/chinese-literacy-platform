/**
 * 小語老師答錯就自動跳出來，而且把正確答案標成綠色打勾。
 *
 * Young 2026-08-19 在 `/learn/20001/comprehension`：
 *
 * > 為什麼「小語老師」都在我寫錯的時候自動跳出來啊？還公布正確答案？
 * > 應該要等我送出後，我自己決定要不要 call 小語老師
 *
 * 兩件事各自都是缺陷：
 *
 * 1. **自動彈出** —— `ExerciseBlockView` 在 `result.verdict === false` 時直接
 *    `setRescue({...})`，學生沒有按任何東西。旁邊那條路
 *    （`MultipleChoiceExercise`）早就是按鈕才開，兩條路的行為不一樣。
 *
 * 2. 🔴 **公布答案** —— 對話框把 `correctAnswer` 那一格畫成綠底 + ✓。
 *    這是今天第六次「答案在學生作答之前就到得了」，只是走 AI 對話這條路。
 *    前五次分別在 `correct_options` 欄位、干擾項 `□①`、沒挖空的 `【答案】`、
 *    配對題 A–H、以及排序題的名次。
 *
 * ⚠️ 這裡不是把答案從 context 拿掉就好 —— AI 引導本來就需要知道正解才問得出
 * 好問題（後端 `correct_answer` 有在用）。要拿掉的是**顯示**那一段。
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ExerciseBlockView from '../ExerciseBlockView';

const EXERCISE = {
  id: 'q1',
  kind: 'exercise' as const,
  type: 'exercise' as const,
  answerSpace: 'choice' as const,
  // ⚠️ `grader` 不可省。`grade()` 的 default 分支回 MANUAL（verdict 既非 true 也非
  // false），於是「答錯」這條路根本沒被走到 —— 第一版 fixture 漏了它，
  //「答錯不會自動跳出」那條照樣綠，因為**從頭到尾沒有答錯過**。
  grader: 'exact' as const,
  answer: 1,
  question: {
    kind: 'multiple_choice' as const,
    question: '下列哪個詞語使用正確？',
    options: ['快樂的連假總是「轉瞬即逝」', '他「經年累月」地看了一眼', '天氣「事與願違」'],
  },
};

function renderBlock() {
  return render(
    <ExerciseBlockView
      exercise={EXERCISE as never}
      lessonCode="L0001"
      value={null}
      verdict={null}
      submitted={false}
      onValueChange={() => {}}
      onGraded={() => {}}
    />,
  );
}

describe('小語老師要學生自己叫，而且不公布答案', () => {
  it('答錯不會自動跳出對話框', () => {
    renderBlock();
    // 點第一個選項（正解是 index 1，所以這是錯的）
    fireEvent.click(screen.getAllByText(/快樂的連假總是/)[0]);
    expect(screen.queryByText('小語老師')).toBeNull();
  });

  it('答錯後有一個按鈕，學生自己決定要不要叫', () => {
    renderBlock();
    fireEvent.click(screen.getAllByText(/快樂的連假總是/)[0]);
    expect(screen.getByRole('button', { name: /小語老師|AI 助教|想想/ })).toBeTruthy();
  });

  it('對話框開了也不可以把正解標出來', () => {
    const { container } = renderBlock();
    fireEvent.click(screen.getAllByText(/快樂的連假總是/)[0]);
    const btn = screen.queryByRole('button', { name: /小語老師|AI 助教|想想/ });
    if (btn) fireEvent.click(btn);
    // 綠底 = 這一格是正解。學生一眼就看到，等於直接告訴他。
    expect(container.querySelectorAll('.bg-green-50').length).toBe(0);
  });
});
