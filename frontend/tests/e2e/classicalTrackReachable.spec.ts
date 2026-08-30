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
  await page.waitForTimeout(2500);

  // 側欄用單字縮寫（文／句／詞／戰），所以用點擊後的網址當判準，不是比字面
  for (const [label, want] of [['原文', 'classical-text'],
                               ['文白句子比對', 'classical-sentence-matching'],
                               ['文白詞語比對', 'classical-word-matching'],
                               ['自我挑戰', 'classical-self-challenge']] as const) {
    const nav = page.getByRole('button', { name: new RegExp(label) })
      .or(page.getByRole('link', { name: new RegExp(label) })).first();
    expect(await nav.count(), `側欄點不到「${label}」—— 學生走不到這一步`).toBeGreaterThan(0);
    await nav.click();
    await page.waitForTimeout(2000);
    expect(page.url(), `點「${label}」沒走到 ${want}`).toContain(want);
  }
});

test('文言文課的念順順讀的是原文，不是空的', async ({ page }) => {
  await loginAsStudent(page);
  await page.goto(`${FE}/learn/${CLASSICAL}/key-passage-reading`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const t = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
  expect(t, '沒走全文朗讀那條路 —— 這一軌學習單要的就是「朗讀原文」').toContain('從頭到尾讀完整篇文章');
  // 原文真的在畫面上（不是只有標題與說明）
  const zh = t.replace(/[^一-龥]/g, '');
  expect(zh.length, `畫面上只有 ${zh.length} 個中文字 —— 學生沒有東西可唸`).toBeGreaterThan(200);
  expect(t, '文言文原文沒出現').toMatch(/桓公|管子/);
});

test('來源沒有這個大題的課，側欄就不該有那一步', async ({ page }) => {
  await loginAsStudent(page);
  await page.goto(`${FE}/learn/${NO_SECTION}/lesson-intro`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
  expect(body, '學習單沒有這個大題，側欄卻列出「重點朗讀」—— 學生會以為漏做了什麼')
    .not.toContain('朗 重點朗讀');
});

test('正向對照：正常課仍然是「老師指定的重點段落」', async ({ page }) => {
  await loginAsStudent(page);
  await page.goto(`${FE}/learn/${NORMAL}/key-passage-reading`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const t = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
  // 少了這條，上面三條在「全部課都變成唸全文」的情況下仍然全綠
  expect(t, '正常課被降級成唸全文了 —— 那是 #2712 那條線修好的東西又壞了')
    .toContain('朗讀老師指定的重點段落');
});
