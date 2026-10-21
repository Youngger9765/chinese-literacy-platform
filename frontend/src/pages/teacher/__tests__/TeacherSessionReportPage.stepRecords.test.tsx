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

// ─── Issue #3682 跟進：comprehension_result / vocab_result 是死欄位 ──────────
//
// 上面那組測試的 REPORT fixture 把 `comprehension_result` 寫死成一個有值的物件
// （`{ answers: [...] }`），但真實產品的現行 step 元件（ComprehensionChat.tsx、
// VocabApplication.tsx）從來不會寫這兩個欄位——它們只透過
// PUT /learning/sessions/{id}/progress 寫 step_progress.step_data，從來沒有任何
// 呼叫點把資料寫回 session.comprehension_result / session.vocab_result。
//
// 後果：StepRecordsView 原本的 `hasComprehension = !!detail.comprehension_result`
// 在真實資料下恆為 false——即使學生真的在對話（DialogueTurn 已經即時寫進 DB，
// 由教師端專用的 `/teacher/students/{id}/sessions/{id}/dialogue` 端點讀得到）、
// 即使學生真的填過語詞應用的填空題（已經寫進
// step_progress.step_data['vocab-application'].exercise.firstTryResults），
// 老師點進「作答紀錄」看到的還是「尚無作答紀錄」。
//
// 這組測試用「跟現實一致」的 fixture（兩個結果欄位都是 null）鎖住修復後的行為。
describe('作答紀錄不能依賴死欄位 (#3682 跟進)', () => {
  const REALISTIC_IN_PROGRESS_REPORT = {
    ...REPORT,
    // 跟現行 production 一致：這兩個欄位從來沒有寫入過，永遠是 null。
    comprehension_result: null,
    vocab_result: null,
    step_progress: {
      current_step: 'vocab-application',
      steps_completed: ['lesson-intro', 'comprehension'],
      step_data: {
        // 真實的「尚未完成、中途離開」快照：VocabApplication.tsx 的
        // handleExerciseProgress 存的正是這個形狀。
        'vocab-application': {
          phase: 'exercise',
          exercise: {
            currentIdx: 1,
            usedCodes: [],
            score: 1,
            firstTryResults: [
              {
                sentenceIdx: 0,
                firstTryCorrect: true,
                studentFirstAnswer: '興高采烈',
                correctAnswer: '興高采烈',
              },
            ],
          },
        },
      },
      version: 2,
    },
  } as unknown as TeacherSessionReport;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchReport.mockResolvedValue(REALISTIC_IN_PROGRESS_REPORT);
    mockTeacherDialogue.mockResolvedValue({ turns: [] });
    mockStudentDialogue.mockResolvedValue({ turns: [] });
  });

  it('comprehension_result 是 null，但真的有對話紀錄時仍要顯示對話，不是「沒有對話紀錄」', async () => {
    mockTeacherDialogue.mockResolvedValue({
      turns: [
        { id: 1, turn_order: 0, role: 'ai', text: '主角為什麼感到驕傲？', is_correct: null, phase: 'q1', created_at: '2026-01-01T00:00:00Z' },
        { id: 2, turn_order: 1, role: 'student', text: '因為他完成了比賽', is_correct: true, phase: 'q1', created_at: '2026-01-01T00:01:00Z' },
      ],
    });
    renderPage();

    // 真的渲染出對話內容——不是「沒有對話紀錄」的空狀態
    await waitFor(() => expect(screen.getByText('因為他完成了比賽')).toBeInTheDocument());
    expect(screen.getByText('主角為什麼感到驕傲？')).toBeInTheDocument();
    expect(screen.queryByText('沒有對話紀錄')).not.toBeInTheDocument();
  });

  it('vocab_result 是 null，但 step_progress 裡有真實填空作答時要顯示學生的答案', async () => {
    renderPage();

    // 學生實際填的答案要顯示出來，不是被死欄位擋住整段不渲染。
    // 「學生填的：」跟答案文字同一個 <p>，JSX 表達式分段會被 jsdom 併成同一個
    // text node，用 exact getByText('興高采烈') 配不到——比對整段文字內容。
    await waitFor(() =>
      expect(screen.getByText((_, el) => el?.textContent === '學生填的：興高采烈')).toBeInTheDocument(),
    );
  });

  it('沒有任何真實資料時（連對話都沒有）仍然正確顯示「尚無作答紀錄」，不會永遠卡在載入中', async () => {
    const EMPTY_REPORT = {
      ...REALISTIC_IN_PROGRESS_REPORT,
      step_progress: {
        current_step: 'lesson-intro',
        steps_completed: [],
        step_data: {},
        version: 1,
      },
    } as unknown as TeacherSessionReport;
    mockFetchReport.mockResolvedValue(EMPTY_REPORT);
    mockTeacherDialogue.mockResolvedValue({ turns: [] });
    renderPage();

    await waitFor(() => expect(screen.getByText('尚無作答紀錄')).toBeInTheDocument());
  });

  it('對話端點打失敗時仍要落定到「尚無作答紀錄」，不能永遠卡在載入骨架', async () => {
    const EMPTY_REPORT = {
      ...REALISTIC_IN_PROGRESS_REPORT,
      step_progress: {
        current_step: 'lesson-intro',
        steps_completed: [],
        step_data: {},
        version: 1,
      },
    } as unknown as TeacherSessionReport;
    mockFetchReport.mockResolvedValue(EMPTY_REPORT);
    // 教師端對話端點打失敗（網路錯誤/逾時）——.catch 要吞掉它，不能讓
    // dialogueChecked 卡在 false，否則畫面會永遠停在載入骨架。
    mockTeacherDialogue.mockRejectedValue(new Error('network error'));
    renderPage();

    await waitFor(() => expect(screen.getByText('尚無作答紀錄')).toBeInTheDocument());
    expect(screen.queryByLabelText('作答紀錄載入中')).not.toBeInTheDocument();
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
