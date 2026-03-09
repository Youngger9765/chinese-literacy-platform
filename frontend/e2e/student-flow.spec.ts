import { test, expect, type Page } from '@playwright/test';
import { dismissAllModals } from './fixtures';

/**
 * Student E2E tests for LingoLeap preview environment.
 *
 * Uses saved storageState from auth.setup.ts — a fresh student account
 * is registered once in setup, then all tests reuse that auth state.
 *
 * Tests student-specific features: nav buttons, 加入班級 flow, /join page.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Ensure student is authenticated and on the home page. */
async function ensureAuthenticated(page: Page) {
  await page.goto('/');
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

// ── 1. Student Login ─────────────────────────────────────────────────────────

test.describe('Student - Login', () => {
  test('1.1 - Student (no-role user) can see home page', async ({ page }) => {
    await ensureAuthenticated(page);
    await expect(page.locator('text=AI 朗讀助教')).toBeVisible({ timeout: 15_000 });
  });

  test('1.2 - Student does NOT see 系統管理 button', async ({ page }) => {
    await ensureAuthenticated(page);
    await expect(page.locator('button:has-text("系統管理")')).not.toBeVisible();
  });

  test('1.3 - Student does NOT see 班級管理 button', async ({ page }) => {
    await ensureAuthenticated(page);
    await expect(page.locator('button:has-text("班級管理")')).not.toBeVisible();
  });
});

// ── 2. 加入班級 Nav Button ───────────────────────────────────────────────────

test.describe('Student - 加入班級 Button', () => {
  test('2.1 - Student sees 加入班級 button in header', async ({ page }) => {
    await ensureAuthenticated(page);
    await expect(page.locator('button:has-text("加入班級")')).toBeVisible({ timeout: 10_000 });
  });

  test('2.2 - Clicking 加入班級 navigates to /join', async ({ page }) => {
    await ensureAuthenticated(page);
    await page.locator('button:has-text("加入班級")').click();
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/join');
  });
});

// ── 3. Join Classroom Page ───────────────────────────────────────────────────

test.describe('Student - Join Classroom Page', () => {
  test('3.1 - /join page shows heading and description', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=輸入老師提供的加入代碼')).toBeVisible();
  });

  test('3.2 - /join page has join code input', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
  });

  test('3.3 - /join page has 加入代碼 label', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('label:has-text("加入代碼")')).toBeVisible({ timeout: 15_000 });
  });

  test('3.4 - Submit button is disabled when code has fewer than 6 chars', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABC');
    // Submit button requires exactly 6 chars to be enabled
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeDisabled();
  });

  test('3.5 - Submit button is enabled when code has 6 chars', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABCDEF');
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeEnabled();
  });

  test('3.6 - Invalid join code shows 404 error message', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    // XXXXXX is 6 chars — passes client validation, triggers API → 404
    await page.locator('#join-code').fill('XXXXXX');
    await page.locator('button[type="submit"]:has-text("加入班級")').click();
    await expect(
      page.locator('text=找不到此加入代碼，請確認代碼是否正確')
    ).toBeVisible({ timeout: 15_000 });
  });

  test('3.7 - Input auto-uppercases entered code', async ({ page }) => {
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('abcdef');
    // The onChange handler transforms to uppercase
    await expect(page.locator('#join-code')).toHaveValue('ABCDEF');
  });

  test('3.8 - 返回首頁 link navigates to home', async ({ page }) => {
    await page.goto('/join');
    // Wait for page to fully settle (terms modal may appear after API call)
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('text=返回首頁')).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("返回首頁")').click();
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('text=AI 朗讀助教')).toBeVisible({ timeout: 15_000 });
  });
});

// ── 4. Student Home Page ─────────────────────────────────────────────────────

test.describe('Student - Home Page Features', () => {
  test('4.1 - Student can access library', async ({ page }) => {
    await ensureAuthenticated(page);
    await page.locator('button:has-text("進入圖書館")').click();
    expect(page.url()).toContain('/library');
  });
});
