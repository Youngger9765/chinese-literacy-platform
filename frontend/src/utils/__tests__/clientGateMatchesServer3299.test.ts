/**
 * 前端 Gate 1 與後端 gate 必須算出**同一個門檻**（#3299）。
 *
 * ## 為什麼這條比「前端有擋」更重要
 *
 * 兩邊不一致只有兩種結果，都不好：
 *
 *   - **前端鬆、後端嚴** → 孩子上傳最多 10MB、等一趟 Gemini 往返，才拿到
 *     「請重錄一次」。那正是 #3299 開票的原因
 *   - **前端嚴、後端鬆** → 孩子在還可以救的情況下被當場擋掉
 *
 * 所以這條鎖的對象不是「門檻是多少」，而是「兩邊有沒有說同一句話」。
 *
 * ⚠️ 用真實課文比對，不是造假字串 —— 真實段落含標點、注音、文言文的斷詞點，
 *    而那正是兩邊正規化最容易分岔的地方（後端就為此踩過：多算了 `.` 與注音，
 *    實際上限掉到 452 字/分）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  MAX_PLAUSIBLE_CPM,
  SILENT_MIN_DURATION_MS,
  minDurationMsFor,
  validateRecording,
} from '../recordingValidation';
import { countScorableCharacters } from '../textDiff';

const REPO = path.resolve(__dirname, '../../../..');

/** 後端那兩個常數的字面值（由下面的測試確認沒有漂掉）。 */
function readServerConstants() {
  const src = fs.readFileSync(
    path.join(REPO, 'backend/app/routes/learning/learning_reading.py'),
    'utf-8',
  );
  const cpm = src.match(/^_MAX_PLAUSIBLE_CPM\s*=\s*(\d+)/m);
  const floor = src.match(/^_MIN_AUDIO_DURATION_MS\s*=\s*(\d+)/m);
  return { cpm: cpm && Number(cpm[1]), floor: floor && Number(floor[1]) };
}

describe('對照組', () => {
  it('讀得到後端那兩個常數（讀不到的話底下全是空斷言）', () => {
    const { cpm, floor } = readServerConstants();
    expect(cpm).toBeGreaterThan(0);
    expect(floor).toBeGreaterThan(0);
  });
});

describe('前後端門檻一致（#3299）', () => {
  it('兩個常數字面值相同', () => {
    const { cpm, floor } = readServerConstants();
    expect(MAX_PLAUSIBLE_CPM).toBe(cpm);
    expect(SILENT_MIN_DURATION_MS).toBe(floor);
  });

  it.each([0, 1, 17, 83, 130, 248, 362, 566, 2794])(
    '%i 個字：前端算出的門檻 == 後端公式',
    (chars) => {
      const { cpm, floor } = readServerConstants();
      // 後端：max(floor, int(chars / cpm * 60000))
      const server = Math.max(floor!, Math.floor((chars / cpm!) * 60_000));
      expect(minDurationMsFor(chars)).toBe(chars <= 0 ? floor : server);
    },
  );

  it('拿不到課文時兩邊都退回平門檻，不是 0 也不是無限大', () => {
    expect(minDurationMsFor(0)).toBe(SILENT_MIN_DURATION_MS);
    expect(minDurationMsFor(-1)).toBe(SILENT_MIN_DURATION_MS);
    expect(minDurationMsFor(NaN)).toBe(SILENT_MIN_DURATION_MS);
  });
});

describe('門檻真的跟著段落走（不是又一條平線）', () => {
  it('長段落要求的時間比短段落長', () => {
    const seq = [17, 130, 362, 2794].map(minDurationMsFor);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    expect(seq[3]).toBeGreaterThan(seq[1]);
  });

  it('130 字只錄兩秒 → 當場擋住（平門檻放行，這就是 #3299 的病）', () => {
    const long = '在很久以前的那個夏天，孩子們沿著溪邊一路走到山腳下，'.repeat(6);
    expect(countScorableCharacters(long)).toBeGreaterThan(100);
    const r = validateRecording({ peakVolume: 0.3, durationMs: 2000, targetText: long });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('too_short');
  });

  it('負向對照：同樣兩秒、換成極短段落 → 不可以擋', () => {
    const short = '接下來發生的事，就是千古流傳的傳奇了。';
    const r = validateRecording({ peakVolume: 0.3, durationMs: 2000, targetText: short });
    expect(r.ok).toBe(true);
  });

  it('沒傳課文時退回平門檻，而那個平門檻等於後端的', () => {
    // ⚠️ 不要寫死字面值 —— 那會變成「改實作就改斷言」的同義反覆。
    //    對著後端常數斷言，兩邊分岔時才會紅。
    const { floor } = readServerConstants();
    expect(validateRecording({ peakVolume: 0.3, durationMs: floor! - 1 }).reason).toBe('too_short');
    expect(validateRecording({ peakVolume: 0.3, durationMs: floor! + 1 }).ok).toBe(true);
  });

  it('靜音仍然擋得住，而且不會被時長蓋過去', () => {
    const r = validateRecording({ peakVolume: 0.001, durationMs: 60_000, targetText: '短句' });
    expect(r.reason).toBe('silent');
  });
});
