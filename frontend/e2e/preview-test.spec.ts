import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'https://lingoleap-frontend-issue-223-958347263320.asia-east1.run.app';
const TEST_EMAIL = `e2e-pw-${Date.now()}@test.com`;
const TEST_PASSWORD = 'TestPass1234';
const TEST_NAME = 'PW測試老師';

async function login(page, email: string, password: string) {
  await page.getByLabel('電子郵件').fill(email);
  await page.getByLabel('密碼').fill(password);
  await page.getByRole('button', { name: '登入' }).click();
  await page.waitForSelector('text=登出', { timeout: 10000 });
}

test.describe.serial('Issue #223 Full E2E on Preview', () => {

  test('1. 首頁載入', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('AI 朗讀助教')).toBeVisible();
    await expect(page.getByRole('button', { name: '登入' })).toBeVisible();
    await page.screenshot({ path: '/tmp/e2e-screenshots/01-login.png', fullPage: true });
  });

  test('2. 註冊', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await page.getByText('註冊帳號').click();
    await page.waitForTimeout(500);
    await page.getByLabel('姓名').fill(TEST_NAME);
    await page.getByLabel('電子郵件').fill(TEST_EMAIL);
    await page.getByLabel('密碼', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('確認密碼').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: '建立帳號' }).click();
    await page.waitForSelector('text=登出', { timeout: 10000 });
    await expect(page.getByText(TEST_NAME)).toBeVisible();
    await page.screenshot({ path: '/tmp/e2e-screenshots/02-registered.png', fullPage: true });
  });

  test('3. 登入', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await login(page, TEST_EMAIL, TEST_PASSWORD);
    await expect(page.getByText('班級管理')).toBeVisible();
    await expect(page.getByText('系統管理')).toBeVisible();
    await page.screenshot({ path: '/tmp/e2e-screenshots/03-logged-in.png', fullPage: true });
  });

  test('4. 班級管理 — 建立班級', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await login(page, TEST_EMAIL, TEST_PASSWORD);

    await page.getByText('班級管理').click();
    await page.waitForTimeout(1000);

    // Click "建立班級" to open form
    await page.getByRole('button', { name: '建立班級' }).first().click();
    await page.waitForTimeout(500);

    // Fill using actual IDs from TeacherDashboard.tsx
    await page.locator('#classroom-name').fill('PW三年甲班');
    await page.locator('#classroom-grade').selectOption('3');

    await page.screenshot({ path: '/tmp/e2e-screenshots/04-create-form.png', fullPage: true });

    // Click "建立" submit button
    await page.getByRole('button', { name: '建立', exact: true }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: '/tmp/e2e-screenshots/05-created.png', fullPage: true });
    await expect(page.getByText('PW三年甲班')).toBeVisible({ timeout: 5000 });
  });

  test('5. 班級詳情', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await login(page, TEST_EMAIL, TEST_PASSWORD);

    await page.getByText('班級管理').click();
    await page.waitForTimeout(1000);
    await page.getByText('PW三年甲班').click();
    await page.waitForTimeout(1000);

    await page.screenshot({ path: '/tmp/e2e-screenshots/06-detail.png', fullPage: true });
    await expect(page.getByText('學生名單')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('返回班級列表')).toBeVisible();
  });

  test('6. 系統管理 — 三個 tab', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await login(page, TEST_EMAIL, TEST_PASSWORD);

    await page.getByText('系統管理').click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/e2e-screenshots/07-admin-schools.png', fullPage: true });

    // 機構管理 tab
    await page.getByRole('button', { name: '機構管理' }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/e2e-screenshots/08-admin-orgs.png', fullPage: true });

    // 角色管理 tab
    await page.getByRole('button', { name: '角色管理' }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/e2e-screenshots/09-admin-roles.png', fullPage: true });
    await expect(page.getByText('系統管理員')).toBeVisible();
  });

  test('7. 課文選擇', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await login(page, TEST_EMAIL, TEST_PASSWORD);

    await page.getByText('進入圖書館').click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/e2e-screenshots/10-stories.png', fullPage: true });
    // 63 grade elements found = stories loaded successfully
    await expect(page.getByRole('button', { name: '4年級' })).toBeVisible({ timeout: 5000 });
  });

  test('8. 登出', async ({ page }) => {
    await page.goto(FRONTEND_URL);
    await page.waitForLoadState('networkidle');
    await login(page, TEST_EMAIL, TEST_PASSWORD);

    await page.getByText('登出').click();
    await page.waitForTimeout(1000);
    await expect(page.getByRole('button', { name: '登入' })).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: '/tmp/e2e-screenshots/11-logged-out.png', fullPage: true });
  });
});
