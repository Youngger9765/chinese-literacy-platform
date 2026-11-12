/**
 * useLiveQuizRoundSound — issue #3631 P0 #6: wires the lobby/countdown/
 * reveal chimes (liveQuizRoundSound.ts) to a polled game state. One hook
 * used by BOTH the teacher/projector page and the student phone page —
 * each instance plays its own sounds locally (no server coordination
 * needed; everyone's device reaches the same `status`/`round_index` from
 * its own poll).
 *
 * Mute preference and "default off under prefers-reduced-motion" both come
 * from podiumSound's existing `usePodiumMute` (re-exported here as
 * `useLiveQuizSoundMute`) — one toggle for the whole live-quiz session,
 * not a second one just for this hook.
 */
import { useEffect, useRef } from 'react';
import type { LiveQuizState } from '../../services/liveQuizApi';
import { usePrefersReducedMotion } from '../pk/usePrefersReducedMotion';
import { playCountdownTick, playLobbyTick, playRevealSting, useLiveQuizSoundMute } from './liveQuizRoundSound';

const LOBBY_TICK_INTERVAL_MS = 2500;
const COUNTDOWN_POLL_MS = 200;
const COUNTDOWN_WINDOW_SECONDS = 3;

interface UseLiveQuizRoundSoundResult {
  muted: boolean;
  toggleMuted: () => void;
}

export function useLiveQuizRoundSound(state: LiveQuizState | null): UseLiveQuizRoundSoundResult {
  const reducedMotion = usePrefersReducedMotion();
  const [muted, toggleMuted] = useLiveQuizSoundMute(reducedMotion);

  const status = state?.status ?? null;
  const roundIndex = state?.round_index ?? null;
  const answerOpenAt = state?.answer_open_at ?? null;
  const seconds = state?.round?.seconds ?? null;
  // Only truthy once the answer window is actually open (reading phase
  // omits `options` entirely — see round_types/choice.player_view) — the
  // countdown only ticks once there is something to count down to.
  const hasOptions = !!state?.round?.options;

  // Lobby ambient tick — plays immediately on entering the lobby, then
  // repeats while the host/student stays there, and stops the instant the
  // game moves past "lobby".
  useEffect(() => {
    if (muted || status !== 'lobby') return undefined;
    playLobbyTick();
    const id = window.setInterval(playLobbyTick, LOBBY_TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, muted]);

  // Reveal sting — once per round reaching "reveal", never repeated for
  // the same round on a subsequent re-render/poll.
  const lastRevealedRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (muted) return;
    if (status === 'reveal' && roundIndex != null && lastRevealedRoundRef.current !== roundIndex) {
      lastRevealedRoundRef.current = roundIndex;
      playRevealSting();
    }
  }, [status, roundIndex, muted]);

  // Countdown ticks in the final COUNTDOWN_WINDOW_SECONDS of an open
  // answer window. Server-authoritative timing (answerOpenAt + seconds),
  // same source CountdownBar.tsx already renders from — this never
  // invents its own local timer origin.
  useEffect(() => {
    if (muted || status !== 'question' || !hasOptions || !answerOpenAt || !seconds) return undefined;
    const endAtMs = new Date(answerOpenAt).getTime() + seconds * 1000;
    const firedSeconds = new Set<number>();
    const id = window.setInterval(() => {
      const secondsLeft = Math.ceil((endAtMs - Date.now()) / 1000);
      if (secondsLeft > 0 && secondsLeft <= COUNTDOWN_WINDOW_SECONDS && !firedSeconds.has(secondsLeft)) {
        firedSeconds.add(secondsLeft);
        playCountdownTick();
      }
    }, COUNTDOWN_POLL_MS);
    return () => window.clearInterval(id);
  }, [status, hasOptions, answerOpenAt, seconds, muted]);

  return { muted, toggleMuted };
}
