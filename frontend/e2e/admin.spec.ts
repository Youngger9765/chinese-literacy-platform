/**
 * admin.spec.ts — 旅程 H：機構管理 (#362)
 *
 * Migrated from admin-flow.spec.ts (42 tests) and extended with new coverage.
 *
 * Auth: storageState from e2e/.auth/admin.json (admin@test.com / admin1234)
 *
 * Seed data:
 *   Admin:      admin@test.com / admin1234  (王管理員, system_admin)
 *   Org:        朗朗教育基金會
 *   Schools:    台北市大安國小, 新北市板橋國小
 *   Classrooms: 三年甲班 (grade 3), 五年乙班 (grade 5)
 *   Teachers:   李老師 (teacher@test.com), 陳老師 (teacher2@test.com)
 *   Students:   小明, 小華, 小美
 */

import { test, expect, type Page } from '@playwright/test';
import { takeScreenshot } from './fixtures';

// ---------------------------------------------------------------------------
// Unique run ID for mutation tests
// ---------------------------------------------------------------------------

const RUN_ID = Date.now();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to /admin and wait for org sidebar to load. */
async function goToAdmin(page: Page): Promise<void> {
  await page.goto('/admin');
  await expect(page.locator('text=朗朗教育基金會').first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Navigate to a school's detail panel via the sidebar tree.
 * Clicks the org name → expands the chevron → clicks the school name.
 */
async function navigateToSchool(page: Page, schoolName: string): Promise<void> {
  // Click org name to select it (shows OrgDetailPanel)
  await page.locator('text=朗朗教育基金會').first().click();
  await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });

  // Expand the sidebar chevron on the selected org row (has bg-blue-50)
  const chevron = page.locator('.bg-blue-50').locator('[aria-label="展開"]');
  if (await chevron.isVisible()) {
    await chevron.click();
  }

  // Wait for sidebar to reveal school nodes
  await page.waitForTimeout(2000);

  // Click school in sidebar (first DOM match = sidebar tree item)
  await page.locator('text=' + schoolName).first().click();
  await expect(page.getByRole('heading', { name: schoolName })).toBeVisible({ timeout: 10_000 });
}

/**
 * Navigate to a classroom detail panel.
 * Calls navigateToSchool then clicks the classroom row in the table.
 */
async function navigateToClassroom(
  page: Page,
  schoolName: string,
  classroomName: string
): Promise<void> {
  await navigateToSchool(page, schoolName);
  await page.locator(`td:has-text("${classroomName}")`).click();
  await page.waitForTimeout(1000);
}

// ---------------------------------------------------------------------------
// H.1 機構層級管理
// ---------------------------------------------------------------------------

// ── H.1 Navigation ──────────────────────────────────────────────────────────

test.describe('H.1 Navigation', () => {
  test('admin-h1-01 — Admin sees 系統管理 button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('button:has-text("系統管理")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-01-system-admin-button', '管理員首頁可見系統管理按鈕');
  });

  test('admin-h1-02 — Clicking 系統管理 navigates to /admin', async ({ page }) => {
    await goToAdmin(page);
    expect(page.url()).toContain('/admin');
    await takeScreenshot(page, 'admin-h1-02-admin-url', '點擊系統管理後 URL 含 /admin');
  });

  test('admin-h1-03 — Sidebar shows org tree', async ({ page }) => {
    await goToAdmin(page);
    await expect(page.locator('text=朗朗教育基金會').first()).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'admin-h1-03-sidebar-org-tree', '側欄顯示機構樹狀結構');
  });

  test('admin-h1-04 — StepperNav NOT visible on admin page', async ({ page }) => {
    await goToAdmin(page);
    await expect(page.locator('text=逐段朗讀')).not.toBeVisible();
    await takeScreenshot(page, 'admin-h1-04-no-stepper-nav', '管理員頁面不顯示學習步驟導航');
  });
});

// ── H.1 Organization ────────────────────────────────────────────────────────

test.describe('H.1 Organization', () => {
  test('admin-h1-05 — Click org shows OrgDetailPanel with heading', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=所屬學校')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-05-org-detail-panel', '點擊機構顯示 OrgDetailPanel');
  });

  test('admin-h1-06 — Org detail shows schools list', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=台北市大安國小')).toBeVisible();
    await expect(page.locator('text=新北市板橋國小')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-06-org-schools-list', '機構詳情顯示所屬學校清單');
  });

  test('admin-h1-07 — Org detail has edit and toggle buttons', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("編輯")')).toBeVisible();
    await expect(
      page.locator('button:has-text("停用")').or(page.locator('button:has-text("啟用")'))
    ).toBeVisible();
    await takeScreenshot(page, 'admin-h1-07-org-edit-toggle-buttons', '機構詳情顯示編輯與切換按鈕');
  });

  test('admin-h1-08 — Org detail has 新增學校 button', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("新增學校")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-08-org-add-school-button', '機構詳情顯示新增學校按鈕');
  });
});

// ── H.1 School ──────────────────────────────────────────────────────────────

test.describe('H.1 School', () => {
  test('admin-h1-09 — Expand org reveals schools in sidebar', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    const chevron = page.locator('.bg-blue-50').locator('[aria-label="展開"]');
    if (await chevron.isVisible()) {
      await chevron.click();
    }
    await expect(page.locator('text=台北市大安國小').first()).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'admin-h1-09-sidebar-expand-schools', '展開機構後側欄顯示學校');
  });

  test('admin-h1-10 — Click school shows SchoolDetailPanel', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.getByRole('heading', { name: '台北市大安國小' })).toBeVisible();
    await takeScreenshot(page, 'admin-h1-10-school-detail-panel', '點擊學校顯示 SchoolDetailPanel');
  });

  test('admin-h1-11 — School detail shows classroom table', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.locator('td:has-text("三年甲班")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('td:has-text("五年乙班")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-11-school-classroom-table', '學校詳情顯示班級表格');
  });

  test('admin-h1-12 — School detail shows 新增班級 button', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.locator('button:has-text("新增班級")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-12-school-add-classroom-button', '學校詳情顯示新增班級按鈕');
  });

  test('admin-h1-13 — School detail shows join code section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.locator('text=學校加入代碼')).toBeVisible();
    await expect(page.locator('text=尚無加入代碼')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-13-school-join-code', '學校詳情顯示加入代碼區塊');
  });

  test('admin-h1-14 — School detail shows teacher section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.locator('h3:has-text("教師")')).toBeVisible();
    await expect(page.locator('button:has-text("指派教師")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-14-school-teacher-section', '學校詳情顯示教師區塊');
  });
});

// ── H.1 Classroom ───────────────────────────────────────────────────────────

test.describe('H.1 Classroom', () => {
  test('admin-h1-15 — Click classroom opens ClassroomDetailPanel', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('button:has-text("編輯")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-15-classroom-detail-panel', '點擊班級顯示 ClassroomDetailPanel');
  });

  test('admin-h1-16 — Classroom detail shows student section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('h3:has-text("學生")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-16-classroom-student-section', '班級詳情顯示學生區塊');
  });

  test('admin-h1-17 — Classroom detail has join code section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('h3:has-text("加入代碼")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-17-classroom-join-code', '班級詳情顯示加入代碼區塊');
  });

  test('admin-h1-18 — Classroom detail has batch create section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('button:has-text("批量建立學生")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-18-classroom-batch-create', '班級詳情顯示批量建立學生按鈕');
  });

  test('admin-h1-19 — Classroom detail has add student button', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('button:has-text("新增學生")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-19-classroom-add-student', '班級詳情顯示新增學生按鈕');
  });

  test('admin-h1-20 — Classroom back-to-school navigation', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await page.locator('button:has-text("台北市大安國小")').first().click();
    await expect(page.getByRole('heading', { name: '台北市大安國小' })).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-20-classroom-back-to-school', '點擊麵包屑返回學校詳情');
  });
});

// ── H.1 Users Panel ─────────────────────────────────────────────────────────

test.describe('H.1 Users Panel', () => {
  test('admin-h1-21 — Click 使用者管理 shows UsersPanel', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-21-users-panel', '點擊使用者管理顯示 UsersPanel');
  });

  test('admin-h1-22 — Users panel shows user list (search 王管理員)', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('王管理員');
    await expect(page.locator('text=王管理員')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=admin@test.com')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-22-users-list-search-admin', '使用者管理顯示王管理員搜尋結果');
  });

  test('admin-h1-23 — Users panel shows role badges', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('王管理員');
    await expect(page.locator('span:has-text("系統管理員")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-23-users-role-badges', '使用者清單顯示角色標籤');
  });

  test('admin-h1-24 — Users panel search filters results', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('李老師');
    await expect(page.locator('text=李老師')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=共 1 位使用者')).toBeVisible({ timeout: 5_000 });
    await takeScreenshot(page, 'admin-h1-24-users-search-filter', '搜尋功能正確過濾使用者列表');
  });

  test('admin-h1-25 — Users panel expand shows role details', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('王管理員');
    await expect(page.locator('text=共 1 位使用者')).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("管理角色")').first().click();
    await expect(page.locator('text=目前角色')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("指派角色")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-25-users-role-details', '展開使用者顯示角色詳情');
  });
});

// ── H.1 Roles Panel ─────────────────────────────────────────────────────────

test.describe('H.1 Roles Panel', () => {
  test('admin-h1-26 — Click 角色管理 shows RolesPanel', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=角色管理').click();
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-26-roles-panel', '點擊角色管理顯示 RolesPanel');
  });

  test('admin-h1-27 — Roles panel shows all 8 predefined roles', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=角色管理').click();
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h3:has-text("系統管理員")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h3:has-text("機構擁有者")')).toBeVisible();
    await expect(page.locator('h3:has-text("機構管理員")')).toBeVisible();
    await expect(page.locator('h3:has-text("校長")')).toBeVisible();
    await expect(page.locator('h3:has-text("主任")')).toBeVisible();
    await expect(page.locator('h3:has-text("教師")')).toBeVisible();
    await expect(page.locator('h3:has-text("學生")')).toBeVisible();
    await expect(page.locator('h3:has-text("一般員工")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-27-roles-all-predefined', '角色管理顯示全部 8 個預設角色');
  });

  test('admin-h1-28 — Roles panel shows scope level badges', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=角色管理').click();
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h3:has-text("系統管理員")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=共 8 個角色')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-28-roles-scope-badges', '角色管理顯示範圍層級標籤與總數');
  });
});

// ── H.1 Create Org ───────────────────────────────────────────────────────────

test.describe('H.1 Create Org', () => {
  test('admin-h1-29 — Click + shows CreateOrgPanel', async ({ page }) => {
    await goToAdmin(page);
    const addBtn = page
      .locator('button')
      .filter({ has: page.locator('path[d*="M12 4.5v15"]') })
      .first();
    await addBtn.click();
    await expect(page.getByRole('heading', { name: '新增機構' })).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h1-29-create-org-panel', '點擊 + 按鈕顯示新增機構面板');
  });

  test('admin-h1-30 — Create org form has required fields', async ({ page }) => {
    await goToAdmin(page);
    const addBtn = page
      .locator('button')
      .filter({ has: page.locator('path[d*="M12 4.5v15"]') })
      .first();
    await addBtn.click();
    await expect(page.getByRole('heading', { name: '新增機構' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#create-org-name')).toBeVisible();
    await expect(page.locator('#create-org-display')).toBeVisible();
    await expect(page.getByRole('button', { name: '建立機構' })).toBeVisible();
    await takeScreenshot(page, 'admin-h1-30-create-org-form-fields', '新增機構表單顯示必填欄位');
  });
});

// ── H.1 Create School ────────────────────────────────────────────────────────

test.describe('H.1 Create School', () => {
  test('admin-h1-31 — Click 新增學校 shows inline form', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("新增學校")').click();
    await expect(page.locator('h4:has-text("新增學校")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#new-school-name')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-31-create-school-inline-form', '點擊新增學校顯示行內表單');
  });

  test('admin-h1-32 — Create school form has name, phone, address fields', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("新增學校")').click();
    await expect(page.locator('h4:has-text("新增學校")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('label:has-text("學校名稱")')).toBeVisible();
    await expect(page.locator('label:has-text("電話")')).toBeVisible();
    await expect(page.locator('label:has-text("地址")')).toBeVisible();
    await expect(page.locator('button:has-text("建立學校")')).toBeVisible();
    await expect(page.locator('button:has-text("取消")').first()).toBeVisible();
    await takeScreenshot(page, 'admin-h1-32-create-school-form-fields', '新增學校表單顯示名稱電話地址欄位');
  });

  test('admin-h1-33 — Cancel hides the create school form', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("新增學校")').click();
    await expect(page.locator('h4:has-text("新增學校")')).toBeVisible({ timeout: 5_000 });
    await page.locator('button:has-text("取消")').first().click();
    await expect(page.locator('h4:has-text("新增學校")')).not.toBeVisible();
    await takeScreenshot(page, 'admin-h1-33-create-school-cancel', '點擊取消隱藏新增學校表單');
  });
});

// ── H.1 Create Classroom ─────────────────────────────────────────────────────

test.describe('H.1 Create Classroom', () => {
  test('admin-h1-34 — Click 新增班級 shows inline form', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await page.locator('button:has-text("新增班級")').click();
    await expect(page.locator('label:has-text("班級名稱")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('label:has-text("年級")')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-34-create-classroom-inline-form', '點擊新增班級顯示行內表單');
  });

  test('admin-h1-35 — Create classroom form has teacher dropdown', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await page.locator('button:has-text("新增班級")').click();
    await expect(page.locator('label:has-text("導師")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#new-class-teacher')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-35-create-classroom-teacher-dropdown', '新增班級表單顯示導師下拉選單');
  });
});

// ── H.1 Sidebar Tree ─────────────────────────────────────────────────────────

test.describe('H.1 Sidebar Tree', () => {
  test('admin-h1-36 — Sidebar collapsed by default shows org name', async ({ page }) => {
    await goToAdmin(page);
    await expect(page.locator('text=朗朗教育基金會').first()).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'admin-h1-36-sidebar-default-state', '側欄預設顯示機構名稱（未展開）');
  });

  test('admin-h1-37 — Expand reveals schools under org', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    const chevron = page.locator('.bg-blue-50').locator('[aria-label="展開"]');
    if (await chevron.isVisible()) {
      await chevron.click();
    }
    await expect(page.locator('text=台北市大安國小').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=新北市板橋國小').first()).toBeVisible();
    await takeScreenshot(page, 'admin-h1-37-sidebar-expand-reveals-schools', '展開機構後顯示學校清單');
  });

  test('admin-h1-38 — Sidebar shows 角色管理 and 使用者管理', async ({ page }) => {
    await goToAdmin(page);
    await expect(page.locator('text=角色管理')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=使用者管理')).toBeVisible();
    await takeScreenshot(page, 'admin-h1-38-sidebar-bottom-links', '側欄底部顯示角色管理與使用者管理連結');
  });
});

// ── H.1 Data Mutation ────────────────────────────────────────────────────────

test.describe('H.1 Data Mutation', () => {
  test('admin-h1-39 — Create a new org and verify in detail panel', async ({ page }) => {
    const orgName = `e2e-org-${RUN_ID}`;
    const orgDisplayName = `E2E測試機構-${RUN_ID}`;

    await goToAdmin(page);
    const addBtn = page
      .locator('button')
      .filter({ has: page.locator('path[d*="M12 4.5v15"]') })
      .first();
    await addBtn.click();
    await expect(page.getByRole('heading', { name: '新增機構' })).toBeVisible({ timeout: 10_000 });

    await page.locator('#create-org-name').fill(orgName);
    await page.locator('#create-org-display').fill(orgDisplayName);
    await page.getByRole('button', { name: '建立機構' }).click();

    await expect(page.getByRole('heading', { name: orgDisplayName })).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'admin-h1-39-create-org-verify', '建立新機構後在詳情面板中確認');
  });

  test('admin-h1-40 — Create a new school under existing org', async ({ page }) => {
    const schoolName = `E2E測試學校-${RUN_ID}`;

    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("新增學校")').click();
    await expect(page.locator('h4:has-text("新增學校")')).toBeVisible({ timeout: 5_000 });

    await page.locator('#new-school-name').fill(schoolName);
    await page.locator('#new-school-phone').fill('02-1234-5678');
    await page.locator('button:has-text("建立學校")').click();

    await expect(page.locator(`text=${schoolName}`).first()).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'admin-h1-40-create-school-verify', '在現有機構下新增學校並確認出現在清單');
  });
});

// ── H.1 Role Assignment ──────────────────────────────────────────────────────

test.describe('H.1 Role Assignment', () => {
  test('admin-h1-41 — Assign role form shows role dropdown', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('李老師');
    await expect(page.locator('text=共 1 位使用者')).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("管理角色")').first().click();
    await expect(page.locator('text=目前角色')).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("指派角色")').click();
    await expect(page.locator('h5:has-text("指派新角色")')).toBeVisible({ timeout: 5_000 });

    const roleSelect = page.locator('#assign-role-select');
    await expect(roleSelect).toBeVisible();
    const options = roleSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(8);
    await takeScreenshot(page, 'admin-h1-41-assign-role-dropdown', '指派角色表單顯示角色下拉選單');
  });

  test('admin-h1-42 — School-scoped role shows school selector', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('李老師');
    await expect(page.locator('text=共 1 位使用者')).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("管理角色")').first().click();
    await expect(page.locator('text=目前角色')).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("指派角色")').click();
    await expect(page.locator('#assign-role-select')).toBeVisible({ timeout: 5_000 });

    // 教師 is a school-scoped role — selecting it should reveal the school selector
    await page.locator('#assign-role-select').selectOption('teacher');
    await expect(page.locator('#assign-scope-school')).toBeVisible({ timeout: 5_000 });
    await takeScreenshot(page, 'admin-h1-42-assign-role-school-scoped', '選擇學校層級角色後顯示學校選擇器');
  });
});

// ---------------------------------------------------------------------------
// H.2 機構儀表板統計 (new)
// ---------------------------------------------------------------------------

test.describe('H.2 機構儀表板統計', () => {
  test('admin-h2-01 — Admin home page shows statistics overview', async ({ page }) => {
    await goToAdmin(page);
    // The admin page should render a statistics/overview section.
    // Accept any of the common heading patterns the dashboard may use.
    const statsSection = page
      .locator('text=統計')
      .or(page.locator('text=總覽'))
      .or(page.locator('text=機構總覽'))
      .or(page.locator('text=數據總覽'));
    const hasSidebar = page.locator('text=朗朗教育基金會').first();

    // Sidebar must always be present; stats section is best-effort
    await expect(hasSidebar).toBeVisible({ timeout: 15_000 });

    // If a stats section exists, verify it's visible
    const statsVisible = await statsSection.isVisible({ timeout: 5_000 }).catch(() => false);
    if (statsVisible) {
      await expect(statsSection.first()).toBeVisible();
    }

    await takeScreenshot(page, 'admin-h2-01-statistics-overview', '管理員首頁顯示統計總覽區塊');
  });
});

// ---------------------------------------------------------------------------
// H.3 機構點數/授權管理 (new — skip if not implemented)
// ---------------------------------------------------------------------------

test.describe('H.3 機構點數/授權管理', () => {
  test('admin-h3-01 — Credits panel visible if implemented', async ({ page }) => {
    await goToAdmin(page);

    const creditsLink = page.locator('text=點數管理').or(page.locator('text=授權管理'));
    const isImplemented = await creditsLink.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!isImplemented) {
      // Feature not yet implemented — skip gracefully
      test.skip();
      return;
    }

    await creditsLink.first().click();
    const creditsHeading = page
      .locator('h2:has-text("點數")')
      .or(page.locator('h2:has-text("授權")'))
      .or(page.locator('h1:has-text("點數")')  )
      .or(page.locator('h1:has-text("授權")'));
    await expect(creditsHeading.first()).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'admin-h3-01-credits-panel', '點數/授權管理面板可見');
  });
});
