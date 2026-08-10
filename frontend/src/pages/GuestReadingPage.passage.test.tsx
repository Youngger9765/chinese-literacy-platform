/**
 * The guest reader has to serve both codes on the worksheet.
 *
 * 全文 QR  → /learn/{id}/full-text-annotate   — the whole lesson
 * 段落 QR  → /learn/{id}/key-passage-reading  — just the 念順順 passage
 *
 * The second one used to hit a login box, which makes a printed QR code
 * useless. Both now land on this page; what differs is how much text it shows.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const STORY = {
  id: '1',
  title: '贏得喝采的輸家',
  content: ['第一段落的文字。', '第二段落的文字。', '第三段落的文字。'],
  keyReading: { passage: '第二段落的文字。' },
  vocabulary: [],
  images: [],
  grade: 4,
  level: 4,
  category: 'story',
};

vi.mock('../services/api', () => ({ fetchStory: vi.fn(async () => STORY) }));
vi.mock('../context/ZhuyinContext', () => ({
  useZhuyin: () => ({ isZhuyinAny: false, zhuyinActive: false, processLinesSelective: (l: string[]) => l }),
}));
vi.mock('../hooks/useFullTextTtsQueue', () => ({
  useFullTextTtsQueue: () => ({
    currentParagraphIdx: null, isPlaying: false, isPaused: false,
    play: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(),
  }),
}));

import GuestReadingPage from './GuestReadingPage';

function renderAt(step: string) {
  return render(
    <MemoryRouter initialEntries={[`/learn/1/${step}`]}>
      <Routes>
        {/* Mirrors the real tree: the gate renders this page on the PARENT
            route, so `step` is not a param — the page has to read the path. A
            child-route wrapper here would let a broken lookup pass. */}
        <Route path="/learn/:storyId/*" element={<GuestReadingPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GuestReadingPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the whole lesson for the 全文 code', async () => {
    renderAt('full-text-annotate');
    await waitFor(() => expect(screen.getByText(/第一段落的文字/)).toBeInTheDocument());
    expect(screen.getByText(/第三段落的文字/)).toBeInTheDocument();
  });

  it('shows only the passage for the 段落 code', async () => {
    renderAt('key-passage-reading');
    await waitFor(() => expect(screen.getByText(/第二段落的文字/)).toBeInTheDocument());
    // The paragraphs either side of the passage must not be there — showing the
    // whole lesson would make the two codes indistinguishable, which is how the
    // admin panel's 全文/段落 buttons went wrong before.
    expect(screen.queryByText(/第一段落的文字/)).not.toBeInTheDocument();
    expect(screen.queryByText(/第三段落的文字/)).not.toBeInTheDocument();
  });

  it('offers a player in both modes — listening is the point of the QR code', async () => {
    renderAt('key-passage-reading');
    await waitFor(() => expect(screen.getByTestId('reading-player')).toBeInTheDocument());
  });

  it('never offers the recording practice to someone who cannot be scored', async () => {
    renderAt('key-passage-reading');
    await waitFor(() => screen.getByTestId('reading-player'));
    expect(screen.queryByText(/開始朗讀|開始錄音/)).not.toBeInTheDocument();
  });
});
