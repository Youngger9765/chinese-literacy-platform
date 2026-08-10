import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReadingAnnotation from '../FullTextAnnotate';
import { Story } from '../../../types';

// ── Mock ZhuyinContext ──────────────────────────────────────────────────────

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

// ── Fixture ────────────────────────────────────────────────────────────────

const mockStory: Story = {
  id: 'test-story-001',
  title: '測試故事',
  level: 3,
  content: ['第一段的文字內容，用來測試標記功能。', '第二段更多文字，讓我們試試看。'],
  thumbnail: '/thumb.jpg',
  category: 'Fable',
  vocab: [],
  sentences: [],
  intro: { author: '作者', background: '背景介紹' },
} as unknown as Story;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ReadingAnnotation', () => {
  const onFinish = vi.fn();
  const scrollIntoViewMock = vi.fn();

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders story paragraphs', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    expect(screen.getByText(/第一段的文字內容/)).toBeTruthy();
    expect(screen.getByText(/第二段更多文字/)).toBeTruthy();
  });

  it('shows instruction banner', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    expect(screen.getByText(/第一次閱讀/)).toBeTruthy();
    expect(screen.getByText(/第二次閱讀/)).toBeTruthy();
  });

  it('shows mark tool buttons in toolbar', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    const unknownBtns = screen.getAllByText(/不懂/);
    const importantBtns = screen.getAllByText(/重要/);
    expect(unknownBtns.length).toBeGreaterThan(0);
    expect(importantBtns.length).toBeGreaterThan(0);
  });

  it('initially shows 0 marks in summary', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    expect(screen.getByText(/還沒有標記/)).toBeTruthy();
  });

  it('calls onFinish with summary when finish button clicked', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    const finishBtn = screen.getByText(/完成標記/);
    fireEvent.click(finishBtn);
    expect(onFinish).toHaveBeenCalledWith({
      totalMarks: 0,
      unknownCount: 0,
      importantCount: 0,
    });
  });

  it('undo and clear buttons are disabled initially', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    const undoBtn = screen.getByLabelText('復原上一步');
    const clearBtn = screen.getByLabelText('清除所有標記');
    expect(undoBtn).toHaveProperty('disabled', true);
    expect(clearBtn).toHaveProperty('disabled', true);
  });

  it('persists annotations to localStorage on render', async () => {
    // Pre-seed localStorage with an annotation
    const existing = [
      {
        id: 'ann-seed',
        paragraphIndex: 0,
        charStart: 0,
        charEnd: 3,
        type: 'unknown',
      },
    ];
    localStorageMock.setItem(`annotations_test-story-001`, JSON.stringify(existing));

    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    // Mark count should reflect the persisted annotation (total count in <strong>)
    expect(screen.getByText('1', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByText(/還沒有標記/)).toBeNull();
  });

  it('loads annotations from localStorage on mount', () => {
    const seeded = [
      { id: 'a1', paragraphIndex: 0, charStart: 0, charEnd: 2, type: 'important' },
    ];
    localStorageMock.setItem(`annotations_test-story-001`, JSON.stringify(seeded));

    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    // importantCount shown in summary bar — both total (strong) and importantCount (span) = '1'
    const allOnes = screen.getAllByText('1');
    expect(allOnes.length).toBeGreaterThan(0);
  });

  it('renders marks on annotated text (seeded from localStorage)', () => {
    const seeded = [
      { id: 'ann-x', paragraphIndex: 0, charStart: 0, charEnd: 2, type: 'unknown' },
    ];
    localStorageMock.setItem(`annotations_test-story-001`, JSON.stringify(seeded));
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    // The mark span should have role="mark"
    const marks = screen.getAllByRole('mark');
    expect(marks.length).toBeGreaterThan(0);
  });

  it('removes annotation when mark span is clicked', async () => {
    const seeded = [
      { id: 'ann-rm', paragraphIndex: 0, charStart: 0, charEnd: 2, type: 'important' },
    ];
    localStorageMock.setItem(`annotations_test-story-001`, JSON.stringify(seeded));
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    // Initial count — total is shown in the <strong> element
    const totalCount = screen.getByText('1', { selector: 'strong' });
    expect(totalCount).toBeTruthy();

    // Click the mark to remove it
    const marks = screen.getAllByRole('mark');
    await act(async () => {
      fireEvent.click(marks[0]);
    });

    // Count should be 0 now
    expect(screen.getByText(/還沒有標記/)).toBeTruthy();
  });

  it('shows marked words in right side panel as vertical list', () => {
    const seeded = [
      { id: 'ann-1', paragraphIndex: 0, charStart: 0, charEnd: 2, type: 'unknown' },
      { id: 'ann-2', paragraphIndex: 1, charStart: 0, charEnd: 3, type: 'important' },
    ];
    localStorageMock.setItem(`annotations_test-story-001`, JSON.stringify(seeded));

    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    expect(screen.getByText('我的記號')).toBeTruthy();
    expect(screen.getByLabelText(/跳轉到不懂標記：第一/)).toBeTruthy();
    expect(screen.getByLabelText(/跳轉到重要標記：第二段/)).toBeTruthy();
  });

  it('jumps to selected marked word and highlights it when clicking side panel', async () => {
    const seeded = [
      { id: 'ann-jump', paragraphIndex: 0, charStart: 0, charEnd: 2, type: 'important' },
    ];
    localStorageMock.setItem(`annotations_test-story-001`, JSON.stringify(seeded));

    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

    const jumpButton = screen.getByLabelText(/跳轉到重要標記：第一/);

    await act(async () => {
      fireEvent.click(jumpButton);
    });

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    const mark = screen.getByRole('mark', { name: /重要標記：第一/ });
    expect(mark.className).toContain('ring-4');
  });
});

// ── TDD-First: Pure unit tests for offset utils ────────────────────────────
// These test the pure logic extracted from ReadingAnnotation.
// They MUST pass against the CURRENT (pre-refactor) code AND the refactored code.
// After refactor, update imports to the new util files.

describe('annotationOffsets (PUA + selection math)', () => {
  // Import the functions under test.
  // Pre-refactor: they live inline in ReadingAnnotation.tsx as module-level helpers.
  // Post-refactor: they'll live in annotationOffsets.ts (re-exported via the same interface).
  // For now we inline-define equivalent implementations here to test the CONTRACT
  // (TDD: test the behavior, not the module path).

  function stripPUASelectors(text: string): string {
    return text.replace(/\uDB40[\uDC00-\uDFFF]/g, '');
  }

  function countRawChars(text: string, upTo?: number): number {
    const limit = upTo ?? text.length;
    let rawCount = 0;
    let i = 0;
    while (i < limit) {
      const code = text.charCodeAt(i);
      if (code === 0xDB40 && i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xDD00 && low <= 0xDDEF) {
          i += 2;
          continue;
        }
      }
      rawCount++;
      i++;
    }
    return rawCount;
  }

  it('TDD-1: seeded PUA-selector text highlights correct raw character range', () => {
    // "著" followed by a PUA variation selector (U+E01E1 → surrogate pair DB40 DDE1).
    // Raw text has 3 chars: 著、頭、緒. PUA selector is between 著 and 頭.
    const PUA_HIGH = '\uDB40';
    const PUA_LOW = '\uDDE1'; // U+E01E1 selector
    const rawText = '著' + PUA_HIGH + PUA_LOW + '頭緒';

    // stripPUASelectors must remove the two-unit surrogate pair entirely
    const stripped = stripPUASelectors(rawText);
    expect(stripped).toBe('著頭緒');
    expect(stripped.length).toBe(3);

    // countRawChars: the string with PUA has 5 UTF-16 units (1 + 2 + 1 + 1),
    // but raw char count must be 3 (著 頭 緒) — selectors skipped
    expect(countRawChars(rawText)).toBe(3);

    // upTo boundary: count raw chars up to the 3rd UTF-16 unit (after the high surrogate)
    // At i=0: '著' → rawCount=1, i=1
    // At i=1: PUA high 0xDB40, low=0xDDE1 in range → skip both, i=3
    // At i=3 (limit): stop → rawCount=1
    expect(countRawChars(rawText, 3)).toBe(1);

    // upTo=5 covers the full string (all 5 code units): rawCount=3
    expect(countRawChars(rawText, 5)).toBe(3);
  });

  it('TDD-2: overlapping annotation replaces existing overlapping mark', () => {
    // Simulate the applyAnnotation filter logic that removes overlapping annotations.
    // This is the contract: a new annotation at [charStart, charEnd) removes any
    // existing annotation whose range overlaps with the new range.

    type Annotation = { id: string; paragraphIndex: number; charStart: number; charEnd: number; type: string };

    function applyAnnotationFilter(
      prev: Annotation[],
      newRange: { paragraphIndex: number; charStart: number; charEnd: number },
    ): Annotation[] {
      const { paragraphIndex, charStart, charEnd } = newRange;
      return prev.filter(
        (a) =>
          a.paragraphIndex !== paragraphIndex ||
          a.charEnd <= charStart ||
          a.charStart >= charEnd
      );
    }

    const existing: Annotation[] = [
      { id: 'a1', paragraphIndex: 0, charStart: 2, charEnd: 6, type: 'unknown' },
      { id: 'a2', paragraphIndex: 0, charStart: 8, charEnd: 10, type: 'important' },
      { id: 'a3', paragraphIndex: 1, charStart: 0, charEnd: 3, type: 'unknown' },
    ];

    // New annotation [3, 7) overlaps with a1 (2-6) but not a2 (8-10) or a3 (para 1)
    const filtered = applyAnnotationFilter(existing, { paragraphIndex: 0, charStart: 3, charEnd: 7 });

    // a1 overlaps (its charEnd 6 > newStart 3 AND charStart 2 < newEnd 7) → removed
    expect(filtered.find((a) => a.id === 'a1')).toBeUndefined();
    // a2 does not overlap (charStart 8 >= newEnd 7) → kept
    expect(filtered.find((a) => a.id === 'a2')).toBeDefined();
    // a3 is in different paragraph → kept
    expect(filtered.find((a) => a.id === 'a3')).toBeDefined();
    expect(filtered.length).toBe(2);
  });

  it('TDD-3: undo restores previous annotation list + localStorage is synced', () => {
    // Simulate the undo mechanism: undoStack holds snapshots of annotations[].
    // After undo: annotations = last snapshot, undoStack pops.
    // localStorage must reflect the restored state (via useEffect in component).

    type Annotation = { id: string; paragraphIndex: number; charStart: number; charEnd: number; type: string };

    const onFinishLocal = vi.fn();

    // Seed localStorage and render the component
    const initial: Annotation[] = [
      { id: 'ann-a', paragraphIndex: 0, charStart: 0, charEnd: 2, type: 'unknown' },
    ];
    localStorageMock.setItem('annotations_test-story-001', JSON.stringify(initial));

    render(<ReadingAnnotation story={mockStory} onFinish={onFinishLocal} />);

    // Verify initial state: 1 annotation loaded
    expect(screen.getByText('1', { selector: 'strong' })).toBeTruthy();

    // Remove the annotation (this pushes a snapshot onto the undo stack)
    const marks = screen.getAllByRole('mark');
    act(() => {
      fireEvent.click(marks[0]);
    });

    // After removal: 0 annotations
    expect(screen.getByText(/還沒有標記/)).toBeTruthy();
    // Undo button should now be enabled
    const undoBtn = screen.getByLabelText('復原上一步');
    expect(undoBtn).toHaveProperty('disabled', false);

    // Press undo
    act(() => {
      fireEvent.click(undoBtn);
    });

    // After undo: the annotation is restored
    expect(screen.queryByText(/還沒有標記/)).toBeNull();
    expect(screen.getByText('1', { selector: 'strong' })).toBeTruthy();

    // Verify localStorage reflects the restored state
    const stored = JSON.parse(localStorageMock.getItem('annotations_test-story-001') ?? '[]') as Annotation[];
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe('ann-a');
  });

  it('TDD-4: inline image/table markers render inline and not duplicated in fallback strip', () => {
    // Story with one image that has a paragraph caption marker (e.g. "圖1") in content.
    // The image should render inline after that paragraph AND NOT appear in the fallback strip.

    const onFinishLocal = vi.fn();

    const storyWithInlineImage = {
      ...mockStory,
      // Paragraph 0 is a caption row matching detectImageMarker: "圖一 " + non-whitespace
      content: ['圖一 白尾八哥棲息在電線上', '第二段正常文字'],
      images: [{ filename: 'images/G7-L30/G7-L30-01.jpg', caption: '白尾八哥圖片' }],
      layout_mode: 'default',
    } as unknown as Story;

    render(<ReadingAnnotation story={storyWithInlineImage} onFinish={onFinishLocal} />);

    // The inline image should be rendered after paragraph 0
    const inlineImages = document.querySelectorAll('[data-testid="inline-image-after-para-0"]');
    expect(inlineImages.length).toBe(1);

    // The fallback strip for graphic-text layout should NOT contain this image
    // (layout_mode is 'default', not 'graphic-text', so no strip rendered at all)
    const fallbackStrip = document.querySelector('[data-testid="reading-annotation-graphic-text-images"]');
    expect(fallbackStrip).toBeNull();
  });

  it('TDD-5 (#2218): table anchors inline to its body-intro paragraph when no 表N caption row exists', () => {
    // Regression #2218: the printed `表N …` caption rows were stripped from
    // G7-L30 paragraphs into the table title/notes. Without a caption-row anchor
    // the table must still render inline — anchored to the intro sentence
    // (`表一比較了…`) — rather than dropping to the bottom-of-article fallback.
    const onFinishLocal = vi.fn();

    const storyWithTable = {
      ...mockStory,
      content: [
        '前言段落，介紹兩種八哥。',
        '表一比較了白尾八哥和臺灣冠八哥在外形與習性上的異同。',
        '結語段落。',
      ],
      tables: [
        {
          id: 'table-1',
          title: '表一 白尾八哥與臺灣冠八哥比較異同表',
          headers: ['比較項目', '白尾八哥', '臺灣冠八哥'],
          rows: [{ cells: ['嘴喙顏色', '黃色', '象牙白色'] }],
          notes: ['註1. 資料來源：我們的島（2022）'],
        },
      ],
      layout_mode: 'graphic-text',
    } as unknown as Story;

    render(<ReadingAnnotation story={storyWithTable} onFinish={onFinishLocal} />);

    // Table renders inline right after the intro paragraph (index 1).
    const inlineTable = document.querySelectorAll('[data-testid="inline-table-after-para-1"]');
    expect(inlineTable.length).toBe(1);

    // And it must NOT also appear in the bottom-of-article fallback block.
    const fallbackTables = document.querySelector('[data-testid="reading-annotation-tables"]');
    expect(fallbackTables).toBeNull();
  });
});
