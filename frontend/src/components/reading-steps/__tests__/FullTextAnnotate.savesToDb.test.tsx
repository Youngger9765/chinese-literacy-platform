/**
 * #4081 — 做記號一定要進資料庫：
 * 1. 最後一個記號在 800ms 防抖內就離開頁面，也要送出（以前 unmount 時被取消）
 * 2. 讀 DB 失敗時，不能拿畫面上的版本整份覆蓋 DB（讀不到 ≠ DB 是空的）
 */
import { render, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    play: vi.fn(), playOne: vi.fn(),
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

const MARK = { id: 'm1', paragraphIndex: 0, charStart: 0, charEnd: 2, type: 'important' as const };

describe('FullTextAnnotate saves marks to the DB (#4081)', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a save still waiting for its debounce is sent when the page is left', async () => {
    localStorageMock.setItem('annotations_premark-story', JSON.stringify([MARK]));
    vi.spyOn(annotationApi, 'loadAnnotations').mockResolvedValue([]);
    const save = vi.spyOn(annotationApi, 'saveAnnotations').mockResolvedValue(undefined as never);

    const { unmount } = render(<ReadingAnnotation story={makeStory({ vocabulary: [] })} onFinish={vi.fn()} dbSessionId={5} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(save).not.toHaveBeenCalled(); // still inside the 800ms debounce
    unmount();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(5, [expect.objectContaining({ client_id: 'm1', paragraph_index: 0 })]);
  });

  it('a failed DB load never writes the cached copy over the DB', async () => {
    localStorageMock.setItem('annotations_premark-story', JSON.stringify([]));
    vi.spyOn(annotationApi, 'loadAnnotations').mockRejectedValue(new Error('503'));
    const save = vi.spyOn(annotationApi, 'saveAnnotations').mockResolvedValue(undefined as never);

    const { unmount } = render(<ReadingAnnotation story={makeStory({ vocabulary: [] })} onFinish={vi.fn()} dbSessionId={5} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(2000); });
    unmount();
    expect(save).not.toHaveBeenCalled();
  });
});
