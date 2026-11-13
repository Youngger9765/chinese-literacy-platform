/**
 * Regression lock for #3987 UI-6: a resized-viewport QA pass (no real touch
 * emulation) always landed on the mouse wording ("用滑鼠...拖曳") even at
 * phone width, and plenty of real phones/tablets support both a finger and
 * a mouse/trackpad anyway. The onboarding coach and the dismissed-state
 * instruction line both now use one device-neutral sentence and never say
 * 用滑鼠 / 用手指.
 *
 * `IS_TOUCH_DEVICE` is a module-level constant computed once at import time
 * from `window.matchMedia('(pointer: coarse)').matches` — so the second
 * test below forces it to `true` via `vi.resetModules()` + a fresh dynamic
 * import with `matchMedia` mocked, to prove the dismissed-state instruction
 * line no longer branches on it at all (before #3988, that branch produced
 * a *different* string — "橫、直、斜滑過圈出語詞" — on a touch device;
 * jsdom's own default `matchMedia` polyfill always reports `matches: false`,
 * so testing with the default environment alone would pass even against
 * the pre-fix ternary and prove nothing).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VocabWordSearch from '../VocabWordSearch';
import { Story } from '../../../types';

const mockStory: Story = {
  id: 'L01',
  title: '贏得喝采的輸家',
  level: '4',
  content: ['測試課文內容'],
  thumbnail: '',
  category: 'History',
  filename: 'L01.yml',
  vocabulary: [
    { word: '龍爭虎鬥', definition: '形容激烈競爭' },
    { word: '目不轉睛', definition: '非常專心注視' },
  ],
} as unknown as Story;

function mockMatchMediaCoarse(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('pointer: coarse') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe('VocabWordSearch device-neutral wording (#3987 UI-6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('onboarding coach (first visit) never says 用滑鼠, regardless of IS_TOUCH_DEVICE', () => {
    render(<VocabWordSearch story={mockStory} onFinish={vi.fn()} />);
    expect(screen.queryByText(/用滑鼠/)).toBeNull();
    expect(screen.queryByText(/用手指/)).toBeNull();
    expect(screen.getByText(/在方格上拖曳（手指或滑鼠皆可）/)).toBeTruthy();
  });

  it('dismissed-coach instruction line also never says 用滑鼠 (default/mouse-like environment)', () => {
    localStorage.setItem('vocab_wordsearch_onboarded', '1');
    render(<VocabWordSearch story={mockStory} onFinish={vi.fn()} />);
    expect(screen.queryByText(/用滑鼠/)).toBeNull();
    expect(screen.queryByText(/用手指/)).toBeNull();
    expect(screen.getAllByText('橫、直、斜拖曳圈出語詞').length).toBeGreaterThan(0);
  });
});

// `IS_TOUCH_DEVICE` is a module-level constant evaluated once at import time
// from `window.matchMedia('(pointer: coarse)').matches`. jsdom's default
// matchMedia polyfill always reports `matches: false`, so the describe block
// above alone can never exercise (or falsify) the touch branch of the
// pre-#3988 ternary — it would pass against the OLD code too, by accident.
// This isolates a fresh module import with matchMedia forced to report a
// coarse (touch) pointer, so the dismissed-state instruction line is
// actually proven to not vary by device.
describe('VocabWordSearch device-neutral wording on a touch device (#3987 UI-6)', () => {
  const ORIGINAL_MATCH_MEDIA = window.matchMedia;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = ORIGINAL_MATCH_MEDIA;
  });

  it('dismissed-coach instruction line is identical on a coarse-pointer (touch) device', async () => {
    mockMatchMediaCoarse(true);
    const { default: VocabWordSearchTouch } = await import('../VocabWordSearch');
    localStorage.setItem('vocab_wordsearch_onboarded', '1');
    render(<VocabWordSearchTouch story={mockStory} onFinish={vi.fn()} />);
    expect(screen.queryByText(/用滑鼠/)).toBeNull();
    expect(screen.queryByText(/用手指/)).toBeNull();
    expect(screen.getAllByText('橫、直、斜拖曳圈出語詞').length).toBeGreaterThan(0);
  });
});
