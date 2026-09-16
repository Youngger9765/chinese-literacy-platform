/**
 * #3242 —— E2E 部署穩定 preflight 的單元鎖。
 *
 * ⚠️ 這個檔住在 `src/__tests__/` 而不是被測對象旁邊 —— `vitest.config` 的
 * `exclude` 把 `tests/e2e/**` 整個排除（那是 playwright 的地盤）。
 * 放在那裡會**一條都不跑而且沒有任何錯誤訊息**（`No test files found`）。
 *
 * ⛔ 這幾條驗的是**判斷邏輯**，不需要真環境；真環境那半由 preflight 自己在 CI 跑時驗。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForStableDeploy } from '../../tests/e2e/waitForStableDeploy';

const html = (h: string) =>
  `<!doctype html><html><head><script type="module" src="/assets/index-${h}.js"></script></head></html>`;

describe('#3242 部署穩定 preflight', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('⭐ 連續兩次同一個 hash → 通過，並回報那個 hash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html('AAA') })) as never);
    const p = waitForStableDeploy('http://x', { probeGapMs: 10, budgetMs: 1000 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toMatchObject({ fingerprint: '/assets/index-AAA.js' });
  });

  it('⭐ hash 一直在變 → throw，而且訊息要說「INVALID 不是 FAIL」', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html(`H${n++}`) })) as never);
    const p = waitForStableDeploy('http://x', { probeGapMs: 10, budgetMs: 100 });
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(500);
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    // ⛔ 這個字串是重點：紅的原因要能被人一眼分辨
    expect((err as Error).message).toContain('INVALID');
    expect((err as Error).message).toContain('不是 FAIL');
    expect((err as Error).message).toContain('#3242');
  });

  it('⭐ 先變一次再穩定 → 等到穩定為止（不是第一次不同就放棄）', async () => {
    const seq = ['A', 'B', 'B'];
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html(seq[Math.min(i++, 2)]) })) as never);
    const p = waitForStableDeploy('http://x', { probeGapMs: 10, budgetMs: 1000 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toMatchObject({ fingerprint: '/assets/index-B.js' });
  });

  it('⛔ 取不到 hash 時不可以當成「穩定」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '<html>沒有 entry</html>' })) as never);
    const p = waitForStableDeploy('http://x', { probeGapMs: 10, budgetMs: 100 });
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await caught).toBeInstanceOf(Error);
  });

  it('⛔ 站台掛掉（非 2xx）時也不可以當成「穩定」', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })) as never);
    const p = waitForStableDeploy('http://x', { probeGapMs: 10, budgetMs: 100 });
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(500);
    expect(await caught).toBeInstanceOf(Error);
  });
});
