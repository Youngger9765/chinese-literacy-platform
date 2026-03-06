import { test, expect, type Page } from '@playwright/test';

/**
 * Student E2E tests for LingoLeap preview environment.
 *
 * Tests student-specific features: login, 加入班級 nav button, /join page,
 * code input validation, and invalid join code error.
 *
 * Strategy: Register a fresh account per test run (no roles assigned).
 * A user with no roles behaves like a plain student — they see 加入班級
 * but not 班級管理 or 系統管理. This mirrors the auth-flow.spec.ts pattern.
 *
 * Note: seed student1@test.com may not exist on preview; we use fresh
 * registrations so tests are idempotent and environment-independent.
 */

const RUN_ID = Date.now();
const STUDENT_PASSWORD = 'Student1234!';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Register a fresh account with no roles and return its email. */
async function registerFreshStudent(page: Page): Promise<string> {
  const email = `e2e-student-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  await page.locator('button:has-text("註冊帳號")').click();
  await expect(page.locator('text=建立你的帳號')).toBeVisible({ timeout: 10_000 });

  await page.locator('#register-name').fill('E2E學生');
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(STUDENT_PASSWORD);
  await page.locator('#register-confirm').fill(STUDENT_PASSWORD);
  await page.locator('button[type="submit"]:has-text("建立帳號")').click();

  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
  return email;
}

/** Use a pre-registered session fixture via state file, or just register inline. */
async function loginAsStudentUser(page: Page) {
  await registerFreshStudent(page);
}

// ── 1. Student Login ─────────────────────────────────────────────────────────

test.describe('Student - Login', () => {
  test('1.1 - Student (no-role user) can register and see home page', async ({ page }) => {
    await loginAsStudentUser(page);
    await expect(page.locator('text=AI 朗讀助教')).toBeVisible({ timeout: 15_000 });
  });

  test('1.2 - Student does NOT see 系統管理 button', async ({ page }) => {
    await loginAsStudentUser(page);
    await expect(page.locator('button:has-text("系統管理")')).not.toBeVisible();
  });

  test('1.3 - Student does NOT see 班級管理 button', async ({ page }) => {
    await loginAsStudentUser(page);
    await expect(page.locator('button:has-text("班級管理")')).not.toBeVisible();
  });
});

// ── 2. 加入班級 Nav Button ───────────────────────────────────────────────────

test.describe('Student - 加入班級 Button', () => {
  test('2.1 - Student sees 加入班級 button in header', async ({ page }) => {
    await loginAsStudentUser(page);
    await expect(page.locator('button:has-text("加入班級")')).toBeVisible({ timeout: 10_000 });
  });

  test('2.2 - Clicking 加入班級 navigates to /join', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.locator('button:has-text("加入班級")').click();
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/join');
  });
});

// ── 3. Join Classroom Page ───────────────────────────────────────────────────

test.describe('Student - Join Classroom Page', () => {
  test('3.1 - /join page shows heading and description', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=輸入老師提供的加入代碼')).toBeVisible();
  });

  test('3.2 - /join page has join code input', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
  });

  test('3.3 - /join page has 加入代碼 label', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('label:has-text("加入代碼")')).toBeVisible({ timeout: 15_000 });
  });

  test('3.4 - Submit button is disabled when code has fewer than 6 chars', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABC');
    // Submit button requires exactly 6 chars to be enabled
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeDisabled();
  });

  test('3.5 - Submit button is enabled when code has 6 chars', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABCDEF');
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeEnabled();
  });

  test('3.6 - Invalid join code shows 404 error message', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    // XXXXXX is 6 chars — passes client validation, triggers API → 404
    await page.locator('#join-code').fill('XXXXXX');
    await page.locator('button[type="submit"]:has-text("加入班級")').click();
    await expect(
      page.locator('text=找不到此加入代碼，請確認代碼是否正確')
    ).toBeVisible({ timeout: 15_000 });
  });

  test('3.7 - Input auto-uppercases entered code', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('abcdef');
    // The onChange handler transforms to uppercase
    await expect(page.locator('#join-code')).toHaveValue('ABCDEF');
  });

  test('3.8 - 返回首頁 link navigates to home', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.goto('/join');
    await expect(page.locator('text=返回首頁')).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("返回首頁")').click();
    await expect(page.locator('text=AI 朗讀助教')).toBeVisible({ timeout: 15_000 });
  });
});

// ── 4. Student Home Page ─────────────────────────────────────────────────────

test.describe('Student - Home Page Features', () => {
  test('4.1 - Student can access library', async ({ page }) => {
    await loginAsStudentUser(page);
    await page.locator('button:has-text("進入圖書館")').click();
    expect(page.url()).toContain('/library');
  });
});
