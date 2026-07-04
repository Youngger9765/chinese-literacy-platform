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

// #2463: a figure block referencing a table (referent: 'table') has no image
// and no inline table data. It must render NOTHING inline (tables live in the
// 重點表 step) — never the misleading empty「圖表參考」placeholder.
const TABLE_FIGURE_FIXTURE: SpotlightV2 = {
  lesson: 'G7-L30',
  strategy_name: '圖文整合',
  strategy_type: 'graphic_text',
  blocks: [
    { type: 'guide', text: '練習二：第二段 vs 表一' },
    { type: 'figure', referent: 'table', asset: 'table1.json', bind_paragraph: '練習二：第二段 vs 表一' },
  ],
};

describe('BlockSequenceRenderer referent=table figure guard (#2463)', () => {
  it('renders nothing for a referent=table figure block (no empty 圖表參考 placeholder)', () => {
    render(<BlockSequenceRenderer spotlight={TABLE_FIGURE_FIXTURE} story={STORY} />);
    // The sibling guide still shows the instruction...
    expect(screen.getByText('練習二：第二段 vs 表一')).toBeInTheDocument();
    // ...but the table-figure block produces NO placeholder box and NO image.
    expect(screen.queryByText(/圖表參考/)).not.toBeInTheDocument();
    expect(screen.queryByText(/table1\.json/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('figure-img')).not.toBeInTheDocument();
  });
});
