/**
 * 同一個詞是多題的答案時，用過不可以把它關掉。
 *
 * 🔴 staging 實測 L0072：第 5 題與第 7 題的正解都是「懷疑」。學生第 5 題用掉它之後，
 * 走到第 7 題時選項狀態是
 *
 *     負擔:OFF 負荷:OFF 負責:OFF 遷移:OFF 質疑:on 懷疑:OFF 遷徙:OFF
 *
 * 正解點不下去，唯一還能點的「質疑」是錯的 —— 那一題無解。
 *
 * 根因是 `usedCodes` 假設「一個詞只會是一題的答案」。9 題配 7 個詞，這個假設必然
 * 不成立。179 課裡有 7 課中招（L0001 / L0046 / L0071 / L0072 / L0066 / L0122 / L0149）。
 *
 * 判準是**這一課的答案有沒有重複**，不是「題數 vs 詞數」—— 題數少於詞數但答案重複
 * 的課一樣會鎖死。
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FillInBlankExercise from '../FillInBlankExercise';
import { FillInBlankItem } from '../../../types';

const bank: Record<string, string> = { A: '甲', B: '乙', C: '丙' };

/** 第一題與第三題共用答案 A —— 一對一的假設在這一課不成立 */
const repeated: FillInBlankItem[] = [
  { sentence: '第一題(　　)。', answer: 'A' },
  { sentence: '第二題(　　)。', answer: 'B' },
  { sentence: '第三題(　　)。', answer: 'A' },
];

/** 每題答案都不同 —— 一對一成立，用過變灰是刻意的教學設計，要保留 */
const distinct: FillInBlankItem[] = [
  { sentence: '第一題(　　)。', answer: 'A' },
  { sentence: '第二題(　　)。', answer: 'B' },
];

function dismissCoach() {
  const got = screen.queryByText('我知道了');
  if (got) fireEvent.click(got);
}

/** 那個詞現在點得下去嗎（不在畫面上 = 點不下去）。 */
function clickable(word: string): boolean {
  const nodes = screen.queryAllByText(word);
  for (const n of nodes) {
    const b = n.closest('button') as HTMLButtonElement | null;
    if (b && !b.disabled) return true;
  }
  return false;
}

async function answer(word: string) {
  fireEvent.click(screen.getAllByText(word)[0].closest('button')!);
  await act(async () => {
    vi.advanceTimersByTime(1500);   // 自動前進是 1200ms（#2933）
  });
}

describe('答案重複的課', () => {
  it('用過的答案不會被關掉 —— 後面那題還點得下去', async () => {
    vi.useFakeTimers();
    render(<FillInBlankExercise sentences={repeated} vocabBank={bank} onComplete={() => {}} />);
    dismissCoach();

    await answer('甲');           // 第一題，用掉 A
    await answer('乙');           // 第二題，前進到第三題

    expect(
      document.body.textContent?.replace(/\s+/g, ''),
      '沒有前進到第三題',
    ).toContain('第三題');
    expect(clickable('甲'), '「甲」還是第三題的正解，不可以被關掉').toBe(true);
    vi.useRealTimers();
  });
});

describe('負向對照：答案不重複的課，維持原本的行為', () => {
  it('用過的答案仍然關掉', async () => {
    vi.useFakeTimers();
    render(<FillInBlankExercise sentences={distinct} vocabBank={bank} onComplete={() => {}} />);
    dismissCoach();

    await answer('甲');           // 第一題，用掉 A

    expect(
      document.body.textContent?.replace(/\s+/g, ''),
      '沒有前進到第二題',
    ).toContain('第二題');
    expect(clickable('甲'), '一對一成立時，用過關掉是刻意的設計，不可以放寬').toBe(false);
    vi.useRealTimers();
  });
});
