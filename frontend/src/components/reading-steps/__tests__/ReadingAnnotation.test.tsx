import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReadingAnnotation from '../ReadingAnnotation';
import { Story } from '../../../types';

// ── Mock ZhuyinContext ──────────────────────────────────────────────────────

vi.mock('../../../context/ZhuyinContext', () => ({
  useZhuyin: () => ({
    zhuyinEnabled: true,
    zhuyinReady: true,
    zhuyinActive: true,
    setZhuyinEnabled: vi.fn(),
    toggleZhuyin: vi.fn(),
    processZhuyin: (text: string) => text,
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

  it('positions floating toolbar correctly after scrolling', async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);

      const paragraph = container.querySelector('[data-para-idx="0"]') as HTMLElement;
      expect(paragraph).toBeTruthy();
      const textNode = paragraph.firstChild as Text;
      expect(textNode).toBeTruthy();

      const scrollContainer = paragraph.closest('.max-w-3xl')?.parentElement as HTMLDivElement;
      expect(scrollContainer).toBeTruthy();

      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        value: 240,
      });
      Object.defineProperty(scrollContainer, 'scrollLeft', {
        configurable: true,
        value: 12,
      });

      vi.spyOn(scrollContainer, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(100, 80, 700, 500)
      );

      const selectionRect = new DOMRect(220, 300, 40, 20);
      const mockRange = {
        collapsed: false,
        startContainer: textNode,
        endContainer: textNode,
        startOffset: 2,
        toString: () => '一段',
        getBoundingClientRect: () => selectionRect,
      } as unknown as Range;

      const mockSelection = {
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => mockRange,
      } as unknown as Selection;

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection);

      await act(async () => {
        fireEvent.mouseUp(scrollContainer);
        vi.advanceTimersByTime(60);
      });

      const toolbar = screen.getByRole('toolbar', { name: '標記選取文字' }) as HTMLDivElement;
      expect(toolbar.style.left).toBe('152px');
      expect(toolbar.style.top).toBe('452px');
    } finally {
      vi.useRealTimers();
    }
  });
});
