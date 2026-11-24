/**
 * #4081 — 學習步驟的瀏覽器快取要綁使用者，登出要清掉。
 *
 * 快取 key 原本只綁課：共用平板上學生 A 做過的作答，學生 B 打開同一課時會被
 * 「還原」出來，接著被存進 B 自己的資料庫紀錄。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { authToken, clearAuthSession } from '../../utils/storage';
import {
  clearToolboxScopeForStory,
  currentLearnerId,
  getLearningStorageScope,
  scopedStepStorageKey,
  setToolboxMode,
} from '../learningStorageScope';

const tokenFor = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '')}.s`;

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('learning cache is per learner', () => {
  it('reads the learner from the login token', () => {
    authToken.set(tokenFor('42'));
    expect(currentLearnerId()).toBe('42');
  });

  it('two students on the same device get different keys for the same lesson', () => {
    authToken.set(tokenFor('1'));
    const a = scopedStepStorageKey('wordSearch_progress_', 20011);
    authToken.set(tokenFor('2'));
    const b = scopedStepStorageKey('wordSearch_progress_', 20011);
    expect(a).toBe('wordSearch_progress_u1__20011');
    expect(b).toBe('wordSearch_progress_u2__20011');
  });

  it('no token / garbage token falls back to the lesson-only scope instead of throwing', () => {
    expect(getLearningStorageScope(20011)).toBe('20011');
    authToken.set('not-a-jwt');
    expect(getLearningStorageScope(20011)).toBe('20011');
  });

  it('toolbox scope keeps its __t suffix, so the toolbox wipe still finds it', () => {
    authToken.set(tokenFor('7'));
    setToolboxMode(true);
    const key = scopedStepStorageKey('annotations_', 20011);
    expect(key).toBe('annotations_u7__20011__t');
    localStorage.setItem(key, 'x');
    clearToolboxScopeForStory(20011);
    expect(localStorage.getItem(key)).toBeNull();
    setToolboxMode(false);
  });
});

describe('logout clears the learning cache', () => {
  it('removes step caches and keeps unrelated preferences', () => {
    authToken.set(tokenFor('1'));
    localStorage.setItem('wordSearch_progress_u1__20011', '{"found":["甲"]}');
    localStorage.setItem('annotations_20011', '[]'); // pre-#4081 key, no learner
    localStorage.setItem('annotation_onboarded', '1'); // a UI preference, not a record
    clearAuthSession();
    expect(localStorage.getItem('wordSearch_progress_u1__20011')).toBeNull();
    expect(localStorage.getItem('annotations_20011')).toBeNull();
    expect(localStorage.getItem('annotation_onboarded')).toBe('1');
    expect(authToken.get()).toBeNull();
  });
});
