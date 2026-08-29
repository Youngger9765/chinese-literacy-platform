/**
 * Issue #2566 — 台灣口音通融（曾教授三類）計分 golden set。
 *
 * 決議：前後鼻音 / 捲舌 / n·l·r·l 這三類「台灣人常念錯的音」視為【唸對】——
 * 判為 `correct`（計入 correctCount / CPM 流暢率），不再只是 `forgiven`（只進通過率）。
 *
 * 正向：口音變體 → correct。
 * 負向控制：真的念錯（非這三類）仍判錯；真同音字仍為 forgiven（沒開太寬）。
 *
 * 這是 red-green regression：改動前 near-sound 走 forgiven，本檔對 `correct` 的斷言會紅。
 */

import { describe, it, expect } from 'vitest';
import { diffCharacters } from './textDiff';
import { isNearSound } from './pinyin';

/** 取單字 diff 結果的 token 型別（spoken vs target 皆單字）。
 *  注意：DiffResult 只暴露 correctCount（不含 forgivenCount）；forgiven 用 token.type 判斷。 */
function singleType(spoken: string, target: string) {
  const r = diffCharacters(spoken, target, { useHomophone: true });
  return { type: r.tokens[0]?.type, correctCount: r.correctCount };
}

describe('#2566 口音通融 → 判 correct（進 CPM）', () => {
  it('捲舌/不捲舌（zh↔z）：字 唸成 知 → correct', () => {
    const r = singleType('字', '知');
    expect(r.type).toBe('correct');
    expect(r.correctCount).toBe(1);
  });

  it('捲舌（sh↔s）：司 唸成 是 → correct', () => {
    expect(singleType('司', '是').type).toBe('correct');
  });

  it('n↔l：裡 唸成 你 → correct', () => {
    expect(singleType('裡', '你').type).toBe('correct');
  });

  it('計入 CPM：整段口音變體全部算 correctCount（兩字兩對近音）', () => {
    // target 是課文、spoken 是帶口音的學生朗讀（是→司、知→字 皆近音）
    const r = diffCharacters('司字', '是知', { useHomophone: true });
    expect(r.correctCount).toBe(2); // 兩字皆 correct → 無 forgiven
  });
});

describe('#2566 負向控制（沒開太寬）', () => {
  it('真同音字（河/和）仍為 forgiven，不算進 correctCount', () => {
    const r = singleType('和', '河');
    expect(r.type).toBe('forgiven');
    expect(r.correctCount).toBe(0);
  });

  it('真的念錯（非三類，馬≠知）不判 correct', () => {
    const r = diffCharacters('馬', '知', { useHomophone: true });
    expect(r.correctCount).toBe(0);
    // 非 correct/forgiven（wrong 或對不上）
    expect(r.tokens.every((t) => t.type !== 'correct' && t.type !== 'forgiven')).toBe(true);
  });

  it('isNearSound 仍嚴格：相同字 / 真同音字不算 near-sound', () => {
    expect(isNearSound('中', '中')).toBe(false);
    expect(isNearSound('河', '和')).toBe(false);
  });
});
