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
 *
 * #3770 (game-academy audit round 2, P0-1) — the countdown's #3754 fix
 * above still broke when the SAME question (same stem — `gate_question`/
 * `rescue_question` are the one static object reused on every retry) came
 * back after a server-side auto-resolve: the old countdown was keyed on
 * "did stem/chamber_index change", so a retried attempt with an unchanged
 * stem looked identical to the one before it and the countdown stayed
 * stuck at 0 forever ("永久卡死在「正在判定…」"). The fix makes the
 * countdown server-authoritative (`started_at` + `server_now`, same
 * pattern `PkCountdownRing`/`CountdownBar` use) — the tests below use a
 * fixed system time so a "same stem, new `started_at`" retry can be
 * asserted precisely.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: '測試憑證', user: { id: 1, name: '小明' } }),
}));

vi.mock('../../../components/pk/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

const T0 = '2026-01-01T00:00:00.000Z';

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
    started_at: T0,
  },
  rescue_question: null,
  gate_question: null,
  story_intro: '翻開《測試故事》，和三位夥伴一起找回被迷霧吞沒的文字',
  mist_message: '迷霧正在遠離',
  server_now: T0,
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
    // Pinned so `started_at`/`server_now` pairs below are exact, not
    // "whenever this test happened to run" — needed for #3770's "same
    // stem, NEW started_at" assertion to be deterministic.
    vi.setSystemTime(new Date(T0));
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
      started_at: '2026-01-01T00:00:05.000Z',
    };
    renderRun();
    await waitFor(() => expect(getEscapeRoomRunState).toHaveBeenCalledTimes(1));

    getEscapeRoomRunState.mockImplementation(() =>
      Promise.resolve({
        ...BASE_STATE,
        mist_distance: 40,
        current_chamber: nextChamber,
        server_now: '2026-01-01T00:00:05.000Z',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(await screen.findByText('換一題了')).toBeInTheDocument();
    expect(screen.queryByText('時間到了，正在判定...')).not.toBeInTheDocument();
  });

  it('#3770 救援題逾時重試是「同一題」(stem 不變) 也要讓倒數重新開始，不能永久卡在「時間到了」', async () => {
    // This is the actual game-academy audit P0-1 shape: `rescue_question`
    // is the SAME static object on every retry — only `started_at` moves.
    // Before #3770's fix, a stem-keyed countdown could never tell this
    // apart from "nothing happened" and stayed stuck at 0 forever.
    const rescueQuestion = {
      chamber_index: null,
      stem: '要用哪一把鑰匙救援隊友？',
      options: [{ key: 'red-key', text: '紅色鑰匙' }, { key: 'blue-key', text: '藍色鑰匙' }],
      seconds: 5,
      extra_time_ms: 0,
      started_at: T0,
    };
    getEscapeRoomRunState.mockImplementation(() =>
      Promise.resolve({ ...BASE_STATE, rescue_question: rescueQuestion, server_now: T0 }),
    );
    renderRun();
    await waitFor(() => expect(getEscapeRoomRunState).toHaveBeenCalledTimes(1));
    // Scoped to the rescue dialog — `current_chamber` behind it shows the
    // same countdown text, so an unscoped query would see two matches.
    const dialog = () => within(screen.getByRole('dialog'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(dialog().getByText(/^剩餘 \d+ 秒$/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await waitFor(() => expect(dialog().getByText('時間到了，正在判定...')).toBeInTheDocument());

    // The server resolved the timeout (same stem, fresh started_at — exactly
    // what `_maybe_expire_rescue` does: reset `frozen_at`, keep the same
    // static rescue question).
    const retryStartedAt = '2026-01-01T00:00:05.500Z';
    getEscapeRoomRunState.mockImplementation(() =>
      Promise.resolve({
        ...BASE_STATE,
        rescue_question: { ...rescueQuestion, started_at: retryStartedAt },
        server_now: retryStartedAt,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    // Must show a FRESH countdown again, not stay stuck on the old message —
    // same stem, same options, only started_at moved. The exact second
    // isn't the point (fake-timer tick granularity makes it off-by-one-ish);
    // "it's counting down again, not stuck" is.
    await waitFor(() => expect(dialog().getByText(/^剩餘 \d+ 秒$/)).toBeInTheDocument());
    expect(dialog().queryByText('時間到了，正在判定...')).not.toBeInTheDocument();
  });
});
