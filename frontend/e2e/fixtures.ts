/**
 * E2E test fixtures and helpers for LingoLeap.
 *
 * Provides reusable authentication helpers, test data factories, and
 * page navigation utilities shared across all spec files.
 */

import { type Page, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEST_PASSWORD = 'Test1234!';
export const TEACHER_EMAIL = 'teacher@test.com';
export const TEACHER_PASSWORD = 'teacher1234';

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Clear localStorage and reload to guarantee a clean unauthenticated state.
 * Waits for the login page to be visible before returning.
 */
export async function resetToLoginPage(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });
}

/**
 * Register a brand-new account with a unique timestamp+random email.
 * Returns the email that was registered so callers can log in with it later.
 */
export async function registerFreshUser(
  page: Page,
  opts: { name?: string } = {}
): Promise<string> {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `e2e-user-${runId}@example.com`;
  const name = opts.name ?? 'E2E User';

  await resetToLoginPage(page);

  await page.locator('button:has-text("註冊帳號")').click();
  await expect(page.locator('text=建立你的帳號')).toBeVisible({ timeout: 10_000 });

  await page.locator('#register-name').fill(name);
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(TEST_PASSWORD);
  await page.locator('#register-confirm').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]:has-text("建立帳號")').click();

  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
  return email;
}

/**
 * Login with the seeded teacher account.
 * Waits for the authenticated app shell (登出 button) before returning.
 */
export async function loginAsTeacher(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  await page.locator('#login-email').fill(TEACHER_EMAIL);
  await page.locator('#login-password').fill(TEACHER_PASSWORD);
  await page.locator('button[type="submit"]:has-text("登入")').click();

  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

/**
 * Login with an arbitrary email + password.
 * Waits for the authenticated app shell before returning.
 */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await resetToLoginPage(page);
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('button[type="submit"]:has-text("登入")').click();
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

/**
 * Click logout and wait until an auth page (login or register) is visible.
 * If we land on the register page, switches back to login automatically.
 */
export async function logoutAndWaitForLoginPage(page: Page): Promise<void> {
  await page.locator('button:has-text("登出")').click();

  await expect(
    page.locator('text=登入你的帳號').or(page.locator('text=建立你的帳號'))
  ).toBeVisible({ timeout: 15_000 });

  const onRegisterPage = await page.locator('text=建立你的帳號').isVisible();
  if (onRegisterPage) {
    await page.locator('button:has-text("登入")').last().click();
    await expect(page.locator('text=登入你的帳號')).toBeVisible();
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the story library page.
 * Caller must already be authenticated.
 */
export async function goToLibrary(page: Page): Promise<void> {
  await page.goto('/library');
  // Wait for StoryLibrary to render — it shows at least one story card or empty state
  await expect(
    page.locator('[data-testid="story-card"]').first().or(page.locator('text=目前沒有課文'))
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Navigate to the teacher dashboard.
 * Caller must already be authenticated as a teacher.
 */
export async function goToTeacherDashboard(page: Page): Promise<void> {
  await page.locator('button:has-text("班級管理")').click();
  await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate to a specific learning step for a given story slug.
 * Caller must already be authenticated.
 */
export async function goToLearningStep(
  page: Page,
  storyId: string,
  step: 'intro' | 'tutor' | 'comprehension' | 'vocab' | 'dictation' | 'full-reading' | 'report'
): Promise<void> {
  await page.goto(`/learn/${storyId}/${step}`);
}
