import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PkFigurePortrait from '../PkFigurePortrait';

describe('PkFigurePortrait', () => {
  it('resolves the PNG override for Li Bai (tier 7)', () => {
    const { getByAltText } = render(<PkFigurePortrait tier={7} expression="victory" name="李白" />);
    const img = getByAltText('李白') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/story-assets/pk-li-bai/portrait-victory.png');
  });

  it('resolves the PNG override for Du Fu (tier 5) — #3745 extended the PNG set to all 7 figures', () => {
    const { getByAltText } = render(<PkFigurePortrait tier={5} expression="thinking" name="杜甫" />);
    const img = getByAltText('杜甫') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/story-assets/pk-du-fu/portrait-thinking.png');
  });
});
