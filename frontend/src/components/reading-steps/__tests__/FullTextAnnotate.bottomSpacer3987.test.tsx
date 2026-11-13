/**
 * Regression lock for #3987 UI-4: `pb-44` left too little clearance under
 * StepActionBar's fade+button zone on some viewport/content combos — the
 * last line of the article could sit under the floating 完成標記 button.
 * Bumped to `pb-56` for a safer margin.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReadingAnnotation from '../FullTextAnnotate';
import { Story } from '../../../types';

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinEnabled: false,
    zhuyinReady: false,
    zhuyinActive: false,
    isZhuyinAny: false,
    setZhuyinEnabled: vi.fn(),
    toggleZhuyin: vi.fn(),
    processZhuyin: (text: string) => text,
    processLinesSelective: (_lines: string[], _vocabWords: string[]) => null,
  }),
}));

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
  id: 'test-story-bottom-spacer',
  title: '測試故事',
  level: 3,
  content: ['第一段的文字內容。', '第二段更多文字。'],
  thumbnail: '/thumb.jpg',
  category: 'Fable',
  vocab: [],
  sentences: [],
  intro: { author: '作者', background: '背景介紹' },
} as unknown as Story;

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('FullTextAnnotate scroll-container bottom clearance (#3987 UI-4)', () => {
  it('scroll container carries pb-56, not the old pb-44', () => {
    const { container } = render(<ReadingAnnotation story={mockStory} onFinish={vi.fn()} />);
    const scrollArea = container.querySelector('.overflow-y-auto');
    expect(scrollArea).toBeTruthy();
    const classes = scrollArea!.className.split(/\s+/);
    expect(classes).toContain('pb-56');
    expect(classes).not.toContain('pb-44');
  });
});
