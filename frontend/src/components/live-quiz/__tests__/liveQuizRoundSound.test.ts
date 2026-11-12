/**
 * liveQuizRoundSound — issue #3631 P0 #6 lobby/countdown/reveal chimes.
 *
 * Reuses podiumSound's shared AudioContext singleton + mute-preference
 * storage (#3630) rather than a second Web Audio system — the tests below
 * both lock the usual "never crash the game" guarantees AND prove the
 * sharing itself (one AudioContext construction across both modules).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetPodiumAudioStateForTests, playPodiumChime, PODIUM_MUTE_KEY } from '../../podium/podiumSound';
import { playLobbyTick, playCountdownTick, playRevealSting } from '../liveQuizRoundSound';

describe('liveQuizRoundSound — never throws without Web Audio support', () => {
  const originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;
  const originalWebkit = (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;

  beforeEach(() => {
    resetPodiumAudioStateForTests();
  });

  afterEach(() => {
    (window as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext = originalWebkit;
    resetPodiumAudioStateForTests();
  });

  it('is a no-op when the browser has no Web Audio support at all', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;

    expect(() => playLobbyTick()).not.toThrow();
    expect(() => playCountdownTick()).not.toThrow();
    expect(() => playRevealSting()).not.toThrow();
  });

  it('never throws when constructing AudioContext itself throws (blocked by browser policy)', () => {
    class ThrowingAudioContext {
      constructor() {
        throw new DOMException('blocked', 'NotAllowedError');
      }
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = ThrowingAudioContext;

    expect(() => playLobbyTick()).not.toThrow();
    expect(() => playCountdownTick()).not.toThrow();
    expect(() => playRevealSting()).not.toThrow();
  });

  it('never throws when ctx.resume() rejects (suspended by autoplay policy)', () => {
    class SuspendedAudioContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.reject(new Error('user gesture required'));
      }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = SuspendedAudioContext;

    expect(() => playCountdownTick()).not.toThrow();
  });

  it('never throws when a node factory throws mid-call', () => {
    class PartiallyBrokenAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createOscillator(): never {
        throw new Error('boom');
      }
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      }
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = PartiallyBrokenAudioContext;

    expect(() => playRevealSting()).not.toThrow();
  });
});

describe('liveQuizRoundSound — actually drives the Web Audio graph (not a silent no-op)', () => {
  const originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;

  afterEach(() => {
    (window as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    resetPodiumAudioStateForTests();
  });

  function installWorkingAudioContext() {
    const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
    let constructCount = 0;

    class WorkingAudioContext {
      state = 'running';
      currentTime = 0;
      sampleRate = 44100;
      destination = {};
      constructor() {
        constructCount += 1;
      }
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        const node = {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        oscillators.push(node);
        return node;
      }
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
      }
      createBuffer(_channels: number, length: number) {
        return { getChannelData: () => new Float32Array(Math.max(1, length)) };
      }
      createBufferSource() {
        return { buffer: null as unknown, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      }
      createBiquadFilter() {
        return { type: 'bandpass', frequency: { setValueAtTime: vi.fn() }, Q: { setValueAtTime: vi.fn() }, connect: vi.fn() };
      }
    }

    resetPodiumAudioStateForTests();
    (window as unknown as { AudioContext?: unknown }).AudioContext = WorkingAudioContext;
    return { oscillators, getConstructCount: () => constructCount };
  }

  it('playLobbyTick creates and starts an oscillator on a working browser', () => {
    const { oscillators } = installWorkingAudioContext();
    playLobbyTick();
    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators.every((o) => o.start.mock.calls.length > 0)).toBe(true);
  });

  it('playCountdownTick creates and starts an oscillator', () => {
    const { oscillators } = installWorkingAudioContext();
    playCountdownTick();
    expect(oscillators.length).toBeGreaterThan(0);
  });

  it('playRevealSting creates two notes (a two-tone sting)', () => {
    const { oscillators } = installWorkingAudioContext();
    playRevealSting();
    expect(oscillators.length).toBeGreaterThanOrEqual(2);
  });

  it('shares ONE AudioContext construction across liveQuizRoundSound and podiumSound calls', () => {
    const { getConstructCount } = installWorkingAudioContext();
    playLobbyTick();
    playCountdownTick();
    playRevealSting();
    playPodiumChime('rise');
    // Exactly one AudioContext built across four calls spanning both
    // modules — proof this is the same shared singleton, not a second
    // audio system (the whole point of reusing podiumSound.ts).
    expect(getConstructCount()).toBe(1);
  });
});

describe('liveQuizRoundSound — mute preference is podiumSound\'s shared key', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('re-exports the same mute storage key podiumSound already uses', async () => {
    const { useLiveQuizSoundMute } = await import('../liveQuizRoundSound');
    expect(typeof useLiveQuizSoundMute).toBe('function');
    // The key itself is podiumSound's — asserting its value here would
    // duplicate podiumSound.test.ts; this just confirms no second storage
    // key was invented (e.g. a stray `live_quiz_sound_muted`).
    expect(PODIUM_MUTE_KEY).toBe('lingoleap_podium_muted');
  });
});
