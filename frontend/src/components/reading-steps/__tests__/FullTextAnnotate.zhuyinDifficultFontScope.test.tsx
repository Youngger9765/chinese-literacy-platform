/**
 * Regression lock for #3022: in 'difficult' zhuyin mode, FullTextAnnotate must
 * NOT apply the zhuyin font to interface text (legend pills, hint banners,
 * undo/clear buttons, the "我的記號" side panel) or to passage characters
 * outside the vocabulary -- only the vocab-word runs processLinesSelective()
 * marks with DIFFICULT_SPAN_START/END should render in it.
 *
 * Before the fix, fontForZhuyin(isZhuyinAny) sat on the page's outermost
 * wrapper div, which contains ALL of the above -- so the font (and therefore
 * bopomofo, since BpmfZihiSerif renders it for every character it draws)
 * covered the entire page the moment 'difficult' mode turned it on. The
 * issue's own staging reproduction measured 24/78 leaf nodes carrying the
 * font, 11 of them interface text (❓ 不懂, 💛 重要, 還沒有標記, etc).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReadingAnnotation from '../FullTextAnnotate';
import { Story } from '../../../types';
import { DIFFICULT_SPAN_START, DIFFICULT_SPAN_END } from '../../zhuyin/bopomoConstants';
import { ZHUYIN_FONT_STACK } from '../../../constants/fonts';

// ── Mock ZhuyinContext: simulate 'difficult' mode with a real vocab hit ─────

const wrap = (s: string) => `${DIFFICULT_SPAN_START}${s}${DIFFICULT_SPAN_END}`;

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinEnabled: true,
    zhuyinReady: true,
    zhuyinActive: false, // 'difficult' mode -- NOT 'all'
    isZhuyinAny: true,
    setZhuyinEnabled: vi.fn(),
    toggleZhuyin: vi.fn(),
    processZhuyin: (text: string) => text,
    processLinesSelective: (lines: string[]) =>
      // Only "龍" is in the vocab set -- mirrors what ZhuyinContext's real
      // processLinesSelective('difficult') would produce for this fixture.
      lines.map((line) => line.replace('龍', wrap('龍'))),
  }),
}));

// ── Mock localStorage ──────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const mockStory: Story = {
  id: 'test-story-3022',
  title: '測試故事',
  level: 3,
  content: ['有龍在此，但這句沒有難字。', '第二段完全沒有難字的內容。'],
  thumbnail: '/thumb.jpg',
  category: 'Fable',
  vocab: ['龍'],
  sentences: [],
  intro: { author: '作者', background: '背景介紹' },
} as unknown as Story;

// Interface text called out explicitly in #3022's staging reproduction.
const UI_TEXT_SAMPLES = [
  '如何標記詞語？',
  '第一次閱讀',
  '第二次閱讀',
  '示範',
  '我知道了',
  '不懂',
  '重要',
  '復原',
  '清除全部',
  '還沒有標記',
];

describe('#3022 — difficult mode font scope (FullTextAnnotate)', () => {
  const onFinish = vi.fn();

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('never applies the zhuyin font to any interface text element', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    for (const label of UI_TEXT_SAMPLES) {
      const matches = screen.getAllByText((_, node) => node?.textContent?.includes(label) ?? false);
      expect(matches.length, `expected to find UI text "${label}"`).toBeGreaterThan(0);
    }

    // Walk every leaf text-bearing element on the page and assert none of
    // the interface samples ever carry the zhuyin font, checking the
    // element's own inline style AND every ancestor up to the DOM root
    // (this is a DOM-inheritance check, not a jsdom getComputedStyle guess).
    const allLeaves = Array.from(document.querySelectorAll('body *')).filter(
      (el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0,
    );

    const leafCarriesZhuyinFont = (el: Element): boolean => {
      let cur: Element | null = el;
      while (cur) {
        const style = (cur as HTMLElement).style;
        if (style && style.fontFamily && style.fontFamily.includes('BpmfZihiSerif')) return true;
        cur = cur.parentElement;
      }
      return false;
    };

    const uiLeaks = allLeaves.filter(
      (el) =>
        UI_TEXT_SAMPLES.some((label) => (el.textContent ?? '').includes(label)) &&
        leafCarriesZhuyinFont(el),
    );

    expect(
      uiLeaks.map((el) => el.textContent),
      'interface text must never render in the zhuyin font, in any mode',
    ).toEqual([]);
  });

  it('DOES apply the zhuyin font to the vocab-word run inside the passage', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    const difficultSpan = Array.from(document.querySelectorAll('span')).find(
      (el) => el.textContent === '龍' && el.children.length === 0,
    );
    expect(difficultSpan, 'expected a span wrapping the vocab char 龍').toBeTruthy();
    expect(difficultSpan!.style.fontFamily).toContain('BpmfZihiSerif');
    expect(difficultSpan!.style.fontFamily).toBe(ZHUYIN_FONT_STACK.replace(/'/g, '"'));
  });

  it('does NOT apply the zhuyin font to plain passage text next to the vocab word (regression lock for the literal leak)', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    const plainRun = Array.from(document.querySelectorAll('span')).find(
      (el) => el.textContent === '在此，但這句沒有難字。' && el.children.length === 0,
    );
    expect(plainRun, 'expected the plain-text run adjacent to 龍').toBeTruthy();
    expect(plainRun!.style.fontFamily).not.toContain('BpmfZihiSerif');

    // Second paragraph has zero vocab hits -- it must render as plain text,
    // not wrapped in any zhuyin-font span at all.
    expect(screen.getByText(/第二段完全沒有難字的內容/)).toBeTruthy();
    const secondParaSpans = Array.from(document.querySelectorAll('span')).filter(
      (el) => (el.textContent ?? '').includes('第二段') && el.style.fontFamily.includes('BpmfZihiSerif'),
    );
    expect(secondParaSpans).toEqual([]);
  });
});
