/**
 * 朗讀取句子時，slug 要一路帶到後端（#2930）。
 *
 * 少了它：`lesson_id + 段落序號` 定址的是整課頂層（＝第 1 篇），
 * 於是第 3 篇的段落被換成第 1 篇的句子 —— 畫面第 3 篇、聲音第 1 篇。
 * 快取 key 也要分篇，否則三篇共用一份，第一篇先到就把後兩篇釘死。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const MAPPING = {
  paragraphs: [{ index: 0, sentences: [{ text: '第一句。' }] }],
};

describe('TTS 句子對照表要跟著篇次走', () => {
  let speakText: typeof import('../ttsApi').speakText;
  let calls: string[];

  beforeEach(async () => {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => MAPPING, blob: async () => new Blob() };
    }));
    vi.stubGlobal('Audio', class { play() { return Promise.resolve(); } pause() {} addEventListener() {} removeEventListener() {} });
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    vi.resetModules();
    speakText = (await import('../ttsApi')).speakText;
  });

  const mappingCalls = () => calls.filter((u) => u.includes('/api/tts/mapping/'));

  it('帶了篇次 → 對照表網址要帶 p=', async () => {
    await speakText('第一句。', 20063, 0, '7wavn').catch(() => {});
    const m = mappingCalls();
    expect(m.length, '完全沒去要對照表').toBeGreaterThan(0);
    expect(m.some((u) => u.includes('p=7wavn')), `對照表網址沒帶篇次：${m}`).toBe(true);
  });

  it('不同篇次要各自去要，不可共用一份快取', async () => {
    await speakText('第一句。', 20063, 0, '7wavn').catch(() => {});
    await speakText('第一句。', 20063, 0, 'p3kud').catch(() => {});
    const slugs = new Set(mappingCalls().map((u) => /[?&]p=([^&]+)/.exec(u)?.[1] ?? null));
    expect(slugs, '第二篇沿用了第一篇的快取').toEqual(new Set(['7wavn', 'p3kud']));
  });

  it('沒有篇次時維持原樣（單篇課不可回歸）', async () => {
    await speakText('第一句。', 20063, 0).catch(() => {});
    expect(mappingCalls().some((u) => u.includes('p=')), '單篇課不該帶 p=').toBe(false);
  });
});
