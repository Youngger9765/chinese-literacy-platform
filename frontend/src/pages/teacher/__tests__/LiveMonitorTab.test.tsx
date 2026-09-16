/**
 * LiveMonitorTab (Issue #3025) — 教師即時監控儀表板.
 *
 * Locks:
 *  - "no data" students render an EXPLICIT 尚無資料 state — the whole
 *    reason this feature exists is to stop "no data" being silently
 *    confused with "doing fine" (issue #3025 honesty requirement).
 *  - the stuck signal is always labelled 「卡在這題」— "亂猜" must never
 *    appear anywhere in the rendered output (issue #3025 comment: that
 *    word assigns a motive the data does not support).
 *  - the tracked_exercise_types disclosure is rendered, not silently
 *    dropped, so the teacher knows the scope of what this view can see.
 *  - refresh model (Young 2026-09-03, final): auto-poll once a MINUTE plus
 *    a manual 重新整理 button. Both directions are locked: faster than 60s
 *    violates the cost decision (v1 polled every 7s and was pulled), and
 *    no polling at all violates the "auto update" half of the decision.
 *    Polling must stop on unmount — a forgotten tab costs 1 req/min max
 *    that keeps running after unmount would leak requests forever.
 *  - the 推薦練習 button reuses the teacher preview-token mint flow and
 *    navigates to /teacher/preview/{id}, same as StudentProgressTab (#3027).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

const mockGetClassroomLiveMonitor = vi.fn();
const mockRequestPreviewToken = vi.fn();
const mockGetStudentSessions = vi.fn();
vi.mock('../../../services/teacherApi', () => ({
  getClassroomLiveMonitor: (...args: unknown[]) => mockGetClassroomLiveMonitor(...args),
  requestPreviewToken: (...args: unknown[]) => mockRequestPreviewToken(...args),
  getStudentSessions: (...args: unknown[]) => mockGetStudentSessions(...args),
}));

import LiveMonitorTab from '../LiveMonitorTab';
import type { LiveMonitorResponse } from '../../../services/teacherApi';

function renderTab(classroomId = 2) {
  return render(
    <MemoryRouter>
      <LiveMonitorTab classroomId={classroomId} />
    </MemoryRouter>
  );
}

const baseResponse: LiveMonitorResponse = {
  classroom_id: 2,
  generated_at: '2026-09-01T03:00:00Z',
  tracked_exercise_types: ['閱讀理解選擇題', '重點導讀．引導題'],
  students: [
    {
      student_id: 1,
      student_name: '小安',
      has_data: false,
      lesson_id: null,
      question_label: null,
      last_activity_at: null,
      wrong_count: 0,
      is_stuck: false,
    },
    {
      student_id: 2,
      student_name: '小華',
      has_data: true,
      lesson_id: 'L0002',
      question_label: '重點導讀．引導題 2',
      last_activity_at: '2026-09-01T02:59:00Z',
      wrong_count: 3,
      is_stuck: true,
    },
    {
      student_id: 3,
      student_name: '小美',
      has_data: true,
      lesson_id: 'L0001',
      question_label: '閱讀理解選擇題 第 1 題',
      last_activity_at: '2026-09-01T02:58:00Z',
      wrong_count: 1,
      is_stuck: false,
    },
  ],
};

describe('LiveMonitorTab', () => {
  beforeEach(() => {
    mockGetClassroomLiveMonitor.mockReset();
    mockRequestPreviewToken.mockReset();
    mockNavigate.mockReset();
  });

  it('renders an explicit 尚無資料 state for a student with no trackable attempts', async () => {
    mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
    renderTab();

    await waitFor(() => expect(screen.getByText('小安')).toBeInTheDocument());
    // The no-data student's row must carry an explicit "no data" badge —
    // never rendered the same as a student who is doing fine.
    expect(screen.getByText('尚無資料')).toBeInTheDocument();
  });

  it('labels the stuck signal 「卡在這題」 and never renders 「亂猜」 anywhere', async () => {
    mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
    const { container } = renderTab();

    await waitFor(() => expect(screen.getByText('小華')).toBeInTheDocument());
    expect(screen.getAllByText('卡在這題').length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain('亂猜');
  });

  it('does not flag a student who has only answered wrong once', async () => {
    mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
    renderTab();

    await waitFor(() => expect(screen.getByText('小美')).toBeInTheDocument());
    const row = screen.getByText('小美').closest('div[class*="px-4"]');
    expect(row?.textContent).not.toContain('卡在這題');
  });

  it('discloses which exercise types this view can actually see', async () => {
    mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
    renderTab();

    await waitFor(() =>
      expect(screen.getByText(/閱讀理解選擇題、重點導讀．引導題/)).toBeInTheDocument()
    );
  });

  it('shows an error state on fetch failure without crashing', async () => {
    mockGetClassroomLiveMonitor.mockRejectedValue(new Error('network down'));
    renderTab();

    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  describe('preview button wiring (#3027 reuse)', () => {
    it('mints a preview token and navigates to /teacher/preview/{id} on click', async () => {
      mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
      mockRequestPreviewToken.mockResolvedValue({
        preview_token: 'tok-abc',
        student_id: 2,
        student_name: '小華',
        expires_in_minutes: 30,
      });
      renderTab();

      await waitFor(() => expect(screen.getByText('小華')).toBeInTheDocument());
      const row = screen.getByText('小華').closest('div.flex.items-center.justify-between');
      // #3220 之後一列有兩顆按鈕（看作答／推薦練習），所以用名稱選而不是位置
      const previewBtn = Array.from(row?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent?.includes('推薦練習'),
      );
      expect(previewBtn).toBeTruthy();
      fireEvent.click(previewBtn as HTMLButtonElement);

      await waitFor(() => expect(mockRequestPreviewToken).toHaveBeenCalledWith(2));
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith(
          '/teacher/preview/2',
          expect.objectContaining({
            state: expect.objectContaining({ previewToken: 'tok-abc', studentId: 2 }),
          })
        )
      );
    });
  });

  describe('refresh model — 60s poll + manual (Young 2026-09-03 final)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does NOT poll faster than once a minute (v1 polled every 7s — pulled as wasteful)', async () => {
      mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
      renderTab();
      await vi.waitFor(() => expect(mockGetClassroomLiveMonitor).toHaveBeenCalledTimes(1));

      // 59 秒內不可以有第二次 —— 誰把間隔改短（例如改回 7 秒）這裡就紅
      await vi.advanceTimersByTimeAsync(59_000);
      expect(
        mockGetClassroomLiveMonitor.mock.calls.length,
        '59 秒內出現第二次請求 —— 輪詢間隔被改短了？Young 定的是一分鐘',
      ).toBe(1);
    });

    it('DOES auto-refresh after a minute, and stops on unmount', async () => {
      mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
      const { unmount } = renderTab();
      await vi.waitFor(() => expect(mockGetClassroomLiveMonitor).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(61_000);
      expect(
        mockGetClassroomLiveMonitor.mock.calls.length,
        '過了一分鐘沒有自動更新 —— 輪詢被整個拿掉了？決定是 60 秒自動＋手動並存',
      ).toBeGreaterThanOrEqual(2);

      const atUnmount = mockGetClassroomLiveMonitor.mock.calls.length;
      unmount();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(
        mockGetClassroomLiveMonitor.mock.calls.length,
        'unmount 之後還在打 —— 忘記關的分頁會漏水',
      ).toBe(atUnmount);
    });

    it('重新整理 button triggers a re-fetch and updates the timestamp', async () => {
      vi.useRealTimers();
      mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
      renderTab();

      await screen.findByText('小安');
      expect(mockGetClassroomLiveMonitor).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: /重新整理|更新中/ }));
      await vi.waitFor(() => expect(mockGetClassroomLiveMonitor).toHaveBeenCalledTimes(2));
      expect(screen.getByText(/上次更新/)).toBeTruthy();
    });
  });
});

// ─── #3220 第三期：「看作答」入口 ────────────────────────────────────────────
describe('LiveMonitorTab 的「看作答」(#3220)', () => {
  /** 在指定學生那一列裡，依名稱取按鈕（列是排序過的，不能用索引）。 */
  function buttonInRow(studentName: string, label: string) {
    const row = screen.getByText(studentName).closest('div.flex.items-center.justify-between');
    return Array.from(row?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes(label),
    ) as HTMLButtonElement;
  }

  beforeEach(() => {
    mockNavigate.mockReset();
    mockGetClassroomLiveMonitor.mockReset();
    mockGetStudentSessions.mockReset();
    mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
  });

  it('跳到該生「進行中」那一場，而不是比較新的已完成場次', async () => {
    // 後端依 started_at desc 排序，所以已完成那筆在前 —— 老師要的是進行中那場
    mockGetStudentSessions.mockResolvedValue([
      { id: 91, story_title: '昨天做完的', started_at: '2026-09-16T09:00:00Z',
        completed_at: '2026-09-16T09:30:00Z', overall_score: 88, status: 'completed' },
      { id: 90, story_title: '現在在做的', started_at: '2026-09-16T01:00:00Z',
        completed_at: null, overall_score: null, status: 'in_progress' },
    ]);
    renderTab();
    await waitFor(() => expect(screen.getByText('小華')).toBeInTheDocument());
    fireEvent.click(buttonInRow('小華', '看作答'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/teacher/students/2/sessions/90/report'),
    );
  });

  it('學生完全沒有練習紀錄時給訊息，不是無聲失敗', async () => {
    mockGetStudentSessions.mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(screen.getByText('小華')).toBeInTheDocument());
    fireEvent.click(buttonInRow('小華', '看作答'));

    await waitFor(() => expect(screen.getByText(/還沒有任何練習紀錄/)).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
