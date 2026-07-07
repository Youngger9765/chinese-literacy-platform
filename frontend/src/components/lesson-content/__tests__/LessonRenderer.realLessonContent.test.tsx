/**
 * LessonRenderer.realLessonContent.test.tsx — the flag-ON path renders REAL backend
 * lesson_content (not the storyToLesson stopgap) and honours needs_review.
 *
 * Fixtures are the ACTUAL snake_case bytes lesson_content_loader.get_lesson_content emits
 * (a GREEN course + a needs_review course), run through the SAME camelizeKeys +
 * LessonSchema path api.ts uses on the wire. Then mounted through LessonRenderer to prove:
 *   1. real lesson_content parses + renders (blocks present, gradable inputs exposed);
 *   2. a gradable exercise (keypoints_table, grader=exact) can be answered + judged;
 *   3. a block-level needs_review course surfaces the 「需老師人工檢核」 status — the
 *      renderer never pretends a flagged block is complete/verifiable (honesty invariant).
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, within, fireEvent } from '@testing-library/react';

import { camelizeKeys } from '../../../schema/camelize';
import { LessonSchema, type Lesson } from '../../../schema/lessonContent';
import greenRaw from '../../../schema/__tests__/fixtures/backend_lesson_green.json';
import reviewRaw from '../../../schema/__tests__/fixtures/backend_lesson_needs_review.json';

// ── context mocks (mirror LessonRenderer.contract.test.tsx / render-smoke) ────
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

/** The exact api.ts transform: snake_case backend dict → typed Lesson (fail-loud here). */
function parseBackend(raw: unknown): Lesson {
  const res = LessonSchema.safeParse(camelizeKeys(raw));
  if (!res.success) {
    throw new Error('backend fixture failed LessonSchema: ' + JSON.stringify(res.error.issues));
  }
  return res.data;
}

describe('LessonRenderer eats REAL backend lesson_content (flag-ON path)', () => {
  it('GREEN course: parses + renders + exposes a gradable input', () => {
    const lesson = parseBackend(greenRaw);
    // sanity: this is the real backend shape (snake_case survived the round-trip via camelize)
    expect(lesson.lessonCode).toBe((greenRaw as { lesson_code: string }).lesson_code);

    const res = render(<LessonRenderer lesson={lesson} lessonCode={lesson.lessonCode} />);
    expect(res.container.querySelector('[data-testid="lesson-renderer"]')).toBeTruthy();
    // A keypoints_table (grader=exact) exposes fillable inputs → gradable.
    const inputs = res.container.querySelectorAll('input[type="text"], input[type="radio"]');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('GREEN course: a keypoints_table answer is judged (verdict text appears)', () => {
    const lesson = parseBackend(greenRaw);
    const kp = lesson.blocks.find(
      (b) => b.type === 'exercise' && b.question.kind === 'keypoints_table',
    );
    expect(kp, 'fixture must contain a keypoints_table exercise').toBeDefined();

    const res = render(<LessonRenderer lesson={lesson} lessonCode={lesson.lessonCode} />);
    // Fill every text input with a nonempty value, then click every 確認 button (the fixture
    // may carry more than one exercise → more than one confirm). At least the keypoints_table
    // block then renders a verdict line, proving grade() ran on real backend data.
    const textInputs = Array.from(
      res.container.querySelectorAll('input[type="text"]'),
    ) as HTMLInputElement[];
    expect(textInputs.length).toBeGreaterThan(0);
    for (const inp of textInputs) fireEvent.change(inp, { target: { value: 'x' } });
    const confirmBtns = within(res.container).getAllByText('確認');
    expect(confirmBtns.length).toBeGreaterThan(0);
    for (const btn of confirmBtns) fireEvent.click(btn);
    // grade() ran → a keypoints verdict line is shown (correct or 再檢查看看).
    const txt = res.container.textContent ?? '';
    expect(txt.includes('全部答對') || txt.includes('再檢查看看')).toBe(true);
  });

  it('needs_review course: surfaces the 「需老師人工檢核」 status (no fake-complete)', () => {
    const lesson = parseBackend(reviewRaw);
    // fixture precondition: a block-level needs_review exercise exists.
    const flagged = lesson.blocks.filter(
      (b) => b.type === 'exercise' && b.needsReview === true,
    );
    expect(flagged.length, 'fixture must have a needs_review exercise').toBeGreaterThan(0);

    const res = render(<LessonRenderer lesson={lesson} lessonCode={lesson.lessonCode} />);
    expect(res.container.textContent).toContain('需老師人工檢核');
    // ...and it must NOT falsely claim the whole lesson is complete.
    expect(res.container.textContent).not.toContain('本課練習完成');
  });
});
