/**
 * An `ordering` block renders its sentences (#2683).
 *
 * Young opened 《十秒的背後》 閱讀聚光燈 and saw "3.〈𪹚龍慶元宵〉　彭仁星" with nothing
 * under it. The four sentences to put in time order live in a 2-column table in the
 * DOCX; the extractor turned that table into a figure with no asset, and the loader
 * drops assetless table-figures — so the prompt arrived alone.
 *
 * The extractor now emits `{type: 'ordering', items: [{text, correct_order}]}`.
 * This asserts the renderer shows the sentences and does NOT show the answer numbers,
 * since `correct_order` is the marker's answer key.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// The renderer reads a token from AuthContext; the block rendering under test does not
// depend on it, so the context is stubbed rather than the test being given a session.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BlockSequenceRenderer from '../BlockSequenceRenderer';

const ITEMS = [
  { text: '元宵節過後，「化龍返天」是活動的尾聲。', correct_order: 4 },
  { text: '今年元宵節前，我回到苗栗的阿公家。', correct_order: 1 },
  { text: '元宵夜，我們到公園參加「𪹚龍之夜」。', correct_order: 3 },
  { text: '元宵節前一天，街上家家戶戶歡喜的「迎龍」。', correct_order: 2 },
];

function renderBlocks(blocks: unknown[]) {
  return render(
    <BlockSequenceRenderer
      spotlight={{ lesson: 'L0001', strategy_name: '順敘', strategy_type: 'sequence',
                   blocks } as never}
      onComplete={() => {}}
    />
  );
}

describe('ordering block', () => {
  it('shows every sentence', () => {
    renderBlocks([{ type: 'ordering', items: ITEMS }]);
    for (const it of ITEMS) {
      expect(screen.getByText(new RegExp(it.text.slice(0, 8)))).toBeTruthy();
    }
  });

  it('does not hand the student the answer to begin with', () => {
    // 原本這條斷言「每個輸入框的 value 是空的」——2026-08-19 排序題改成拖拉之後
    // 就沒有輸入框可以預填了，那個寫法找不到東西可測。
    //
    // 它守的保證沒有變（教師版帶著答案來，不可以直接給學生），只是換了形狀：
    // 現在要驗的是**初始排列不等於正確答案**。洗牌會避開它，所以這是決定性的。
    //
    // 跑 20 次而不是 1 次：洗牌是隨機的，單跑一次的綠可能只是運氣。
    for (let i = 0; i < 20; i += 1) {
      const { container, unmount } = renderBlocks([{ type: 'ordering', items: ITEMS }]);
      const shown = Array.from(container.querySelectorAll('li p')).map((el) => el.textContent);
      const answerOrder = [...ITEMS]
        .sort((a, b) => a.correct_order - b.correct_order)
        .map((it) => it.text);
      expect(shown).not.toEqual(answerOrder);
      unmount();
    }
  });

  it('renders a prompt that precedes it, so the pair is not orphaned', () => {
    renderBlocks([
      { type: 'free_text', prompt: '3.〈𪹚龍慶元宵〉　彭仁星' },
      { type: 'ordering', items: ITEMS },
    ]);
    expect(screen.getByText(/𪹚龍慶元宵/)).toBeTruthy();
    expect(screen.getByText(/化龍返天/)).toBeTruthy();
  });
});

/**
 * 排序題要用拖拉，不是叫學生打數字（2026-08-19 Young）。
 *
 * > 這種題目，明明可以用拖拉排序，送出答案確認啊！
 * > 我覺得用戶不會填寫，所以才要用拖拉
 *
 * 原本每句前面是一個 `<input type="text">`，學生要自己判斷順序再打 1~4 進去。
 * 小學生不會這樣做 —— 他會空著，或亂填。整題等於沒作用。
 *
 * `OrderingExercise.tsx` 早就有一套拖拉實作（洗牌 → 拖曳 → 送出 → 判分），
 * 只是聚光燈這條路沒有用它。
 */
describe('ordering block：拖拉排序，不打字', () => {
  it('沒有任何要學生打字的輸入框', () => {
    const { container } = renderBlocks([{ type: 'ordering', items: ITEMS }]);
    const inputs = container.querySelectorAll('input[type="text"]');
    expect(inputs.length).toBe(0);
  });

  it('每一句都可以拖曳', () => {
    const { container } = renderBlocks([{ type: 'ordering', items: ITEMS }]);
    const draggables = container.querySelectorAll('[draggable="true"]');
    expect(draggables.length).toBe(ITEMS.length);
  });

  it('有送出按鈕（拖完要能確認）', () => {
    renderBlocks([{ type: 'ordering', items: ITEMS }]);
    expect(screen.getByRole('button', { name: /送出|確認|檢查/ })).toBeTruthy();
  });

  it('送出前不會透露對錯（負向對照）', () => {
    renderBlocks([{ type: 'ordering', items: ITEMS }]);
    expect(screen.queryByText(/答對|答錯|正確答案|再試/)).toBeNull();
  });
});
