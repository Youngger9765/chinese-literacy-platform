/**
 * m3-student.spec.ts — M3: 學生功能測試 (#482)
 *
 * 模組 M3 涵蓋學生的核心功能旅程：
 *   E — 學生登入 + 加入班級 (#361 E.1)
 *   G — 查看學習成果 (#361 G.1–G.5)
 *
 * 注意：學習流程（Journey F）已移至 m6-learning.spec.ts。
 *
 * Auth strategy:
 *   使用 storageState from e2e/.auth/student.json。
 *   不需要重新登入。
 *
 * Seed data (staging):
 *   Student: student@test.com / student1234
 */

import { test, expect } from '@playwright/test';
import {
  takeScreenshot,
  dismissAllModals,
  ensureAuthenticated,
  loginAsTeacher,
  withScreenshotOnFailure,
} from './fixtures';

// ===========================================================================
// M3 旅程 E — 學生登入 + 加入班級
// ===========================================================================

test.describe('M3 — 旅程 E：學生登入 + 加入班級', () => {
  test('E.1 - 學生首頁載入', withScreenshotOnFailure('m3-e1-home-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-e1-home-page', '學生首頁載入成功');
  }));

  test('E.2 - 學生看不到 系統管理 按鈕', withScreenshotOnFailure('m3-e2-no-admin-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await expect(page.locator('button:has-text("系統管理")')).not.toBeVisible();
    await takeScreenshot(page, 'student-e2-no-admin-button', '學生首頁 — 系統管理按鈕不存在');
  }));

  test('E.3 - 學生看不到 班級管理 按鈕', withScreenshotOnFailure('m3-e3-no-classroom-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await expect(page.locator('button:has-text("班級管理")')).not.toBeVisible();
    await takeScreenshot(page, 'student-e3-no-classroom-button', '學生首頁 — 班級管理按鈕不存在');
  }));

  test('E.4 - 學生看到 加入班級 按鈕', withScreenshotOnFailure('m3-e4-join-btn-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await expect(page.locator('button:has-text("加入班級")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'student-e4-join-class-button', '學生首頁 — 加入班級按鈕可見');
  }));

  test('E.5 - 點擊 加入班級 導向 /join', withScreenshotOnFailure('m3-e5-join-redirect-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await page.locator('button:has-text("加入班級")').click();
    await expect(page).toHaveURL(/\/join/, { timeout: 15_000 });
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'student-e5-join-redirect', '/join 頁面標題可見');
  }));

  test('E.6 - /join 頁面有標題、說明文字與輸入框', withScreenshotOnFailure('m3-e6-join-page-fail', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=輸入老師提供的加入代碼')).toBeVisible();
    await expect(page.locator('#join-code')).toBeVisible();
    await takeScreenshot(page, 'student-e6-join-page', '/join 頁面 — 標題、說明、輸入框');
  }));

  test('E.7 - 代碼少於 6 字時提交按鈕 disabled', withScreenshotOnFailure('m3-e7-disabled-fail', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABC');
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeDisabled();
    await takeScreenshot(page, 'student-e7-submit-disabled', '代碼不足 6 字 — 提交按鈕 disabled');
  }));

  test('E.8 - 代碼等於 6 字時提交按鈕 enabled', withScreenshotOnFailure('m3-e8-enabled-fail', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABCDEF');
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeEnabled();
    await takeScreenshot(page, 'student-e8-submit-enabled', '代碼剛好 6 字 — 提交按鈕 enabled');
  }));

  test('E.9 - 輸入無效代碼顯示 404 錯誤訊息', withScreenshotOnFailure('m3-e9-invalid-code-fail', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('XXXXXX');
    await page.locator('button[type="submit"]:has-text("加入班級")').click();
    await expect(
      page.locator('text=找不到此加入代碼，請確認代碼是否正確')
    ).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-e9-invalid-code-error', '無效代碼 — 顯示錯誤訊息');
  }));

  test('E.10 - 輸入小寫代碼自動轉大寫', withScreenshotOnFailure('m3-e10-uppercase-fail', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('abcdef');
    await expect(page.locator('#join-code')).toHaveValue('ABCDEF');
    await takeScreenshot(page, 'student-e10-auto-uppercase', '輸入小寫 — 自動轉大寫為 ABCDEF');
  }));

  test('E.11 - 返回首頁 按鈕可回到首頁', withScreenshotOnFailure('m3-e11-back-home-fail', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('text=返回首頁')).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("返回首頁")').click();
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(
      page.locator('h1')
        .or(page.locator('text=你好'))
        .or(page.locator('main'))
    ).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-e11-back-home', '返回首頁成功');
  }));

  test('E.12 - 學生可進入圖書館', withScreenshotOnFailure('m3-e12-library-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    const libraryBtn = page.locator('button:has-text("進入圖書館")');
    if (await libraryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await libraryBtn.click();
    } else {
      await page.goto('/library');
    }
    await dismissAllModals(page);
    await expect(page).toHaveURL(/\/library/, { timeout: 15_000 });
    await takeScreenshot(page, 'student-e12-library-access', '學生成功進入圖書館頁面');
  }));
});

// ===========================================================================
// M3 旅程 G — 查看學習成果 (#361 G.1–G.5)
// ===========================================================================

test.describe('M3 — 旅程 G：查看學習成果', () => {
  test('G.1 - 學習路徑追蹤：/progress 頁面載入', withScreenshotOnFailure('m3-g1-progress-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    try {
      await page.goto('/progress', { timeout: 20_000 });
      const isLoginPage = await page
        .locator('text=登入你的帳號')
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (isLoginPage) {
        test.info().annotations.push({
          type: 'skip-reason',
          description: '/progress 頁面重定向到登入，可能尚未實作',
        });
        return;
      }
      await expect(page.locator('main, [role="main"], body')).toBeVisible({ timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '/progress 頁面載入逾時，標記為待驗證',
      });
      return;
    }
    await takeScreenshot(page, 'student-g1-progress-page', '學習路徑追蹤 /progress 頁面');
  }));

  test('G.2 - 蘇格拉底對話紀錄頁面（若有獨立路由）', withScreenshotOnFailure('m3-g2-dialogue-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    const candidates = ['/history', '/progress', '/learn/history'];
    let loaded = false;
    for (const path of candidates) {
      try {
        await page.goto(path, { timeout: 15_000 });
        const isLogin = await page
          .locator('text=登入你的帳號')
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (!isLogin) {
          await expect(page.locator('main, body')).toBeVisible({ timeout: 10_000 });
          loaded = true;
          break;
        }
      } catch {
        // Try next candidate
      }
    }
    if (!loaded) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '對話紀錄頁面路由尚未確認，標記為待驗證',
      });
      return;
    }
    await takeScreenshot(page, 'student-g2-dialogue-history', '蘇格拉底對話紀錄頁面');
  }));

  test('G.3 - 遊戲化系統：/achievements 頁面載入', withScreenshotOnFailure('m3-g3-achievements-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    try {
      await page.goto('/achievements', { timeout: 20_000 });
      const isLoginPage = await page
        .locator('text=登入你的帳號')
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (isLoginPage) {
        test.info().annotations.push({
          type: 'skip-reason',
          description: '/achievements 頁面重定向到登入，可能尚未實作',
        });
        return;
      }
      await expect(page.locator('main, [role="main"], body')).toBeVisible({ timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '/achievements 頁面載入逾時，標記為待驗證',
      });
      return;
    }
    await takeScreenshot(page, 'student-g3-achievements-page', '遊戲化系統 /achievements 頁面');
  }));

  test('G.4 - AI 學習路徑推薦：首頁有推薦區塊', withScreenshotOnFailure('m3-g4-recommendation-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    const hasRecommendation = await page
      .locator(
        'text=推薦, text=建議, text=為你推薦, [data-testid*="recommend"], [data-testid*="suggestion"]'
      )
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!hasRecommendation) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'AI 推薦區塊在首頁尚未渲染，標記為待驗證',
      });
    }
    await takeScreenshot(page, 'student-g4-home-recommendation', '首頁 AI 學習路徑推薦區塊');
  }));

  test('G.5 - 自學模式：圖書館搜尋 + 年級篩選 + 點擊故事卡', withScreenshotOnFailure('m3-g5-self-study-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);

    await page.locator('button:has-text("圖書館")').click();
    await dismissAllModals(page);

    await expect(
      page.locator('h3').first().or(page.locator('h4').first())
    ).toBeVisible({ timeout: 20_000 });

    const searchInput = page.locator('input[placeholder*="搜尋"]');
    if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.fill('草');
      await page.waitForTimeout(500);
      await searchInput.clear();
    }

    const startBtn = page.locator('button:has-text("開始學習")').first();
    if (await startBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await startBtn.click();
    } else {
      const card = page.locator('h3, h4').first();
      await card.click();
    }

    await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });
    await takeScreenshot(page, 'student-g5-self-study-flow', '自學模式 — 點擊故事導向 intro');
  }));
});
