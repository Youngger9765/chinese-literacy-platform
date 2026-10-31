/**
 * ReadingBabyAtlasPage — `/student/reading-babies`（#3780 reading-babies
 * PRD §3「圖鑑頁：179 格」）。取代 v1 WordBabiesLab 的唯一寶貝圖鑑入口
 * （game-design.md §5.3：WordBabiesLab 整頁刪除）。
 *
 * 鎖：① loading/error（可重試）/success 三態 ② 依教授家族分組顯示
 * （readingBabyProfessorFamilies.ts，不是後端目前回傳的舊 11 家族）
 * ③ 已遇見/未遇見視覺區分，點已遇見的格子會導到寶貝卡
 * ④ 文案不出現升級/餵食/領取字樣。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'tok', user: { id: 4, roles: [{ role_name: 'student' }] } }),
}));

const fetchReadingBabyAtlasMock = vi.fn();
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyAtlas: (...args: unknown[]) => fetchReadingBabyAtlasMock(...args),
}));

import ReadingBabyAtlasPage from '../ReadingBabyAtlasPage';

const BABY_L0001 = {
  lesson_uid: 'L0001',
  title: '十秒的背後',
  ability_family: 'D',
  ability_family_name: '寫作鑑賞力',
  stage: 'intermediate' as const,
  assessable_total: 5,
  assessable_passed: 3,
  progress_ratio: 0.6,
  fragments_count: 3,
  next_step: { station: 'spotlight', station_label: null, building: '聚光閣', indicator_code: '5-Ⅱ-5' },
  all_cleared: false,
};

const BABY_L0002_UNSEEN = {
  lesson_uid: 'L0002',
  title: '未遇見的課',
  ability_family: 'A',
  ability_family_name: '推論力',
  stage: 'not_encountered' as const,
  assessable_total: 4,
  assessable_passed: 0,
  progress_ratio: 0,
  fragments_count: 0,
  next_step: null,
  all_cleared: false,
};

describe('ReadingBabyAtlasPage', () => {
  beforeEach(() => {
    navigate.mockReset();
    fetchReadingBabyAtlasMock.mockReset();
  });

  it('shows a loading message while the atlas is being fetched', () => {
    fetchReadingBabyAtlasMock.mockReturnValue(new Promise(() => {}));
    render(<ReadingBabyAtlasPage />);
    expect(screen.getByText(/載入中/)).toBeInTheDocument();
  });

  it('shows a retryable error message on fetch failure (not stuck forever)', async () => {
    fetchReadingBabyAtlasMock.mockRejectedValueOnce(new Error('network'));
    render(<ReadingBabyAtlasPage />);

    const retryButton = await screen.findByRole('button', { name: /重新|再試/ });
    expect(retryButton).toBeInTheDocument();

    fetchReadingBabyAtlasMock.mockResolvedValueOnce({
      student_id: 4, total_lessons: 179, total_fragments: 3, babies: [BABY_L0001],
    });
    await act(async () => { fireEvent.click(retryButton); });

    await waitFor(() => expect(screen.getByText('十秒的背後')).toBeInTheDocument());
  });

  it('shows how many lessons encountered out of the total, and total fragments', async () => {
    fetchReadingBabyAtlasMock.mockResolvedValue({
      student_id: 4, total_lessons: 179, total_fragments: 3, babies: [BABY_L0001, BABY_L0002_UNSEEN],
    });
    render(<ReadingBabyAtlasPage />);

    await waitFor(() => expect(screen.getByText(/1.*179/)).toBeInTheDocument());
    expect(screen.getByText(/碎片收藏 3 片/)).toBeInTheDocument();
  });

  it('groups lessons by professor family (F08 寫作手法 for L0001), not the backend ability_family', async () => {
    fetchReadingBabyAtlasMock.mockResolvedValue({
      student_id: 4, total_lessons: 179, total_fragments: 3, babies: [BABY_L0001],
    });
    render(<ReadingBabyAtlasPage />);

    // L0001's professor family is F08 寫作手法 (readingBabyProfessorFamilies.json),
    // NOT its ability_family_name "寫作鑑賞力" from the (old 11-family) API response.
    await waitFor(() => expect(screen.getByText('寫作手法')).toBeInTheDocument());
    expect(screen.queryByText('寫作鑑賞力')).not.toBeInTheDocument();
  });

  it('renders an unseen (not_encountered) lesson distinctly and does not navigate when clicked', async () => {
    fetchReadingBabyAtlasMock.mockResolvedValue({
      student_id: 4, total_lessons: 179, total_fragments: 0, babies: [BABY_L0002_UNSEEN],
    });
    render(<ReadingBabyAtlasPage />);

    const cell = await screen.findByTestId('reading-baby-cell-L0002');
    expect(cell).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(cell);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clicking an encountered lesson navigates to its card page', async () => {
    fetchReadingBabyAtlasMock.mockResolvedValue({
      student_id: 4, total_lessons: 179, total_fragments: 3, babies: [BABY_L0001],
    });
    render(<ReadingBabyAtlasPage />);

    const cell = await screen.findByTestId('reading-baby-cell-L0001');
    fireEvent.click(cell);
    expect(navigate).toHaveBeenCalledWith('/student/reading-babies/L0001');
  });

  it('never uses 升級/餵食/領取 wording anywhere on the page', async () => {
    fetchReadingBabyAtlasMock.mockResolvedValue({
      student_id: 4, total_lessons: 179, total_fragments: 3, babies: [BABY_L0001, BABY_L0002_UNSEEN],
    });
    render(<ReadingBabyAtlasPage />);
    await waitFor(() => expect(screen.getByText('十秒的背後')).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/升級|餵食|領取/);
  });
});
