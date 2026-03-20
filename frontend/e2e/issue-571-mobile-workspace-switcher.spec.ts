/**
 * issue-571-mobile-workspace-switcher.spec.ts
 *
 * Verifies the mobile workspace switcher added in #571.
 *
 * Strategy: Uses teacher storageState + route intercept to inject a
 * multi-role /api/users/me response (teacher + student), then tests
 * that the mobile drawer shows the "切換身分" section and role switching works.
 *
 * Tests:
 *   1. Single-role teacher → no "更多" button in bottom nav (correct hide)
 *   2. Multi-role (teacher+student) → "更多" visible → drawer shows "切換身分"
 *   3. Clicking "學生" pill → navigates to /student
 *   4. Active role pill has accent styling
 */

import { test, expect, type Route } from '@playwright/test';
import { dismissAllModals } from './fixtures';

const MOBILE_VIEWPORT = { width: 375, height: 812 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for app to fully load (logout button visible, no loading spinners). */
async function waitForAppReady(page: import('@playwright/test').Page) {
  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
  await dismissAllModals(page);
}

/**
 * Intercept /api/users/me and inject a response with teacher + student roles.
 * Must be called before page.goto() to ensure the intercept is active.
 */
async function mockMultiRoleUser(page: import('@playwright/test').Page) {
  await page.route('**/api/users/me', async (route: Route) => {
    const original = await route.fetch();
    const body = await original.json();
    // Inject student role alongside existing teacher role
    body.roles = [
      ...(body.roles ?? []),
      { role_name: 'student', role_display_name: '學生', scope_type: null, scope_id: null },
    ];
    await route.fulfill({ json: body });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Issue #571 — 行動版 Workspace 切換', () => {

  test.use({ storageState: 'e2e/.auth/teacher.json' });

  test('1. 單角色教師：底部導覽不顯示「更多」按鈕', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/teacher-home');
    await waitForAppReady(page);

    // Bottom nav should show 4 role-specific items but no "更多" for single-role
    const moreButton = page.locator('button:has-text("更多")');
    // Single-role teacher has exactly 4 nav items (主頁, 班級管理, 我的課文, 作業管理)
    // moreItems is empty AND hasMultipleViews is false → showMoreButton = false
    await expect(moreButton).not.toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/issue-571/single-role-no-more-button.png', fullPage: true });
  });

  test('2. 多角色用戶：底部導覽顯示「更多」按鈕', async ({ page }) => {
    await mockMultiRoleUser(page);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/teacher-home');
    await waitForAppReady(page);

    // With hasMultipleViews=true, showMoreButton should be true
    const moreButton = page.locator('button:has-text("更多")');
    await expect(moreButton).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: 'e2e/screenshots/issue-571/multi-role-more-button.png', fullPage: true });
  });

  test('3. 多角色用戶：點「更多」開 drawer，顯示「切換身分」section', async ({ page }) => {
    await mockMultiRoleUser(page);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/teacher-home');
    await waitForAppReady(page);

    // Open the drawer
    await page.locator('button:has-text("更多")').click();

    // Drawer should appear with "切換身分" label
    await expect(page.locator('text=切換身分')).toBeVisible({ timeout: 5_000 });

    // Both role pills should be present (use aria-label for precision)
    await expect(page.locator('button[aria-label="切換至老師"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button[aria-label="切換至學生"]')).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/issue-571/drawer-with-switcher.png', fullPage: true });
  });

  test('4. 點「學生」pill → 導航到 /student', async ({ page }) => {
    await mockMultiRoleUser(page);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/teacher-home');
    await waitForAppReady(page);

    // Open drawer
    await page.locator('button:has-text("更多")').click();
    await expect(page.locator('text=切換身分')).toBeVisible({ timeout: 5_000 });

    // Click student pill
    await page.locator('button[aria-label="切換至學生"]').click();

    // Should navigate to /student
    await expect(page).toHaveURL(/\/student/, { timeout: 10_000 });

    // localStorage should be updated
    const stored = await page.evaluate(() => localStorage.getItem('lingoleap_workspace_view'));
    expect(stored).toBe('student');

    await page.screenshot({ path: 'e2e/screenshots/issue-571/after-switch-to-student.png', fullPage: true });
  });

  test('5. 當前角色的 pill 有 accent 樣式（active state）', async ({ page }) => {
    await mockMultiRoleUser(page);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/teacher-home');
    await waitForAppReady(page);

    // Open drawer
    await page.locator('button:has-text("更多")').click();
    await expect(page.locator('text=切換身分')).toBeVisible({ timeout: 5_000 });

    // Active pill (teacher) should have aria-pressed="true"
    const teacherPill = page.locator('button[aria-label="切換至老師"]');
    await expect(teacherPill).toHaveAttribute('aria-pressed', 'true');

    // Inactive pill (student) should have aria-pressed="false"
    const studentPill = page.locator('button[aria-label="切換至學生"]');
    await expect(studentPill).toHaveAttribute('aria-pressed', 'false');

    await page.screenshot({ path: 'e2e/screenshots/issue-571/active-role-pill-state.png', fullPage: true });
  });

});
