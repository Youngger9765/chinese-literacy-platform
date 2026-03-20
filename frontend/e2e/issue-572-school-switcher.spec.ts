/**
 * issue-572-school-switcher.spec.ts
 *
 * Verifies the multi-school switcher added in #572/#600.
 *
 * Strategy:
 *   - Mock /api/users/me → inject two school scopes (teacher@school 26 + school 27)
 *   - Mock /api/schools/26 and /api/schools/27 → return school name fixtures
 *   - Verify SchoolSwitcher renders, options are correct, switching persists to localStorage
 *
 * Tests:
 *   1. Single-school teacher: no switcher visible
 *   2. Multi-school teacher: switcher appears with school name options
 *   3. Switching school updates activeSchoolId in localStorage
 *   4. School selection persists after page reload
 */

import { test, expect, type Route } from '@playwright/test';
import { dismissAllModals } from './fixtures';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCHOOL_26 = { id: 26, name: '中正國小', display_name: '中正國小' };
const SCHOOL_27 = { id: 27, name: '民生國小', display_name: '民生國小' };

async function mockMultiSchoolTeacher(page: import('@playwright/test').Page) {
  // Inject two school-scoped teacher roles
  await page.route('**/api/users/me', async (route: Route) => {
    const original = await route.fetch();
    const body = await original.json();
    body.roles = [
      { role_name: 'teacher', role_display_name: '教師', scope_type: 'school', scope_id: '26' },
      { role_name: 'teacher', role_display_name: '教師', scope_type: 'school', scope_id: '27' },
    ];
    await route.fulfill({ json: body });
  });

  // Mock school detail API calls
  await page.route('**/api/schools/26', async (route: Route) => {
    await route.fulfill({ json: SCHOOL_26 });
  });
  await page.route('**/api/schools/27', async (route: Route) => {
    await route.fulfill({ json: SCHOOL_27 });
  });
}

async function waitForAppReady(page: import('@playwright/test').Page) {
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
  await dismissAllModals(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Issue #572 — 教師端多校切換 UI', () => {

  test.use({ storageState: 'e2e/.auth/teacher.json' });

  test('1. 單校教師：不顯示學校切換器', async ({ page }) => {
    // No mock — real teacher account has only one school
    await page.goto('/teacher');
    await waitForAppReady(page);

    // SchoolSwitcher returns null when hasMultipleSchools=false
    await expect(page.locator('label:has-text("目前學校")')).not.toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/issue-572/single-school-no-switcher.png', fullPage: true });
  });

  test('2. 多校教師：顯示學校切換器，含學校名稱', async ({ page }) => {
    await mockMultiSchoolTeacher(page);
    await page.goto('/teacher');
    await waitForAppReady(page);

    // SchoolSwitcher should appear
    await expect(page.locator('label:has-text("目前學校")')).toBeVisible({ timeout: 10_000 });

    // Select element should contain both school names
    const select = page.locator('select[aria-label="切換目前學校"]');
    await expect(select).toBeVisible({ timeout: 10_000 });

    // Both options present
    await expect(page.locator('option:has-text("中正國小")')).toBeAttached();
    await expect(page.locator('option:has-text("民生國小")')).toBeAttached();

    await page.screenshot({ path: 'e2e/screenshots/issue-572/multi-school-switcher-visible.png', fullPage: true });
  });

  test('3. 切換學校 → localStorage 更新', async ({ page }) => {
    await mockMultiSchoolTeacher(page);
    await page.goto('/teacher');
    await waitForAppReady(page);

    await expect(page.locator('label:has-text("目前學校")')).toBeVisible({ timeout: 10_000 });

    // Switch to 民生國小 (id=27)
    await page.locator('select[aria-label="切換目前學校"]').selectOption({ value: '27' });

    // localStorage should update
    const stored = await page.evaluate(() => localStorage.getItem('lingoleap_workspace_school'));
    expect(stored).toBe('27');

    await page.screenshot({ path: 'e2e/screenshots/issue-572/after-switch-to-school-27.png', fullPage: true });
  });

  test('4. 重新整理後，選擇的學校仍記住', async ({ page }) => {
    await mockMultiSchoolTeacher(page);
    await page.goto('/teacher');
    await waitForAppReady(page);

    await expect(page.locator('label:has-text("目前學校")')).toBeVisible({ timeout: 10_000 });

    // Switch to school 27
    await page.locator('select[aria-label="切換目前學校"]').selectOption({ value: '27' });

    // Reload — mock still active (page.route survives reload)
    await page.reload();
    await waitForAppReady(page);

    // Select should show school 27 as selected
    await expect(page.locator('label:has-text("目前學校")')).toBeVisible({ timeout: 10_000 });
    const selectedValue = await page.locator('select[aria-label="切換目前學校"]').inputValue();
    expect(selectedValue).toBe('27');

    await page.screenshot({ path: 'e2e/screenshots/issue-572/persisted-school-after-reload.png', fullPage: true });
  });

});
