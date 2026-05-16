/**
 * Tests for AIAnalysisSection — Issue #1648
 *
 * Covers:
 * - When dbSessionId is null, no API call fires and graceful empty state renders
 * - When dbSessionId is a valid number, the session-based cached endpoint is called
 * - Normal analysis render when data comes back
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AIAnalysisSection from '../AIAnalysisSection';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAIAnalysis = vi.fn();

vi.mock('../../../services/learningApi', () => ({
  getAIAnalysis: (...args: unknown[]) => mockGetAIAnalysis(...args),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token-abc' }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  storyTitle: '玉山之美',
  accuracy: 85,
  cpm: 120,
  errorChars: ['山', '雪'],
  totalCharacters: 200,
};

const MOCK_ANALYSIS = {
  analysis_summary: '整體表現不錯',
  strengths: ['發音清晰'],
  areas_for_improvement: ['注意多音字'],
  practice_suggestions: ['每天練習 10 分鐘'],
  encouragement_message: '加油！',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AIAnalysisSection — Issue #1648', () => {
  beforeEach(() => {
    mockGetAIAnalysis.mockReset();
  });

  describe('when dbSessionId is null (error/reset state)', () => {
    it('does NOT call getAIAnalysis when user clicks generate', async () => {
      render(<AIAnalysisSection {...BASE_PROPS} dbSessionId={null} />);

      // The generate button might not even appear — but if it does, clicking
      // should not call the API
      const btn = screen.queryByText('產生 AI 分析');
      if (btn) {
        fireEvent.click(btn);
        // Even after click, API should not be called
        expect(mockGetAIAnalysis).not.toHaveBeenCalled();
      }
    });

    it('shows graceful empty state message when dbSessionId is null', () => {
      render(<AIAnalysisSection {...BASE_PROPS} dbSessionId={null} />);

      // Should show a message indicating session is not ready
      const container = screen.getByTestId('ai-analysis-no-session');
      expect(container).toBeTruthy();
      expect(container.textContent).toContain('分析資料載入中');
    });

    it('does NOT fire any fetch/API call on mount when dbSessionId is null', () => {
      render(<AIAnalysisSection {...BASE_PROPS} dbSessionId={null} />);
      expect(mockGetAIAnalysis).not.toHaveBeenCalled();
    });
  });

  describe('when dbSessionId is a valid number', () => {
    it('calls getAIAnalysis with the session ID when user clicks generate', async () => {
      mockGetAIAnalysis.mockResolvedValueOnce(MOCK_ANALYSIS);

      render(<AIAnalysisSection {...BASE_PROPS} dbSessionId={42} />);

      const btn = screen.getByText('產生 AI 分析');
      fireEvent.click(btn);

      await waitFor(() => {
        expect(mockGetAIAnalysis).toHaveBeenCalledOnce();
        // Second arg is the session ID
        expect(mockGetAIAnalysis).toHaveBeenCalledWith(
          'test-token-abc',
          expect.objectContaining({ storyTitle: '玉山之美' }),
          42,
        );
      });
    });

    it('renders analysis result after successful fetch', async () => {
      mockGetAIAnalysis.mockResolvedValueOnce(MOCK_ANALYSIS);

      render(<AIAnalysisSection {...BASE_PROPS} dbSessionId={42} />);

      fireEvent.click(screen.getByText('產生 AI 分析'));

      await waitFor(() => {
        expect(screen.getByText('整體表現不錯')).toBeTruthy();
        expect(screen.getByText('加油！')).toBeTruthy();
      });
    });

    it('never passes sessionId=undefined to getAIAnalysis (ensures cached endpoint)', async () => {
      mockGetAIAnalysis.mockResolvedValueOnce(MOCK_ANALYSIS);

      render(<AIAnalysisSection {...BASE_PROPS} dbSessionId={99} />);

      fireEvent.click(screen.getByText('產生 AI 分析'));

      await waitFor(() => {
        const [, , sessionIdArg] = mockGetAIAnalysis.mock.calls[0];
        // Must be the numeric ID, never undefined (which would trigger standalone endpoint)
        expect(typeof sessionIdArg).toBe('number');
        expect(sessionIdArg).toBe(99);
      });
    });
  });
});
