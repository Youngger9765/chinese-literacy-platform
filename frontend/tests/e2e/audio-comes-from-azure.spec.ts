import { test, expect } from '@playwright/test';

/**
 * 朗讀必須真的是後端合成的音檔，不是瀏覽器內建語音（#2930）。
 *
 * `useTtsPlayback` 在後端失敗時會**靜默**降級成 `speechSynthesis` ——
 * 聽起來「有聲音」，網路面看不出異狀，只有耳朵分得出那是機器人音。
 * 擁有者 2026-08-26：「為什麼是機器人音？？？？？ 我們應該用 azure 啊」
 *
 * 所以判準是三件事一起看，缺一不可：
 *   1. `/api/tts/synthesize` 回 `audio/mpeg`（不是 JSON 錯誤、不是 0 位元組）
 *   2. 音檔夠大 —— 一整段話的 Azure mp3 是幾百 KB 等級
 *   3. `speechSynthesis.speak` 一次都沒被呼叫
 *
 * 只驗「送出去的文字對不對」是不夠的：文字可以完全正確，
 * 而播出來的是機器人音（我就是這樣連報了三次「聲音對了」）。
 */

// CI 用 PLAYWRIGHT_BASE_URL 指到該 PR 的 preview（見 playwright.config.ts）。
// 讀錯變數名的話，PR 上跑的是 staging —— 綠燈驗的不是這次的改動。
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
const MIN_MP3_BYTES = 20_000;   // 一句話的 Azure mp3 都遠大於此；降級路徑則是 0 個請求

type Probe = { audio: Array<{ status: number; type: string; bytes: number }>; spoke: string[] };

async function playAndProbe(page: import('@playwright/test').Page, path: string): Promise<Probe> {
  const audio: Probe['audio'] = [];
  await page.addInitScript(() => {
    const s = window.speechSynthesis;
    if (!s?.speak) return;
    const orig = s.speak.bind(s);
    s.speak = (u: SpeechSynthesisUtterance) => {
      // 只記真的有字的。`useTtsPlayback` 會先送一個**空字串** utterance 暖機
      // （為了在 async fetch 之前保住使用者手勢），那不是機器音 ——
      // 把它算進來會讓每一次正常播放都被判成降級（我第一版就是這樣誤報的）。
      const t = String(u.text ?? '');
      if (t.trim()) {
        (window as unknown as { __spoke: string[] }).__spoke ??= [];
        (window as unknown as { __spoke: string[] }).__spoke.push(t.slice(0, 20));
      }
      return orig(u);
    };
  });
  page.on('response', (r) => {
    if (!/\/api\/tts\/synthesize/i.test(r.url())) return;
    const h = r.headers();
    audio.push({
      status: r.status(),
      type: h['content-type'] ?? '',
      bytes: Number(h['content-length'] ?? 0),
    });
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /小明/ }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /播放全文/ }).first().click();
  await page.waitForResponse((r) => /\/api\/tts\/synthesize/i.test(r.url()), { timeout: 45_000 })
    .catch(() => undefined);
  await page.waitForTimeout(4000);

  const spoke = await page.evaluate(() => (window as unknown as { __spoke?: string[] }).__spoke ?? []);
  return { audio, spoke };
}

for (const [label, path] of [
  ['多篇課的第 3 篇', '/learn/20063/full-text-annotate?p=7wavn'],
  ['單篇課（對照組，確保沒因為篇次改動而壞掉）', '/learn/20010/full-text-annotate'],
] as const) {
  test(`朗讀是後端音檔不是機器人音 — ${label}`, async ({ page }) => {
    const { audio, spoke } = await playAndProbe(page, path);

    expect(audio.length, '完全沒去後端要音檔 —— 這就是降級成瀏覽器語音的樣子').toBeGreaterThan(0);
    for (const a of audio) {
      expect(a.status, `後端回 ${a.status}`).toBe(200);
      expect(a.type, `回的不是音檔而是 ${a.type}`).toContain('audio/');
      expect(a.bytes, `音檔只有 ${a.bytes} 位元組`).toBeGreaterThan(MIN_MP3_BYTES);
    }
    expect(spoke, `瀏覽器語音被呼叫了 ${spoke.length} 次 —— 那是機器人音`).toEqual([]);
  });
}

test('把後端打掉時，使用者一定會知道 —— 不可以安靜地換成機器音', async ({ page }) => {
  await page.addInitScript(() => {
    const sy = window.speechSynthesis;
    if (!sy?.speak) return;
    const orig = sy.speak.bind(sy);
    sy.speak = (u: SpeechSynthesisUtterance) => {
      // 只記真的有字的。`useTtsPlayback` 會先送一個**空字串** utterance 暖機
      // （為了在 async fetch 之前保住使用者手勢），那不是機器音 ——
      // 把它算進來會讓每一次正常播放都被判成降級（我第一版就是這樣誤報的）。
      const t = String(u.text ?? '');
      if (t.trim()) {
        (window as unknown as { __spoke: string[] }).__spoke ??= [];
        (window as unknown as { __spoke: string[] }).__spoke.push(t.slice(0, 20));
      }
      return orig(u);
    };
  });
  const intercepted: number[] = [];
  await page.route('**/api/tts/synthesize*', async (route) => {
    intercepted.push(1);
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"injected"}' });
  });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /小明/ }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await page.goto(`${BASE}/learn/20063/full-text-annotate?p=7wavn`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /播放全文/ }).first().click();
  await page.waitForTimeout(8000);

  // 注入確實生效，否則下面在測一個沒被打掉的後端
  expect(intercepted.length, '攔截沒生效 —— 這次結論作廢').toBeGreaterThan(0);

  const spoke = await page.evaluate(() => (window as unknown as { __spoke?: string[] }).__spoke ?? []);
  const body = (await page.locator('body').innerText()).replace(/\s/g, '');
  const saidSomething = /系統語音|不是AI朗讀|連不上|失敗|重試/.test(body);

  // 兩條路都可以，安靜地播機器音不可以 —— 那正是擁有者遇到的：
  // 聽起來不對，畫面上一句話都沒說。
  expect(
    saidSomething || spoke.length === 0,
    `降級了（瀏覽器語音 ${spoke.length} 次）但畫面沒有任何說明`,
  ).toBe(true);
});
