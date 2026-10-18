/**
 * liveQuizRoundSound — issue #3631 P0 #6 "音效／音樂：等待室、倒數、揭曉、
 * 頒獎台；可靜音；減少動態效果時預設關閉".
 *
 * Deliberately NOT a second Web Audio system: this reuses podiumSound's
 * (#3630) shared `AudioContext` singleton, its `playTone` note primitive,
 * and its `usePodiumMute` persisted preference — one live-quiz session has
 * exactly one AudioContext and one mute toggle, lobby through podium. Only
 * the three chime SHAPES below (lobby / countdown / reveal) are new.
 *
 * Every exported function follows podiumSound's hard rule: never let a
 * Web Audio failure (missing support, blocked constructor, rejected
 * resume(), a broken node factory) crash the game. See
 * `__tests__/liveQuizRoundSound.test.ts` for every failure mode this
 * guards against, mirroring `podiumSound.test.ts`.
 */
import { getSharedAudioContext, playTone, usePodiumMute } from '../podium/podiumSound';

export { usePodiumMute as useLiveQuizSoundMute };

function safely(run: (ctx: AudioContext) => void): void {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      try {
        void ctx.resume().catch(() => {
          /* autoplay policy blocked resume — fine, just no sound this time */
        });
      } catch {
        // resume() itself threw synchronously on some odd implementation
      }
    }

    run(ctx);
  } catch {
    // Sound is an enhancement; it must never break the game.
  }
}

/** Soft, slow single tone — one per lobby "tick" while players are
 * joining (the caller is responsible for the interval; see
 * useLiveQuizRoundSound). Deliberately quiet (peakGain 0.05) — this plays
 * every couple of seconds for as long as the host is on the lobby screen,
 * so it must not be the loudest thing in the room. */
export function playLobbyTick(): void {
  safely((ctx) => {
    playTone(ctx, 440, ctx.currentTime, 0.3, 0.05);
  });
}

/** One short tick — the caller fires this once per second during the
 * final seconds of an answer window. */
export function playCountdownTick(): void {
  safely((ctx) => {
    playTone(ctx, 880, ctx.currentTime, 0.09, 0.08);
  });
}

/** Two-note sting when a round's answer is revealed — short and
 * attention-getting without being a full fanfare (that's the podium's
 * job, at the end of the whole game, not every single question). */
export function playRevealSting(): void {
  safely((ctx) => {
    const now = ctx.currentTime;
    playTone(ctx, 660, now, 0.12, 0.12);
    playTone(ctx, 990, now + 0.11, 0.16, 0.12);
  });
}
