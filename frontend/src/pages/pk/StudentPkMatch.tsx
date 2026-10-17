/**
 * StudentPkMatch — `/pk/match/:matchId` (PRD §3.1 steps 5-8, §3.3, §9.2).
 *
 * Phase machine: 'vs' -> (AI only) 'intro' -> 'battle' -> 'result'.
 *
 * CRITICAL: polling (usePkMatchPoll) only starts once `phase === 'battle'`
 * — engine.py's `advance_if_needed` lazily starts round 1's clock on the
 * FIRST real `/state` call after match creation specifically so the VS
 * screen and figure intro never eat into the 20s answer window (PRD
 * §10.1). Polling early here would silently reintroduce that bug from the
 * frontend side even though the backend fix is correct.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePkMatchPoll } from '../../components/pk/usePkMatchPoll';
import PkVsScreen from '../../components/pk/PkVsScreen';
import PkFigureIntro from '../../components/pk/PkFigureIntro';
import PkCountdownRing from '../../components/pk/PkCountdownRing';
import PkOptionButtons from '../../components/pk/PkOptionButtons';
import PkScoreBar from '../../components/pk/PkScoreBar';
import PkComboBadge, { computeCombo, type PkAnswerLite } from '../../components/pk/PkComboBadge';
import PkResultScreen from '../../components/pk/PkResultScreen';
import PkFigurePortrait from '../../components/pk/PkFigurePortrait';
import { resolveAiExpression } from '../../components/pk/pkExpression';
import { getPkFigure, pkFigureAssetPath } from '../../data/pkFigures';
import { getPkMatchResult, submitPkAnswer, PkApiError, type PkMatchResult } from '../../services/pkApi';

// Scene-slot note (2026-10-16, Young): a separate design doc for a 2D
// story mode (NPC dialogue scenes) for AI PK is being written. This agent
// does NOT build that mode -- but the two insertion points are:
//   (1) pre-match scene : between 'vs' and 'battle' (same slot 'intro'
//       already occupies for the AI figure bio animation -- a story-mode
//       encounter scene would be a sibling phase inserted here, or a
//       generalization of 'intro', not a rewrite of this state machine)
//   (2) post-match scene: between 'battle' and 'result' (insert a new
//       phase before setPhase('result') is called, once `result` has been
//       fetched -- the data is already available at that point)
// Nothing below is built for this yet; this comment exists so the slot is
// easy to find when that design lands.
type Phase = 'vs' | 'intro' | 'battle' | 'result';

interface LocationState {
  opponentType?: 'ai' | 'player';
  tier?: number;
  firstTime?: boolean;
}

const MAX_SCORE = 5000; // PRD §4: 5 題 x 1000 分滿分

/**
 * #3602 "also": a zhuyin round's stem is a plain sentence containing the
 * asked character somewhere in it (backend's extra.target_index, a
 * character offset — see live_quiz/sources/zhuyin.py) with no visual
 * marker at all for which character is being asked about -- staging QA:
 * "畫面上看不到問的是「適」還是「的」...學生沒辦法作答". Bold + underline the
 * target character inline, same span otherwise unstyled.
 */
function renderStemWithTarget(stem: string, targetIndex?: number | null): React.ReactNode {
  if (targetIndex == null || targetIndex < 0 || targetIndex >= stem.length) return stem;
  return (
    <>
      {stem.slice(0, targetIndex)}
      <span className="font-bold text-accent underline underline-offset-2">{stem[targetIndex]}</span>
      {stem.slice(targetIndex + 1)}
    </>
  );
}

const StudentPkMatch: React.FC = () => {
  const { matchId } = useParams<{ matchId: string }>();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = (location.state as LocationState) ?? {};

  // No location.state (e.g. a hard page reload mid-match) -> resume
  // straight into battle, since the clock is already lazily running.
  const [phase, setPhase] = useState<Phase>(locState.opponentType ? 'vs' : 'battle');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<PkMatchResult | null>(null);
  const [resultError, setResultError] = useState('');
  const myRevealedAnswersRef = useRef<PkAnswerLite[]>([]);
  const [comboTick, setComboTick] = useState(0);

  const numericMatchId = matchId ? Number(matchId) : null;
  const { state, error: pollError } = usePkMatchPoll(
    token && phase === 'battle' ? token : null,
    phase === 'battle' ? numericMatchId : null,
  );

  const aiFigure = locState.opponentType === 'ai' && locState.tier != null ? getPkFigure(locState.tier) : null;

  // Reset the "already selected" local state whenever the round changes.
  const roundIndex = state?.round_index;
  useEffect(() => {
    setSelectedKey(null);
    setSubmitError('');
  }, [roundIndex]);

  // Accumulate MY revealed-round results for the client-only combo counter
  // (PRD §3.3: "連擊數純前端計算" — the server has no running-streak field).
  const revealing = state?.revealing;
  useEffect(() => {
    if (!state?.round || !revealing || !state.round.my_answered) return;
    const already = myRevealedAnswersRef.current.some((a) => a.round_index === state.round_index);
    if (already) return;
    const isCorrect = state.round.my_choice_key != null && state.round.my_choice_key === state.round.correct_key;
    myRevealedAnswersRef.current = [...myRevealedAnswersRef.current, { round_index: state.round_index, is_correct: isCorrect }];
    setComboTick((t) => t + 1);
    // Depend on the primitives (round_index/revealing), not the `state`
    // object itself -- `state` is a fresh object on every 1s poll tick even
    // when nothing meaningful changed (same pattern as live-quiz's
    // StudentLiveQuizPlay.tsx), so including it would re-run this on every
    // poll instead of only when a round actually gets revealed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.round_index, revealing]);

  // Transition to the result screen once the backend reports completion.
  useEffect(() => {
    if (state?.status === 'completed' && token && numericMatchId && phase !== 'result') {
      getPkMatchResult(token, numericMatchId)
        .then((r) => {
          setResult(r);
          setPhase('result');
        })
        .catch((err) => setResultError(err instanceof PkApiError ? err.message : '載入結果失敗'));
    }
  }, [state?.status, token, numericMatchId, phase]);

  const handleSelect = async (key: string) => {
    if (!token || !numericMatchId || selectedKey || revealing) return;
    setSelectedKey(key);
    try {
      await submitPkAnswer(token, numericMatchId, key);
    } catch (err) {
      setSubmitError(err instanceof PkApiError ? err.message : '送出失敗，請重試');
    }
  };

  const combo = computeCombo(myRevealedAnswersRef.current);
  void comboTick; // referenced only to force a re-render when the ref updates

  if (phase === 'vs') {
    const opponentName = locState.opponentType === 'ai' ? aiFigure?.name ?? 'AI' : '同學';
    return (
      <PkVsScreen
        myName={user?.name ?? '你'}
        opponentName={opponentName}
        // #3602 B5: moved off /pk/figures to avoid colliding with this SPA's own /pk route
        opponentAvatarUrl={aiFigure ? pkFigureAssetPath(aiFigure.tier, 'portrait-idle.svg') : undefined}
        opponentIsAi={locState.opponentType === 'ai'}
        opponentTier={locState.tier}
        onDone={() => setPhase(locState.opponentType === 'ai' ? 'intro' : 'battle')}
      />
    );
  }

  if (phase === 'intro' && aiFigure) {
    return <PkFigureIntro figure={aiFigure} firstTime={!!locState.firstTime} onDone={() => setPhase('battle')} />;
  }

  if (phase === 'result' && result) {
    return (
      <PkResultScreen
        result={result}
        onRematch={() => navigate(-1)}
        onChangeOpponent={() => navigate('/pk', { replace: true })}
        onBack={() => navigate('/pk', { replace: true })}
      />
    );
  }

  // --- battle phase ---
  if (resultError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">{resultError}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="載入中">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent" />
      </div>
    );
  }

  const round = state.round;
  const isLastRound = state.round_index === state.rounds_total - 1;
  // PK gamification MVP (launch-plan, 2026-10-17): the figure used to be
  // derived ONLY from location.state.tier (set by whoever navigated here),
  // so a hard page reload mid-match (no location.state — see this file's
  // header comment on the `phase` initial value) silently lost track of
  // which AI the student was fighting, and both the small score-bar avatar
  // and the new large portrait panel below would disappear. The /state poll
  // itself already carries `bot_tier` (null for a human match), so prefer
  // that — it's authoritative and survives a reload; locState.tier only
  // matters before the first poll response exists (the 'vs'/'intro' phases
  // above, which run before polling starts).
  const battleAiTier = state.bot_tier ?? aiFigure?.tier ?? null;
  const battleAiFigure = battleAiTier != null ? getPkFigure(battleAiTier) : null;
  // #3602 B6: drive the opponent's portrait off the backend-computed
  // ai_expression (PRD §10.5.3) instead of always showing portrait-idle —
  // resolveAiExpression defaults to 'idle' for a human match (ai_expression
  // is null, §8.2 — no figure to react) or an unrecognized wire value.
  const battleAiExpression = resolveAiExpression(state.ai_expression);
  const opponentAvatarUrl = battleAiFigure ? pkFigureAssetPath(battleAiFigure.tier, `portrait-${battleAiExpression}.svg`) : undefined;

  return (
    <div className="flex min-h-screen flex-col bg-surface px-5 py-6">
      {pollError && (
        <div className="mb-3 rounded-lg bg-surface-container-low px-3 py-2 text-center text-xs text-on-surface-variant">
          連線中斷，正在重新連線…
        </div>
      )}

      {/* PK gamification MVP: the AI used to only ever show up as the 8x8px
          avatar next to its score bar below — at battle scale that's nearly
          invisible, which is a big part of why this screen read as "a form"
          rather than a fight against a character. This panel is the large,
          expression-switching portrait PRD §3.3/§10.5.3 asks for; the small
          score-bar avatar stays too (useful as a compact "whose turn" cue
          right next to the number), the two aren't redundant at this size
          difference. */}
      {battleAiFigure && (
        <div className="mb-3 flex justify-center">
          <div className="relative flex h-28 w-24 items-end justify-center overflow-hidden rounded-2xl bg-gradient-to-b from-accent-bg/70 to-transparent sm:h-36 sm:w-32 md:h-44 md:w-40">
            <PkFigurePortrait
              tier={battleAiFigure.tier}
              expression={battleAiExpression}
              name={battleAiFigure.name}
              className="h-full w-full object-contain"
            />
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">
              {battleAiFigure.name}・Lv.{battleAiFigure.tier}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 mb-4">
        <PkScoreBar label={state.my_name ?? '你'} score={state.my_score} maxScore={MAX_SCORE} colorClass="bg-accent" />
        <PkScoreBar
          label={state.opponent_name ?? aiFigure?.name ?? '對手'}
          score={state.opponent_score}
          maxScore={MAX_SCORE}
          colorClass="bg-tertiary-container"
          isAi={state.opponent_type === 'AI'}
          avatarUrl={opponentAvatarUrl}
        />
      </div>

      <div className="flex items-center justify-between mb-2">
        <span
          className={[
            'text-sm font-medium text-on-surface-variant',
            isLastRound ? 'rounded-full bg-tertiary-container px-3 py-1 font-bold text-tertiary' : '',
          ].join(' ')}
        >
          第 {state.round_index + 1} / {state.rounds_total} 題{isLastRound ? '・最後一題！' : ''}
        </span>
        <PkComboBadge combo={combo} />
      </div>

      {round && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          {!revealing && state.round_started_at && (
            <PkCountdownRing roundStartedAt={state.round_started_at} seconds={round.seconds} serverNow={state.server_now} />
          )}

          {/* PK gamification MVP: wrap the stem in a visible card instead of
              bare text floating on the page background — PRD §16.5/§18 #9
              asks for a "clearly readable question card" at 390px, and a
              card is also a basic game-UI affordance a plain <p> isn't. */}
          <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest px-5 py-4 shadow-sm">
            <p className="text-center text-lg font-medium text-on-surface">
              {renderStemWithTarget(round.stem, round.extra?.target_index)}
            </p>
          </div>

          <PkOptionButtons
            options={round.options}
            selectedKey={round.my_choice_key ?? selectedKey}
            correctKey={revealing ? round.correct_key : undefined}
            disabled={!!round.my_choice_key || !!selectedKey || !!revealing}
            onSelect={(key) => void handleSelect(key)}
          />

          {submitError && <p className="text-sm text-error">{submitError}</p>}
          {revealing && (
            <p className="text-sm text-on-surface-variant">
              {round.my_choice_key === round.correct_key ? '答對了！' : '答錯了，下一題加油！'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default StudentPkMatch;
