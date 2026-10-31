/**
 * #3780 第三階段：寶貝要畫出來，三階外觀看得出差別（island-v2 design §3.5：
 * 基礎最簡化／中階加代表道具／進階完整造型＋發光）。
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import ReadingBabyAvatar from '../ReadingBabyAvatar';

function parts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-part]')).map((el) => el.getAttribute('data-part')!).sort();
}

describe('ReadingBabyAvatar', () => {
  it('draws an svg with an accessible name that says which stage it is', () => {
    const { getByRole } = render(<ReadingBabyAvatar lessonUid="L0001" stage="intermediate" name="十秒的背後" />);
    expect(getByRole('img', { name: '十秒的背後的閱讀寶貝（中階）' })).toBeInTheDocument();
  });

  it('basic has a body but no held accessory and no glow', () => {
    const { container } = render(<ReadingBabyAvatar lessonUid="L0001" stage="basic" />);
    const p = parts(container);
    expect(p).toContain('body');
    expect(p).not.toContain('held-accessory');
    expect(p).not.toContain('glow');
  });

  it('intermediate adds the held accessory but still no glow', () => {
    const { container } = render(<ReadingBabyAvatar lessonUid="L0001" stage="intermediate" />);
    const p = parts(container);
    expect(p).toContain('held-accessory');
    expect(p).not.toContain('glow');
  });

  it('advanced has the full look: held accessory, story prop and glow', () => {
    const { container } = render(<ReadingBabyAvatar lessonUid="L0001" stage="advanced" />);
    const p = parts(container);
    expect(p).toEqual(expect.arrayContaining(['held-accessory', 'story-prop', 'glow']));
  });

  it('the three stages render three different drawings', () => {
    const html = (['basic', 'intermediate', 'advanced'] as const).map(
      (stage) => render(<ReadingBabyAvatar lessonUid="L0001" stage={stage} />).container.innerHTML,
    );
    expect(new Set(html).size).toBe(3);
  });

  it('not-yet-met babies are a grey silhouette with no face details', () => {
    const { container, getByRole } = render(<ReadingBabyAvatar lessonUid="L0001" stage="not_encountered" />);
    expect(getByRole('img', { name: '還沒遇見的閱讀寶貝' })).toBeInTheDocument();
    expect(parts(container)).toEqual(['silhouette']);
  });

  it('two different lessons do not draw the same picture', () => {
    const a = render(<ReadingBabyAvatar lessonUid="L0001" stage="advanced" />).container.innerHTML;
    const b = render(<ReadingBabyAvatar lessonUid="L0002" stage="advanced" />).container.innerHTML;
    expect(a).not.toBe(b);
  });
});
