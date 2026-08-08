import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import LessonAudioTable, { buildLessonQrValue } from './LessonAudioTable';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('../../../hooks/useTtsPlayback', () => ({
  useTtsPlayback: () => ({
    speakText: vi.fn(),
    stopPlayback: vi.fn(),
    isTtsLoading: false,
    isTtsSpeaking: false,
  }),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test'),
  },
}));

const STORIES_RESPONSE = {
  total: 2,
  grades: [4, 7],
  stories: [
    {
      id: 1,
      lesson_number: 1,
      title: '贏得喝采的輸家',
      grade: 4,
      grade_code: 'G4-1',
      genre: '記敘文',
      category: 'Daily',
      char_count: 100,
      thumbnail_url: '/assets/stories/thumbnails/lesson-1.webp',
      reading_strategy: null,
      intro: { author: '', background: '' },
      has_key_reading: true,
    },
    {
      id: 89,
      lesson_number: 89,
      title: '閱讀策略練習',
      grade: 7,
      grade_code: 'G7-L23',
      genre: '說明文',
      category: 'Science',
      char_count: 120,
      thumbnail_url: '/assets/stories/thumbnails/lesson-89.webp',
      reading_strategy: null,
      intro: { author: '', background: '' },
      has_key_reading: false,
    },
  ],
};

function mockStoriesFetch() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => STORIES_RESPONSE,
  }));
}

describe('LessonAudioTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoriesFetch();
  });

  it('renders one row per lesson from the list response', async () => {
    render(<LessonAudioTable />);

    await waitFor(() => {
      expect(screen.getByText('贏得喝采的輸家')).toBeTruthy();
      expect(screen.getByText('閱讀策略練習')).toBeTruthy();
    });

    expect(screen.getAllByRole('row')).toHaveLength(STORIES_RESPONSE.total + 1);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/stories?page_size=300'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } }),
    );
  });

  it('marks only lessons without key_reading as 無重點段', async () => {
    render(<LessonAudioTable />);

    await waitFor(() => expect(screen.getByText('無重點段（唸全文）')).toBeTruthy());

    const rowWithKeyReading = screen.getByText('贏得喝采的輸家').closest('[role="row"]');
    const rowWithoutKeyReading = screen.getByText('閱讀策略練習').closest('[role="row"]');

    expect(rowWithKeyReading?.textContent).not.toContain('無重點段');
    expect(rowWithoutKeyReading?.textContent).toContain('無重點段（唸全文）');
  });

  it('builds QR values for intro and full-reading lesson routes', () => {
    const origin = 'https://staging.example.test';

    expect(buildLessonQrValue(origin, 1, 'intro')).toBe('https://staging.example.test/learn/1/intro');
    expect(buildLessonQrValue(origin, 1, 'full-reading')).toBe(
      'https://staging.example.test/learn/1/full-reading',
    );
  });
});
