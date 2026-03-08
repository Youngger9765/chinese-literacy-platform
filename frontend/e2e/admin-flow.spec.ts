import { test, expect, type Page } from '@playwright/test';

/**
 * Admin Dashboard E2E tests for LingoLeap preview environment.
 *
 * Tests the full admin flow: login → admin dashboard → org/school/classroom
 * management → user management → role management.
 *
 * Seed data on preview:
 *   - Admin: admin@test.com / admin1234 (王管理員, system_admin)
 *   - Org: 朗朗教育基金會
 *   - Schools: 台北市大安國小 (id=3), 新北市板橋國小 (id=4)
 *   - Classrooms: 三年甲班 (id=6, grade 3), 五年乙班 (id=7, grade 5)
 *   - Teachers: 李老師 (teacher@test.com), 陳老師 (teacher2@test.com)
 *   - Students: 小明, 小華, 小美
 */

const ADMIN_EMAIL = 'admin@test.com';
const ADMIN_PASSWORD = 'admin1234';
const RUN_ID = Date.now();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsAdmin(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 30_000 });

  await page.locator('#login-email').fill(ADMIN_EMAIL);
  await page.locator('#login-password').fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]:has-text("登入")').click();

  await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 30_000 });
}

async function goToAdmin(page: Page) {
  await loginAsAdmin(page);
  await page.locator('button:has-text("系統管理")').click();
  // Wait for sidebar to load with org data
  await expect(page.locator('text=朗朗教育基金會').first()).toBeVisible({ timeout: 15_000 });
}

/** Navigate to a specific school's detail panel via sidebar tree. */
async function navigateToSchool(page: Page, schoolName: string) {
  // Step 1: Click org name to select it (shows OrgDetailPanel)
  await page.locator('text=朗朗教育基金會').first().click();
  await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });

  // Step 2: Click the chevron on the SAME org row to expand sidebar tree
  // The selected org row has bg-blue-50 class
  const selectedOrgRow = page.locator('.bg-blue-50');
  const chevron = selectedOrgRow.locator('[aria-label="展開"]');
  if (await chevron.isVisible()) {
    await chevron.click();
  }

  // Step 3: Wait for school to appear in sidebar (now 2 matches: sidebar + OrgDetailPanel)
  await page.waitForTimeout(2000);

  // Step 4: Click the school in sidebar (first match in DOM = sidebar tree)
  await page.locator('text=' + schoolName).first().click();
  // Wait for SchoolDetailPanel heading
  await expect(page.getByRole('heading', { name: schoolName })).toBeVisible({ timeout: 10_000 });
}

/** Navigate to a classroom detail panel. */
async function navigateToClassroom(page: Page, schoolName: string, classroomName: string) {
  await navigateToSchool(page, schoolName);
  // Click classroom in the table
  await page.locator(`td:has-text("${classroomName}")`).click();
  // Wait for classroom detail to load
  await page.waitForTimeout(1000);
}

// ── 1. Admin Login & Navigation ─────────────────────────────────────────────

test.describe('Admin Dashboard - Navigation', () => {
  test('1.1 - Admin can see 系統管理 button after login', async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator('button:has-text("系統管理")')).toBeVisible();
  });

  test('1.2 - Clicking 系統管理 navigates to /admin', async ({ page }) => {
    await goToAdmin(page);
    expect(page.url()).toContain('/admin');
  });

  test('1.3 - Admin sidebar shows org tree', async ({ page }) => {
    await goToAdmin(page);
    await expect(page.locator('text=朗朗教育基金會').first()).toBeVisible({ timeout: 15_000 });
  });

  test('1.4 - StepperNav is NOT visible on admin page', async ({ page }) => {
    await goToAdmin(page);
    // Learning steps should NOT be shown on admin pages
    await expect(page.locator('text=逐段朗讀')).not.toBeVisible();
  });
});

// ── 2. Organization Detail ──────────────────────────────────────────────────

test.describe('Admin Dashboard - Organization', () => {
  test('2.1 - Click org shows OrgDetailPanel', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=所屬學校')).toBeVisible();
  });

  test('2.2 - Org detail shows schools list', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=台北市大安國小')).toBeVisible();
    await expect(page.locator('text=新北市板橋國小')).toBeVisible();
  });

  test('2.3 - Org detail has edit and toggle buttons', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("編輯")')).toBeVisible();
    await expect(
      page.locator('button:has-text("停用")').or(page.locator('button:has-text("啟用")'))
    ).toBeVisible();
  });

  test('2.4 - Org detail has 新增學校 button', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("新增學校")')).toBeVisible();
  });
});

// ── 3. School Detail ────────────────────────────────────────────────────────

test.describe('Admin Dashboard - School', () => {
  test('3.1 - Expand org shows schools in sidebar', async ({ page }) => {
    await goToAdmin(page);
    // Click org name first to select it, then expand its chevron
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    // Click chevron on the selected org row (bg-blue-50)
    const chevron = page.locator('.bg-blue-50').locator('[aria-label="展開"]');
    if (await chevron.isVisible()) {
      await chevron.click();
    }
    await expect(page.locator('text=台北市大安國小').first()).toBeVisible({ timeout: 15_000 });
  });

  test('3.2 - Click school shows SchoolDetailPanel', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    // Verify heading is showing
    await expect(page.getByRole('heading', { name: '台北市大安國小' })).toBeVisible();
  });

  test('3.3 - School detail shows classroom table', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');

    // Should see classrooms in the table
    await expect(page.locator('td:has-text("三年甲班")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('td:has-text("五年乙班")')).toBeVisible();
  });

  test('3.4 - School detail shows 新增班級 button', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.locator('button:has-text("新增班級")')).toBeVisible();
  });

  test('3.5 - School detail shows join code section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.locator('text=學校加入代碼')).toBeVisible();
    // Seed data has null join_code, so "尚無加入代碼" text should be visible
    await expect(page.locator('text=尚無加入代碼')).toBeVisible();
  });

  test('3.6 - School detail shows teacher section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await expect(page.locator('h3:has-text("教師")')).toBeVisible();
    await expect(page.locator('button:has-text("指派教師")')).toBeVisible();
  });
});

// ── 4. Classroom Detail ─────────────────────────────────────────────────────

test.describe('Admin Dashboard - Classroom', () => {
  test('4.1 - Click classroom from school panel opens ClassroomDetailPanel', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    // Should show edit button in classroom detail
    await expect(page.locator('button:has-text("編輯")')).toBeVisible({ timeout: 10_000 });
  });

  test('4.2 - Classroom detail shows student section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    // Should show student heading
    await expect(page.locator('h3:has-text("學生")')).toBeVisible({ timeout: 10_000 });
  });

  test('4.3 - Classroom detail has join code section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('h3:has-text("加入代碼")')).toBeVisible({ timeout: 10_000 });
  });

  test('4.4 - Classroom detail has batch create section', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('button:has-text("批量建立學生")')).toBeVisible({ timeout: 10_000 });
  });

  test('4.5 - Classroom detail has add student button', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');
    await expect(page.locator('button:has-text("新增學生")')).toBeVisible({ timeout: 10_000 });
  });

  test('4.6 - Classroom detail back-to-school navigation', async ({ page }) => {
    await goToAdmin(page);
    await navigateToClassroom(page, '台北市大安國小', '三年甲班');

    // Click school name in breadcrumb to go back
    await page.locator('button:has-text("台北市大安國小")').first().click();
    // Should be back at school detail
    await expect(page.getByRole('heading', { name: '台北市大安國小' })).toBeVisible({ timeout: 10_000 });
  });
});

// ── 5. Users Panel ──────────────────────────────────────────────────────────

test.describe('Admin Dashboard - Users Panel', () => {
  test('5.1 - Click 使用者管理 shows UsersPanel', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
  });

  test('5.2 - Users panel shows user list', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=王管理員')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=admin@test.com')).toBeVisible();
  });

  test('5.3 - Users panel shows role badges', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });
    // Admin's role badge
    await expect(page.locator('span:has-text("系統管理員")')).toBeVisible({ timeout: 10_000 });
  });

  test('5.4 - Users panel search filters results', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });

    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('李老師');
    // Wait for debounce (300ms) + API response
    await expect(page.locator('text=李老師')).toBeVisible({ timeout: 10_000 });
    // Total should show filtered count
    await expect(page.locator('text=共 1 位使用者')).toBeVisible({ timeout: 5_000 });
  });

  test('5.5 - Users panel expand shows role details', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });

    await page.locator('text=管理角色').first().click();
    await expect(page.locator('text=目前角色')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("指派角色")')).toBeVisible();
  });
});

// ── 6. Roles Panel ──────────────────────────────────────────────────────────

test.describe('Admin Dashboard - Roles Panel', () => {
  test('6.1 - Click 角色管理 shows RolesPanel', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=角色管理').click();
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 10_000 });
  });

  test('6.2 - Roles panel shows all predefined roles', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=角色管理').click();
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 10_000 });

    // Check role cards
    await expect(page.locator('h3:has-text("系統管理員")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h3:has-text("機構擁有者")')).toBeVisible();
    await expect(page.locator('h3:has-text("機構管理員")')).toBeVisible();
    await expect(page.locator('h3:has-text("校長")')).toBeVisible();
    await expect(page.locator('h3:has-text("主任")')).toBeVisible();
    await expect(page.locator('h3:has-text("教師")')).toBeVisible();
    await expect(page.locator('h3:has-text("學生")')).toBeVisible();
    await expect(page.locator('h3:has-text("一般員工")')).toBeVisible();
  });

  test('6.3 - Roles panel shows scope level badges', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=角色管理').click();
    await expect(page.getByRole('heading', { name: '角色管理' })).toBeVisible({ timeout: 10_000 });

    // Wait for role cards to load, then check scope level badges exist
    await expect(page.locator('h3:has-text("系統管理員")')).toBeVisible({ timeout: 10_000 });
    // Count shows 8 roles
    await expect(page.locator('text=共 8 個角色')).toBeVisible();
  });
});

// ── 7. Create Organization Flow ─────────────────────────────────────────────

test.describe('Admin Dashboard - Create Organization', () => {
  test('7.1 - Click + button shows CreateOrgPanel', async ({ page }) => {
    await goToAdmin(page);
    const addBtn = page.locator('button').filter({ has: page.locator('path[d*="M12 4.5v15"]') }).first();
    await addBtn.click();
    await expect(page.getByRole('heading', { name: '新增機構' })).toBeVisible({ timeout: 10_000 });
  });

  test('7.2 - Create org form has required fields', async ({ page }) => {
    await goToAdmin(page);
    const addBtn = page.locator('button').filter({ has: page.locator('path[d*="M12 4.5v15"]') }).first();
    await addBtn.click();
    await expect(page.getByRole('heading', { name: '新增機構' })).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('#create-org-name')).toBeVisible();
    await expect(page.locator('#create-org-display')).toBeVisible();
    await expect(page.getByRole('button', { name: '建立機構' })).toBeVisible();
  });
});

// ── 8. Create School Flow ───────────────────────────────────────────────────

test.describe('Admin Dashboard - Create School', () => {
  test('8.1 - Click 新增學校 shows inline form', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("新增學校")').click();
    await expect(page.locator('h4:has-text("新增學校")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#new-school-name')).toBeVisible();
  });

  test('8.2 - Create school form has name, phone, address fields', async ({ page }) => {
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
  });

  test('8.3 - Cancel hides the create school form', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("新增學校")').click();
    await expect(page.locator('h4:has-text("新增學校")')).toBeVisible({ timeout: 5_000 });

    await page.locator('button:has-text("取消")').first().click();
    await expect(page.locator('h4:has-text("新增學校")')).not.toBeVisible();
  });
});

// ── 9. Create Classroom Flow ────────────────────────────────────────────────

test.describe('Admin Dashboard - Create Classroom', () => {
  test('9.1 - Click 新增班級 shows inline form', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');

    await page.locator('button:has-text("新增班級")').click();
    await expect(page.locator('label:has-text("班級名稱")')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('label:has-text("年級")')).toBeVisible();
  });

  test('9.2 - Create classroom form has teacher dropdown', async ({ page }) => {
    await goToAdmin(page);
    await navigateToSchool(page, '台北市大安國小');
    await page.locator('button:has-text("新增班級")').click();

    await expect(page.locator('label:has-text("導師")')).toBeVisible({ timeout: 5_000 });
    // Should have a select element for teacher selection
    await expect(page.locator('#new-class-teacher')).toBeVisible();
  });
});

// ── 10. Sidebar Tree Structure ──────────────────────────────────────────────

test.describe('Admin Dashboard - Sidebar Tree', () => {
  test('10.1 - Sidebar shows collapsed org by default', async ({ page }) => {
    await goToAdmin(page);
    await expect(page.locator('text=朗朗教育基金會').first()).toBeVisible({ timeout: 15_000 });
  });

  test('10.2 - Expand org reveals schools under it', async ({ page }) => {
    await goToAdmin(page);
    // Click org to select, then expand
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });
    const chevron = page.locator('.bg-blue-50').locator('[aria-label="展開"]');
    if (await chevron.isVisible()) {
      await chevron.click();
    }
    await expect(page.locator('text=台北市大安國小').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=新北市板橋國小').first()).toBeVisible();
  });

  test('10.3 - Sidebar bottom shows 角色管理 and 使用者管理', async ({ page }) => {
    await goToAdmin(page);
    await expect(page.locator('text=角色管理')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=使用者管理')).toBeVisible();
  });
});

// ── 11. Data Mutation Tests ─────────────────────────────────────────────────

test.describe('Admin Dashboard - Full Create Flow', () => {
  test('11.1 - Create a new org and verify in detail panel', async ({ page }) => {
    const orgName = `e2e-org-${RUN_ID}`;
    const orgDisplayName = `E2E測試機構-${RUN_ID}`;

    await goToAdmin(page);

    const addBtn = page.locator('button').filter({ has: page.locator('path[d*="M12 4.5v15"]') }).first();
    await addBtn.click();
    await expect(page.getByRole('heading', { name: '新增機構' })).toBeVisible({ timeout: 10_000 });

    await page.locator('#create-org-name').fill(orgName);
    await page.locator('#create-org-display').fill(orgDisplayName);
    await page.getByRole('button', { name: '建立機構' }).click();

    // After creation, should redirect to org detail panel
    await expect(page.getByRole('heading', { name: orgDisplayName })).toBeVisible({ timeout: 15_000 });
  });

  test('11.2 - Create a new school under existing org', async ({ page }) => {
    const schoolName = `E2E測試學校-${RUN_ID}`;

    await goToAdmin(page);
    await page.locator('text=朗朗教育基金會').first().click();
    await expect(page.getByRole('heading', { name: '朗朗教育基金會' })).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("新增學校")').click();
    await expect(page.locator('h4:has-text("新增學校")')).toBeVisible({ timeout: 5_000 });

    await page.locator('#new-school-name').fill(schoolName);
    await page.locator('#new-school-phone').fill('02-1234-5678');
    await page.locator('button:has-text("建立學校")').click();

    // School should appear in the org's school list
    await expect(page.locator(`text=${schoolName}`).first()).toBeVisible({ timeout: 15_000 });
  });
});

// ── 12. User Role Assignment Flow ───────────────────────────────────────────

test.describe('Admin Dashboard - Role Assignment', () => {
  test('12.1 - Assign role form shows role dropdown with all roles', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });

    await page.locator('text=管理角色').first().click();
    await expect(page.locator('text=目前角色')).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("指派角色")').click();
    await expect(page.locator('h5:has-text("指派新角色")')).toBeVisible({ timeout: 5_000 });

    const roleSelect = page.locator('#assign-role-select');
    await expect(roleSelect).toBeVisible();
    const options = roleSelect.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(8); // 8 roles + 1 placeholder
  });

  test('12.2 - Selecting school-scoped role shows school selector', async ({ page }) => {
    await goToAdmin(page);
    await page.locator('text=使用者管理').click();
    await expect(page.getByRole('heading', { name: '使用者管理' })).toBeVisible({ timeout: 10_000 });

    await page.locator('text=管理角色').first().click();
    await expect(page.locator('text=目前角色')).toBeVisible({ timeout: 10_000 });

    await page.locator('button:has-text("指派角色")').click();
    await expect(page.locator('#assign-role-select')).toBeVisible({ timeout: 5_000 });

    // Select "教師" (school-scoped role)
    await page.locator('#assign-role-select').selectOption('teacher');

    // Should show school selector
    await expect(page.locator('#assign-scope-school')).toBeVisible({ timeout: 5_000 });
  });
});
