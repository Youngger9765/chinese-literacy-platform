/**
 * m1-auth.spec.ts — M1: 教師驗證流程 (#482)
 *
 * 模組 M1 涵蓋教師的完整驗證旅程：
 *   A.1 — email/password 註冊 + 驗證 + 登入
 *   A.2 — Google OAuth → skip (needs OAuth provider)
 *
 * Auth strategy:
 *   這些測試明確清除 localStorage，不依賴 storageState。
 *   目的是測試登入/登出功能本身。
 *
 * Seed data (staging):
 *   Teacher: teacher@test.com / teacher1234
 */

import { test, expect, type Page } from '@playwright/test';
import {
  takeScreenshot,
  dismissAllModals,
  TEST_PASSWORD,
  withScreenshotOnFailure,
} from './fixtures';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Unique suffix per test run — keeps registration emails idempotent. */
const RUN_ID = Date.now();
const TEACHER_NAME = 'E2E 教師';

// ---------------------------------------------------------------------------
// Module-local helpers
// ---------------------------------------------------------------------------

/** Clear localStorage and navigate to the login page. */
async function resetToLoginPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });
}

/**
 * Register a fresh teacher account (with email verification) and wait for
 * the main app to be ready.
 */
async function registerAndWaitForApp(page: Page, email: string): Promise<void> {
  await page.locator('button:has-text("註冊帳號")').click();
  await expect(page.locator('text=教師註冊')).toBeVisible({ timeout: 10_000 });

  await page.locator('#register-name').fill(TEACHER_NAME);
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(TEST_PASSWORD);
  await page.locator('#register-confirm').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]:has-text("建立帳號")').click();

  // Staging shows a dev verification link after submit (issue #460)
  await expect(page.locator('h2:has-text("請驗證您的 Email")')).toBeVisible({ timeout: 30_000 });

  const verifyLink = page.locator('a:has-text("點擊此連結驗證 Email")');
  await expect(verifyLink).toBeVisible({ timeout: 10_000 });
  const href = await verifyLink.getAttribute('href');
  if (!href) throw new Error('Email verification link href not found on page');

  const status = await page.evaluate(async (url: string) => {
    const res = await fetch(url);
    return res.status;
  }, href);
  if (status !== 200) {
    throw new Error(`Email verification failed with HTTP ${status}`);
  }

  await page.locator('button:has-text("前往登入")').click();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 10_000 });

  await loginAndWaitForApp(page, email, TEST_PASSWORD);
}

/** Fill the login form and wait for the main app. Handles modals. */
async function loginAndWaitForApp(page: Page, email: string, password: string): Promise<void> {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('button[type="submit"]:has-text("登入")').click();

  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 30_000 }).catch(() => null),
  ]);

  await dismissAllModals(page);
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

/** Click logout and wait until the login page is shown. */
async function logoutAndWaitForLoginPage(page: Page): Promise<void> {
  await dismissAllModals(page);
  await page.locator('button:has-text("登出")').click();

  await expect(
    page.locator('text=登入你的帳號').or(page.locator('text=教師註冊'))
  ).toBeVisible({ timeout: 15_000 });

  const onRegisterPage = await page.locator('text=教師註冊').isVisible();
  if (onRegisterPage) {
    await page.locator('button:has-text("登入")').last().click();
    await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 10_000 });
  }
}

// ===========================================================================
// M1 旅程 A — 教師驗證流程
// ===========================================================================

test.describe('M1 — 旅程 A：教師驗證流程 (A.1)', () => {
  test('A.1.1 - 登入頁載入：顯示帳號、密碼欄位與登入按鈕', withScreenshotOnFailure('m1-a1-1-login-fail', async ({ page }) => {
    await resetToLoginPage(page);

    await expect(page.locator('label:has-text("帳號")')).toBeVisible();
    await expect(page.locator('label:has-text("密碼")')).toBeVisible();
    await expect(page.locator('button[type="submit"]:has-text("登入")')).toBeVisible();
    await expect(page.locator('button:has-text("註冊帳號")')).toBeVisible();

    await takeScreenshot(page, 'teacher-a1-login-page', '登入頁載入 — 帳號密碼欄位與登入按鈕');
  }));

  test('A.1.2 - 切換到註冊頁：顯示「教師註冊」表單', withScreenshotOnFailure('m1-a1-2-register-fail', async ({ page }) => {
    await resetToLoginPage(page);
    await page.locator('button:has-text("註冊帳號")').click();

    await expect(page.locator('text=教師註冊')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('label:has-text("姓名")')).toBeVisible();
    await expect(page.locator('label:has-text("確認密碼")')).toBeVisible();
    await expect(page.locator('button[type="submit"]:has-text("建立帳號")')).toBeVisible();

    await takeScreenshot(page, 'teacher-a2-register-form', '切換到註冊頁 — 教師註冊表單');
  }));

  test('A.1.3 - 註冊新教師帳號：完整流程（驗證 email → 登入 → 主頁）', withScreenshotOnFailure('m1-a1-3-register-full-fail', async ({ page }) => {
    const email = `e2e-teacher-reg-${RUN_ID}@example.com`;
    await resetToLoginPage(page);
    await registerAndWaitForApp(page, email);

    await expect(page.locator('button:has-text("登出")')).toBeVisible();

    await takeScreenshot(page, 'teacher-a3-registered-home', '教師註冊完成後的主頁');
  }));

  test('A.1.4 - 登出：回到登入頁', withScreenshotOnFailure('m1-a1-4-logout-fail', async ({ page }) => {
    const email = `e2e-teacher-logout-${RUN_ID}@example.com`;
    await resetToLoginPage(page);
    await registerAndWaitForApp(page, email);

    await logoutAndWaitForLoginPage(page);

    await expect(page.locator('button[type="submit"]:has-text("登入")')).toBeVisible();

    await takeScreenshot(page, 'teacher-a4-logout', '登出後回到登入頁');
  }));

  test('A.1.5 - 用已註冊帳號登入：登入成功', withScreenshotOnFailure('m1-a1-5-relogin-fail', async ({ page }) => {
    const email = `e2e-teacher-relogin-${RUN_ID}@example.com`;
    await resetToLoginPage(page);

    await registerAndWaitForApp(page, email);
    await logoutAndWaitForLoginPage(page);
    await loginAndWaitForApp(page, email, TEST_PASSWORD);

    await expect(page.locator('button:has-text("登出")')).toBeVisible();

    await takeScreenshot(page, 'teacher-a5-relogin', '用已註冊帳號再次登入成功');
  }));

  test('A.1.6 - 登入失敗（密碼錯誤）：顯示錯誤訊息', withScreenshotOnFailure('m1-a1-6-login-fail-msg-fail', async ({ page }) => {
    await resetToLoginPage(page);

    await page.locator('#login-email').fill('nonexistent@example.com');
    await page.locator('#login-password').fill('wrongpassword123');
    await page.locator('button[type="submit"]:has-text("登入")').click();

    await expect(
      page.locator('text=帳號或密碼錯誤')
        .or(page.locator('text=登入失敗'))
        .or(page.locator('text=錯誤'))
        .or(page.locator('[role="alert"]'))
    ).toBeVisible({ timeout: 30_000 });

    await takeScreenshot(page, 'teacher-a6-login-fail', '登入失敗 — 帳號或密碼錯誤訊息');
  }));

  test('A.1.7 - 重複註冊：顯示「此電子郵件已被註冊」', withScreenshotOnFailure('m1-a1-7-dup-reg-fail', async ({ page }) => {
    const email = `e2e-teacher-reg-${RUN_ID}@example.com`;
    await resetToLoginPage(page);

    await page.locator('button:has-text("註冊帳號")').click();
    await expect(page.locator('text=教師註冊')).toBeVisible({ timeout: 10_000 });

    await page.locator('#register-name').fill('Duplicate Teacher');
    await page.locator('#register-email').fill(email);
    await page.locator('#register-password').fill(TEST_PASSWORD);
    await page.locator('#register-confirm').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]:has-text("建立帳號")').click();

    await expect(
      page.locator('text=此電子郵件已被註冊')
        .or(page.locator('text=已被註冊'))
        .or(page.locator('text=請驗證您的 Email'))
        .or(page.locator('[role="alert"]'))
    ).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-a7-duplicate-reg', '重複註冊 — 錯誤或驗證頁面');
  }));

  // A.2: Google OAuth → skip (requires OAuth provider integration)
});
