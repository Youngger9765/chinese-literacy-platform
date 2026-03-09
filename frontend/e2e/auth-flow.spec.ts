import { test, expect, type Page } from '@playwright/test';

/**
 * Auth flow E2E tests for LingoLeap preview environment.
 *
 * Covers: login page load, register switch, registration, logout,
 * login with registered account, login failure, duplicate registration.
 *
 * Uses a unique timestamp-based email per test run so tests are idempotent.
 * Uses @example.com domain because the backend email validator rejects
 * special-use TLDs like .test.
 */

const RUN_ID = Date.now();
const TEST_PASSWORD = 'Test1234!';
const TEST_NAME = 'E2E Tester';

/** Helper: clear localStorage and reload to a clean login page. */
async function resetToLoginPage(page: Page) {
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  // After clear + reload, should land on login page (default authPage state)
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });
}

/**
 * Helper: accept terms modal if visible.
 */
async function acceptTermsIfVisible(page: Page) {
  const termsHeading = page.locator('h2:has-text("使用條款同意書")');
  if (await termsHeading.isVisible({ timeout: 3000 }).catch(() => false)) {
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
 * Helper: skip onboarding guide if visible.
 */
async function skipOnboardingIfVisible(page: Page) {
  const skipBtn = page.locator('button:has-text("跳過")');
  if (await skipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skipBtn.click();
    await expect(skipBtn).not.toBeVisible({ timeout: 5000 });
  }
}

/**
 * Helper: dismiss all blocking modals (Terms, Onboarding).
 * Waits for modals that may appear in sequence.
 */
async function dismissAllModals(page: Page) {
  await acceptTermsIfVisible(page);
  await skipOnboardingIfVisible(page);
  // Check once more in case another modal appeared
  await acceptTermsIfVisible(page);
}

/** Helper: register a new account and wait for the main app to appear. */
async function registerAndWaitForApp(page: Page, email: string) {
  await page.locator('button:has-text("註冊帳號")').click();
  await expect(page.locator('text=建立你的帳號')).toBeVisible();

  await page.locator('#register-name').fill(TEST_NAME);
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(TEST_PASSWORD);
  await page.locator('#register-confirm').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]:has-text("建立帳號")').click();

  // Wait for either terms modal or main app to appear
  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 30_000 }).catch(() => null),
  ]);

  await dismissAllModals(page);

  // Wait for the main app to fully load
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

/**
 * Helper: click logout and wait for an auth page to appear.
 *
 * After logout, the SPA shows whichever auth page was last active
 * (login or register). Since registration tests leave authPage='register',
 * we wait for either form to appear, then switch to login if needed.
 */
async function logoutAndWaitForLoginPage(page: Page) {
  // Dismiss any modals that might be blocking the logout button
  await dismissAllModals(page);

  await page.locator('button:has-text("登出")').click();

  // Wait for either login or register page to appear
  await expect(
    page.locator('text=登入你的帳號').or(page.locator('text=建立你的帳號'))
  ).toBeVisible({ timeout: 15_000 });

  // If we landed on the register page, switch to login
  const onRegisterPage = await page.locator('text=建立你的帳號').isVisible();
  if (onRegisterPage) {
    // The register page has a "登入" link at the bottom
    await page.locator('button:has-text("登入")').last().click();
    await expect(page.locator('text=登入你的帳號')).toBeVisible();
  }
}

/**
 * Helper: login and handle post-login modals.
 */
async function loginAndWaitForApp(page: Page, email: string, password: string) {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.locator('button[type="submit"]:has-text("登入")').click();

  // Wait for either terms modal or main app
  await Promise.race([
    page.waitForSelector('h2:has-text("使用條款同意書")', { timeout: 30_000 }).catch(() => null),
    page.waitForSelector('button:has-text("登出")', { timeout: 30_000 }).catch(() => null),
  ]);

  await dismissAllModals(page);
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// 1. Login page loads
// ---------------------------------------------------------------------------
test('1 - 登入頁載入', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  // Should see the login form elements
  await expect(page.locator('label:has-text("帳號")')).toBeVisible();
  await expect(page.locator('label:has-text("密碼")')).toBeVisible();
  await expect(page.locator('button[type="submit"]:has-text("登入")')).toBeVisible();
  await expect(page.locator('button:has-text("註冊帳號")')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Switch to register page
// ---------------------------------------------------------------------------
test('2 - 切換到註冊頁', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  await page.locator('button:has-text("註冊帳號")').click();

  // Should see register form
  await expect(page.locator('text=建立你的帳號')).toBeVisible();
  await expect(page.locator('label:has-text("姓名")')).toBeVisible();
  await expect(page.locator('label:has-text("確認密碼")')).toBeVisible();
  await expect(page.locator('button[type="submit"]:has-text("建立帳號")')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Register a new account
// ---------------------------------------------------------------------------
test('3 - 註冊新帳號', async ({ page }) => {
  const email = `test-reg-${RUN_ID}@example.com`;

  await page.goto('/');
  await resetToLoginPage(page);

  await registerAndWaitForApp(page, email);

  // Should see the main app content
  await expect(page.locator('text=AI 朗讀助教')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. Logout
// ---------------------------------------------------------------------------
test('4 - 登出', async ({ page }) => {
  const email = `test-logout-${RUN_ID}@example.com`;

  await page.goto('/');
  await resetToLoginPage(page);

  // Register to get authenticated
  await registerAndWaitForApp(page, email);

  // Logout and verify return to login page
  await logoutAndWaitForLoginPage(page);
  await expect(page.locator('button[type="submit"]:has-text("登入")')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Login with registered account
// ---------------------------------------------------------------------------
test('5 - 用已註冊帳號登入', async ({ page }) => {
  const email = `test-login-${RUN_ID}@example.com`;

  await page.goto('/');
  await resetToLoginPage(page);

  // Register first
  await registerAndWaitForApp(page, email);

  // Logout and go to login page
  await logoutAndWaitForLoginPage(page);

  // Now login with the same credentials
  await loginAndWaitForApp(page, email, TEST_PASSWORD);

  // Should see the main app
  await expect(page.locator('text=AI 朗讀助教')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 6. Login failure (wrong password)
// ---------------------------------------------------------------------------
test('6 - 登入失敗（密碼錯誤）', async ({ page }) => {
  await page.goto('/');
  await resetToLoginPage(page);

  await page.locator('#login-email').fill('nonexistent@example.com');
  await page.locator('#login-password').fill('wrongpassword123');
  await page.locator('button[type="submit"]:has-text("登入")').click();

  // Should see error message
  await expect(page.locator('text=帳號或密碼錯誤')).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// 7. Duplicate registration
// ---------------------------------------------------------------------------
test('7 - 重複註冊', async ({ page }) => {
  const email = `test-dup-${RUN_ID}@example.com`;

  await page.goto('/');
  await resetToLoginPage(page);

  // First registration
  await registerAndWaitForApp(page, email);

  // Logout and go back to auth pages
  await logoutAndWaitForLoginPage(page);

  // Switch to register page
  await page.locator('button:has-text("註冊帳號")').click();
  await expect(page.locator('text=建立你的帳號')).toBeVisible();

  // Second registration with same email
  await page.locator('#register-name').fill('Duplicate User');
  await page.locator('#register-email').fill(email);
  await page.locator('#register-password').fill(TEST_PASSWORD);
  await page.locator('#register-confirm').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]:has-text("建立帳號")').click();

  // Should see duplicate email error
  await expect(page.locator('text=此電子郵件已被註冊')).toBeVisible({ timeout: 15_000 });
});
