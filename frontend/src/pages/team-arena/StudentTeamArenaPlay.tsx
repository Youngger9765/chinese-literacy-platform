/**
 * StudentTeamArenaPlay — `/team-arena/:code`, v2 (issue #3632, PRD §0 v2
 * 改版). Every player — including the host — lands here; the host is
 * simply the student who also sees the room code and a Start button.
 *
 * Join flow: if the URL carries `?side=a|b` (set by StudentTeamArenaJoin
 * when a student types in a code), auto-join with that side on mount —
 * idempotent server-side if already seated (rejoin after refresh/sleep).
 * Arriving WITHOUT a `?side` (host coming straight from "開房", or a bare
 * shared link) skips the join call and polls state directly; a stranger
 * hitting a bare link gets an inline "選哪一隊" picker the first time
 * `/state` 403s them (PRD rule C: "學生加入時自己選隊" — this is the
 * fallback entry for that same choice, not a second code path).
 *
 * Attack animations (PRD rule N) are derived PURELY from the public
 * `sides` summary (towers_destroyed/current_hp/base_destroyed deltas
 * between polls, see detectSideEvents.ts) — never from a per-round
 * payload — so every viewer (both sides, the host) sees them identically
 * without leaking which question was answered or by whom.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTeamArenaPoll } from '../../components/team-arena/useTeamArenaPoll';
import GameResultActions from '../../components/game/GameResultActions';
import StemWithTarget from '../../components/live-quiz/StemWithTarget';
import AttackAnimation from '../../components/team-arena/AttackAnimation';
import { TowerCollapse, VictoryBurst } from '../../components/team-arena/TowerCollapse';
import { pickAttackVariant, type AttackVariant } from '../../components/team-arena/attackAnimations';
import { detectSideEvents, type SideSnapshot } from '../../components/team-arena/detectSideEvents';
import {
  joinTeamArenaSession,
  controlTeamArena,
  submitTeamArenaAnswer,
  submitTeamArenaWeapon,
  submitTeamArenaSuggestion,
  getTeamArenaResult,
  getTeamArenaState,
  isUnchangedState,
  teamArenaMyOutcome,
  TeamArenaApiError,
  TEAM_ARENA_WEAPON_LABELS,
  type TeamArenaSide,
  type TeamArenaWeapon,
  type TeamArenaResult,
  type TeamArenaStoryView,
} from '../../services/teamArenaApi';

// #3772 (game-academy audit r2 P1-1): the backend already carries a full
// themed narrative (story_adapter.py) — team labels like 探書隊／尋光隊
// instead of the generic 甲隊／乙隊, and a per-outcome sentence instead of
// a flat "平手"/"你的隊伍獲勝！". `team_labels` is NEVER null/empty — even
// that adapter's own exception-fallback path still returns two real
// strings (青隊/橙隊), so there's no "undefined label" case to guard here;
// this screen's hardcoded 甲隊/乙隊 was simply never updated to read it.
function teamLabel(story: TeamArenaStoryView, side: TeamArenaSide): string {
  return story.team_labels[side === 'a' ? 0 : 1];
}

function resultCopy(story: TeamArenaStoryView, outcome: 'win' | 'lose' | 'draw' | null): string {
  return outcome ? story.result_copy[outcome] : '';
}

function isValidTeamArenaCode(code: string | undefined): code is string {
  return !!code && /^[A-Z0-9]{4,8}$/.test(code);
}

// Mirrors services/team_arena/weapons.py::MIN_OPTIONS_TO_ELIMINATE (PRD
// rule I) -- a client-side copy, not a shared import (backend/frontend
// don't share a types package here), so greying the button out matches
// exactly what the server would otherwise 409 on.
const MIN_OPTIONS_TO_ELIMINATE = 3;
// Mirrors services/team_arena/towers.py::TOWER_COUNT (PRD rule L) --
// display-only, same "no shared types package" reasoning as above.
const TOWER_COUNT = 3;

type VisualEffect =
  | { kind: 'attack'; side: TeamArenaSide; variant: AttackVariant; then?: 'collapse' | 'victory' }
  | { kind: 'collapse'; side: TeamArenaSide }
  | { kind: 'victory'; side: TeamArenaSide };

// `sides[side].towers_destroyed` is how many of THAT side's OWN towers
// have fallen (it is damage TAKEN by that side, not dealt by it) -- a
// bare "N/3 座塔" next to a team's own label reads backwards (team-lead
// review of #3655 staging screenshots, 2026-10-20: 甲隊 personally
// destroyed 3 of 乙隊's towers, each player's highlight said so, but the
// panel labelled 甲隊 showed "0/3 座塔"). Every caller must show BOTH an
// offense count (towers this side knocked down = the OTHER side's
// towers_destroyed) and a defense count (towers this side has left).
const SideBar: React.FC<{
  label: string;
  sideData: { towers_destroyed: number; current_hp: number; seated: number; team_size: number };
  opponentTowersDestroyed: number;
  effect: VisualEffect | null;
  onEffectComplete: () => void;
}> = ({ label, sideData, opponentTowersDestroyed, effect, onEffectComplete }) => (
  <div data-testid={`side-bar-${label}`} className="relative flex-1 rounded-xl border border-surface-dim bg-surface-container p-3 text-center overflow-hidden">
    <p className="text-xs font-semibold text-on-surface-variant">{label}</p>
    <p className="text-sm font-bold text-on-surface">已打倒對方 {opponentTowersDestroyed} 座塔</p>
    <p className="text-xs text-on-surface-variant">我方剩 {TOWER_COUNT - sideData.towers_destroyed} 座塔</p>
    <div className="mt-1 h-2 w-full rounded-full bg-surface-dim">
      <div
        className="h-2 rounded-full bg-accent transition-all"
        style={{ width: `${Math.max(0, Math.min(100, sideData.current_hp))}%` }}
      />
    </div>
    <p className="mt-1 text-[10px] text-on-surface-variant">
      {sideData.seated}/{sideData.team_size} 人
    </p>
    {effect?.kind === 'attack' && <AttackAnimation variant={effect.variant} onComplete={onEffectComplete} />}
    {effect?.kind === 'collapse' && <TowerCollapse onComplete={onEffectComplete} />}
    {effect?.kind === 'victory' && <VictoryBurst onComplete={onEffectComplete} />}
  </div>
);

const StudentTeamArenaPlay: React.FC = () => {
  const { code: routeCode } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [joinError, setJoinError] = useState('');
  const [joinAttempted, setJoinAttempted] = useState(false);
  const [pendingSidePick, setPendingSidePick] = useState(false);
  const [sidePickError, setSidePickError] = useState('');

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [weaponError, setWeaponError] = useState('');
  const [weaponBusy, setWeaponBusy] = useState<TeamArenaWeapon | null>(null);
  const [result, setResult] = useState<TeamArenaResult | null>(null);
  const [startError, setStartError] = useState('');

  const lastAnsweredTurnRef = useRef<number | null>(null);
  const prevSidesRef = useRef<Record<TeamArenaSide, SideSnapshot> | null>(null);
  const lastAttackVariantRef = useRef<AttackVariant | null>(null);
  const [effects, setEffects] = useState<Partial<Record<TeamArenaSide, VisualEffect>>>({});

  const codeValid = isValidTeamArenaCode(routeCode);
  const sideParam = searchParams.get('side');

  const { state, error: pollError } = useTeamArenaPoll(
    token ?? null,
    joinAttempted && codeValid ? routeCode : null,
  );

  // Initial join. Two entry shapes:
  //  - URL carries `?side=a|b` (StudentTeamArenaJoin's flow): join with
  //    that side immediately. Idempotent server-side if already seated.
  //  - Bare link (host coming from "開房", or a shared URL with no side
  //    param): probe membership with one direct `/state` call. A host or
  //    already-seated student gets a real state back and polling starts
  //    normally; a stranger gets a 403 (checked by STATUS CODE, never by
  //    matching the error string -- teamArenaApi.ts deliberately replaces
  //    any non-Chinese server detail with a generic message, so string
  //    sniffing here would silently stop working) and sees the inline
  //    side-picker instead (PRD rule C: "學生加入時自己選隊").
  useEffect(() => {
    if (!token || !routeCode) return;
    if (!codeValid) {
      setJoinError('找不到這場比賽');
      return;
    }
    if (sideParam === 'a' || sideParam === 'b') {
      joinTeamArenaSession(token, routeCode, sideParam)
        .then(() => setJoinAttempted(true))
        .catch((err) => {
          setJoinError(err instanceof TeamArenaApiError ? err.message : '加入失敗，請確認代碼是否正確');
        });
      return;
    }
    getTeamArenaState(token, routeCode)
      .then(() => setJoinAttempted(true))
      .catch((err) => {
        if (err instanceof TeamArenaApiError && err.status === 403) {
          setPendingSidePick(true);
          return;
        }
        setJoinError(err instanceof TeamArenaApiError ? err.message : '找不到這場比賽');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, routeCode, codeValid]);

  const ownMatch = state && !isUnchangedState(state) ? state.own_match : null;
  const currentRound = ownMatch?.current_round ?? null;
  const turnNo = currentRound?.turn_no;

  useEffect(() => {
    if (turnNo != null && lastAnsweredTurnRef.current !== turnNo) {
      setSelectedKey(null);
      setSubmitError('');
      setWeaponError('');
    }
  }, [turnNo]);

  // Attack/collapse/victory animations, derived from the public sides
  // summary only (see module docstring).
  useEffect(() => {
    if (!state || isUnchangedState(state)) return;
    const events = detectSideEvents(prevSidesRef.current, state.sides as Record<TeamArenaSide, SideSnapshot>);
    prevSidesRef.current = state.sides as Record<TeamArenaSide, SideSnapshot>;
    if (events.length === 0) return;
    // Staging: one effect at a time (motion-craft — don't animate two
    // things at once); extras this tick are simply dropped.
    const event = events[0];
    // Every hit plays a random attack first. A fast correct answer usually
    // topples a tower in one hit (80 + speed bonus vs 100 HP), so showing
    // only the collapse meant the attack animation almost never played
    // (staging QA 2026-10-21: 0 attacks in a full match). The collapse /
    // victory follows the attack via `then`.
    const variant = pickAttackVariant(lastAttackVariantRef.current);
    lastAttackVariantRef.current = variant;
    const then = event.kind === 'base_destroyed' ? 'victory' : event.kind === 'tower_fallen' ? 'collapse' : undefined;
    setEffects((prev) => ({ ...prev, [event.side]: { kind: 'attack', side: event.side, variant, then } }));
  }, [state]);

  const clearEffect = (side: TeamArenaSide) =>
    setEffects((prev) => {
      const cur = prev[side];
      if (cur?.kind === 'attack' && cur.then) return { ...prev, [side]: { kind: cur.then, side } };
      return { ...prev, [side]: undefined };
    });

  useEffect(() => {
    if (state && !isUnchangedState(state) && state.status === 'ended' && token && routeCode && !result) {
      getTeamArenaResult(token, routeCode)
        .then(setResult)
        .catch(() => {});
    }
  }, [state, token, routeCode, result]);

  const handlePickSide = async (side: TeamArenaSide) => {
    if (!token || !routeCode) return;
    setSidePickError('');
    try {
      await joinTeamArenaSession(token, routeCode, side);
      setPendingSidePick(false);
      setJoinAttempted(true);
    } catch (err) {
      setSidePickError(err instanceof TeamArenaApiError ? err.message : '加入失敗，請重試');
    }
  };

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

  const handleSuggest = async (key: string) => {
    if (!token || !routeCode) return;
    try {
      await submitTeamArenaSuggestion(token, routeCode, key);
    } catch {
      // best-effort — teammate suggestions are a soft-help feature
    }
  };

  const handleWeapon = async (weapon: TeamArenaWeapon) => {
    if (!token || !routeCode || weaponBusy) return;
    setWeaponError('');
    setWeaponBusy(weapon);
    try {
      await submitTeamArenaWeapon(token, routeCode, weapon);
    } catch (err) {
      setWeaponError(err instanceof TeamArenaApiError ? err.message : '使用失敗，請重試');
    } finally {
      setWeaponBusy(null);
    }
  };

  const handleStart = async () => {
    if (!token || !routeCode) return;
    setStartError('');
    try {
      await controlTeamArena(token, routeCode, 'start');
    } catch (err) {
      setStartError(err instanceof TeamArenaApiError ? err.message : '無法開始，請確認兩隊都滿額');
    }
  };

  if (joinError) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">{joinError}</p>
      </div>
    );
  }

  if (pendingSidePick) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10 text-center">
        <h1 className="mb-6 text-lg font-bold text-on-surface">加入這場多人對抗賽</h1>
        <p className="mb-4 text-sm text-on-surface-variant">選一隊加入</p>
        <div className="grid w-full max-w-xs grid-cols-2 gap-3">
          <button type="button" onClick={() => handlePickSide('a')} className="rounded-xl border-2 border-surface-dim px-4 py-3 text-base font-semibold text-on-surface">
            甲隊
          </button>
          <button type="button" onClick={() => handlePickSide('b')} className="rounded-xl border-2 border-surface-dim px-4 py-3 text-base font-semibold text-on-surface">
            乙隊
          </button>
        </div>
        {sidePickError && <p className="mt-3 text-sm text-red-600">{sidePickError}</p>}
      </div>
    );
  }

  if (!joinAttempted || (!state && !pollError)) {
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
    const bothFull = state.sides.a.seated === state.team_size && state.sides.b.seated === state.team_size;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10 text-center">
        {/* #3777 (game-academy audit r2 P1-2): StudentTeamArenaJoin's
            choose screen already got a hero banner with this tower
            illustration (#3761 round 3) — it never extended to THIS
            screen, the in-game waiting room shown right after
            creating/joining a room. Same asset, same gradient, so it
            reads as one continuous flow rather than "banner, then
            suddenly plain text" the moment a room exists. */}
        <div className="mb-6 w-full max-w-sm overflow-hidden rounded-3xl bg-gradient-to-br from-[#1FA6A6] to-[#E0792B] px-5 py-6 shadow-sm">
          <img
            src="/story-assets/team-arena-hub/icon.png"
            alt=""
            aria-hidden="true"
            className="mx-auto h-16 w-16 object-contain drop-shadow-md"
          />
          <p className="mt-2 text-sm text-white/90">比賽代碼</p>
          <p className="font-mono text-4xl font-bold tracking-widest text-white">{state.code}</p>
        </div>
        <div className="flex w-full max-w-sm gap-3">
          {(['a', 'b'] as const).map((side) => (
            <div key={side} className="flex-1 rounded-xl border border-surface-dim p-3">
              <p className="mb-2 text-sm font-semibold text-on-surface">{teamLabel(state.story, side)}</p>
              <p className="mb-2 text-xs text-on-surface-variant">
                {state.sides[side].seated}/{state.team_size} 人
              </p>
              <ul className="space-y-1 text-xs text-on-surface">
                {state.sides[side].members.map((m) => (
                  <li key={`${m.display_name}-${m.student_id ?? 'x'}`}>{m.display_name}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {state.is_host ? (
          <>
            <button
              type="button"
              onClick={handleStart}
              disabled={!bothFull}
              className="mt-6 w-full max-w-xs rounded-xl bg-accent px-4 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-40"
            >
              {bothFull ? '開始比賽' : '等兩隊都滿額才能開始'}
            </button>
            {startError && <p className="mt-3 text-sm text-red-600">{startError}</p>}
          </>
        ) : (
          <p className="mt-6 text-sm text-on-surface-variant">等發起比賽的同學按「開始比賽」</p>
        )}
      </div>
    );
  }

  if (state.status === 'paused') {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center">
        <p className="text-on-surface-variant">比賽暫停中，請稍候</p>
      </div>
    );
  }

  if (state.status === 'ended') {
    const outcome = ownMatch ? teamArenaMyOutcome(ownMatch) : null;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10 text-center">
        <h1 className="mb-4 text-xl font-bold text-on-surface">比賽結束</h1>
        {outcome && (
          <p className="mb-6 text-base font-semibold text-accent">{resultCopy(state.story, outcome)}</p>
        )}
        {result && (
          <div className="grid w-full max-w-sm grid-cols-2 gap-3 text-left">
            {(['a', 'b'] as const).map((side) => {
              const other = side === 'a' ? 'b' : 'a';
              return (
              <div key={side} data-testid={`result-side-${side}`} className="rounded-xl border border-surface-dim p-3">
                <p className="mb-2 text-sm font-bold text-on-surface">{teamLabel(state.story, side)}</p>
                <p className="mb-1 text-xs font-semibold text-on-surface">已打倒對方 {result.sides[other].towers_destroyed} 座塔</p>
                <p className="mb-2 text-xs text-on-surface-variant">我方剩 {TOWER_COUNT - result.sides[side].towers_destroyed} 座塔</p>
                <ul className="space-y-1.5 text-xs text-on-surface">
                  {result.players[side].map((p) => (
                    <li key={`${p.display_name}-${p.student_id ?? 'x'}`}>
                      <span className="font-semibold">{p.display_name}</span>
                      <span className="block text-on-surface-variant">{p.highlight}</span>
                    </li>
                  ))}
                </ul>
              </div>
              );
            })}
          </div>
        )}

        {/* #3771 (game-academy audit r2 P0-2): this screen had ZERO
            interactive elements — a student could only leave via the
            browser's own back button. "再玩一場" has no single opponent
            to rematch (unlike PK) — a team match needs both teams to
            re-coordinate — so it goes back to the entry/join page rather
            than instantly starting a new session. */}
        <GameResultActions onReplay={() => navigate('/team-arena')} onBackToHub={() => navigate('/game-hub')} />
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

  const payload = currentRound && 'stem' in currentRound ? currentRound : null;
  const options = payload?.options;
  const answered = selectedKey != null;
  const revealed = !!currentRound?.revealed;
  const wasCorrect = revealed && answered && payload?.correct_key != null ? selectedKey === payload.correct_key : null;
  const weaponsUsed = ownMatch.weapons_used;

  return (
    <div className="flex min-h-screen flex-col bg-surface px-5 py-6">
      {state.showdown && (
        <div
          className="mb-3 rounded-lg bg-amber-500/90 px-3 py-2 text-center text-sm font-bold text-white animate-pop"
          data-testid="showdown-banner"
        >
          ⚔️ 決戰時刻！傷害 ×2
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <SideBar label={teamLabel(state.story, 'a')} sideData={state.sides.a} opponentTowersDestroyed={state.sides.b.towers_destroyed} effect={effects.a ?? null} onEffectComplete={() => clearEffect('a')} />
        <SideBar label={teamLabel(state.story, 'b')} sideData={state.sides.b} opponentTowersDestroyed={state.sides.a.towers_destroyed} effect={effects.b ?? null} onEffectComplete={() => clearEffect('b')} />
      </div>

      {ownMatch.match_status === 'ended' ? (
        <p className="text-center text-base font-semibold text-accent">
          {resultCopy(state.story, teamArenaMyOutcome(ownMatch))}
        </p>
      ) : !currentRound ? (
        <p className="text-center text-on-surface-variant">等待下一回合…</p>
      ) : !ownMatch.am_i_active && !currentRound.called_for_help ? (
        <p className="text-center text-on-surface-variant">輪到隊友了，等待中…</p>
      ) : (
        <>
          {!ownMatch.am_i_active && currentRound.called_for_help && (
            <p className="mb-2 text-sm font-semibold text-accent">隊友呼叫你幫忙！點一個建議答案</p>
          )}
          {ownMatch.am_i_active && <p className="mb-2 text-sm font-semibold text-accent">輪到你了！</p>}

          <p className="mb-4 text-lg font-medium text-on-surface">
            {payload?.stem != null && <StemWithTarget stem={payload.stem} targetIndex={payload.extra?.target_index} />}
          </p>

          {ownMatch.am_i_active && currentRound.hint_text && (
            <p className="mb-3 rounded-lg bg-accent-bg px-3 py-2 text-sm text-accent">💡 {currentRound.hint_text}</p>
          )}

          {!options ? (
            <p className="text-center text-on-surface-variant">請先仔細讀題目，稍後選項才會出現</p>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {options.map((opt) => {
                const isSelected = selectedKey === opt.key;
                const isCorrectChoice = revealed && payload?.correct_key === opt.key;
                const onClick = ownMatch.am_i_active ? () => handleAnswer(opt.key) : () => handleSuggest(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    disabled={ownMatch.am_i_active && answered}
                    onClick={onClick}
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

          {ownMatch.am_i_active && options && (
            <div className="mt-4">
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(TEAM_ARENA_WEAPON_LABELS) as TeamArenaWeapon[]).map((w) => {
                  // PRD rule I: "本來就只有 2 個選項的題目不能用，按鈕灰掉且
                  // 不扣次數" -- the frontend already has `options.length`
                  // in scope, so it greys this out BEFORE a round-trip ever
                  // happens (the backend still enforces + 409s too, this is
                  // defense in depth / avoiding a pointless error flash).
                  const cannotEliminate = w === 'eliminate' && options.length < MIN_OPTIONS_TO_ELIMINATE;
                  const noHint = w === 'hint' && currentRound.hint_available === false;
                  return (
                    <button
                      key={w}
                      type="button"
                      disabled={weaponsUsed[w] || weaponBusy !== null || answered || cannotEliminate || noHint}
                      onClick={() => handleWeapon(w)}
                      className="rounded-lg border border-surface-dim px-2 py-2 text-xs font-semibold text-on-surface disabled:opacity-40"
                    >
                      {TEAM_ARENA_WEAPON_LABELS[w]}
                    </button>
                  );
                })}
              </div>
              {weaponError && <p className="mt-2 text-xs text-red-600">{weaponError}</p>}
              {currentRound.call_teammate_active && (
                <div className="mt-3 rounded-lg border border-surface-dim p-2">
                  <p className="mb-1 text-xs font-semibold text-on-surface-variant">隊友建議</p>
                  {currentRound.suggestions && currentRound.suggestions.length > 0 ? (
                    <ul className="space-y-1 text-xs text-on-surface">
                      {currentRound.suggestions.map((s) => (
                        <li key={s.student_id}>
                          {s.display_name}：{s.choice_key}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-on-surface-variant">等待隊友建議…</p>
                  )}
                </div>
              )}
            </div>
          )}

          {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}
          {revealed && ownMatch.am_i_active && answered && wasCorrect != null && (
            <p className={`mt-4 text-center text-base font-semibold ${wasCorrect ? 'text-green-600' : 'text-on-surface-variant'}`}>
              {wasCorrect ? '答對了！攻擊對方！' : '這題沒有推進，正解是 ' + payload?.correct_key}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default StudentTeamArenaPlay;
