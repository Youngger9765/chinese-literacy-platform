/**
 * #4159 首頁「接著做」：找出上次進行中的課與第幾關
 * 規則與既有續讀提示一致：超過 7 天算放棄、未知／停用的關卡、已到最後一關都不算進行中；
 * 只讀不刪（刪除是續讀提示自己的事）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { findResumeInfo } from '../resumeInfo';
import { resolveActiveSteps, DEFAULT_STEP_SEQUENCE } from '../../config/stepConfig';

const KEY = (u: string) => `lingoleap-active-session-${u}`;
const save = (u: string, o: object) => localStorage.setItem(KEY(u), JSON.stringify(o));
const active = resolveActiveSteps();
const NOW = 1_800_000_000_000;
const rec = (stepIdx: number, over: Partial<{ timestamp: number; storyId: string }> = {}) => ({
  sessionId: 1, storyId: '20011', currentStep: active[stepIdx].dbStepNumber, timestamp: NOW - 1000, ...over,
});

describe('findResumeInfo', () => {
  beforeEach(() => localStorage.clear());

  it('沒有紀錄回 null（完全新學生）', () => {
    expect(findResumeInfo('1', NOW)).toBeNull();
  });

  it('有進行中：回課號、關卡名、第幾關、總關數', () => {
    save('1', rec(2));
    const r = findResumeInfo('1', NOW)!;
    expect(r.storyId).toBe('20011');
    expect(r.stepId).toBe(active[2].id);
    expect(r.stepLabel).toBe(active[2].label);
    expect(r.stepNumber).toBe(3);
    expect(r.totalSteps).toBe(active.length);
  });

  it('第一關也算進行中（已開始、未完成）', () => {
    save('1', rec(0));
    expect(findResumeInfo('1', NOW)?.stepNumber).toBe(1);
  });

  it('已到最後一關（成績單）算完成，不是進行中', () => {
    save('1', rec(active.length - 1));
    expect(findResumeInfo('1', NOW)).toBeNull();
  });

  it('超過 7 天算放棄', () => {
    save('1', rec(2, { timestamp: NOW - 8 * 24 * 3600 * 1000 }));
    expect(findResumeInfo('1', NOW)).toBeNull();
    save('1', rec(2, { timestamp: NOW - 6 * 24 * 3600 * 1000 }));
    expect(findResumeInfo('1', NOW)).not.toBeNull();
  });

  it('不認得的關卡（舊版步驟）回 null', () => {
    save('1', { sessionId: 1, storyId: '20011', currentStep: 9999, timestamp: NOW - 1000 });
    expect(findResumeInfo('1', NOW)).toBeNull();
  });

  it('只讀不刪：無效紀錄還留在 localStorage', () => {
    save('1', rec(active.length - 1));
    findResumeInfo('1', NOW);
    expect(localStorage.getItem(KEY('1'))).not.toBeNull();
  });

  it('別人的紀錄不會被讀到', () => {
    save('2', rec(2));
    expect(findResumeInfo('1', NOW)).toBeNull();
  });

  it('停用的關卡（逐段朗讀）回 null', () => {
    save('1', { sessionId: 1, storyId: '20011', currentStep: 2, timestamp: NOW - 1000 });
    expect(findResumeInfo('1', NOW)).toBeNull();
  });

  it('依該課自己的關卡順序算第幾關與總關數', () => {
    const seq = DEFAULT_STEP_SEQUENCE.slice(0, 6);
    const steps = resolveActiveSteps(seq);
    save('1', { sessionId: 1, storyId: '20011', currentStep: steps[1].dbStepNumber, timestamp: NOW - 1000 });
    const r = findResumeInfo('1', NOW, seq)!;
    expect(r.totalSteps).toBe(steps.length);
    expect(r.stepNumber).toBe(2);
    // 這課的最後一關算做完
    save('1', { sessionId: 1, storyId: '20011', currentStep: steps[steps.length - 1].dbStepNumber, timestamp: NOW - 1000 });
    expect(findResumeInfo('1', NOW, seq)).toBeNull();
  });
});
