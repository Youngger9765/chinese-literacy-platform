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

  it('does not pre-fill the slots with the marker\'s answer', () => {
    // Asserted on the INPUT VALUES, not on textContent. The first version of this test
    // searched container.textContent and passed under mutation — an input's value is
    // not text content, so it was looking somewhere the answer could never appear.
    renderBlocks([{ type: 'ordering', items: ITEMS }]);
    const slots = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(slots).toHaveLength(ITEMS.length);
    expect(slots.map((s) => s.value)).toEqual(ITEMS.map(() => ''));
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
