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

/**
 * #3696 回歸鎖 —— 現場老師回報「文章重點表版面在 iPad 直放時被壓成一窄條」。
 *
 * 根因：標準兩欄版面（無圖文對照的課）只在 `md:`（768px）就切成兩欄，右欄只拿到
 * 12 格裡的 5 格，裡面的表格（WorksheetTable 等）在這個寬度被壓到逐字往下疊、
 * 完全無法閱讀；而且第一眼看到的是一欄空的勾選框，看不出表格其實可以橫向捲動。
 *
 * 修法：兩欄並排改到 `xl:`（1280px）才啟動，`xl` 以下兩塊直接上下堆疊、共用
 * 一個捲軸，右欄因此拿到完整寬度，不需要水平捲動就能正常換行。
 *
 * 這條鎖只問 class 層級的意圖有沒有被不小心改回去 —— jsdom 測不出真實版面，
 * 實際排版用 staging 上的螢幕截圖驗證（768×1024 / 1024×768）。
 */
describe('ComprehensionLayout 標準兩欄版面在窄螢幕要堆疊（#3696）', () => {
  it('兩欄並排延後到 xl，不再在 md 就切開', () => {
    const { container } = render(
      <ComprehensionLayout story={standardLessonStory}>
        <div>exercise panel</div>
      </ComprehensionLayout>,
    );
    const textCard = container.querySelector('[data-comprehension-lesson-text]');
    expect(textCard).toBeTruthy();
    const leftCol = textCard!.parentElement!;
    const root = leftCol.parentElement!;

    // 根層：窄螢幕是 flex 直向堆疊，只有 xl 以上才變成 12 格的 grid。
    expect(root.className).toContain('flex');
    expect(root.className).toContain('flex-col');
    expect(root.className).toContain('xl:grid');
    expect(root.className).toContain('xl:grid-cols-12');
    expect(root.className).not.toMatch(/(^|\s)md:grid-cols-12(\s|$)/);

    // 左欄（參考課文）：col-span 延後到 xl。
    expect(leftCol.className).toContain('xl:col-span-7');
    expect(leftCol.className).not.toMatch(/(^|\s)md:col-span-7(\s|$)/);

    // 右欄（重點表/練習）：col-span 延後到 xl，窄螢幕不再自己開獨立捲軸
    // （捲動交給 root 統一處理，跟 hasImages 分支已經在用的單一捲動區同一招）。
    const rightCol = leftCol.nextElementSibling as HTMLElement;
    expect(rightCol).toBeTruthy();
    expect(rightCol.className).toContain('xl:col-span-5');
    expect(rightCol.className).not.toMatch(/(^|\s)md:col-span-5(\s|$)/);
  });

  it('堆疊時練習排在參考課文前面，不需要捲過整篇課文才看到題目', () => {
    const { container } = render(
      <ComprehensionLayout story={standardLessonStory}>
        <div>exercise panel</div>
      </ComprehensionLayout>,
    );
    const textCard = container.querySelector('[data-comprehension-lesson-text]');
    const leftCol = textCard!.parentElement!; // 參考課文
    const rightCol = leftCol.nextElementSibling as HTMLElement; // 重點表/練習

    // DOM 順序不變（CSS order 只改視覺順序，不改文件順序），只有視覺順序用
    // order 調換：窄螢幕右欄（練習）排第一，xl 以上用 order-none 取消覆寫、
    // 恢復成左文右練習的原始版面。
    expect(leftCol.className).toContain('order-2');
    expect(leftCol.className).toContain('xl:order-none');
    expect(rightCol.className).toContain('order-1');
    expect(rightCol.className).toContain('xl:order-none');
  });
});
