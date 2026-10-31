/**
 * ReadingBabyCardPage — `/student/reading-babies/:lessonUid`（#3780
 * reading-babies PRD §4「寶貝卡」）。取代 v1 的餵食/圖鑑卡片。
 *
 * 鎖：① 寫出主要能力（課綱代碼放小字）② 列出技能 ③ 碎片收藏牆
 * （fragments_count 片）④ 下一步要去的站名＋建築 + 一鍵直達按鈕
 * （導到該課該站，帶 focusStation 查詢參數）⑤ all_cleared 時顯示「這一課
 * 你都學會了」⑥ 不出現升級/餵食/領取字樣。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ lessonUid: 'L0001' }),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', user: { id: 4, roles: [{ role_name: 'student' }] } }),
}));

const fetchReadingBabyCardMock = vi.fn();
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyCard: (...args: unknown[]) => fetchReadingBabyCardMock(...args),
}));

import ReadingBabyCardPage from '../ReadingBabyCardPage';

const CARD_IN_PROGRESS = {
  lesson_uid: 'L0001',
  title: '十秒的背後',
  ability_family: 'F08',
  ability_family_name: '寫作手法',
  stage: 'intermediate' as const,
  assessable_total: 5,
  assessable_passed: 3,
  progress_ratio: 0.6,
  fragments_count: 3,
  next_step: { station: 'spotlight', station_label: null, building: '聚光閣', indicator_code: '5-Ⅱ-5' },
  all_cleared: false,
};

const CARD_ALL_CLEARED = {
  ...CARD_IN_PROGRESS,
  stage: 'advanced' as const,
  assessable_passed: 5,
  progress_ratio: 1,
  next_step: null,
  all_cleared: true,
};

describe('ReadingBabyCardPage', () => {
  beforeEach(() => {
    navigate.mockReset();
    fetchReadingBabyCardMock.mockReset();
  });

  it('shows the lesson title and primary ability with its curriculum code in small text', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_IN_PROGRESS);
    render(<ReadingBabyCardPage />);

    await waitFor(() => expect(screen.getByText('十秒的背後')).toBeInTheDocument());
    // L0001's primary indicator code from readingBabyLessonSkills.json is 5-Ⅱ-5
    expect(screen.getByText(/5-Ⅱ-5/)).toBeInTheDocument();
  });

  it('draws the baby itself and says which stage it is in (#3780 phase 3)', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_IN_PROGRESS);
    render(<ReadingBabyCardPage />);

    expect(await screen.findByRole('img', { name: '十秒的背後的閱讀寶貝（中階）' })).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: '寶貝的三個階段' });
    const items = Array.from(steps.querySelectorAll('li'));
    expect(items.map((li) => li.textContent)).toEqual(['基礎', '中階', '進階']);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
  });

  it('shows the professor family from the API as the primary ability', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_IN_PROGRESS);
    render(<ReadingBabyCardPage />);

    await waitFor(() => expect(screen.getByText(/主要能力：寫作手法/)).toBeInTheDocument());
  });

  it('lists the skills for this lesson', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_IN_PROGRESS);
    render(<ReadingBabyCardPage />);

    await waitFor(() => expect(screen.getByText('朗讀流暢')).toBeInTheDocument());
    expect(screen.getByText('詞語運用')).toBeInTheDocument();
  });

  it('shows the fragment collection wall sized to fragments_count', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_IN_PROGRESS);
    render(<ReadingBabyCardPage />);

    await waitFor(() => expect(screen.getByTestId('fragment-wall')).toBeInTheDocument());
    expect(screen.getAllByTestId('fragment-piece')).toHaveLength(3);
  });

  it('shows the next step station/building with a one-click-travel button', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_IN_PROGRESS);
    render(<ReadingBabyCardPage />);

    await waitFor(() => expect(screen.getByText(/聚光閣/)).toBeInTheDocument());
    const travelButton = screen.getByRole('button', { name: /直達|出發|前往/ });
    fireEvent.click(travelButton);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('focusStation=spotlight'));
  });

  it('shows "這一課你都學會了" and no next-step button when all_cleared', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_ALL_CLEARED);
    render(<ReadingBabyCardPage />);

    await waitFor(() => expect(screen.getByText(/這一課你都學會了/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /直達|出發|前往/ })).not.toBeInTheDocument();
  });

  it('shows a retryable error message on fetch failure', async () => {
    fetchReadingBabyCardMock.mockRejectedValueOnce(new Error('network'));
    render(<ReadingBabyCardPage />);

    const retryButton = await screen.findByRole('button', { name: /重新|再試/ });
    fetchReadingBabyCardMock.mockResolvedValueOnce(CARD_IN_PROGRESS);
    fireEvent.click(retryButton);

    await waitFor(() => expect(screen.getByText('十秒的背後')).toBeInTheDocument());
  });

  it('never uses 升級/餵食/領取 wording anywhere on the page', async () => {
    fetchReadingBabyCardMock.mockResolvedValue(CARD_IN_PROGRESS);
    render(<ReadingBabyCardPage />);
    await waitFor(() => expect(screen.getByText('十秒的背後')).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/升級|餵食|領取/);
  });
});
