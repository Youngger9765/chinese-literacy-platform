/**
 * 轉寫失敗要告訴學生「下一步做什麼不一樣的事」（#3299）。
 *
 * prod 近 30 天 44 次轉寫有 4 次 fallback，原因完全不同（3 次太短、1 次太長），
 * 而前端一律回「辨識失敗，請重錄一次」—— 對太短的那三個學生那是無效指示，
 * 照同樣長度再錄一次會同樣失敗，而他們已經等了 9–20 秒才看到這句話。
 */
import { describe, it, expect } from 'vitest';
import {
  transcribeFallbackMessage,
  retryingTheSameWayWillFail,
} from '../transcribeFallbackMessage';

const BACKEND_REASONS = [
  'too_short', 'silent', 'empty', 'truncated',
  'decode', 'timeout', 'safety', 'hallucination', 'error',
];

describe('#3299 轉寫失敗的訊息', () => {
  it('後端回得出來的每一種 reason 都有自己的話', () => {
    const seen = new Map<string, string>();
    for (const r of BACKEND_REASONS) {
      const m = transcribeFallbackMessage(r);
      expect(m, `${r} 沒有訊息`).toBeTruthy();
      seen.set(r, m);
    }
    // 至少要分得出「太短」「太長」「沒聲音」「重試就好」四類，
    // 否則等於換了句子還是一種訊息
    const distinct = new Set(seen.values());
    expect(distinct.size, `9 種原因只產生 ${distinct.size} 種訊息`).toBeGreaterThanOrEqual(6);
  });

  it('⭐ 太短／太長不可以叫學生「重錄一次」—— 那是無效指示', () => {
    for (const r of ['too_short', 'empty', 'decode', 'truncated']) {
      const m = transcribeFallbackMessage(r);
      expect(m, `${r} 仍然只叫學生重錄：「${m}」`).not.toMatch(/重錄一次/);
      expect(retryingTheSameWayWillFail(r)).toBe(true);
    }
  });

  it('太短要講「多唸一點」，太長要講「分段」—— 方向相反，不能混', () => {
    expect(transcribeFallbackMessage('too_short')).toMatch(/太短|唸完|多唸/);
    expect(transcribeFallbackMessage('empty')).toMatch(/太短|多唸/);
    expect(transcribeFallbackMessage('decode')).toMatch(/太長|分成小段/);
    expect(transcribeFallbackMessage('truncated')).toMatch(/太長|分成小段/);
  });

  it('暫時性問題才可以叫他再試一次', () => {
    for (const r of ['timeout', 'error']) {
      expect(retryingTheSameWayWillFail(r)).toBe(false);
      expect(transcribeFallbackMessage(r)).toMatch(/再按一次|再試/);
    }
  });

  it('沒聲音要指向麥克風，不是指向重錄', () => {
    expect(transcribeFallbackMessage('silent')).toMatch(/麥克風|沒有聽到聲音/);
  });

  it('未知或空的 reason 有預設，不會變成空字串', () => {
    for (const r of [null, undefined, '', 'something_new']) {
      expect(transcribeFallbackMessage(r as string | null | undefined)).toBeTruthy();
    }
  });
});
