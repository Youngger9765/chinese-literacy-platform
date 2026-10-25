import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AbilityBar from '../../components/escape-room/AbilityBar';
import ChoiceButtons from '../../components/escape-room/ChoiceButtons';
import MistBar from '../../components/escape-room/MistBar';
import TeammateRow from '../../components/escape-room/TeammateRow';
import StemWithTarget from '../../components/live-quiz/StemWithTarget';
import { usePrefersReducedMotion } from '../../components/pk/usePrefersReducedMotion';
import { useAuth } from '../../contexts/AuthContext';
import {
  EscapeRoomApiError,
  getEscapeRoomResult,
  getEscapeRoomRunState,
  submitEscapeRoomAnswer,
  submitEscapeRoomGateAnswer,
  submitEscapeRoomRescue,
  activateEscapeRoomAbility,
  type EscapeRoomAbilityKey,
  type EscapeRoomResult,
  type EscapeRoomRunState,
  type SafeQuestion,
} from '../../services/escapeRoomApi';

function questionTitle(state: EscapeRoomRunState): string {
  if (state.current_chamber) return `第 ${(state.current_chamber.chamber_index ?? 0) + 1} 座機關`;
  return '大門題';
}

function questionKey(question: SafeQuestion | null): string {
  if (!question) return '';
  return `${question.chamber_index ?? 'gate-or-rescue'}:${question.stem}`;
}

// #3754: "這什麼爛題目啊！你要寫清楚你再問哪一個字啊" — `StemWithTarget`
// already bolds/underlines the asked character inline (same mechanism PK/
// team-arena/live-quiz use), but a bare highlighted character with no
// question around it still isn't an unambiguous question. This spells it
// out: "句中的「覺」怎麼唸？". Only zhuyin rounds carry `extra.target_index`
// (vocab/comprehension questions don't) — anything else renders nothing.
function targetCharPrompt(question: SafeQuestion | null): string | null {
  const index = question?.extra?.target_index;
  if (question == null || index == null || index < 0 || index >= question.stem.length) return null;
  return `句中的「${question.stem[index]}」怎麼唸？`;
}

// #3754: "剩餘 0 秒 然後呢？？？？" — once the visible countdown reaches
// zero there must be a definite result, not silence while `ChoiceButtons`
// keeps sitting there waiting for a click. Everything that actually
// RESOLVES a timed-out question lives server-side (`_maybe_expire_current_
// question` in `escape_room/engine.py`, the same lazy no-cron pattern PK's
// `advance_if_needed` uses) — this string is purely the "we're on it"
// acknowledgement shown for however briefly it takes the poll below to
// come back with the resolved state.
function timeRemainingLabel(secondsRemaining: number): string {
  return secondsRemaining > 0 ? `剩餘 ${secondsRemaining} 秒` : '時間到了，正在判定...';
}

const StudentEscapeRoomRun: React.FC = () => {
  const { runId } = useParams<{ runId: string }>();
  const numericRunId = Number(runId);
  const { token } = useAuth();
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  const [state, setState] = useState<EscapeRoomRunState | null>(null);
  const [result, setResult] = useState<EscapeRoomResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [questionStartedAt, setQuestionStartedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  const visibleQuestion = state?.rescue_question ?? state?.current_chamber ?? state?.gate_question ?? null;
  const visibleQuestionKey = questionKey(visibleQuestion);

  useEffect(() => {
    const startedAt = Date.now();
    setQuestionStartedAt(startedAt);
    setNow(startedAt);
    if (!visibleQuestionKey) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visibleQuestionKey]);

  const loadResult = useCallback(async () => {
    if (!token || !Number.isFinite(numericRunId)) return;
    setResult(await getEscapeRoomResult(token, numericRunId));
  }, [numericRunId, token]);

  const loadState = useCallback(async () => {
    if (!token || !Number.isFinite(numericRunId)) return;
    try {
      const nextState = await getEscapeRoomRunState(token, numericRunId);
      setState(nextState);
      if (nextState.status !== 'in_progress') await loadResult();
    } catch (err) {
      setError(err instanceof EscapeRoomApiError ? err.message : '發生錯誤，請稍後再試一次');
    }
  }, [loadResult, numericRunId, token]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const applyState = async (request: () => Promise<EscapeRoomRunState>) => {
    setBusy(true);
    setError('');
    try {
      const nextState = await request();
      setState(nextState);
      if (nextState.status !== 'in_progress') await loadResult();
    } catch (err) {
      setError(err instanceof EscapeRoomApiError ? err.message : '發生錯誤，請稍後再試一次');
    } finally {
      setBusy(false);
    }
  };

  const handleChamberChoice = (choiceKey: string) => {
    if (!token || !state?.current_chamber || state.rescue_question) return;
    void applyState(() => submitEscapeRoomAnswer(token, numericRunId, {
      chamber_index: state.current_chamber?.chamber_index ?? 0,
      choice_key: choiceKey,
    }));
  };

  const handleGateChoice = (choiceKey: string) => {
    if (!token || !state?.gate_question || state.current_chamber || state.rescue_question) return;
    void applyState(() => submitEscapeRoomGateAnswer(token, numericRunId, { choice_key: choiceKey }));
  };

  const handleRescueChoice = (choiceKey: string) => {
    if (!token || !state?.rescue_question) return;
    void applyState(() => submitEscapeRoomRescue(token, numericRunId, { choice_key: choiceKey }));
  };

  const handleAbility = (abilityKey: EscapeRoomAbilityKey) => {
    if (!token || !state || state.rescue_question) return;
    void applyState(() => activateEscapeRoomAbility(token, numericRunId, { ability_key: abilityKey }));
  };

  const secondsRemaining = useMemo(() => {
    if (!visibleQuestion) return null;
    const allowedMs = visibleQuestion.seconds * 1000 + visibleQuestion.extra_time_ms;
    return Math.max(0, Math.ceil((allowedMs - (now - questionStartedAt)) / 1000));
  }, [now, questionStartedAt, visibleQuestion]);

  // #3754: the countdown hitting zero is purely a client-side visual —
  // nobody was asking the server whether the question actually expired, so
  // the screen just sat there forever. Once it hits 0, poll until the
  // server resolves it (its own lazy check runs on every `get_run_state`
  // call) and a new question/state replaces this one. A blocked case (e.g.
  // a rescue dialog covering the real question, or `use_ability` resetting
  // its clock) just makes this poll a harmless no-op until it clears.
  useEffect(() => {
    if (secondsRemaining !== 0) return undefined;
    void loadState();
    const poll = window.setInterval(() => void loadState(), 1000);
    return () => window.clearInterval(poll);
  }, [secondsRemaining, loadState]);

  if (result) {
    const escaped = result.result === 'escaped';
    return (
      <main className="flex min-h-screen items-center justify-center bg-accent-bg px-5 text-center">
        <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-accent">迷城密室</p>
          <h1 className="mt-3 text-3xl font-bold text-on-surface">{escaped ? '你們一起走出迷城了' : '這次沒來得及，再試一次？'}</h1>
          <p className="mt-4 leading-7 text-on-surface-variant">{result.message}</p>
          {escaped && result.unlocked_skins.length > 0 && <p className="mt-5 rounded-xl bg-accent-bg px-4 py-3 text-sm">你解鎖了新的外觀</p>}
          <button type="button" onClick={() => navigate('/escape-room', { replace: true })} className="btn-immersive mt-7 w-full">
            再次探索
          </button>
        </section>
      </main>
    );
  }

  if (!state || state.status !== 'in_progress') {
    return <div className="flex min-h-screen items-center justify-center" role="status" aria-label={error || '正在準備迷城結局'} />;
  }

  const baseQuestion = state.current_chamber ?? state.gate_question;
  const frozenTeammate = state.teammates.find((teammate) => teammate.frozen);

  return (
    <main className="min-h-screen bg-surface pb-24 text-on-surface sm:pb-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
        <MistBar distance={state.mist_distance} reducedMotion={reducedMotion} message={state.mist_message} />
        <TeammateRow teammates={state.teammates} />
        <section className="rounded-3xl bg-white p-5 shadow-sm sm:p-8" aria-live="polite">
          <p className="mb-5 rounded-xl bg-accent-bg px-4 py-3 text-sm text-on-surface-variant">{state.story_intro}</p>
          {baseQuestion ? (
            <>
              <p className="text-sm font-semibold text-accent">{questionTitle(state)}</p>
              <h1 className="mt-3 text-xl font-bold leading-8 sm:text-2xl">
                <StemWithTarget stem={baseQuestion.stem} targetIndex={baseQuestion.extra?.target_index} />
              </h1>
              {targetCharPrompt(baseQuestion) && (
                <p className="mt-2 text-sm font-medium text-accent">{targetCharPrompt(baseQuestion)}</p>
              )}
              {secondsRemaining !== null && (
                <p className="mt-3 text-sm text-on-surface-variant" aria-live="polite">{timeRemainingLabel(secondsRemaining)}</p>
              )}
              <div className="mt-7">
                <ChoiceButtons
                  options={baseQuestion.options}
                  disabled={busy || Boolean(state.rescue_question)}
                  onSelect={state.current_chamber ? handleChamberChoice : handleGateChoice}
                />
              </div>
            </>
          ) : (
            <p className="text-on-surface-variant">正在準備下一道機關</p>
          )}
          {error && <p className="mt-4 text-sm text-error" role="alert">{error}</p>}
        </section>
        <AbilityBar used={state.abilities_used} disabled={busy || Boolean(state.rescue_question)} onUse={handleAbility} />
      </div>
      {state.rescue_question && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="救援題">
          <section className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
            <p className="text-sm font-semibold text-accent">救援題</p>
            <p className="mt-3 text-sm text-on-surface-variant">{frozenTeammate ? '隊友暫時被定住了，答對這題就能把他帶回隊伍' : '答對這題就能救援隊友'}</p>
            <h2 className="mt-4 text-xl font-bold leading-8">
              <StemWithTarget stem={state.rescue_question.stem} targetIndex={state.rescue_question.extra?.target_index} />
            </h2>
            {targetCharPrompt(state.rescue_question) && (
              <p className="mt-2 text-sm font-medium text-accent">{targetCharPrompt(state.rescue_question)}</p>
            )}
            {secondsRemaining !== null && (
              <p className="mt-3 text-sm text-on-surface-variant" aria-live="polite">{timeRemainingLabel(secondsRemaining)}</p>
            )}
            <div className="mt-6"><ChoiceButtons options={state.rescue_question.options} disabled={busy} onSelect={handleRescueChoice} /></div>
          </section>
        </div>
      )}
    </main>
  );
};

export default StudentEscapeRoomRun;
