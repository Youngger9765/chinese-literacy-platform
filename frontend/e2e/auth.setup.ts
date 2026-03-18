/**
 * Global auth setup — runs once before all tests to create saved auth states.
 * This avoids hitting rate limits by logging in only once per role.
 */
import { test as setup, expect } from '@playwright/test';
import { dismissAllModals } from './fixtures';

const TEACHER_EMAIL = 'teacher@test.com';
const TEACHER_PASSWORD = 'teacher1234';
const ADMIN_EMAIL = 'admin@test.com';
const ADMIN_PASSWORD = 'admin1234';
const STUDENT_EMAIL = 'student@test.com';
const STUDENT_PASSWORD = 'student1234';

setup('authenticate as teacher', async ({ page }) => {
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

  await page.context().storageState({ path: 'e2e/.auth/teacher.json' });
});

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  await page.locator('#login-email').fill(ADMIN_EMAIL);
  await page.locator('#login-password').fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]:has-text("登入")').click();

  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 30_000 }).catch(() => null),
  ]);
  await dismissAllModals(page);
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});

setup('authenticate as student', async ({ page }) => {
  // Use pre-seeded student account instead of self-registering.
  // Student self-registration was blocked in #457; seed accounts have email_verified=True (#475).
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  await page.locator('#login-email').fill(STUDENT_EMAIL);
  await page.locator('#login-password').fill(STUDENT_PASSWORD);
  await page.locator('button[type="submit"]:has-text("登入")').click();

  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 30_000 }).catch(() => null),
  ]);
  await dismissAllModals(page);
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });

  await page.context().storageState({ path: 'e2e/.auth/student.json' });
});
