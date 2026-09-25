import { describe, it, expect } from 'vitest';
import { underlinedFlagsByRawIndex } from '../underlinedTermsRenderer';

const on = (flags: boolean[]) => flags.map((f) => (f ? '1' : '.')).join('');

describe('underlinedFlagsByRawIndex', () => {
  it('標在詞的位置上，不多不少', () => {
    //            0123456789
    const text = '孟嘗君逃出秦國';
    expect(on(underlinedFlagsByRawIndex(text, ['孟嘗君', '秦國']))).toBe('111..11');
  });

  it('沒有詞表時整段都不標（不是整段都標）', () => {
    expect(on(underlinedFlagsByRawIndex('孟嘗君', []))).toBe('...');
    expect(on(underlinedFlagsByRawIndex('孟嘗君', null))).toBe('...');
    expect(on(underlinedFlagsByRawIndex('孟嘗君', undefined))).toBe('...');
  });

  it('同一個詞出現多次都要標', () => {
    expect(on(underlinedFlagsByRawIndex('臺東到臺東', ['臺東']))).toBe('11.11');
  });

  it('重疊的詞取聯集 —— 畫面上是一條連續底線', () => {
    // 「臺東」與「臺東市」都在表裡（L0063 真的是這樣）
    expect(on(underlinedFlagsByRawIndex('去臺東市玩', ['臺東', '臺東市']))).toBe('.111.');
  });

  it('旗標的基準是剝過 PUA 之後 —— 跟 data-ci 同一個索引', () => {
    // 注音變體選擇器（U+DB40 + low surrogate）在 data-ci 裡不佔位置。
    const withPua = '著󠄀頭緒';
    const flags = underlinedFlagsByRawIndex(withPua, ['頭緒']);
    expect(flags).toHaveLength(3);          // 著 頭 緒，選擇器不算一格
    expect(on(flags)).toBe('.11');
  });

  it('詞表裡有不存在於課文的詞時，不會標到別的地方', () => {
    // codex 窮舉時看到的情形：DOCX 的底線也會出現在練習區，
    // 那些詞不在課文裡，掃不到就是掃不到，不可以退而求其次去模糊比對。
    expect(on(underlinedFlagsByRawIndex('孟嘗君', ['韓信', '屈原']))).toBe('...');
  });

  it('空字串詞被忽略，不會把整段標起來', () => {
    expect(on(underlinedFlagsByRawIndex('孟嘗君', ['', '孟']))).toBe('1..');
  });
});
