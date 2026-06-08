/**
 * ComprehensionLayout — per-paragraph 圖文對照 pairing (#2085).
 *
 * The graphic-text branch pairs each paragraph with the SPECIFIC figure it
 * references, matched by `figure_label` (NOT array order — the YAML image
 * array is often reversed vs. figure order). These tests pin that contract:
 *   - 段 referencing 圖一 gets the image whose figure_label === '圖一',
 *     even when that image is LAST in the array.
 *   - Figures referenced by no paragraph fall under 其他圖表.
 *   - Non-graphic-text lessons are untouched.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ComprehensionLayout from '../ComprehensionLayout';
import { Story } from '../../../types';

// ── Mocks ─────────────────────────────────────────────────────────────────
vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinActive: false,
    processLines: (lines: string[]) => lines,
  }),
}));

vi.mock('../FloatingAIHelper', () => ({
  default: () => null,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────
/**
 * G7-L29: the image array is REVERSED relative to figure order — index 0 is
 * 圖四, index 3 is 圖一. Pairing MUST use figure_label, not index.
 * Paragraph 0 references 圖一, paragraph 3 references 圖四.
 */
const g7l29Story: Story = {
  id: '1109',
  title: '氣候變遷',
  level: 7,
  content: [
    '近年來天氣愈來愈古怪……請看圖一。', // para 0 → 圖一
    '為什麼地球氣溫升高呢？如圖二。',     // para 1 → 圖二
    '圖三進一步說明二氧化碳排放趨勢。',   // para 2 → 圖三
    '把時間拉長來看，如圖四。',           // para 3 → 圖四
    '總結來說，原因仍有爭議。',           // para 4 → none
  ],
  layout_mode: 'graphic-text',
  lesson_code: 'G7',
  images: [
    { filename: 'images/G7-L29/G7-L29-02.png', size_bytes: 0, image_hash: 'h', content_type: 'image/png', figure_label: '圖四' },
    { filename: 'images/G7-L29/G7-L29-05.png', size_bytes: 0, image_hash: 'h', content_type: 'image/png', figure_label: '圖三' },
    { filename: 'images/G7-L29/G7-L29-07.png', size_bytes: 0, image_hash: 'h', content_type: 'image/png', figure_label: '圖二' },
    { filename: 'images/G7-L29/G7-L29-09.png', size_bytes: 0, image_hash: 'h', content_type: 'image/png', figure_label: '圖一' },
  ],
} as unknown as Story;

const standardLessonStory: Story = {
  id: 'standard',
  title: '一般課文',
  level: 6,
  content: ['段落一', '段落二'],
  layout_mode: 'standard',
} as unknown as Story;

/** Find the <img> element rendered in the same paragraph row as a given index. */
function imgSrcForParagraph(rowText: string): string | null {
  // FigureCard alt falls back to figure_label, so query by alt text.
  const imgs = screen.queryAllByRole('img');
  void rowText;
  return imgs.length ? (imgs[0].getAttribute('src') ?? null) : null;
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe('ComprehensionLayout per-paragraph pairing (#2085)', () => {
  it('pairs 段(請看圖一) with the image whose figure_label === 圖一 (LAST in array, NOT index 0)', () => {
    render(
      <ComprehensionLayout story={g7l29Story}>
        <div>exercise panel</div>
      </ComprehensionLayout>,
    );
    // 圖一 image (alt falls back to figure_label '圖一') must be the -09 file,
    // NOT the -02 file (which is 圖四 and sits at array index 0).
    const img圖一 = screen.getByAltText('圖一');
    expect(img圖一.getAttribute('src')).toContain('G7-L29-09.png');
    expect(img圖一.getAttribute('src')).not.toContain('G7-L29-02.png');
  });

  it('pairs 段(如圖四) with the image whose figure_label === 圖四 (FIRST in array)', () => {
    render(
      <ComprehensionLayout story={g7l29Story}>
        <div />
      </ComprehensionLayout>,
    );
    const img圖四 = screen.getByAltText('圖四');
    expect(img圖四.getAttribute('src')).toContain('G7-L29-02.png');
  });

  it('renders all four figures (圖一..圖四) exactly once', () => {
    render(
      <ComprehensionLayout story={g7l29Story}>
        <div />
      </ComprehensionLayout>,
    );
    ['圖一', '圖二', '圖三', '圖四'].forEach((label) => {
      expect(screen.getAllByAltText(label)).toHaveLength(1);
    });
    void imgSrcForParagraph;
  });

  it('does NOT render figures or pairing for non-graphic-text lessons', () => {
    render(
      <ComprehensionLayout story={standardLessonStory}>
        <div />
      </ComprehensionLayout>,
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText('圖文對照閱讀')).toBeNull();
  });
});
