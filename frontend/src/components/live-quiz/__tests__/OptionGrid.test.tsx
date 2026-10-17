import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ASSET_BASE } from '../../../config/assetBase';
import OptionGrid from '../OptionGrid';

const options = [
  { key: 'A', text: '文字選項' },
  { key: 'B', text: '另一個選項' },
  { key: 'C', text: '第三個選項' },
  { key: 'D', text: '', image: '/assets/lesson/L0052/fig13.jpeg' },
];

describe('OptionGrid image options', () => {
  for (const mode of ['host', 'player'] as const) {
    it(`shows resolved image in ${mode} mode`, () => {
      render(<OptionGrid options={[options[3]]} mode={mode} />);
      expect(screen.getByRole('img').getAttribute('src')).toBe(`${ASSET_BASE}/lesson/L0052/fig13.jpeg`);
      expect(screen.getByRole('button', { name: /圖片選項/ })).toBeTruthy();
    });

    it(`keeps text-only shape in ${mode} mode`, () => {
      const { container } = render(<OptionGrid options={[options[0]]} mode={mode} />);
      expect(screen.queryByRole('img')).toBeNull();
      expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    });
  }

  it('shows exactly one image among four options', () => {
    render(<OptionGrid options={options} mode="player" />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
