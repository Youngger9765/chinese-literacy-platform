/**
 * 進關卡（openModule）要讓環境音暫停、回島（returnToIsland）要恢復——
 * team-lead 2026-10-26 明令，原因：① 學生在關卡裡要專心讀課文
 * ② 「重點朗讀」那一關會用麥克風錄音，背景的海浪跟底墊和弦會被錄進去，
 * 影響朗讀評分。若學生進關卡前本來就設成靜音，恢復後也要維持靜音
 * （不能因為「恢復播放」就不小心把靜音狀態蓋掉）。
 *
 * 用 mock AudioContext 斷言：master gain 的淡出/淡入目標值（0 或 level()），
 * 以及 ctx.suspend()/ctx.resume() 有沒有被呼叫——兩者只要符合其一即代表
 * 真的「暫停」而不只是「靜音」（見 pause() 的實作：兩者都做）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIslandAudio } from '../islandAudio';

function makeConnectable() {
  return { connect: vi.fn((target: unknown) => target), start: vi.fn(), stop: vi.fn() };
}

function installMockAudioContext() {
  const gainNodes: Array<{ gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; setTargetAtTime: ReturnType<typeof vi.fn> } }> = [];

  const ctx = {
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
    createBufferSource: vi.fn(() => ({ ...makeConnectable(), buffer: null, loop: false })),
    createBiquadFilter: vi.fn(() => ({
      ...makeConnectable(),
      type: '',
      frequency: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      Q: { value: 0 },
    })),
    createGain: vi.fn(() => {
      const node = {
        ...makeConnectable(),
        gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
      };
      gainNodes.push(node);
      return node;
    }),
    createOscillator: vi.fn(() => ({ ...makeConnectable(), type: '', frequency: { value: 0 }, detune: { value: 0 } })),
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  // `new Ctor()` 在程式碼裡是用 `new` 呼叫的，箭頭函式／純 vi.fn() 不能當建構式
  // 用，所以這裡用一般 function 當建構子，直接回傳 mock ctx（忽略 `this`）。
  function MockAudioContext() { return ctx; }
  (window as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext as unknown;
  return { ctx, gainNodes, master: () => gainNodes[0] };
}

describe('createIslandAudio — pause()/resume() for lesson modules (#3780)', () => {
  let mock: ReturnType<typeof installMockAudioContext>;

  beforeEach(() => { mock = installMockAudioContext(); });
  afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { AudioContext?: unknown }).AudioContext; });

  it('pause() fades master gain to 0 and suspends the context', () => {
    const audio = createIslandAudio(false);
    audio.start();
    const master = mock.master();

    audio.pause();

    const lastRampCall = master.gain.setTargetAtTime.mock.calls.at(-1);
    expect(lastRampCall?.[0]).toBe(0);
    expect(mock.ctx.suspend).toHaveBeenCalled();
  });

  it('resume() resumes the context and ramps master gain back up when not muted', () => {
    const audio = createIslandAudio(false);
    audio.start();
    const master = mock.master();

    audio.pause();
    audio.resume();

    expect(mock.ctx.resume).toHaveBeenCalled();
    const lastRampCall = master.gain.setTargetAtTime.mock.calls.at(-1);
    expect(lastRampCall?.[0]).toBeGreaterThan(0); // level() when not muted = 0.6
  });

  it('resume() keeps the student muted if they had muted before entering the module', () => {
    const audio = createIslandAudio(false);
    audio.start();
    const master = mock.master();

    audio.setMuted(true); // 學生進關卡前自己關掉聲音
    audio.pause();        // 進關卡
    audio.resume();       // 回島

    const lastRampCall = master.gain.setTargetAtTime.mock.calls.at(-1);
    expect(lastRampCall?.[0]).toBe(0); // 不能因為「恢復」就蓋掉學生自己設的靜音
  });

  it('pause()/resume() before start() (no AudioContext yet) do not throw', () => {
    const audio = createIslandAudio(false);
    expect(() => audio.pause()).not.toThrow();
    expect(() => audio.resume()).not.toThrow();
  });
});
