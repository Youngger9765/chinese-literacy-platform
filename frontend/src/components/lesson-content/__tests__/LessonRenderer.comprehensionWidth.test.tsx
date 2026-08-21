/**
 * LessonRenderer.comprehensionWidth.test.tsx — #2832
 *
 * The single-column path (no reference text) already got a `max-w-3xl mx-auto`
 * treatment for "字太小，右邊留一堆空白" (2026-08-19, see comment above line ~437
 * of LessonRenderer.tsx). Its sibling — the `useSplit` two-pane layout, in its
 * DEFAULT collapsed state (`readingOpen` starts `false`) — renders the exact
 * same full-bleed card and was never fixed. Every 閱讀理解 page that has 參考課文
 * (i.e. almost every real lesson) hits this path on first load, which is exactly
 * what Young saw and reported (2026-08-19/21: "右邊留白太多，可以減少寬度 放中間").
 *
 * This test exercises the `useSplit=true` branch specifically (not the
 * already-fixed single-column one) by using a fixture with BOTH a reading block
 * and an exercise block, and asserts the collapsed exercise card is width-capped
 * and centered — the same fix already proven for the single-column sibling.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';

import { loadFixture } from '../../../schema/testHelpers';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null, isAuthenticated: false }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinMode: 'none',
    zhuyinReady: true,
    zhuyinActive: false,
    isZhuyinAny: false,
    isZhuyinAll: false,
    isZhuyinNone: true,
    zhuyinEnabled: false,
    setZhuyinMode: vi.fn(),
    setZhuyinEnabled: vi.fn(),
    toggleZhuyin: vi.fn(),
    processZhuyin: (t: string) => t,
    processLines: () => null,
    processLinesSelective: () => null,
  }),
  ZhuyinProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/', search: '', hash: '', state: null, key: 'k' }),
  useParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LessonRenderer from '../LessonRenderer';

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

describe('LessonRenderer — comprehension card width when reading panel is collapsed (#2832)', () => {
  it('caps the exercise card at max-w-3xl and centers it (useSplit branch, readingOpen defaults false)', () => {
    // G5-L9 has both paragraph (reading) and exercise blocks → useSplit=true.
    const lesson = loadFixture('G5-L9.lesson.yml');
    const { container } = render(<LessonRenderer lesson={lesson} lessonCode={lesson.lessonCode} />);

    // Confirm we're actually exercising the useSplit branch, not the already-fixed
    // single-column one — otherwise this test would pass for the wrong reason.
    const root = container.querySelector('[data-testid="lesson-renderer"]');
    expect(root?.getAttribute('data-layout')).toBe('reading-split');

    const section = container.querySelector('section[aria-label$="作答區"]');
    expect(section, 'answer-area section').toBeTruthy();
    const card = section!.firstElementChild as HTMLElement;
    expect(card, 'card wrapping the exercise blocks').toBeTruthy();
    expect(card.className).toContain('max-w-3xl');
    expect(card.className).toContain('mx-auto');
  });
});
