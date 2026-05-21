/**
 * ComprehensionLayout — inline image/table placement (#1692).
 *
 * Verifies that lessons with 圖 N / 表 N caption paragraphs render the
 * matching asset inline immediately after the caption, and that
 * un-referenced assets still fall back to the bottom strip/table block.
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
const g7l30Story: Story = {
  id: '1110',
  title: '臺灣兩種八哥',
  level: 7,
  content: [
    '段落零文字內容',
    '圖一 白尾八哥（左）與 臺灣冠八哥（右）外形圖',
    '表一比較了白尾八哥和臺灣冠八哥', // body — not a caption
    '表一 白尾八哥與臺灣冠八哥比較異同表',
    '表二則說明了兩種八哥近年族群數量的變化', // body — not a caption
    '表二 近年兩種臺灣常見八哥之族群數量之變化',
    '結尾段落',
  ],
  layout_mode: 'graphic-text',
  lesson_code: 'G7-L30',
  images: [
    { filename: 'images/G7-L30/G7-L30-06.png', size_bytes: 0, image_hash: 'h', content_type: 'image/png' },
  ],
  tables: [
    {
      id: 'table-1',
      title: '表一 白尾八哥與臺灣冠八哥比較異同表',
      headers: ['項目', '白尾八哥'],
      rows: [{ cells: ['體型', '小'] }],
    },
    {
      id: 'table-2',
      title: '表二 近年兩種臺灣常見八哥之族群數量之變化',
      headers: ['年份', '數量'],
      rows: [{ cells: ['2020', '100'] }],
    },
  ],
} as unknown as Story;

const g7l29NoCaptionsStory: Story = {
  id: '1109',
  title: '氣候變遷',
  level: 7,
  content: [
    '一般段落',
    '另一段',
    '圖三進一步說明了一百多年來', // body, NOT a caption (no space after 圖三)
    '結尾',
  ],
  layout_mode: 'graphic-text',
  lesson_code: 'G7-L29',
  images: [
    { filename: 'images/G7-L29/G7-L29-02.png', size_bytes: 0, image_hash: 'h', content_type: 'image/png' },
    { filename: 'images/G7-L29/G7-L29-05.png', size_bytes: 0, image_hash: 'h', content_type: 'image/png' },
  ],
} as unknown as Story;

const standardLessonStory: Story = {
  id: 'standard',
  title: '一般課文',
  level: 6,
  content: ['段落一', '段落二'],
  layout_mode: 'standard',
} as unknown as Story;

// ── Tests ─────────────────────────────────────────────────────────────────
describe('ComprehensionLayout inline image/table (#1692)', () => {
  it('renders 圖一 inline right after paragraph[1] for G7-L30', () => {
    render(
      <ComprehensionLayout story={g7l30Story}>
        <div>exercise panel</div>
      </ComprehensionLayout>,
    );
    expect(screen.getByTestId('comprehension-inline-image-after-para-1')).toBeTruthy();
  });

  it('renders 表一 inline after paragraph[3] (the caption, not body sentence at [2])', () => {
    render(
      <ComprehensionLayout story={g7l30Story}>
        <div />
      </ComprehensionLayout>,
    );
    expect(screen.queryByTestId('comprehension-inline-table-after-para-2')).toBeNull(); // body
    expect(screen.getByTestId('comprehension-inline-table-after-para-3')).toBeTruthy(); // caption
  });

  it('renders 表二 inline after paragraph[5] only', () => {
    render(
      <ComprehensionLayout story={g7l30Story}>
        <div />
      </ComprehensionLayout>,
    );
    expect(screen.queryByTestId('comprehension-inline-table-after-para-4')).toBeNull(); // body
    expect(screen.getByTestId('comprehension-inline-table-after-para-5')).toBeTruthy(); // caption
  });

  it('falls back to bottom image strip when paragraphs have no caption rows (G7-L29 case)', () => {
    render(
      <ComprehensionLayout story={g7l29NoCaptionsStory}>
        <div />
      </ComprehensionLayout>,
    );
    // No inline image cards.
    for (let i = 0; i < g7l29NoCaptionsStory.content.length; i += 1) {
      expect(screen.queryByTestId(`comprehension-inline-image-after-para-${i}`)).toBeNull();
    }
    // Fallback strip rendered.
    expect(screen.getByTestId('graphic-text-image-pane')).toBeTruthy();
  });

  it('does NOT render image strip or any inline asset for non-graphic-text lessons', () => {
    render(
      <ComprehensionLayout story={standardLessonStory}>
        <div />
      </ComprehensionLayout>,
    );
    expect(screen.queryByTestId('graphic-text-image-pane')).toBeNull();
    expect(screen.queryByTestId('lesson-tables')).toBeNull();
    expect(screen.queryByTestId('comprehension-inline-image-after-para-0')).toBeNull();
  });

  it('once an asset renders inline it is removed from the fallback block', () => {
    render(
      <ComprehensionLayout story={g7l30Story}>
        <div />
      </ComprehensionLayout>,
    );
    // G7-L30 has 1 image and 2 tables — all 3 captioned in paragraphs, so the
    // fallback strip + bottom tables block must both be absent.
    expect(screen.queryByTestId('graphic-text-image-pane')).toBeNull();
    expect(screen.queryByTestId('lesson-tables')).toBeNull();
  });
});
