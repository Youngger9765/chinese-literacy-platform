/**
 * StudentLiveQuizPlay — `/live/:code`, the student's phone screen.
 *
 * Auto-joins on mount (covers both the QR deep-link path and the manual
 * `/live` → confirm → navigate-here path — joining is idempotent
 * server-side either way). Phases: waiting in lobby / reading (stem only,
 * "看大螢幕讀題") / answering (shapes only, no option text) / reveal
 * (✓／✗ + points, never rank) / ended (答對題數 + 進步, never rank).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLiveQuizPoll } from '../../components/live-quiz/useLiveQuizPoll';
import OptionGrid from '../../components/live-quiz/OptionGrid';
import CountdownBar from '../../components/live-quiz/CountdownBar';
import { joinLiveQuizGame, submitLiveQuizAnswer, LiveQuizApiError } from '../../services/liveQuizApi';

const StudentLiveQuizPlay: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { token, user } = useAuth();
  const [joinError, setJoinError] = useState('');
  const [joined, setJoined] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const lastAnsweredRoundRef = useRef<number | null>(null);

  const { state, error: pollError } = useLiveQuizPoll(joined && token ? token : null, joined ? (code ?? null) : null);

  useEffect(() => {
    if (!token || !code) return;
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
