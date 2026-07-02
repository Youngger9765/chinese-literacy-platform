import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BlockSequenceRenderer from '../BlockSequenceRenderer';
import type { SpotlightV2, Story } from '../../../types';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));
vi.mock('../../../services/learningApi', () => ({
  validateStrategyAnswer: vi.fn(),
}));

// FigureCard stub exposes the resolved `src` so the test can assert exactly
// which filename the frontend fetches. buildImageSrc mirrors the real URL
// shape (basename under the lesson dir) without hitting the network.
vi.mock('../../reading-steps/GraphicTextImageStrip', () => ({
  FigureCard: ({ src }: { src: string }) => <img data-testid="figure-img" src={src} alt="fig" />,
  buildImageSrc: (filename: string, code: string) =>
    `https://gcs/${code}/${filename.split('/').pop()}`,
}));

// A figure block whose synthetic `asset` (fig1.png) only encodes the LABEL
// (圖一). The real image the frontend must fetch is images[].filename.
const FIGURE_FIXTURE: SpotlightV2 = {
  lesson: 'G7-L28',
  strategy_name: '圖文整合',
  strategy_type: 'graphic_text',
  blocks: [{ type: 'figure', asset: 'fig1.png', bind_paragraph: '圖一' }],
};

const STORY: Story = {
  id: '1234',
  title: '巴斯德的鵝頸瓶',
  content: ['課文段落'],
  level: 7,
  thumbnail: '',
  category: 'Daily',
  filename: '',
  lesson_code: 'G7-L28',
  images: [
    {
      filename: 'images/G7-L28/G7-L28-08.jpg',
      size_bytes: 1,
      image_hash: 'h',
      content_type: 'image/jpeg',
      figure_label: '圖一',
    },
  ],
};

describe('BlockSequenceRenderer figure src contract (#2459)', () => {
  it('builds the figure src from images[].filename, never the synthetic block.asset', () => {
    render(<BlockSequenceRenderer spotlight={FIGURE_FIXTURE} story={STORY} />);
    const img = screen.getByTestId('figure-img') as HTMLImageElement;
    // Frontend fetches the REAL image filename...
    expect(img.getAttribute('src')).toBe('https://gcs/G7-L28/G7-L28-08.jpg');
    expect(img.getAttribute('src')).toContain('G7-L28-08.jpg');
    // ...and NEVER the synthetic figN.png asset (that name 404s in GCS — the
    // content-evidence gate must audit the same filename, not block.asset).
    expect(img.getAttribute('src')).not.toContain('fig1.png');
  });
});
