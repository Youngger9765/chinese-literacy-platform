import { test, expect } from '@playwright/test';
import { loginAsTeacher, goToTeacherDashboard } from './fixtures';

/**
 * Teacher dashboard E2E tests (issue #28).
 *
 * Validates the teacher's classroom management interface:
 *  - Dashboard navigation
 *  - Classroom list
 *  - Student list tab
 *  - Assignment management
 *
 * Seed data on preview:
 *   Teacher: teacher@test.com / teacher1234 (李老師)
 *   Classrooms: 三年甲班, 五年乙班 under 台北市大安國小
 */

// ── 1. Dashboard Access ───────────────────────────────────────────────────────

test.describe('Teacher Dashboard - Access', () => {
  test('1.1 - Teacher sees 班級管理 in header after login', async ({ page }) => {
    await loginAsTeacher(page);
    await expect(page.locator('button:has-text("班級管理")')).toBeVisible({ timeout: 10_000 });
  });

  test('1.2 - 班級管理 navigates to /teacher', async ({ page }) => {
    await loginAsTeacher(page);
    await page.locator('button:has-text("班級管理")').click();
    await expect(page).toHaveURL(/\/teacher/, { timeout: 15_000 });
  });

  test('1.3 - /teacher page shows dashboard heading', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 10_000 });
  });
});

// ── 2. Classroom List ─────────────────────────────────────────────────────────

test.describe('Teacher Dashboard - Classroom List', () => {
  test('2.1 - Dashboard shows seeded classrooms', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    // Both seeded classrooms should be visible
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=五年乙班').first()).toBeVisible({ timeout: 15_000 });
  });

  test('2.2 - Dashboard header shows total classroom count', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('text=/共 \\d+ 個班級/')).toBeVisible({ timeout: 15_000 });
  });

  test('2.3 - Classroom cards show student count', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=/\\d+ 位學生/').first()).toBeVisible({ timeout: 10_000 });
  });

  test('2.4 - 建立班級 button is visible', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('button:has-text("建立班級")').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── 3. Classroom Detail ───────────────────────────────────────────────────────

test.describe('Teacher Dashboard - Classroom Detail', () => {
  test('3.1 - Clicking classroom card navigates to classroom detail URL', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('text=三年甲班').first().click();
    await expect(page).toHaveURL(/\/teacher\/classroom\/\d+/, { timeout: 15_000 });
  });

  test('3.2 - Classroom detail shows three tabs', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('text=三年甲班').first().click();
    await expect(page.locator('button:has-text("返回班級列表")')).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('button:has-text("學生進度")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("課文管理")')).toBeVisible();
    await expect(page.locator('button:has-text("學生名單")')).toBeVisible();
  });

  test('3.3 - Back button returns to classroom list', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('text=三年甲班').first().click();
    await expect(page.locator('button:has-text("返回班級列表")')).toBeVisible({ timeout: 15_000 });

    await page.locator('button:has-text("返回班級列表")').click();
    await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
  });
});

// ── 4. Students Tab ───────────────────────────────────────────────────────────

test.describe('Teacher Dashboard - Students Tab', () => {
  test('4.1 - 學生名單 tab shows content', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('text=三年甲班').first().click();
    await expect(page.locator('button:has-text("返回班級列表")')).toBeVisible({ timeout: 15_000 });

    await page.locator('button:has-text("學生名單")').click();
    // Either shows students table or empty state
    await expect(
      page.locator('text=邀請碼').or(page.locator('text=加入代碼')).or(page.locator('text=目前沒有學生'))
    ).toBeVisible({ timeout: 15_000 });
  });

  test('4.2 - 課文管理 tab shows 指派課文 button', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('text=三年甲班').first().click();
    await expect(page.locator('button:has-text("返回班級列表")')).toBeVisible({ timeout: 15_000 });

    await page.locator('button:has-text("課文管理")').click();
    await expect(page.locator('button:has-text("指派課文")')).toBeVisible({ timeout: 15_000 });
  });
});

// ── 5. Create Classroom Form ──────────────────────────────────────────────────

test.describe('Teacher Dashboard - Create Classroom Form', () => {
  test('5.1 - Clicking 建立班級 shows create form', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await page.locator('button:has-text("建立班級")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
  });

  test('5.2 - Submit is disabled when 班級名稱 is empty', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await page.locator('button:has-text("建立班級")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    const submitBtn = page.locator('button[type="submit"]:has-text("建立")');
    await expect(submitBtn).toBeDisabled();
  });

  test('5.3 - Clicking 取消 hides the create form', async ({ page }) => {
    await loginAsTeacher(page);
    await goToTeacherDashboard(page);
    await page.locator('button:has-text("建立班級")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("取消")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).not.toBeVisible();
  });
});
