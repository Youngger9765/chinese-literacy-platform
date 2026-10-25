/**
 * #3754 — two things Young hit while actually playing 迷城密室 on staging:
 *
 * 1. "這什麼爛題目啊！你要寫清楚你再問哪一個字啊" — a zhuyin question's
 *    stem showed up as a bare sentence with no indication which character
 *    was being asked about (the backend's own safe-view whitelist dropped
 *    `extra` — see `backend/app/services/escape_room/engine.py`'s
 *    `_safe_question`). This file locks that the frontend, given a valid
 *    `extra.target_index`, actually surfaces an unambiguous question.
 *
 * 2. "剩餘 0 秒 然後呢？？？？" — the countdown was purely client-side and
 *    nothing polled the server once it hit zero, so the screen sat frozen.
 *    This locks that reaching 0 triggers another `getEscapeRoomRunState`
 *    call (the actual time-up *resolution* is a server-side lazy check —
 *    `backend/tests/test_escape_room_engine.py::TestQuestionTimeout` locks
 *    that half; this file only locks that the frontend asks).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: '測試憑證', user: { id: 1, name: '小明' } }),
}));

vi.mock('../../../components/pk/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

const BASE_STATE = {
  run_id: 1,
  status: 'in_progress' as const,
  mist_distance: 50,
  unlocked_chambers: 0,
  teammates: [
    { slug: 'bookworm', frozen: false },
    { slug: 'lantern', frozen: false },
    { slug: 'compass', frozen: false },
  ],
  abilities_used: [],
  current_chamber: {
    chamber_index: 0,
    stem: '他覺得這次一定能成功',
    options: [
      { key: 'A', text: 'ㄐㄩㄝˊ' },
      { key: 'B', text: 'ㄐㄧㄠˋ' },
    ],
    seconds: 5,
    extra_time_ms: 0,
    extra: { target_index: 1 }, // stem[1] === '覺'
  },
  rescue_question: null,
  gate_question: null,
  story_intro: '翻開《測試故事》，和三位夥伴一起找回被迷霧吞沒的文字',
  mist_message: '迷霧正在遠離',
};

const getEscapeRoomRunState = vi.fn(() => Promise.resolve(BASE_STATE));

vi.mock('../../../services/escapeRoomApi', () => ({
  EscapeRoomApiError: class EscapeRoomApiError extends Error {},
  getEscapeRoomRunState: (...args: unknown[]) => getEscapeRoomRunState(...(args as [])),
  getEscapeRoomResult: vi.fn(() => Promise.resolve({ run_id: 1, result: 'escaped', message: '已逃脫', unlocked_skins: [] })),
  submitEscapeRoomAnswer: vi.fn(() => Promise.resolve(BASE_STATE)),
  submitEscapeRoomGateAnswer: vi.fn(() => Promise.resolve(BASE_STATE)),
  submitEscapeRoomRescue: vi.fn(() => Promise.resolve(BASE_STATE)),
  activateEscapeRoomAbility: vi.fn(() => Promise.resolve(BASE_STATE)),
}));

import StudentEscapeRoomRun from '../StudentEscapeRoomRun';

function renderRun(): void {
  render(
    <MemoryRouter initialEntries={['/escape-room/run/1']}>
      <Routes><Route path="/escape-room/run/:runId" element={<StudentEscapeRoomRun />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getEscapeRoomRunState.mockClear();
  getEscapeRoomRunState.mockImplementation(() => Promise.resolve(BASE_STATE));
});

describe('讀音題目標字標示與問句 (#3754)', () => {
  it('標出 stem 裡被問的那個字，並且用明確的問句', async () => {
    renderRun();

    const target = await screen.findByTestId('stem-target');
    expect(target).toHaveTextContent('覺');
    expect(await screen.findByText('句中的「覺」怎麼唸？')).toBeInTheDocument();
  });

  it('沒有 extra 的一般題目不顯示目標字問句', async () => {
    getEscapeRoomRunState.mockResolvedValueOnce({
      ...BASE_STATE,
      current_chamber: { ...BASE_STATE.current_chamber, extra: undefined },
    });
    renderRun();

    await screen.findByText('他覺得這次一定能成功');
    expect(screen.queryByText(/怎麼唸？/)).not.toBeInTheDocument();
  });
});

describe('時間到自動推進 (#3754)', () => {
  beforeEach(() => {
    // `shouldAdvanceTime` lets real microtasks (promise resolution,
    // testing-library's own `waitFor`/`findBy*` polling) keep moving while
    // `vi.advanceTimersByTimeAsync` below drives the component's own
    // `setInterval`s — without it, `waitFor`'s internal `setTimeout` polling
    // is ALSO faked and never fires on its own, so it just hangs.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('倒數歸零時顯示「時間到了」並再次向伺服器確認狀態', async () => {
    renderRun();

    await waitFor(() => expect(getEscapeRoomRunState).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('剩餘 5 秒')).toBeInTheDocument();

    // 題目秒數是 5 秒（+0 extra_time_ms）— 走完 5 次 1 秒 tick 讓倒數歸零。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(await screen.findByText('時間到了，正在判定...')).toBeInTheDocument();
    // 第一次是 mount 時的初始讀取；歸零後的這一次就是新加的輪詢。
    await waitFor(() => expect(getEscapeRoomRunState.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('伺服器判定後換成新題目，就不再停在「時間到了」', async () => {
    const nextChamber = {
      chamber_index: 0,
      stem: '換一題了',
      options: [{ key: 'A', text: '選項一' }],
      seconds: 30,
      extra_time_ms: 0,
    };
    renderRun();
    await waitFor(() => expect(getEscapeRoomRunState).toHaveBeenCalledTimes(1));

    getEscapeRoomRunState.mockImplementation(() =>
      Promise.resolve({ ...BASE_STATE, mist_distance: 40, current_chamber: nextChamber }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(await screen.findByText('換一題了')).toBeInTheDocument();
    expect(screen.queryByText('時間到了，正在判定...')).not.toBeInTheDocument();
  });
});
