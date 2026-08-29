/**
 * 用**真的 API 回應**跑完整條路徑（#2930）。
 *
 * 之前的 fixture 是我自己編的形狀，測試全綠而 staging 播錯篇 ——
 * 編出來的 fixture 只驗得到我的想像。這份是 staging 真回應存下來的。
 *
 * 走的是真 user 的那條：fetchStory（含 snake→camel 對應）→ storyForStep。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import real from './fixtures/L0063.real.json';

const ROUNDS = ['p3kud', '4uee3', '7wavn'] as const;

describe('L0063 真 payload：每一輪的每個重複模組都要換過去', () => {
  let fetchStory: typeof import('../../services/api').fetchStory;
  let storyForStep: typeof import('../../services/api').storyForStep;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => real,
    })));
    vi.resetModules();
    const api = await import('../../services/api');
    fetchStory = api.fetchStory;
    storyForStep = api.storyForStep;
  });

  it('帳本有接上（沒接上的話後面每一條都會假綠）', async () => {
    const story = await fetchStory('20063');
    expect(story?.manifestSections?.length, '帳本沒對應到前端 → 一輪都切不了').toBeGreaterThan(0);
  });

  it('讀全文：三輪的課文各不相同', async () => {
    const story = await fetchStory('20063');
    const firsts = ROUNDS.map((r) => storyForStep(story, `full-text-annotate#${r}`)?.content?.[0] ?? '');
    expect(new Set(firsts).size, `三輪首段：${firsts.map((s) => s.slice(0, 12))}`).toBe(3);
  });

  it('念順順：三輪的重點段各不相同', async () => {
    const story = await fetchStory('20063');
    const p = ROUNDS.map((r) => storyForStep(story, `key-passage-reading#${r}`)?.keyReading?.passage ?? '');
    expect(new Set(p).size, `三輪重點段：${p.map((s) => s.slice(0, 12))}`).toBe(3);
  });
});
