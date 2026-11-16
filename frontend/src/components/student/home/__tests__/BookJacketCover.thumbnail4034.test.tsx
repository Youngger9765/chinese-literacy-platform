/**
 * #4034 — the student-home "today's lesson" cover built
 * `/stories/thumbnails/lesson-{storyId}.webp`, a legacy folder that only holds
 * low-integer ids, so every current lesson (20001–20179) 404'd and silently
 * fell back to the text cover. The served thumbnail for lesson 200NN is
 * `/assets/lesson/L00NN/thumbnail.webp` (what /api/stories returns).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../../config/assetBase', () => ({ ASSET_BASE: '/assets' }));

import { BookJacketCover } from '../TodayLessonCard';

describe('BookJacketCover thumbnail path (#4034)', () => {
  it('points lesson 20011 at /assets/lesson/L0011/thumbnail.webp', () => {
    const { container } = render(<BookJacketCover storyId="20011" title="贏得喝采的輸家" />);
    const img = container.querySelector('img');
    expect(img, 'cover <img> should render').not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/assets/lesson/L0011/thumbnail.webp');
  });

  it('pads three-digit lesson numbers (20140 → L0140)', () => {
    const { container } = render(<BookJacketCover storyId="20140" title="x" />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/assets/lesson/L0140/thumbnail.webp');
  });

  it('shows the text cover when there is no story id', () => {
    const { container, getByText } = render(<BookJacketCover storyId={null} title="今日沒有課" />);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('今日沒有課')).toBeTruthy();
  });
});
