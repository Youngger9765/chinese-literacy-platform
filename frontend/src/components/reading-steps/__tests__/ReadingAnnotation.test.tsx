import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReadingAnnotation from '../ReadingAnnotation';
import { Story } from '../../../types';

// ── Mock zhuyin (heavy processor not needed in unit tests) ──────────────────

vi.mock('../../zhuyin/polyphonicProcessor', () => ({
  PolyphonicProcessor: {
    instance: {
      loadPolyphonicData: vi.fn().mockResolvedValue(undefined),
      process: vi.fn((text: string) => text),
    },
  },
  buildZhuyinString: vi.fn((text: string) => text),
}));

vi.mock('../../ui/ZhuyinToggle', () => ({
  default: ({ onToggle }: { onToggle: () => void }) => (
    <button onClick={onToggle} data-testid="zhuyin-toggle">注音切換</button>
  ),
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

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
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
    // Both mark types should be in the top toolbar
    const unknownBtns = screen.getAllByText('不懂');
    const importantBtns = screen.getAllByText('重要');
    expect(unknownBtns.length).toBeGreaterThan(0);
    expect(importantBtns.length).toBeGreaterThan(0);
  });

  it('initially shows 0 marks in summary', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    expect(screen.getByText(/已標記/)).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
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

  it('displays 注音切換 toggle when zhuyinActive prop is not set', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} />);
    expect(screen.getByTestId('zhuyin-toggle')).toBeTruthy();
  });

  it('hides 注音切換 toggle when zhuyinActive prop is provided', () => {
    render(<ReadingAnnotation story={mockStory} onFinish={onFinish} zhuyinActive={false} />);
    expect(screen.queryByTestId('zhuyin-toggle')).toBeNull();
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
    expect(screen.getByText('0', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText(/還沒有標記/)).toBeTruthy();
  });
});
