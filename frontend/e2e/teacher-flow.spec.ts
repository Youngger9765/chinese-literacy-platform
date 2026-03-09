import { test, expect, type Page } from '@playwright/test';

/**
 * Teacher Dashboard E2E tests for LingoLeap preview environment.
 *
 * Uses saved storageState from auth.setup.ts — no login needed per test.
 *
 * Seed data on preview:
 *   - Teacher: teacher@test.com / teacher1234 (李老師)
 *   - Teacher has classrooms: 三年甲班, 五年乙班 under 台北市大安國小
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Ensure teacher is authenticated and on the home page. */
async function ensureAuthenticated(page: Page) {
  await page.goto('/');
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

async function goToTeacherDashboard(page: Page) {
  await page.goto('/teacher');
  await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
}

/** Navigate to the first classroom card by name. */
async function navigateToClassroom(page: Page, classroomName: string) {
  await goToTeacherDashboard(page);
  // Wait for classroom cards to load (grid replaces skeleton)
  await expect(page.locator(`text=${classroomName}`).first()).toBeVisible({ timeout: 15_000 });
  await page.locator(`text=${classroomName}`).first().click();
  // Wait for classroom detail to load (back button appears)
  await expect(page.locator('button:has-text("返回班級列表")')).toBeVisible({ timeout: 15_000 });
}

// ── 1. Teacher Login & Navigation ────────────────────────────────────────────

test.describe('Teacher Dashboard - Navigation', () => {
  test('1.1 - Teacher login shows 班級管理 button', async ({ page }) => {
    await ensureAuthenticated(page);
    await expect(page.locator('button:has-text("班級管理")')).toBeVisible();
  });

  test('1.2 - Clicking 班級管理 navigates to /teacher', async ({ page }) => {
    await ensureAuthenticated(page);
    await page.locator('button:has-text("班級管理")').click();
    await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/teacher');
  });

  test('1.3 - Teacher does NOT see 系統管理 button', async ({ page }) => {
    await ensureAuthenticated(page);
    await expect(page.locator('button:has-text("系統管理")')).not.toBeVisible();
  });

  test('1.4 - Teacher does NOT see 加入班級 button', async ({ page }) => {
    await ensureAuthenticated(page);
    // Teachers have teacher role so 加入班級 is hidden (only shown to plain students)
    await expect(page.locator('button:has-text("加入班級")')).not.toBeVisible();
  });
});

// ── 2. Classroom Cards ───────────────────────────────────────────────────────

test.describe('Teacher Dashboard - Classroom Cards', () => {
  test('2.1 - Teacher dashboard shows classroom cards', async ({ page }) => {
    await goToTeacherDashboard(page);
    // Both seeded classrooms should be visible
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=五年乙班').first()).toBeVisible({ timeout: 15_000 });
  });

  test('2.2 - Dashboard header shows total classroom count', async ({ page }) => {
    await goToTeacherDashboard(page);
    // Wait for loading to finish — count text replaces "載入中..."
    await expect(page.locator('text=/共 \\d+ 個班級/')).toBeVisible({ timeout: 15_000 });
  });

  test('2.3 - Classroom card shows student count', async ({ page }) => {
    await goToTeacherDashboard(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    // Cards render "N 位學生" inside each card
    await expect(page.locator('text=/\\d+ 位學生/').first()).toBeVisible({ timeout: 10_000 });
  });
});

// ── 3. Classroom Detail ──────────────────────────────────────────────────────

test.describe('Teacher Dashboard - Classroom Detail', () => {
  test('3.1 - Clicking classroom card navigates to classroom detail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    expect(page.url()).toContain('/teacher/classroom/');
  });

  test('3.2 - Classroom detail shows classroom name as heading', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await expect(page.locator('h2:has-text("三年甲班")')).toBeVisible({ timeout: 10_000 });
  });

  test('3.3 - Classroom detail shows 編輯 and 停用/啟用 buttons', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await expect(page.locator('button:has-text("編輯")')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('button:has-text("停用")').or(page.locator('button:has-text("啟用")'))
    ).toBeVisible();
  });

  test('3.4 - Classroom detail shows three tabs', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await expect(page.locator('button:has-text("學生進度")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("課文管理")')).toBeVisible();
    await expect(page.locator('button:has-text("學生名單")')).toBeVisible();
  });
});

// ── 4. Student Progress Tab ──────────────────────────────────────────────────

test.describe('Teacher Dashboard - Student Progress Tab', () => {
  test('4.1 - Default tab is 學生進度 and shows content', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    // 學生進度 tab is active by default; the tab panel renders either a table or
    // the empty-state message — both are acceptable as proof the tab rendered.
    await expect(
      page.locator('text=學生姓名').or(page.locator('text=尚無學生學習記錄'))
    ).toBeVisible({ timeout: 15_000 });
  });

  test('4.2 - Clicking 學生進度 tab keeps tab active', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("學生進度")').click();
    await expect(
      page.locator('text=學生姓名').or(page.locator('text=尚無學生學習記錄'))
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ── 5. Text Management Tab ───────────────────────────────────────────────────

test.describe('Teacher Dashboard - Text Management Tab', () => {
  test('5.1 - Clicking 課文管理 tab shows tab content', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("課文管理")').click();
    // Tab panel always renders the "已指派 N 篇課文" counter in the header row
    await expect(page.locator('text=/已指派 \\d+ 篇課文/').first()).toBeVisible({ timeout: 15_000 });
  });

  test('5.2 - 課文管理 tab shows 指派課文 button', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("課文管理")').click();
    await expect(page.locator('button:has-text("指派課文")')).toBeVisible({ timeout: 15_000 });
  });

  test('5.3 - Clicking 指派課文 shows course selector panel', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("課文管理")').click();
    await expect(page.locator('button:has-text("指派課文")')).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("指派課文")').click();
    // Selector panel header is always rendered once the selector opens
    await expect(page.locator('h4:has-text("選擇課文指派")')).toBeVisible({ timeout: 10_000 });
  });
});

// ── 6. Back Navigation ───────────────────────────────────────────────────────

test.describe('Teacher Dashboard - Back Navigation', () => {
  test('6.1 - Clicking 返回班級列表 navigates back to /teacher', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("返回班級列表")').click();
    await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/teacher');
  });
});

// ── 7. Create Classroom Form ─────────────────────────────────────────────────

test.describe('Teacher Dashboard - Create Classroom Form', () => {
  test('7.1 - Clicking 建立班級 shows create form', async ({ page }) => {
    await goToTeacherDashboard(page);
    await page.locator('button:has-text("建立班級")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
  });

  test('7.2 - Create form has 班級名稱 and 年級 fields', async ({ page }) => {
    await goToTeacherDashboard(page);
    await page.locator('button:has-text("建立班級")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#classroom-name')).toBeVisible();
    await expect(page.locator('#classroom-grade')).toBeVisible();
  });

  test('7.3 - Create form submit button is disabled when name is empty', async ({ page }) => {
    await goToTeacherDashboard(page);
    await page.locator('button:has-text("建立班級")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    // Submit button is disabled when name is empty
    const submitBtn = page.locator('button[type="submit"]:has-text("建立")');
    await expect(submitBtn).toBeDisabled();
  });

  test('7.4 - Clicking 取消 hides the create form', async ({ page }) => {
    await goToTeacherDashboard(page);
    await page.locator('button:has-text("建立班級")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("取消")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).not.toBeVisible();
  });
});
