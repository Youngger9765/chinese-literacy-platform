/**
 * FullTextAnnotate.editorPreMarks.test.tsx — 編者標 (#3026) component wiring.
 *
 * editorPreMarks.test.ts locks the pure computation; this file locks that
 * FullTextAnnotate actually WIRES it in per the issue's BDD scenarios:
 *   - a lesson with vocab data pre-marks it, unmarked lessons stay unmarked
 *   - a student's own pre-existing marks survive pre-marks being applied,
 *     and the two are visually distinguishable
 *   - a student can dismiss an individual pre-mark
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReadingAnnotation from '../FullTextAnnotate';
import type { Story } from '../../../types';
import * as annotationApi from '../../../services/learning/annotationApi';

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    isZhuyinAny: false,
    zhuyinActive: false,
    processLinesSelective: (lines: string[]) => lines,
  }),
}));

vi.mock('../../../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    currentParagraphIdx: null,
    isPlaying: false,
    isPaused: false,
    isTtsDegraded: false,
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
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

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: 'premark-story',
    title: '測試課文',
    level: 4,
    grade: 4,
    content: ['珍古德研究震撼彈般的發現，也遇到打量她的人。', '第二段沒有任何語詞。'],
    category: 'story',
    vocabulary: [{ word: '震撼彈', definition: '比喻很大的消息。' }, { word: '打量', definition: '仔細察看。' }],
    images: [],
    ...overrides,
  } as unknown as Story;
}

describe('FullTextAnnotate — 編者標 (#3026)', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('pre-marks every vocabulary term that appears in the article', () => {
    render(<ReadingAnnotation story={makeStory()} onFinish={vi.fn()} />);
    expect(screen.getByRole('mark', { name: /震撼彈/ })).toBeInTheDocument();
    expect(screen.getByRole('mark', { name: /打量/ })).toBeInTheDocument();
  });

  it('renders a lesson with no vocabulary data completely unmarked — no error, no message', () => {
    render(<ReadingAnnotation story={makeStory({ vocabulary: undefined })} onFinish={vi.fn()} />);
    expect(screen.queryAllByRole('mark')).toHaveLength(0);
    // the article text itself still renders fine
    expect(screen.getByText(/珍古德研究震撼彈般的發現/)).toBeInTheDocument();
  });

  it('renders a lesson with an empty vocabulary array unmarked (25/179 lessons per the PRD)', () => {
    render(<ReadingAnnotation story={makeStory({ vocabulary: [] })} onFinish={vi.fn()} />);
    expect(screen.queryAllByRole('mark')).toHaveLength(0);
  });

  it('marks a term at EVERY occurrence, not just the first', () => {
    render(
      <ReadingAnnotation
        story={makeStory({
          content: ['孟嘗君是貴族。', '孟嘗君後來又出現一次。'],
          vocabulary: [{ word: '孟嘗君', definition: '戰國貴族。' }],
        })}
        onFinish={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('mark', { name: /孟嘗君/ })).toHaveLength(2);
  });

  it('gives an editor pre-mark a visually distinct style from a student 重要/不懂 mark', () => {
    render(<ReadingAnnotation story={makeStory()} onFinish={vi.fn()} />);
    const preMark = screen.getByRole('mark', { name: /震撼彈/ });
    // Distinguishable both by class (not the plain yellow 重要 background) and
    // by an aria-label that does not claim to be the student's own 重要/不懂 mark.
    expect(preMark.className).not.toBe('bg-yellow-200');
    expect(preMark.getAttribute('aria-label')).not.toMatch(/^(重要|不懂)標記/);
  });

  it("keeps a student's own pre-existing mark when pre-marks are applied, and the two stay visually distinguishable (BDD: 視覺上可分辨)", () => {
    const story = makeStory();
    // Seed a student annotation on paragraph 1 ("第二段沒有任何語詞。"), a
    // range with zero vocabulary terms nearby, so it cannot collide with any
    // pre-mark.
    localStorage.setItem(
      `annotations_${story.id}`,
      JSON.stringify([{ id: 'student-1', paragraphIndex: 1, charStart: 0, charEnd: 2, type: 'unknown' }]),
    );
    render(<ReadingAnnotation story={story} onFinish={vi.fn()} dbSessionId={null} />);

    const studentMark = screen.getByRole('mark', { name: /不懂標記/ });
    const editorMark = screen.getByRole('mark', { name: /震撼彈/ });
    expect(studentMark).toBeInTheDocument();
    expect(editorMark).toBeInTheDocument();
    expect(studentMark.className).not.toBe(editorMark.className);
  });

  it('lets a student dismiss an individual pre-mark by clicking it, without touching the other pre-mark', () => {
    render(<ReadingAnnotation story={makeStory()} onFinish={vi.fn()} />);
    const target = screen.getByRole('mark', { name: /震撼彈/ });
    fireEvent.click(target);

    expect(screen.queryByRole('mark', { name: /震撼彈/ })).not.toBeInTheDocument();
    // the plain text is still there — dismissing a pre-mark ≠ deleting the word
    expect(screen.getByText(/震撼彈/)).toBeInTheDocument();
    // the other pre-mark is untouched
    expect(screen.getByRole('mark', { name: /打量/ })).toBeInTheDocument();
  });

  it('a student can still add their own annotation panel entry — 我的記號 stays scoped to the student, not inflated by pre-marks', () => {
    render(<ReadingAnnotation story={makeStory()} onFinish={vi.fn()} />);
    // The legend counts (❓ / 💛) reflect ONLY the student's own annotations.
    // With zero student annotations and two editor pre-marks, both counters
    // must still read as empty (no numeral badge rendered) — pre-marks must
    // never be counted as if the student made them.
    expect(screen.queryByText('❓ 不懂')?.parentElement?.textContent).toBe('❓ 不懂');
    expect(screen.queryByText('💛 重要')?.parentElement?.textContent).toBe('💛 重要');
  });

  describe('DB-restore (INIT) interaction — the collision the coordinator flagged', () => {
    // dbHydration dispatches `INIT` (annotationReducer.ts:54) with the
    // student's DB-persisted annotations, REPLACING the whole `annotations`
    // array. If pre-marks lived inside that same array, this INIT would wipe
    // them out the instant a session with real DB annotations loads. They
    // don't (see the editorPreMarks block in FullTextAnnotate.tsx) — this
    // proves it end to end, through the real async load path, not just by
    // reading the source.
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('DB-restored student annotations and pre-marks both render together after hydration — INIT does not touch pre-marks', async () => {
      vi.spyOn(annotationApi, 'loadAnnotations').mockResolvedValue([
        { id: 1, paragraph_index: 1, char_start: 0, char_end: 2, annotation_type: 'unknown', client_id: 'db-student-1' },
      ]);
      const story = makeStory();

      render(<ReadingAnnotation story={story} onFinish={vi.fn()} dbSessionId={42} />);

      // Before hydration resolves, pre-marks are already there (computed from
      // story data, not from any async load).
      expect(screen.getByRole('mark', { name: /震撼彈/ })).toBeInTheDocument();

      // After the DB load's INIT lands, the restored student mark must show
      // up ALONGSIDE the pre-marks — not replacing them.
      await waitFor(() => {
        expect(screen.getByRole('mark', { name: /不懂標記/ })).toBeInTheDocument();
      });
      expect(screen.getByRole('mark', { name: /震撼彈/ })).toBeInTheDocument();
      expect(screen.getByRole('mark', { name: /打量/ })).toBeInTheDocument();
    });

    it('remounting the step (leave and come back) recomputes the same pre-marks from story data — a dismissal does not survive the remount, by design (session-local, not persisted)', async () => {
      vi.spyOn(annotationApi, 'loadAnnotations').mockResolvedValue([]);
      const story = makeStory();

      const { unmount } = render(<ReadingAnnotation story={story} onFinish={vi.fn()} dbSessionId={7} />);
      await waitFor(() => expect(screen.getByRole('mark', { name: /震撼彈/ })).toBeInTheDocument());

      fireEvent.click(screen.getByRole('mark', { name: /震撼彈/ }));
      expect(screen.queryByRole('mark', { name: /震撼彈/ })).not.toBeInTheDocument();

      // Simulate the student leaving the page and coming back — a fresh
      // mount, exactly like navigating away and returning to this step.
      unmount();
      cleanup();
      render(<ReadingAnnotation story={story} onFinish={vi.fn()} dbSessionId={7} />);

      // The dismissal was session-local component state, not saved anywhere
      // (not localStorage, not the DB) — the pre-mark is back, same as any
      // other student opening this lesson for the first time would see.
      await waitFor(() => {
        expect(screen.getByRole('mark', { name: /震撼彈/ })).toBeInTheDocument();
      });
    });
  });
});
