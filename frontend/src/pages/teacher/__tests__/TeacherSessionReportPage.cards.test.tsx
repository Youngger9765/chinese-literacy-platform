/**
 * #3749 — 老師查看學生報告（/teacher/students/:id/sessions/:id/report）的報告
 * 區塊必須跟學生端同一套「關卡完成卡片」，不是舊版 AssessmentReport。
 *
 * 這條鎖驗的是「渲染出來的是哪個元件」。老師專屬的評語區／聚光燈記錄／語詞應用
 * 記錄／「作答紀錄」已經在 TeacherSessionReportPage.stepRecords.test.tsx 鎖住，
 * 這裡不重複驗。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'teacher-token' }),
}));

const mockFetchReport = vi.fn();
vi.mock('../../../services/teacherApi', () => ({
  fetchTeacherSessionReport: (...a: unknown[]) => mockFetchReport(...a),
  getTeacherStudentDialogue: vi.fn().mockResolvedValue({ turns: [] }),
  saveTeacherComment: vi.fn().mockResolvedValue({}),
  generateAIComment: vi.fn().mockResolvedValue({ ai_comment: '' }),
}));

const mockFetchStory = vi.fn();
vi.mock('../../../services/api', () => ({
  fetchStory: (...a: unknown[]) => mockFetchStory(...a),
}));

// 舊格式的代表元件 —— 這條鎖同時斷言它完全沒有被 import/渲染。
vi.mock('../../../components/reading-steps/AssessmentReport', () => ({
  default: () => <div data-testid="assessment-report">舊版 AssessmentReport</div>,
}));

import TeacherSessionReportPage from '../TeacherSessionReportPage';
import type { TeacherSessionReport } from '../../../services/teacherApi';

const REPORT = {
  id: 55,
  student_id: 7,
  student_name: '小美',
  story_slug: '20015',
  story_title: '穿越極限的跑者',
  status: 'completed',
  is_complete: true,
  accuracy: null,
  overall_score: null,
  reading_result: null,
  comprehension_result: null,
  vocab_result: null,
  full_reading_result: null,
  comprehension_score: null,
  literal_score: null,
  inferential_score: null,
  evaluative_score: null,
  comprehension_feedback: null,
  ai_comment: '表現不錯',
  teacher_comment: null,
  teacher_reviewed_at: null,
  started_at: '2026-09-16T01:00:00Z',
  completed_at: '2026-09-16T01:20:00Z',
  step_progress: {
    current_step: 'report',
    steps_completed: ['lesson-intro', 'vocab-review'],
    step_data: { 'vocab-review': { foundWords: ['陳彥博'] } },
    version: 3,
  },
} as unknown as TeacherSessionReport;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teacher/students/7/sessions/55/report']}>
      <Routes>
        <Route
          path="/teacher/students/:studentId/sessions/:sessionId/report"
          element={<TeacherSessionReportPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TeacherSessionReportPage — 報告區塊 (#3749)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchReport.mockResolvedValue(REPORT);
    mockFetchStory.mockResolvedValue({
      id: '20015',
      title: '穿越極限的跑者',
      stepSequence: ['lesson-intro', 'vocab-review', 'report'],
    });
  });

  it('渲染新版關卡卡片，不是舊版 AssessmentReport', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('step-report-cards')).toBeInTheDocument());
    expect(screen.queryByTestId('assessment-report')).not.toBeInTheDocument();
    expect(screen.getByText('完成 2 / 2 關')).toBeInTheDocument();
  });

  it('沒有做記號的資料時，讀全文卡片不會誤報「還沒有做記號」', async () => {
    mockFetchStory.mockResolvedValue({
      id: '20015',
      title: '穿越極限的跑者',
      stepSequence: ['lesson-intro', 'full-text-annotate', 'report'],
    });
    const withAnnotateStep = {
      ...REPORT,
      step_progress: {
        current_step: 'report',
        steps_completed: ['lesson-intro', 'full-text-annotate'],
        step_data: {},
        version: 1,
      },
    } as unknown as TeacherSessionReport;
    mockFetchReport.mockResolvedValue(withAnnotateStep);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('step-report-cards')).toBeInTheDocument());

    screen.getByRole('button', { name: /讀全文-做記號/ }).click();
    expect(screen.queryByText('還沒有做記號')).not.toBeInTheDocument();
    expect(screen.queryByText('記號載入中…')).not.toBeInTheDocument();
  });

  it('未完成的 session 仍顯示「尚未完成」訊息，不渲染卡片（維持既有行為）', async () => {
    mockFetchReport.mockResolvedValue({ ...REPORT, is_complete: false });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('學生尚未完成此課文的學習，暫無報告資料')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('step-report-cards')).not.toBeInTheDocument();
  });
});
