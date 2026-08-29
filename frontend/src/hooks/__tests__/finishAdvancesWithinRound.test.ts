/**
 * 按「完成標記」要走到**下一步**，不是直接跳到最後（#2930 續）。
 *
 * `dispatchStepFinish` 收到的是寫死的 base id（`'full-text-annotate'`），
 * 但一課多篇的序列裡是 `'full-text-annotate#p3kud'` ——
 * `lessonAwareNextStep` 找不到就 `return 'report'`，於是學生在第 2 步按完成，
 * 直接被丟到第 21 步的報告頁。三篇的每一步都會這樣。
 *
 * 擁有者 2026-08-26 實測：「2.7.12步，若按完成標記沒有跳到下一步，而是直接跳到21步」
 */
import { describe, it, expect } from 'vitest';
import { lessonAwareNextStep } from '../lessonAwareStepTransition';

// staging `GET /api/stories/20063` 的真值（前六步）
const SEQ = [
  'lesson-intro',
  'full-text-annotate#p3kud', 'key-passage-reading#yprak', 'vocab-definition#mc9mf',
  'vocab-application#4fq9w', 'keypoints-table#dydnq',
  'full-text-annotate#4uee3', 'key-passage-reading#9a7x4',
];

describe('多篇課按完成標記', () => {
  it('帶輪次的 key 會走到同一輪的下一步', () => {
    expect(lessonAwareNextStep('full-text-annotate#p3kud', SEQ, 'x'))
      .toBe('key-passage-reading#yprak');
  });

  it('一輪的最後一步接到下一輪的第一步', () => {
    expect(lessonAwareNextStep('keypoints-table#dydnq', SEQ, 'x'))
      .toBe('full-text-annotate#4uee3');
  });

  it('⚠️ 不帶輪次的 base id 會掉到 report —— 這就是那個 bug', () => {
    // 這條記錄現況：helper 本身沒錯，錯在呼叫端傳了不含輪次的 id。
    expect(lessonAwareNextStep('full-text-annotate', SEQ, 'x')).toBe('report');
  });

  it('單篇課不受影響', () => {
    const plain = ['lesson-intro', 'full-text-annotate', 'key-passage-reading', 'report'];
    expect(lessonAwareNextStep('full-text-annotate', plain, 'x')).toBe('key-passage-reading');
  });
});
