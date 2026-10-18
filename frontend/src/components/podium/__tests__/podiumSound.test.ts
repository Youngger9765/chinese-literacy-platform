/**
 * podiumSound — #3630 Web Audio API 合成歡呼／號角聲 + 靜音偏好持久化。
 *
 * No third-party audio files (licensing) — everything here is synthesized
 * with OscillatorNode/GainNode/AudioBufferSourceNode. The one hard rule this
 * file exists to lock: a browser that blocks or lacks Web Audio must never
 * crash the ceremony. Every failure mode below must be swallowed silently.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PODIUM_MUTE_KEY,
  getStoredMutePreference,
  setStoredMutePreference,
  playPodiumChime,
  resetPodiumAudioStateForTests,
} from '../podiumSound';

describe('podiumSound — mute preference persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing has been saved yet', () => {
    expect(getStoredMutePreference()).toBeNull();
  });

  it('persists true/false and reads the same value back', () => {
    setStoredMutePreference(true);
    expect(getStoredMutePreference()).toBe(true);
    expect(localStorage.getItem(PODIUM_MUTE_KEY)).toBe('true');

    setStoredMutePreference(false);
    expect(getStoredMutePreference()).toBe(false);
    expect(localStorage.getItem(PODIUM_MUTE_KEY)).toBe('false');
  });

  it('never throws when localStorage.setItem throws (private browsing / quota)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => setStoredMutePreference(true)).not.toThrow();
    spy.mockRestore();
  });

  it('never throws when localStorage.getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => getStoredMutePreference()).not.toThrow();
    expect(getStoredMutePreference()).toBeNull();
    spy.mockRestore();
  });
});

describe('podiumSound — playPodiumChime never crashes the ceremony', () => {
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

  it('is a no-op (never throws) when the browser has no Web Audio support at all', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;

    expect(() => playPodiumChime('rise')).not.toThrow();
    expect(() => playPodiumChime('fanfare')).not.toThrow();
  });

  it('never throws when constructing AudioContext itself throws (blocked by browser policy)', () => {
    class ThrowingAudioContext {
      constructor() {
        throw new DOMException('blocked', 'NotAllowedError');
      }
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = ThrowingAudioContext;

    expect(() => playPodiumChime('fanfare')).not.toThrow();
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
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
      createBuffer() {
        return { getChannelData: () => new Float32Array(1) };
      }
      createBufferSource() {
        return { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      }
      createBiquadFilter() {
        return { type: 'bandpass', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn() };
      }
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = SuspendedAudioContext;

    expect(() => playPodiumChime('fanfare')).not.toThrow();
  });

  it('never throws when a node factory throws mid-playback (partially broken implementation)', () => {
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
        return {
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
    }
    (window as unknown as { AudioContext?: unknown }).AudioContext = PartiallyBrokenAudioContext;

    expect(() => playPodiumChime('rise')).not.toThrow();
  });
});

describe('podiumSound — playPodiumChime actually drives the Web Audio graph (not a silent no-op)', () => {
  // Critic review on the red-test commit flagged that a stub implementation
  // that does nothing would pass every "never throws" test above. These two
  // cases pin down that a *working* browser really gets oscillator/gain
  // nodes created and started, so an accidental no-op can't sneak through.
  const originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;

  afterEach(() => {
    (window as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
    resetPodiumAudioStateForTests();
  });

  function installWorkingAudioContext() {
    const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
    const bufferSources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];

    class WorkingAudioContext {
      state = 'running';
      currentTime = 0;
      sampleRate = 44100;
      destination = {};
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
        return {
          gain: {
            setValueAtTime: vi.fn(),
            linearRampToValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      }
      createBuffer(channels: number, length: number) {
        return { getChannelData: () => new Float32Array(Math.max(1, length)) };
      }
      createBufferSource() {
        const node = { buffer: null as unknown, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
        bufferSources.push(node);
        return node;
      }
      createBiquadFilter() {
        return { type: 'bandpass', frequency: { setValueAtTime: vi.fn() }, Q: { setValueAtTime: vi.fn() }, connect: vi.fn() };
      }
    }

    resetPodiumAudioStateForTests();
    (window as unknown as { AudioContext?: unknown }).AudioContext = WorkingAudioContext;
    return { oscillators, bufferSources };
  }

  it('rise chime creates and starts at least one oscillator on a working browser', () => {
    const { oscillators } = installWorkingAudioContext();
    playPodiumChime('rise');
    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators.every((o) => o.start.mock.calls.length > 0)).toBe(true);
  });

  it('fanfare creates oscillators (fanfare notes) AND a buffer source (the synthesized cheer), both started', () => {
    const { oscillators, bufferSources } = installWorkingAudioContext();
    playPodiumChime('fanfare');
    expect(oscillators.length).toBeGreaterThan(0);
    expect(oscillators.every((o) => o.start.mock.calls.length > 0)).toBe(true);
    expect(bufferSources.length).toBeGreaterThan(0);
    expect(bufferSources.every((b) => b.start.mock.calls.length > 0)).toBe(true);
  });
});
