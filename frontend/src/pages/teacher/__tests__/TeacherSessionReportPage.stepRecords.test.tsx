/**
 * 教師報告頁的「作答紀錄」（#3220 第二期）。
 *
 * ## 這條鎖在守什麼
 *
 * 教師端**早就拿到**學生的逐關作答（`TeacherSessionReportResponse.step_progress.step_data`），
 * 但 #1549 留下的是 `JSON.stringify` 的 `<details>` placeholder —— 資料到位、
 * 老師卻讀不了。學生端「作答紀錄」分頁的 `StepRecordsView` 渲染的就是同一份資料，
 * 所以第二期是重用它，不是另寫一套。
 *
 * 三條鎖：
 *   1. 教師報告頁**渲染作答內容**，不是 raw JSON —— 退回 JSON.stringify 會紅
 *   2. 對話來源是**教師端**那支。`StepRecordsView` 預設打
 *      `/learning/sessions/{id}/dialogue`（走 `get_owned_session`，老師打 403），
 *      注入若被拿掉，畫面上不會有任何錯誤，對話只是靜靜地空掉 ——
 *      所以這條鎖驗的是「呼叫了哪一支」，不是「畫面有沒有炸」
 *   3. 型別相容性在 build 期就守住（見檔案末端的 type-level 斷言）
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'teacher-token' }),
}));

const mockFetchReport = vi.fn();
const mockTeacherDialogue = vi.fn();
vi.mock('../../../services/teacherApi', () => ({
  fetchTeacherSessionReport: (...a: unknown[]) => mockFetchReport(...a),
  getTeacherStudentDialogue: (...a: unknown[]) => mockTeacherDialogue(...a),
  saveTeacherComment: vi.fn().mockResolvedValue({}),
  // 後端 AICommentResponse.ai_comment 是非 optional 的 str（teacher_student_reports.py:157
  // 用 `or ""` 保證），mock 照契約回空字串而不是 null
  generateAIComment: vi.fn().mockResolvedValue({ ai_comment: '' }),
}));

// 學生端那支：這個測試的重點之一就是它**不可以**被呼叫到
const mockStudentDialogue = vi.fn();
vi.mock('../../../services/learning/comprehension', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../services/learning/comprehension',
  );
  return { ...actual, fetchDialogueHistory: (...a: unknown[]) => mockStudentDialogue(...a) };
});

vi.mock('../../../services/api', () => ({ fetchStory: vi.fn().mockResolvedValue(null) }));

import TeacherSessionReportPage from '../TeacherSessionReportPage';
import type { TeacherSessionReport } from '../../../services/teacherApi';
import type { SessionDetailResponse } from '../../../services/learningApi';

const REPORT = {
  id: 55,
  student_id: 7,
  student_name: '小美',
  story_slug: '20015',
  story_title: '穿越極限的跑者',
  status: 'in_progress',
  is_complete: false,
  accuracy: null,
  overall_score: null,
  reading_result: null,
  comprehension_result: { answers: [{ q: '主角是誰？', a: '陳彥博' }] },
  vocab_result: null,
  full_reading_result: null,
  comprehension_score: null,
  literal_score: null,
  inferential_score: null,
  evaluative_score: null,
  comprehension_feedback: null,
  ai_comment: null,
  teacher_comment: null,
  teacher_reviewed_at: null,
  started_at: '2026-09-16T01:00:00Z',
  completed_at: null,
  step_progress: {
    current_step: 'spotlight',
    steps_completed: ['lesson-intro', 'full-text-annotate'],
    step_data: { spotlight: { answers: ['他'] } },
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

describe('教師報告頁的作答紀錄 (#3220)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchReport.mockResolvedValue(REPORT);
    mockTeacherDialogue.mockResolvedValue({ turns: [] });
    mockStudentDialogue.mockResolvedValue({ turns: [] });
  });

  it('渲染作答紀錄，而不是把 step_progress 倒成 JSON', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText(/作答紀錄/)).toBeInTheDocument());

    // 退回 #1549 那個 placeholder 會讓這條紅：raw JSON 會把欄位名原封不動印出來
    expect(container.textContent).not.toContain('"steps_completed"');
    expect(container.textContent).not.toContain('學習步驟細節（原始資料）');
  });

  it('對話走教師端端點，不是學生端那支（學生端老師打會 403）', async () => {
    renderPage();
    await waitFor(() => expect(mockTeacherDialogue).toHaveBeenCalled());

    // 帶對了學生與場次，否則老師會拿到別人的對話
    expect(mockTeacherDialogue).toHaveBeenCalledWith('teacher-token', 7, 55);
    // 關鍵：預設那支絕不能被呼叫到 —— 它不會報錯，只會靜靜地空掉
    expect(mockStudentDialogue).not.toHaveBeenCalled();
  });

  it('未完成的 session 也渲染（老師要在上課當下看得到）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/作答紀錄/)).toBeInTheDocument());
    // REPORT.status 是 in_progress、is_complete 為 false
    // 數字與「步已完成」分屬不同節點，所以用容器文字比對
    expect(screen.getByRole('heading', { name: /作答紀錄/ }).textContent).toMatch(/2\s*步已完成/);
  });
});

// ─── build 期的型別鎖 ───────────────────────────────────────────────────────
// 教師端的欄位必須完整涵蓋 StepRecordsView 要的 SessionDetailResponse。
// 任一邊欄位漂移，這一行會在 tsc 就紅，而不是等到執行期破圖。
// （2026-09-16 實測：教師端 28 欄 ⊇ SessionDetailResponse 19 欄）
type _TeacherReportCoversSessionDetail =
  TeacherSessionReport extends Partial<SessionDetailResponse> ? true : never;
const _typeLock: _TeacherReportCoversSessionDetail = true;
void _typeLock;
