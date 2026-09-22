/**
 * 聚光燈裡那段文章的出處行要畫出來（#3277 · L0096）。
 *
 * `passage` block 原本只畫 `paragraphs`，所以原稿印在文章末尾的
 * 〈節選自國語日報網路新聞…〉抽出來了、學生看不到。
 *
 * ⚠️ 這一條**必須 render 真的 `BlockSequenceRenderer`**。第一版我在測試裡
 *    自己複製了一份 `{paragraphs.map(...)}{source_line && ...}`，那樣把渲染端
 *    整個刪掉測試照樣綠 —— 鎖住的是測試自己，不是產品。
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BlockSequenceRenderer from '../BlockSequenceRenderer';
import type { SpotlightV2 } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ token: 'test-token' }) }));
vi.mock('../../../services/learningApi', () => ({ validateStrategyAnswer: vi.fn() }));
vi.mock('../../reading-steps/GraphicTextImageStrip', () => ({
  FigureCard: ({ alt }: { alt: string }) => <div>{alt}</div>,
  buildImageSrc: (f: string) => f,
}));

const withSource: SpotlightV2 = {
  lesson: 'G4-L?',
  strategy_name: '4F 反思法',
  strategy_type: 'reflection_4f',
  blocks: [
    {
      type: 'passage',
      paragraphs: ['世界展望會發布的「缺糧」報告指出，許多家庭每天只能吃一頓飯。'],
      source_line: '<節選自國語日報網路新聞>',
    },
  ],
};

describe('#3277 聚光燈文章的出處行', () => {
  it('真的渲染器把出處行畫在那段文章底下', () => {
    render(<BlockSequenceRenderer spotlight={withSource} />);
    expect(screen.getByText(/缺糧/)).toBeInTheDocument();
    expect(screen.getByTestId('spotlight-passage-source-line').textContent)
      .toBe('<節選自國語日報網路新聞>');
  });

  it('沒有出處行的文章不會多出那個節點', () => {
    const plain: SpotlightV2 = {
      ...withSource,
      blocks: [{ type: 'passage', paragraphs: ['烏鴉又渴又累。'] }],
    };
    render(<BlockSequenceRenderer spotlight={plain} />);
    expect(screen.getByText(/烏鴉又渴又累/)).toBeInTheDocument();
    expect(screen.queryByTestId('spotlight-passage-source-line')).toBeNull();
  });
});
