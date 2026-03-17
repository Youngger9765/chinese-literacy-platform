/**
 * E2E test fixtures and helpers for LingoLeap.
 *
 * Provides reusable authentication helpers, test data factories,
 * page navigation utilities, and screenshot helpers shared across all spec files.
 */

import { type Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEST_PASSWORD = 'Test1234!';
export const TEACHER_EMAIL = 'teacher@test.com';
export const TEACHER_PASSWORD = 'teacher1234';

// ---------------------------------------------------------------------------
// Screenshot helpers
// ---------------------------------------------------------------------------

/**
 * Take a screenshot with a standardized name and save caption metadata.
 * Screenshots are saved to e2e/screenshots/{module}/.
 *
 * @param page - Playwright Page
 * @param name - Screenshot filename without extension (e.g. "m1-01-login-page")
 * @param caption - Human-readable description of what the screenshot shows
 */
export async function takeScreenshot(
  page: Page,
  name: string,
  caption: string
): Promise<void> {
  const module = name.split('-')[0]; // e.g. "m1" from "m1-01-login-page"
  const dir = path.join(__dirname, 'screenshots', module);
  fs.mkdirSync(dir, { recursive: true });

  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
  });

  // Write caption as sidecar JSON for report generator
  const captionPath = path.join(dir, `${name}.caption.json`);
  fs.writeFileSync(captionPath, JSON.stringify({ name, caption, module }, null, 2));
}

// ---------------------------------------------------------------------------
// Modal helpers
// ---------------------------------------------------------------------------

/**
 * Accept the Terms of Service modal if it's visible.
 */
async function acceptTermsIfVisible(page: Page, waitMs = 3000): Promise<void> {
  const termsHeading = page.locator('h2:has-text("使用條款同意書")');
  if (await termsHeading.isVisible({ timeout: waitMs }).catch(() => false)) {
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    await page.locator('button:has-text("我同意使用條款，進入平台")').click();
    await expect(termsHeading).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Skip the Onboarding Guide modal if it's visible.
 */
async function skipOnboardingIfVisible(page: Page, waitMs = 2000): Promise<void> {
  const skipBtn = page.locator('button:has-text("跳過")');
  if (await skipBtn.isVisible({ timeout: waitMs }).catch(() => false)) {
    await skipBtn.click();
    await expect(skipBtn).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Dismiss all blocking modals (Terms of Service, Onboarding Guide).
 */
export async function dismissAllModals(page: Page): Promise<void> {
  await acceptTermsIfVisible(page);
  await skipOnboardingIfVisible(page);
  await acceptTermsIfVisible(page);
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Clear localStorage and reload to guarantee a clean unauthenticated state.
 */
export async function resetToLoginPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });
}

/**
 * Register a brand-new account with a unique timestamp+random email.
 * Returns the email that was registered.
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

  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 30_000 }).catch(() => null),
  ]);

  await dismissAllModals(page);
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
  return email;
}

/**
 * Login with the seeded teacher account.
 */
export async function loginAsTeacher(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  await page.locator('#login-email').fill(TEACHER_EMAIL);
  await page.locator('#login-password').fill(TEACHER_PASSWORD);
  await page.locator('button[type="submit"]:has-text("登入")').click();

  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 30_000 }).catch(() => null),
  ]);

  await dismissAllModals(page);
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

/**
 * Login with an arbitrary email + password.
 */
export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await resetToLoginPage(page);
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

/**
 * Click logout and wait until an auth page (login or register) is visible.
 */
export async function logoutAndWaitForLoginPage(page: Page): Promise<void> {
  await dismissAllModals(page);
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
 */
export async function goToLibrary(page: Page): Promise<void> {
  await page.goto('/library');
  await expect(
    page.locator('[data-testid="story-card"]').first().or(page.locator('text=目前沒有課文'))
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Navigate to the teacher dashboard.
 */
export async function goToTeacherDashboard(page: Page): Promise<void> {
  await page.locator('button:has-text("班級管理")').click();
  await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate to a specific learning step for a given story slug.
 */
export async function goToLearningStep(
  page: Page,
  storyId: string,
  step: 'intro' | 'tutor' | 'comprehension' | 'vocab' | 'dictation' | 'listening' | 'full-reading' | 'report'
): Promise<void> {
  await page.goto(`/learn/${storyId}/${step}`);
}

/**
 * Get the first story slug by navigating to the library and clicking the first card.
 * Returns the storyId extracted from the URL.
 */
export async function getFirstStorySlug(page: Page): Promise<string> {
  await page.goto('/library');
  await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

  const firstCard = page.locator('button').filter({ has: page.locator('h3') }).first();
  if ((await firstCard.count()) > 0) {
    await firstCard.click();
  } else {
    await page.locator('h3').first().click();
  }

  await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });
  const url = page.url();
  const match = url.match(/\/learn\/([^/]+)\/intro/);
  return match?.[1] ?? '';
}

/**
 * Ensure page is authenticated (has 登出 button visible).
 */
export async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto('/');
  // Wait for page to settle — terms/onboarding modals may appear after API calls
  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 5_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 5_000 }).catch(() => null),
  ]);
  await dismissAllModals(page);
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}
