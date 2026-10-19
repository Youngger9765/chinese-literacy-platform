/**
 * StudentTeamArenaPlay — `/team-arena/:code`, the student's phone screen
 * (issue #3632, PRD §6 "學生手機").
 *
 * Auto-joins on mount (idempotent server-side, same pattern as
 * StudentLiveQuizPlay.tsx). Phases follow `state.own_match`/`state.status`:
 * lobby (waiting for teams, then lane self-claim) → playing (reading /
 * answering as 上場 or 助攻 / revealed) → paused → ended (fetches result).
 *
 * "答對/答錯" after reveal is derived CLIENT-SIDE by comparing the locally
 * remembered `selectedKey` against the now-visible `payload.correct_key`
 * — the server's submit-answer ack never reveals correctness (PRD §3.4:
 * "每回合結束...不公開對錯" until reveal), and `own_match` has no separate
 * "was I right" field, so this comparison is the one place that
 * information can legitimately surface, using only already-public data.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTeamArenaPoll } from '../../components/team-arena/useTeamArenaPoll';
import {
  joinTeamArenaSession,
  claimTeamArenaLane,
  submitTeamArenaAnswer,
  getTeamArenaResult,
  isUnchangedState,
  teamArenaMyOutcome,
  TeamArenaApiError,
  TEAM_ARENA_LANE_LABELS,
  TEAM_ARENA_PRIMARY_LANES,
  type TeamArenaLane,
  type TeamArenaResult,
} from '../../services/teamArenaApi';

function isValidTeamArenaCode(code: string | undefined): code is string {
  return !!code && /^[A-Z0-9]{4,8}$/.test(code);
}

const StudentTeamArenaPlay: React.FC = () => {
  const { code: routeCode } = useParams<{ code: string }>();
  const { token } = useAuth();
  const [joinError, setJoinError] = useState('');
  const [joined, setJoined] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [laneError, setLaneError] = useState('');
  const [result, setResult] = useState<TeamArenaResult | null>(null);
  const lastAnsweredTurnRef = useRef<number | null>(null);

  const codeValid = isValidTeamArenaCode(routeCode);
  const { state, error: pollError } = useTeamArenaPoll(token ?? null, joined && codeValid ? routeCode : null);

  useEffect(() => {
    if (!token || !routeCode) return;
    if (!codeValid) {
      setJoinError('找不到這場比賽');
      return;
    }
    joinTeamArenaSession(token, routeCode)
      .then(() => setJoined(true))
      .catch((err) => {
        setJoinError(err instanceof TeamArenaApiError ? err.message : '加入失敗，請確認代碼是否正確');
      });
  }, [token, routeCode, codeValid]);

  const ownMatch = state && !isUnchangedState(state) && 'own_match' in state ? state.own_match : null;
  const currentRound = ownMatch?.current_round ?? null;
  const turnNo = currentRound?.turn_no;

  useEffect(() => {
    if (turnNo != null && lastAnsweredTurnRef.current !== turnNo) {
      setSelectedKey(null);
      setSubmitError('');
    }
  }, [turnNo]);

  useEffect(() => {
    if (state && !isUnchangedState(state) && state.status === 'ended' && token && routeCode && !result) {
      getTeamArenaResult(token, routeCode)
        .then(setResult)
        .catch(() => {
          /* ownMatch summary already shows the per-match outcome */
        });
    }
  }, [state, token, routeCode, result]);

  const handleAnswer = async (key: string) => {
    if (!token || !routeCode || selectedKey) return;
    setSelectedKey(key);
    lastAnsweredTurnRef.current = turnNo ?? null;
    setSubmitError('');
    try {
      await submitTeamArenaAnswer(token, routeCode, key);
    } catch (err) {
      setSubmitError(err instanceof TeamArenaApiError ? err.message : '送出失敗，請重試');
    }
  };

  const handleClaimLane = async (lane: TeamArenaLane) => {
    if (!token || !routeCode) return;
    setLaneError('');
    try {
      await claimTeamArenaLane(token, routeCode, lane);
    } catch (err) {
      setLaneError(err instanceof TeamArenaApiError ? err.message : '選擇失敗，請重試');
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

  if (!state || isUnchangedState(state)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">{pollError ?? '載入中…'}</p>
      </div>
    );
  }

  if (state.status === 'lobby') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10 text-center">
        {!ownMatch ? (
          <p className="text-on-surface-variant">等待老師分隊…</p>
        ) : (
          <>
            <p className="mb-1 text-lg font-bold text-on-surface">我的路線：{TEAM_ARENA_LANE_LABELS[ownMatch.my_lane]}</p>
            <p className="mb-6 text-sm text-on-surface-variant">還可以換一條路線（先選先得）</p>
            <div className="grid w-full max-w-xs grid-cols-2 gap-2">
              {TEAM_ARENA_PRIMARY_LANES.map((lane) => (
                <button
                  key={lane}
                  type="button"
                  onClick={() => handleClaimLane(lane)}
                  className={`rounded-lg border px-3 py-3 text-sm font-semibold ${
                    ownMatch.my_lane === lane
                      ? 'border-accent bg-accent-bg text-accent'
                      : 'border-surface-dim text-on-surface-variant'
                  }`}
                >
                  {TEAM_ARENA_LANE_LABELS[lane]}
                </button>
              ))}
            </div>
            {laneError && <p className="mt-3 text-sm text-red-600">{laneError}</p>}
            <p className="mt-6 text-sm text-on-surface-variant">等老師按下「開始比賽」</p>
          </>
        )}
      </div>
    );
  }

  if (state.status === 'paused') {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">老師暫停了比賽，請稍候</p>
      </div>
    );
  }

  if (state.status === 'ended') {
    const me = result?.me;
    const outcome = ownMatch ? teamArenaMyOutcome(ownMatch) : null;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10 text-center">
        <h1 className="mb-4 text-xl font-bold text-on-surface">比賽結束</h1>
        {outcome && (
          <p className="mb-4 text-base font-semibold text-accent">
            {outcome === 'draw' ? '平手' : outcome === 'win' ? '你的隊伍獲勝！' : '你的隊伍差一點，下次再加油'}
          </p>
        )}
        {me && (
          <div className="rounded-xl border border-surface-dim bg-white p-4 text-sm text-on-surface">
            <p>上場次數：{me.turns_played}</p>
            <p>推倒塔數：{me.towers_knocked}</p>
            <p>助攻次數：{me.assists}</p>
          </div>
        )}
      </div>
    );
  }

  // status === 'playing'
  if (!ownMatch) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">你不在這場比賽的名單裡</p>
      </div>
    );
  }

  const payload = currentRound?.payload;
  const options = payload?.options;
  const answered = selectedKey != null;
  const revealed = !!currentRound?.revealed;
  const wasCorrect = revealed && answered && payload?.correct_key != null ? selectedKey === payload.correct_key : null;

  return (
    <div className="flex min-h-screen flex-col bg-surface px-5 py-6">
      <div className="mb-3 flex gap-1">
        {TEAM_ARENA_PRIMARY_LANES.map((lane) => (
          <div key={lane} className="flex-1 rounded bg-surface-container p-1 text-center text-[10px]">
            {TEAM_ARENA_LANE_LABELS[lane]}
            <div className="font-bold">{ownMatch.towers_down?.[lane] ?? 0}/2</div>
          </div>
        ))}
      </div>

      {ownMatch.match_status === 'ended' ? (
        // My match already ended (base conquered) while the session/other
        // matches continue — show the outcome now instead of waiting
        // forever for a "next round" that will never come for this match.
        <p className="text-center text-base font-semibold text-accent">
          {(() => {
            const outcome = teamArenaMyOutcome(ownMatch);
            return outcome === 'draw' ? '平手' : outcome === 'win' ? '你的隊伍獲勝！' : '你的隊伍差一點，下次再加油';
          })()}
        </p>
      ) : !currentRound ? (
        <p className="text-center text-on-surface-variant">等待下一回合…</p>
      ) : (
        <>
          <p className="mb-2 text-sm font-semibold text-accent">
            {ownMatch.am_i_active ? '輪到你了！' : '隊友作答中，你可以助攻'}
          </p>
          <p className="mb-6 text-lg font-medium text-on-surface">{payload?.stem}</p>

          {!options ? (
            <p className="text-center text-on-surface-variant">請先仔細讀題目，稍後選項才會出現</p>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {options.map((opt) => {
                const isSelected = selectedKey === opt.key;
                const isCorrectChoice = revealed && payload?.correct_key === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={answered}
                    onClick={() => handleAnswer(opt.key)}
                    className={`rounded-xl border-2 px-4 py-3 text-left text-base ${
                      isCorrectChoice
                        ? 'border-green-500 bg-green-50'
                        : isSelected
                          ? 'border-accent bg-accent-bg'
                          : 'border-surface-dim bg-white'
                    } disabled:opacity-70`}
                  >
                    <span className="mr-2 font-bold">{opt.key}</span>
                    {opt.text}
                  </button>
                );
              })}
            </div>
          )}

          {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}
          {revealed && answered && wasCorrect != null && (
            <p className={`mt-4 text-center text-base font-semibold ${wasCorrect ? 'text-green-600' : 'text-on-surface-variant'}`}>
              {wasCorrect ? (ownMatch.am_i_active ? '答對了！推倒一座塔' : '你也答對了，助攻 +1') : '這題沒有推進，正解是 ' + payload?.correct_key}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default StudentTeamArenaPlay;
