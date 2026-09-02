/**
 * StudentPreviewPage (Issue #3027) — teacher "preview as student" read-only view.
 *
 * Covers:
 *  - No router state (page reached directly, no mint flow ran) → bounce
 *    message, no crash, no network call.
 *  - With state → the read-only banner names the student and states the
 *    preview will expire; recommendations render using the PREVIEW token
 *    (not any global auth token) via the existing, already-generic
 *    getStoryRecommendations(token, studentId, limit).
 *  - Fetch failure (e.g. expired preview token) shows an error, not a crash.
 *  - "結束預覽" navigates back rather than leaving the teacher stuck on the
 *    student's view.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockGetStoryRecommendations = vi.fn();
vi.mock('../../../services/progressApi', () => ({
  getStoryRecommendations: (...args: unknown[]) => mockGetStoryRecommendations(...args),
}));

import StudentPreviewPage from '../StudentPreviewPage';

function renderWithState(state: Record<string, unknown> | null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/teacher/preview/6', state }]}>
      <StudentPreviewPage />
    </MemoryRouter>
  );
}

describe('StudentPreviewPage (#3027)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bounces back with a message when reached with no preview state — never crashes', () => {
    renderWithState(null);
    expect(screen.getByText(/需要從「班級學生列表」點擊/)).toBeInTheDocument();
    // No token to use — must not have attempted any network call.
    expect(mockGetStoryRecommendations).not.toHaveBeenCalled();
  });

  it('renders a read-only banner naming the previewed student and the expiry', async () => {
    mockGetStoryRecommendations.mockResolvedValue({ recommendations: [], total: 0 });
    renderWithState({
      previewToken: 'preview.jwt.token',
      studentId: 6,
      studentName: '小美',
      expiresInMinutes: 20,
    });

    expect(screen.getByText(/預覽模式（唯讀）/)).toBeInTheDocument();
    expect(screen.getByText(/小美/).closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText(/20 分鐘後自動失效/)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetStoryRecommendations).toHaveBeenCalledWith('preview.jwt.token', 6, 5);
    });
  });

  it('renders recommendation cards fetched with the PREVIEW token, not any global token', async () => {
    mockGetStoryRecommendations.mockResolvedValue({
      recommendations: [
        {
          story_slug: '20001',
          title: '十秒的背後',
          grade: 4,
          genre: '記敘文',
          difficulty_match_score: 30,
          reason: '難度符合你目前的程度（4 年級）',
        },
      ],
      total: 1,
    });
    renderWithState({
      previewToken: 'preview.jwt.token',
      studentId: 6,
      studentName: '小美',
      expiresInMinutes: 20,
    });

    await waitFor(() => {
      expect(screen.getByText('十秒的背後')).toBeInTheDocument();
    });
    expect(mockGetStoryRecommendations).toHaveBeenCalledTimes(1);
    expect(mockGetStoryRecommendations).toHaveBeenCalledWith('preview.jwt.token', 6, 5);
  });

  it('shows an error (not a crash) when the preview fetch fails, e.g. an expired token', async () => {
    mockGetStoryRecommendations.mockRejectedValue(new Error('403'));
    renderWithState({
      previewToken: 'expired.jwt.token',
      studentId: 6,
      studentName: '小美',
      expiresInMinutes: 20,
    });

    await waitFor(() => {
      expect(screen.getByText(/載入預覽失敗/)).toBeInTheDocument();
    });
  });

  it('"結束預覽" navigates back instead of leaving the teacher stuck in the preview', async () => {
    mockGetStoryRecommendations.mockResolvedValue({ recommendations: [], total: 0 });
    renderWithState({
      previewToken: 'preview.jwt.token',
      studentId: 6,
      studentName: '小美',
      expiresInMinutes: 20,
    });

    fireEvent.click(screen.getByRole('button', { name: '結束預覽' }));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
