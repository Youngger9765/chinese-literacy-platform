import { test, expect } from '@playwright/test';

/**
 * 文言文那一軌：學生從**真側欄**走得到，而且念順順讀的是原文（#2752 / #2730 週邊）。
 *
 * ⚠️ 這條存在的理由是我自己犯的錯：2026-08-31 我從資料層看到
 * `has_key_reading=false`，就在總帳本寫下「🔴 真缺口 —— 學習單上有這個大題，
 * 學生在平台上看不到」。**真的走一次才發現學生看得到** ——
 * 那一步在側欄裡，畫面上寫「從頭到尾讀完整篇文章」，下面就是文言文原文，
 * 而學習單要的正是「請用計時器，朗讀原文」。
 *
 * 資料層的旗標回答的是「有沒有指定重點段」，不是「學生有沒有東西可練」。
 * 兩者差一個 fallback，而那個 fallback 正是這一軌的正解。
 *
 * #4045（E2E flakiness 盤點）：原本每一步都是「固定等 2–3 秒 → 拍一次快照
 * 斷言」。固定延遲在 staging 部署期間或冷啟動（backend min-instances=0）
 * 時不夠，波動性失敗因此跟改動本身無關（兩次 production 失敗分別發生在
 * staging 部署視窗重疊、以及與本檔完全無關的 PR）——本機對 staging 連續
 * 跑 10 次全線乾淨通過，證實不是產品行為退化。修法：正向斷言（應該出現的
 * 內容/網址）換成會自動重試的 `expect(locator).toBeVisible()` /
 * `expect(page).toHaveURL()` / `expect.poll()`，給夠寬的上限（20s）而不是
 * 猜一個固定秒數；重試會停在「真的等到」或「上限到了才真的失敗」，不是
 * "retry the whole test" 那種作弊式重跑。
 * 否定斷言（不應該出現的內容，見第三個 test）不可比照辦理：
 * `expect.poll(...).not.toContain(x)` 在畫面還沒渲染完時「不包含 x」永遠
 * 為真，那是問得太早、不是驗證——所以那裡改成先等一個「這頁一定會有」的
 * 錨點渲染出來，確認側欄真的畫完，再做一次性的否定快照判斷。
 */
const FE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';

test.describe.configure({ timeout: 300_000 });

async function loginAsStudent(page) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  const demo = page.getByRole('button', { name: /小明/ }).first();
  // 環境不合格 → 標 INVALID 不是 FAIL（沒有一鍵登入鈕代表這個環境沒開 demo login）
  if (!(await demo.count())) test.skip(true, '環境不合格：登入頁沒有一鍵登入鈕（INVALID，非 FAIL）');
  await demo.click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

const CLASSICAL = '20155';   // 不流血的戰爭（文-L12）
const NO_SECTION = '20021';  // 正太與小豬 —— 來源學習單沒有念順順
const NORMAL = '20003';      // 大自然的氣象小幫手 —— 有指定重點段（正向對照）

test('文言文課：四個 step 在真側欄裡，點得進去', async ({ page }) => {
  await loginAsStudent(page);
  await page.goto(`${FE}/learn/${CLASSICAL}/lesson-intro`, { waitUntil: 'networkidle' });

  // 側欄用單字縮寫（文／句／詞／戰），所以用點擊後的網址當判準，不是比字面
  for (const [label, want] of [['原文', 'classical-text'],
                               ['文白句子比對', 'classical-sentence-matching'],
                               ['文白詞語比對', 'classical-word-matching'],
                               ['自我挑戰', 'classical-self-challenge']] as const) {
    const nav = page.getByRole('button', { name: new RegExp(label) })
      .or(page.getByRole('link', { name: new RegExp(label) })).first();
    await expect(nav, `側欄點不到「${label}」—— 學生走不到這一步`).toBeVisible({ timeout: 20_000 });
    await nav.click();
    await expect(page, `點「${label}」沒走到 ${want}`).toHaveURL(new RegExp(want), { timeout: 20_000 });
  }
});

test('文言文課的念順順讀的是原文，不是空的', async ({ page }) => {
  await loginAsStudent(page);
  await page.goto(`${FE}/learn/${CLASSICAL}/key-passage-reading`, { waitUntil: 'networkidle' });
  const mainText = async () => (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');

  await expect.poll(mainText, {
    timeout: 20_000,
    message: '沒走全文朗讀那條路 —— 這一軌學習單要的就是「朗讀原文」',
  }).toContain('從頭到尾讀完整篇文章');

  const t = await mainText();
  // 原文真的在畫面上（不是只有標題與說明）
  const zh = t.replace(/[^一-龥]/g, '');
  expect(zh.length, `畫面上只有 ${zh.length} 個中文字 —— 學生沒有東西可唸`).toBeGreaterThan(200);
  expect(t, '文言文原文沒出現').toMatch(/桓公|管子/);
});

test('來源沒有這個大題的課，側欄就不該有那一步', async ({ page }) => {
  await loginAsStudent(page);
  await page.goto(`${FE}/learn/${NO_SECTION}/lesson-intro`, { waitUntil: 'networkidle' });

  // 這是否定斷言（不應該出現「重點朗讀」）——不能用 expect.poll(...).not.toContain()，
  // 畫面還沒渲染完時「不包含」永遠為真，那不是驗證過，是問得太早。先等一個
  // 「這頁一定會有」的錨點（lesson-intro 自己這一步的側欄項目）確認側欄真的畫完。
  const sidebarReady = page.getByRole('button', { name: /課程簡介/ })
    .or(page.getByRole('link', { name: /課程簡介/ })).first();
  await expect(sidebarReady, '側欄連自己這一步（課程簡介）都沒畫出來 —— 頁面可能根本沒載入').toBeVisible({ timeout: 20_000 });

  const body = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
  expect(body, '學習單沒有這個大題，側欄卻列出「重點朗讀」—— 學生會以為漏做了什麼')
    .not.toContain('朗 重點朗讀');
});

test('正向對照：正常課仍然是「老師指定的重點段落」', async ({ page }) => {
  await loginAsStudent(page);
  await page.goto(`${FE}/learn/${NORMAL}/key-passage-reading`, { waitUntil: 'networkidle' });
  const mainText = async () => (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');

  // 少了這條，上面三條在「全部課都變成唸全文」的情況下仍然全綠
  await expect.poll(mainText, {
    timeout: 20_000,
    message: '正常課被降級成唸全文了 —— 那是 #2712 那條線修好的東西又壞了',
  }).toContain('朗讀老師指定的重點段落');
});
