/**
 * StudentLiveQuizPlay — `/live/:code`, the student's phone screen.
 *
 * Auto-joins on mount (covers both the QR deep-link path and the manual
 * `/live` → confirm → navigate-here path — joining is idempotent
 * server-side either way). Phases: waiting in lobby / reading (stem only,
 * "看大螢幕讀題") / answering (shapes only, no option text) / reveal
 * (✓／✗ + this round's points + running total; top 5 see their own rank,
 * 6th place or lower see a signed "前進/後退 N 名" delta instead — never
 * a literal "第 N 名" outside the top 5, see issue #3631 P0 #4) / ended
 * (答對題數 + 進步 vs last game).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLiveQuizPoll } from '../../components/live-quiz/useLiveQuizPoll';
import { useLiveQuizRoundSound } from '../../components/live-quiz/useLiveQuizRoundSound';
import OptionGrid from '../../components/live-quiz/OptionGrid';
import CountdownBar from '../../components/live-quiz/CountdownBar';
import { joinLiveQuizGame, submitLiveQuizAnswer, isValidLiveQuizCode, LiveQuizApiError } from '../../services/liveQuizApi';

const StudentLiveQuizPlay: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { token, user } = useAuth();
  const [joinError, setJoinError] = useState('');
  const [joined, setJoined] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const lastAnsweredRoundRef = useRef<number | null>(null);

  const { state, error: pollError } = useLiveQuizPoll(joined && token ? token : null, joined ? (code ?? null) : null);
  // issue #3631 P0 #6 — called unconditionally before any early return.
  const { muted, toggleMuted } = useLiveQuizRoundSound(state);

  useEffect(() => {
    if (!token || !code) return;
    // A route param is a raw URL segment a caller controls completely (QR
    // deep-link, bookmarked URL, hand-typed address bar) — reject anything
    // that isn't the 6-digit shape BEFORE it ever reaches the API client,
    // so a crafted `/live/..%2F..%2Fsomething` link can never turn into a
    // request against some other endpoint carrying this student's token.
    if (!isValidLiveQuizCode(code)) {
      setJoinError('找不到這場搶答');
      return;
    }
    joinLiveQuizGame(token, code)
      .then(() => setJoined(true))
      .catch((err) => {
        setJoinError(
          err instanceof LiveQuizApiError
            ? err.status === 403
              ? '主持人無法加入自己的場次'
              : err.message
            : '加入失敗，請確認代碼是否正確',
        );
      });
  }, [token, code]);

  // Reset local "selected" state whenever the round changes so a stale
  // highlight from the previous question never bleeds into the next one.
  // Depend on the primitive round_index (not `state`) so eslint's
  // exhaustive-deps is satisfied without re-running this on every poll tick
  // that doesn't change the round.
  const roundIndex = state?.round_index;
  useEffect(() => {
    if (roundIndex != null && lastAnsweredRoundRef.current !== roundIndex) {
      setSelectedKey(null);
      setSubmitError('');
    }
  }, [roundIndex]);

  const handleSelect = async (key: string) => {
    if (!token || !code || selectedKey) return; // first-answer-only, client-side mirror of the server rule
    setSelectedKey(key);
    lastAnsweredRoundRef.current = state?.round_index ?? null;
    try {
      await submitLiveQuizAnswer(token, code, { choice_key: key });
    } catch (err) {
      setSubmitError(err instanceof LiveQuizApiError ? err.message : '送出失敗，請重試');
    }
  };

  if (joinError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">{joinError}</p>
      </div>
    );
  }

  if (!joined || (!state && !pollError)) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="載入中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">{pollError}</p>
      </div>
    );
  }

  const round = state.round;
  const yourPlayer = state.your_player;

  return (
    <div className="flex min-h-screen flex-col bg-surface px-5 py-6">
      {/* issue #3631 P0 #6 — same shared mute toggle/storage as the host's
          projector screen and the #3630 podium (liveQuizRoundSound.ts). */}
      {state.status !== 'ended' && (
        <button
          type="button"
          onClick={toggleMuted}
          aria-pressed={muted}
          aria-label={muted ? '開啟音效' : '關閉音效'}
          className="fixed right-3 top-3 z-40 rounded-full border border-surface-dim bg-white/90 px-2.5 py-1 text-sm shadow"
        >
          {muted ? '🔇' : '🔊'}
        </button>
      )}
      {pollError && (
        <div className="mb-3 rounded-lg bg-surface-container-low px-3 py-2 text-center text-xs text-on-surface-variant">
          連線中斷，正在重新連線…（你的作答會在重新連線後送出）
        </div>
      )}

      {state.status === 'lobby' && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-lg font-medium text-on-surface">等待老師開始…</p>
          <p className="mt-1 text-sm text-on-surface-variant">你好，{user?.name ?? '同學'}</p>
        </div>
      )}

      {state.status === 'question' && round && (
        <div className="flex flex-1 flex-col items-center justify-center">
          {!round.options ? (
            <p className="text-center text-lg font-medium text-accent">看大螢幕讀題</p>
          ) : yourPlayer && !yourPlayer.eligible ? (
            <p className="text-center text-sm text-on-surface-variant">這一題在你加入之前就開始了，下一題見</p>
          ) : (
            <>
              {state.answer_open_at && (
                <div className="mb-6 w-full max-w-xs">
                  <CountdownBar answerOpenAt={state.answer_open_at} seconds={round.seconds} serverNow={state.server_now} mode="player" />
                </div>
              )}
              <OptionGrid
                options={round.options}
                mode="player"
                selectedKey={selectedKey}
                onSelect={(key) => void handleSelect(key)}
                disabled={!!selectedKey}
              />
              {selectedKey && <p className="mt-4 text-sm text-on-surface-variant">已送出，等待揭曉…</p>}
              {submitError && <p className="mt-2 text-sm text-error">{submitError}</p>}
            </>
          )}
        </div>
      )}

      {state.status === 'reveal' && round && yourPlayer && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          {yourPlayer.last_answer_correct == null ? (
            <>
              <span className="text-5xl" aria-hidden="true">⏳</span>
              <p className="mt-3 text-lg font-medium text-on-surface-variant">未參加這一題</p>
            </>
          ) : yourPlayer.last_answer_correct ? (
            <>
              <span className="text-6xl" aria-hidden="true">✓</span>
              <p className="mt-3 text-xl font-bold text-[#15803D]">答對了！</p>
              {yourPlayer.last_answer_points != null && (
                <p className="mt-1 text-sm text-on-surface-variant">+{yourPlayer.last_answer_points} 分</p>
              )}
            </>
          ) : (
            <>
              <span className="text-6xl" aria-hidden="true">✗</span>
              <p className="mt-3 text-xl font-bold text-on-surface">答錯了</p>
            </>
          )}
          {/* issue #3631 P0 #4: running total always shown (unless practice
              mode, where the backend omits these fields entirely); top 5
              see their actual rank, everyone else sees a signed
              前進/後退 delta instead — never "第 N 名" outside the top 5. */}
          {yourPlayer.total_score != null && (
            <p className="mt-4 text-sm text-on-surface-variant">總分 {yourPlayer.total_score} 分</p>
          )}
          {yourPlayer.rank != null ? (
            <p className="mt-1 text-sm font-medium text-accent">目前第 {yourPlayer.rank} 名</p>
          ) : (
            yourPlayer.rank_delta != null && (
              <p className="mt-1 text-sm font-medium text-accent">
                {yourPlayer.rank_delta > 0
                  ? `這題前進了 ${yourPlayer.rank_delta} 名`
                  : yourPlayer.rank_delta < 0
                    ? `這題後退了 ${Math.abs(yourPlayer.rank_delta)} 名`
                    : '名次不變'}
              </p>
            )
          )}
        </div>
      )}

      {state.status === 'ended' && yourPlayer && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="mb-2 text-lg font-bold text-on-surface">
            {state.ended_by_host ? '老師提前結束了這場課堂搶答' : '課堂搶答結束！'}
          </p>
          <p className="mb-1 text-4xl font-bold text-accent">{yourPlayer.correct_count}</p>
          <p className="text-sm text-on-surface-variant">題答對</p>
          {yourPlayer.previous_game_correct_count != null && (
            <p className="mt-4 text-sm text-on-surface-variant">
              {yourPlayer.improved
                ? `比上一場進步了（上一場答對 ${yourPlayer.previous_game_correct_count} 題）`
                : yourPlayer.improved === false
                  ? `上一場答對 ${yourPlayer.previous_game_correct_count} 題，繼續加油`
                  : null}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default StudentLiveQuizPlay;
