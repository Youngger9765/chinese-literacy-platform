/**
 * LessonRenderer.contract.test.tsx — render-contract for the Phase-2 unified renderer.
 *
 * Sibling of the schema parity gate: parses the SAME 4 shared fixtures and asserts the
 * renderer honors the contract at the DOM level:
 *   1. every fixture mounts without a TDZ/ReferenceError (mountGuard, #2289 net);
 *   2. every exercise block exposes an interactive input matching its kind (choice→radio,
 *      multi_choice→checkbox, ordering→draggable item, keypoints/fill→textbox/radio,
 *      custom→textarea + 「需人工檢核」). This is the DOM half of "每題有可作答輸入 +
 *      答案可判分" — the grading half is proven in lessonGrading.test.ts;
 *   3. resolveLayout: G7-L30 → 'paired', G5/G6/wen → 'single-column-flow' (pure fn);
 *   4. TableBlockView renders both the fast-path (G7 rowSections) and a raw merged grid.
 *
 * Context hooks (useZhuyin/useAuth/react-router) are mocked; jsdom polyfills mirror the
 * render-smoke setup.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, within, fireEvent } from '@testing-library/react';

import { loadFixture } from '../../../schema/testHelpers';
import { LessonSchema, type Lesson, type Block } from '../../../schema/lessonContent';
import { resolveLayout } from '../lessonLayout';

// ── context mocks (mirror render-smoke) ──────────────────────────────────────
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

// Imported AFTER mocks so the mocked contexts are picked up.
import LessonRenderer, { PAGINATED_QUESTION_KINDS } from '../LessonRenderer';
import TableBlockView from '../blocks/TableBlockView';

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

const FIXTURES = ['G5-L9.lesson.yml', 'G6-L22.lesson.yml', 'G7-L30.lesson.yml', 'wen-L2.lesson.yml'];

/** Mount; fail ONLY on a TDZ-style ReferenceError (other errors swallowed, per #2289). */
function mountGuard(name: string, el: React.ReactElement) {
  let threw: unknown = null;
  let result: ReturnType<typeof render> | null = null;
  try {
    result = render(el);
  } catch (e) {
    threw = e;
  }
  if (threw instanceof ReferenceError) {
    throw new Error(`TDZ / ReferenceError on mount of ${name}: ${threw.message}`);
  }
  return result;
}

describe('LessonRenderer render-contract (4 shared fixtures)', () => {
  for (const file of FIXTURES) {
    it(`mounts ${file} without TDZ`, () => {
      const lesson = loadFixture(file);
      const res = mountGuard(file, <LessonRenderer lesson={lesson} lessonCode={lesson.lessonCode} />);
      expect(res).not.toBeNull();
      // The renderer root is present with its resolved layout hint.
      expect(res!.container.querySelector('[data-testid="lesson-renderer"]')).toBeTruthy();
    });
  }
});

describe('every exercise exposes an interactive answerable input', () => {
  function assertExerciseInputs(lesson: Lesson) {
    const res = render(<LessonRenderer lesson={lesson} lessonCode={lesson.lessonCode} />);
    const { container } = res;

    // `LessonRenderer` shows only ONE `PAGINATED_QUESTION_KINDS` block at a time (一題一題出,
    // #2763/#20011). A global `container.querySelectorAll(...)` count is blind to WHICH
    // block is currently on screen — with only one paginated kind (multiple_choice) it
    // happened to stay green because some other multiple_choice block was always the one
    // left visible; adding fill_in_blank to the paginated set exposed that this assertion
    // was never actually checking the block it named (`ex-mcq-2 choice/trait radios:
    // expected 0 to be greater than 0` — it had been silently reading a SIBLING block's
    // radios). Fix: click 下一題 the right number of times so the block under test is the
    // one actually on screen before asserting.
    const paginatedBlocks = (lesson.blocks as Block[]).filter(
      (b) => b.type === 'exercise' && PAGINATED_QUESTION_KINDS.has(b.question.kind),
    );
    let pageIdx = 0;
    const gotoPaginatedBlock = (target: number) => {
      while (pageIdx < target) {
        fireEvent.click(within(container).getByRole('button', { name: /下一題/ }));
        pageIdx += 1;
      }
    };

    for (const b of lesson.blocks as Block[]) {
      if (b.type !== 'exercise') continue;
      const q = b.question;
      if (paginatedBlocks.length > 1) {
        const target = paginatedBlocks.indexOf(b);
        if (target !== -1) gotoPaginatedBlock(target);
      }
      if (q.kind === 'custom') {
        expect(container.querySelector('textarea'), `${b.id} custom textarea`).toBeTruthy();
        expect(container.textContent).toContain('需人工檢核');
      } else if (q.kind === 'multiple_choice' && b.answerSpace === 'multi_choice') {
        expect(
          container.querySelectorAll('input[type="checkbox"]').length,
          `${b.id} multi_choice checkboxes`,
        ).toBeGreaterThan(0);
      } else if (q.kind === 'multiple_choice' || q.kind === 'trait_inference') {
        expect(
          container.querySelectorAll('[role="radio"]').length,
          `${b.id} choice/trait radios`,
        ).toBeGreaterThan(0);
      } else if (q.kind === 'ordering') {
        expect(
          container.querySelectorAll('[data-testid="ordering-item"]').length,
          `${b.id} ordering items`,
        ).toBeGreaterThan(0);
      } else if (q.kind === 'keypoints_table') {
        const inputs = container.querySelectorAll('input[type="text"], input[type="radio"]');
        expect(inputs.length, `${b.id} keypoints inputs`).toBeGreaterThan(0);
      } else if (q.kind === 'fill_in_blank') {
        const inputs = container.querySelectorAll('input[type="text"], [role="radio"]');
        expect(inputs.length, `${b.id} fill_in_blank inputs`).toBeGreaterThan(0);
      } else if (q.kind === 'guided_steps' || q.kind === 'graphic_text_integration') {
        // guided steps expose radios / checkboxes / textareas per step
        const inputs = container.querySelectorAll(
          '[role="radio"], input[type="checkbox"], textarea',
        );
        expect(inputs.length, `${b.id} guided step inputs`).toBeGreaterThan(0);
      }
    }
    res.unmount();
  }

  for (const file of FIXTURES) {
    it(`${file} — each exercise is answerable`, () => {
      assertExerciseInputs(loadFixture(file));
    });
  }
});

describe('resolveLayout hint (pure fn — no mount)', () => {
  it('G7-L30 (圖文表整合) → paired', () => {
    expect(resolveLayout(loadFixture('G7-L30.lesson.yml'))).toBe('paired');
  });
  it('G5 / G6 / wen → single-column-flow', () => {
    expect(resolveLayout(loadFixture('G5-L9.lesson.yml'))).toBe('single-column-flow');
    expect(resolveLayout(loadFixture('G6-L22.lesson.yml'))).toBe('single-column-flow');
    expect(resolveLayout(loadFixture('wen-L2.lesson.yml'))).toBe('single-column-flow');
  });
});

/** Narrow a parsed lesson's block to the table member (runtime-checked). */
function tableBlock(lesson: Lesson, id: string): Block & { type: 'table' } {
  const b = lesson.blocks.find((x) => x.id === id);
  if (!b || b.type !== 'table') throw new Error(`table block ${id} not found`);
  return b as Block & { type: 'table' };
}

describe('TableBlockView renders both table shapes', () => {
  it('fast path: G7 table-1 (rowSections + sectionLabelCol)', () => {
    const tbl = tableBlock(loadFixture('G7-L30.lesson.yml'), 'table-1');
    const res = mountGuard('table-1 fast', <TableBlockView block={tbl} />);
    expect(res).not.toBeNull();
    // Fast path renders a real <table> (via TableCard/TableBody).
    expect(within(res!.container).getAllByRole('table').length).toBeGreaterThan(0);
  });

  it('raw grid path: a horizontal-band merged grid renders a <table>', () => {
    // Parse through the frozen contract so this is a REAL Block, not a hand-shaped literal.
    const lesson = LessonSchema.parse({
      id: 'grid-case',
      lessonCode: 'T-1',
      blocks: [
        { id: 'p1', type: 'paragraph', text: 'x' },
        {
          id: 'grid-tbl',
          type: 'table',
          title: '合併表',
          headers: ['比較項目', '白尾八哥', '臺灣冠八哥'],
          grid: [
            [{ text: '相同處', colspan: 3, isSectionLabel: true }],
            [{ text: '外形' }, { text: '全身大致為黑色', colspan: 2 }],
          ],
        },
      ],
    });
    const res = mountGuard('raw grid', <TableBlockView block={tableBlock(lesson, 'grid-tbl')} />);
    expect(res).not.toBeNull();
    expect(within(res!.container).getAllByRole('table').length).toBeGreaterThan(0);
  });
});
