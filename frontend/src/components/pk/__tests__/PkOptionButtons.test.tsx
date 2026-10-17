import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ASSET_BASE } from '../../../config/assetBase';
import PkOptionButtons from '../PkOptionButtons';

const options = [
  { key: 'A', text: '文字選項' },
  { key: 'B', text: '另一個選項' },
  { key: 'C', text: '第三個選項' },
  { key: 'D', text: '', image: '/assets/lesson/L0052/fig13.jpeg' },
];

const props = { selectedKey: null, disabled: false, onSelect: () => {} };

describe('PkOptionButtons image options', () => {
  it('shows an image with a resolved asset URL', () => {
    render(<PkOptionButtons {...props} options={[options[3]]} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe(`${ASSET_BASE}/lesson/L0052/fig13.jpeg`);
    expect(screen.getByRole('button', { name: /圖片選項/ })).toBeTruthy();
  });

  it('keeps the shape glyph for text-only options', () => {
    const { container } = render(<PkOptionButtons {...props} options={[options[0]]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });

  it('shows exactly one image among four options', () => {
    render(<PkOptionButtons {...props} options={options} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
