/**
 * podiumSound — #3630 頒獎台歡呼／號角聲。
 *
 * Web Audio API–synthesized only — no third-party audio files (licensing).
 * The one hard rule this file exists to enforce: a browser that blocks or
 * lacks Web Audio must never crash the ceremony. Every failure mode
 * (missing AudioContext, constructor throws, resume() rejects, a node
 * factory throws mid-call) is swallowed inside `playPodiumChime` so the
 * caller never has to guard it itself.
 */
import { useCallback, useState } from 'react';
import { safeStorage } from '../../utils/storage';

export const PODIUM_MUTE_KEY = 'lingoleap_podium_muted';

export function getStoredMutePreference(): boolean | null {
  try {
    const raw = safeStorage.local.get(PODIUM_MUTE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

export function setStoredMutePreference(muted: boolean): void {
  try {
    safeStorage.local.set(PODIUM_MUTE_KEY, muted ? 'true' : 'false');
  } catch {
    // non-fatal — the ceremony still plays this session, just won't
    // remember the choice next time.
  }
}

type ChimeKind = 'rise' | 'fanfare';

// Module-level shared context so repeated chimes don't each spin up (and
// never tear down) a new AudioContext. `null` means "not created yet",
// distinct from `failed` which means "don't bother trying again".
let sharedCtx: AudioContext | null = null;
let ctxCreationFailed = false;

/** TEST-ONLY — clears the cached context/failure flag so each test case
 *  can simulate a fresh browser. Not used by production code paths. */
export function resetPodiumAudioStateForTests(): void {
  sharedCtx = null;
  ctxCreationFailed = false;
}

function getSharedAudioContext(): AudioContext | null {
  if (ctxCreationFailed) return null;
  if (sharedCtx) return sharedCtx;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      ctxCreationFailed = true;
      return null;
    }
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    ctxCreationFailed = true;
    return null;
  }
}

/** A short ascending tone — used for the rise of one note. Every node
 *  call is individually guarded so one broken method can't take the whole
 *  chime down with it. */
function playTone(ctx: AudioContext, frequency: number, startAt: number, duration: number, peakGain = 0.22): void {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  } catch {
    // one broken note must not silence the rest of the chime
  }
}

/** A short burst of filtered noise — reads as a soft crowd "cheer" rather
 *  than harsh static once it's gone through a mid-range bandpass filter
 *  with an attack/decay envelope. */
function playCheer(ctx: AudioContext, startAt: number, duration: number): void {
  try {
    const sampleRate = ctx.sampleRate || 44100;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, startAt);
    if (filter.Q) filter.Q.setValueAtTime(0.7, startAt);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(0.18, startAt + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(startAt);
    source.stop(startAt + duration + 0.05);
  } catch {
    // no cheer this time — the oscillator notes still carry the moment
  }
}

function playRiseChime(ctx: AudioContext): void {
  const now = ctx.currentTime;
  // Two quick ascending notes — bright and short, for 3rd/2nd place rising.
  playTone(ctx, 660, now, 0.14);
  playTone(ctx, 880, now + 0.1, 0.18);
}

function playFanfareChime(ctx: AudioContext): void {
  const now = ctx.currentTime;
  // Ascending major-triad-ish run (brass-like fanfare), then the cheer
  // layered slightly behind it so the "crowd" reaction follows the horn.
  playTone(ctx, 523.25, now, 0.22, 0.26); // C5
  playTone(ctx, 659.25, now + 0.14, 0.22, 0.26); // E5
  playTone(ctx, 783.99, now + 0.28, 0.3, 0.3); // G5
  playTone(ctx, 1046.5, now + 0.46, 0.4, 0.32); // C6 — the big landing note
  playCheer(ctx, now + 0.15, 1.1);
}

/**
 * Plays a synthesized chime. Guaranteed to never throw, regardless of
 * whether Web Audio exists, is blocked, or partially breaks mid-call —
 * see podiumSound.test.ts for every failure mode this guards against.
 */
export function playPodiumChime(kind: ChimeKind): void {
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

    if (kind === 'rise') {
      playRiseChime(ctx);
    } else {
      playFanfareChime(ctx);
    }
  } catch {
    // Never let sound break the ceremony.
  }
}

/**
 * usePodiumMute — muted state + toggle, persisted via setStoredMutePreference.
 * Default: honor a previously-saved choice; otherwise default muted to the
 * caller's `reducedMotion` flag (sound off by default under reduced motion,
 * on by default otherwise).
 */
export function usePodiumMute(reducedMotion: boolean): [boolean, () => void] {
  const [muted, setMuted] = useState<boolean>(() => {
    const stored = getStoredMutePreference();
    return stored !== null ? stored : reducedMotion;
  });

  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      setStoredMutePreference(next);
      return next;
    });
  }, []);

  return [muted, toggle];
}
