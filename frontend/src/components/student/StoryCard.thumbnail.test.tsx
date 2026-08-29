/**
 * 沒有封面圖時，不要 render 一個空的 <img>。
 *
 * 二修的 175 課目前一張封面都沒有（`backend/data/lessons/` 底下 0 個圖檔，
 * 所以 `_thumbnail_name()` 全部回 None → `thumbnail_url: null`）。
 * StoryCard 無條件 `<img src={story.thumbnail}>`，於是圖書館的 **175 張卡片
 * 全部是破圖** —— staging 實測：img 175 個、載入成功 0、壞掉 175、src=null。
 *
 * 破圖比沒有圖更糟：它看起來像壞掉，而不是像「這課還沒有封面」。
 *
 * ⚠️ 這條測的是「沒有 URL 時的行為」，不是「封面該不該存在」。
 * 封面要不要補是內容工作，跟這個 render 決定無關 —— 就算之後補了封面，
 * 缺圖的那幾課仍然不該出現破圖。
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StoryCard from './StoryCard';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const baseStory = {
  id: 1,
  title: '測試課文',
  grade: 4,
  genre: '記敘文',
  category: 'Daily',
  char_count: 500,
  reading_strategy: '推論策略',
} as never;

const props = {
  isLoading: false,
  isCompleted: false,
  onClick: () => {},
};

describe('StoryCard 封面圖', () => {
  it('沒有 thumbnail 時不 render 空的 <img>', () => {
    const { container } = render(
      <StoryCard story={{ ...(baseStory as object), thumbnail: undefined } as never} {...props} />,
    );
    const imgs = [...container.querySelectorAll('img')];
    const empty = imgs.filter((i) => !i.getAttribute('src'));
    expect(empty, `render 了 ${empty.length} 個沒有 src 的 <img> —— 那在畫面上是破圖`).toHaveLength(0);
  });

  it('沒有 thumbnail 時仍要有東西佔位，卡片不能塌掉', () => {
    render(
      <StoryCard story={{ ...(baseStory as object), thumbnail: null } as never} {...props} />,
    );
    expect(screen.getByTestId('story-cover-placeholder')).toBeTruthy();
  });

  it('正向對照：有 thumbnail 時照常 render <img>', () => {
    const { container } = render(
      <StoryCard
        story={{ ...(baseStory as object), thumbnail: '/assets/lesson/L0001/cover.webp' } as never}
        {...props}
      />,
    );
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('/assets/lesson/L0001/cover.webp');
  });
});
