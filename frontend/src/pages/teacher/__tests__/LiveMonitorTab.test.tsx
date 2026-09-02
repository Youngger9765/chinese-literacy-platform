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
 *  - refresh model (Young 2026-09-03): fetches ONCE on mount, never again
 *    on its own — no timers at all. 重新整理 button triggers a re-fetch.
 *    The first version auto-polled every 7s; a forgotten open tab would
 *    hit the backend all night, so polling was removed entirely
 *    that keeps running after unmount would leak requests forever.
 *  - the 預覽 button reuses the teacher preview-token mint flow and
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
vi.mock('../../../services/teacherApi', () => ({
  getClassroomLiveMonitor: (...args: unknown[]) => mockGetClassroomLiveMonitor(...args),
  requestPreviewToken: (...args: unknown[]) => mockRequestPreviewToken(...args),
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
      const previewBtn = row?.querySelector('button');
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

  describe('refresh model — no polling (Young 2026-09-03)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('fetches once on mount and NEVER again on its own — no timers', async () => {
      mockGetClassroomLiveMonitor.mockResolvedValue(baseResponse);
      renderTab();

      await vi.waitFor(() => expect(mockGetClassroomLiveMonitor).toHaveBeenCalledTimes(1));

      // 走過遠超過舊輪詢間隔的時間 —— 若有人把 setInterval 加回來，這裡會抓到。
      // 這是本次改動的核心承諾：開著忘記關的分頁不會一直打後端。
      await vi.advanceTimersByTimeAsync(120_000);
      expect(
        mockGetClassroomLiveMonitor.mock.calls.length,
        '兩分鐘內出現額外請求 —— 自動輪詢被加回來了？Young 明確拿掉它',
      ).toBe(1);
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
