/**
 * #4161：從 AI 派發的卡點進來的課，建立學習紀錄時要帶 entry_source；
 * 自己挑的課、已有進行中紀錄而沒有新建時，都不能帶（也不能把標記留到之後）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLearningSessionBootstrap } from '../useLearningSessionBootstrap';
import { markEntrySource, takeEntrySource } from '../../utils/entrySource';

vi.mock('../../services/api', () => ({
  fetchStory: vi.fn().mockResolvedValue({ id: '20011', stepSequence: null, content: [] }),
  saveActiveSession: vi.fn(),
}));

const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
let fetchMock: ReturnType<typeof vi.fn>;

const setupFetch = (existing: { id: number } | null) => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { ok: true, json: async () => ({ id: 555 }) };
    return { ok: true, json: async () => ({ items: existing ? [existing] : [] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
};

const mount = (storyId = '20011') =>
  renderHook(() =>
    useLearningSessionBootstrap({ storyId, user: { id: 'u1' } as never, token: 'tok', navigate: vi.fn() }),
  );

describe('#4161 建立學習紀錄帶 entry_source', () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('從 AI 派發點進來：POST 帶 entry_source=ai_dispatch，標記用完就清掉', async () => {
    setupFetch(null);
    markEntrySource('20011');
    mount();
    await waitFor(() => expect(posts().length).toBeGreaterThan(0));
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toEqual({ story_slug: '20011', entry_source: 'ai_dispatch' });
    expect(takeEntrySource('20011')).toBeUndefined();
  });

  it('自己挑的課：POST 不帶 entry_source（對照）', async () => {
    setupFetch(null);
    mount();
    await waitFor(() => expect(posts().length).toBeGreaterThan(0));
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toEqual({ story_slug: '20011' });
  });

  it('標記是別課的：這一課的 POST 不帶', async () => {
    setupFetch(null);
    markEntrySource('99999');
    mount();
    await waitFor(() => expect(posts().length).toBeGreaterThan(0));
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toEqual({ story_slug: '20011' });
  });

  it('已有進行中紀錄、沒有新建：不 POST，而且標記被清掉，不會留給之後別次進入', async () => {
    setupFetch({ id: 321 });
    markEntrySource('20011');
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // 直接看儲存空間，不用 takeEntrySource：它讀的同時就會清掉，會把「沒清」蓋成「清了」
    await waitFor(() => expect(posts()).toHaveLength(0));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(sessionStorage.getItem('lingoleap_entry_source')).toBeNull());
    expect(posts()).toHaveLength(0);
  });
});
