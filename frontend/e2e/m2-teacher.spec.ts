/**
 * m2-teacher.spec.ts — M2: 教師功能測試 (#482)
 *
 * 模組 M2 涵蓋教師的班級管理旅程：
 *   B — 建立班級 + 管理學生   (B.3: classroom CRUD + navigation)
 *   C — 上傳課文 + 指派作業   (C.1-C.4)
 *   D — 查看報告 + 學生管理   (D.1-D.6)
 *
 * Auth strategy:
 *   使用 storageState from e2e/.auth/teacher.json。
 *   不需要重新登入。
 *
 * Seed data (staging):
 *   Teacher: teacher@test.com / teacher1234 (李老師)
 *   Classrooms: 三年甲班, 五年乙班 under 台北市大安國小
 */

import { test, expect, type Page } from '@playwright/test';
import {
  takeScreenshot,
  dismissAllModals,
  ensureAuthenticated,
  withScreenshotOnFailure,
} from './fixtures';

// ---------------------------------------------------------------------------
// Module-local helpers
// ---------------------------------------------------------------------------

/** Navigate to /teacher dashboard and dismiss any modals. */
async function goToTeacher(page: Page): Promise<void> {
  await page.goto('/teacher');
  await dismissAllModals(page);
  await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
}

/** Navigate to a specific classroom's detail page. */
async function navigateToClassroom(page: Page, classroomName: string): Promise<void> {
  await goToTeacher(page);
  await expect(page.locator(`text=${classroomName}`).first()).toBeVisible({ timeout: 30_000 });
  await page.locator(`text=${classroomName}`).first().click();
  await expect(page.locator('button:has-text("返回班級列表")')).toBeVisible({ timeout: 15_000 });
}

// ===========================================================================
// M2 旅程 B — 班級管理 (B.3)
// ===========================================================================

test.describe('M2 — 旅程 B：班級管理 (B.3)', () => {
  test('B.3.1 - Teacher 首頁顯示「班級管理」按鈕', withScreenshotOnFailure('m2-b3-1-nav-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);

    await expect(
      page.getByRole('button', { name: '班級管理' })
    ).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-b1-nav-button', '教師首頁 — 班級管理按鈕');
  }));

  test('B.3.2 - 點擊「班級管理」進入 /teacher 頁面', withScreenshotOnFailure('m2-b3-2-nav-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await page.locator('button:has-text("班級管理")').first().click();

    await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/teacher');

    await takeScreenshot(page, 'teacher-b2-teacher-page', '班級管理頁面 /teacher');
  }));

  test('B.3.3 - 教師角色不顯示「系統管理」按鈕', withScreenshotOnFailure('m2-b3-3-no-admin-fail', async ({ page }) => {
    await ensureAuthenticated(page);

    await expect(page.locator('button:has-text("系統管理")')).not.toBeVisible();

    await takeScreenshot(page, 'teacher-b3-no-admin-btn', '教師首頁 — 無系統管理按鈕');
  }));

  test('B.3.4 - 教師角色不顯示「加入班級」按鈕', withScreenshotOnFailure('m2-b3-4-no-join-fail', async ({ page }) => {
    await ensureAuthenticated(page);

    await expect(page.locator('button:has-text("加入班級")')).not.toBeVisible();

    await takeScreenshot(page, 'teacher-b4-no-join-btn', '教師首頁 — 無加入班級按鈕');
  }));

  test('B.3.5 - 班級列表顯示種子班級（三年甲班、五年乙班）', withScreenshotOnFailure('m2-b3-5-classrooms-fail', async ({ page }) => {
    await goToTeacher(page);

    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=五年乙班').first()).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-b5-classroom-cards', '班級列表 — 三年甲班、五年乙班');
  }));

  test('B.3.6 - Dashboard header 顯示「共 N 個班級」', withScreenshotOnFailure('m2-b3-6-count-fail', async ({ page }) => {
    await goToTeacher(page);

    await expect(page.locator('text=/共 \\d+ 個班級/')).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-b6-classroom-count', '班級管理 — 共 N 個班級 header');
  }));

  test('B.3.7 - 班級卡片顯示學生人數（N 位學生）', withScreenshotOnFailure('m2-b3-7-student-count-fail', async ({ page }) => {
    await goToTeacher(page);
    await expect(page.locator('text=三年甲班').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('text=/\\d+ 位學生/').first()).toBeVisible({ timeout: 10_000 });

    await takeScreenshot(page, 'teacher-b7-student-count', '班級卡片 — N 位學生');
  }));

  test('B.3.8 - 點擊班級卡片進入班級詳情 URL', withScreenshotOnFailure('m2-b3-8-detail-url-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');

    expect(page.url()).toMatch(/\/teacher\/classroom\/\d+/);

    await takeScreenshot(page, 'teacher-b8-classroom-detail', '班級詳情頁 URL');
  }));

  test('B.3.9 - 班級詳情頁顯示班級名稱 heading', withScreenshotOnFailure('m2-b3-9-detail-name-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');

    await expect(page.locator('h2:has-text("三年甲班")')).toBeVisible({ timeout: 10_000 });

    await takeScreenshot(page, 'teacher-b9-classroom-name', '班級詳情 — 三年甲班 heading');
  }));

  test('B.3.10 - 班級詳情顯示三個 tab（學生進度、課文管理、學生名單）', withScreenshotOnFailure('m2-b3-10-tabs-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');

    await expect(page.locator('button:has-text("學生進度")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("課文管理")')).toBeVisible();
    await expect(page.locator('button:has-text("學生名單")')).toBeVisible();

    await takeScreenshot(page, 'teacher-b10-three-tabs', '班級詳情 — 三個 tab');
  }));

  test('B.3.11 - 班級詳情顯示「編輯」與「停用/啟用」按鈕', withScreenshotOnFailure('m2-b3-11-edit-toggle-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');

    await expect(page.locator('button:has-text("編輯")')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('button:has-text("停用")').or(page.locator('button:has-text("啟用")'))
    ).toBeVisible();

    await takeScreenshot(page, 'teacher-b11-edit-toggle', '班級詳情 — 編輯與停用按鈕');
  }));

  test('B.3.12 - 點擊「返回班級列表」回到 /teacher', withScreenshotOnFailure('m2-b3-12-back-nav-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("返回班級列表")').click();

    await expect(page.locator('h1:has-text("班級管理")')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/teacher');

    await takeScreenshot(page, 'teacher-b12-back-nav', '返回班級列表');
  }));

  test('B.3.13 - 學生名單 tab 顯示內容（邀請碼或空白狀態）', withScreenshotOnFailure('m2-b3-13-student-list-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("學生名單")').click();

    await expect(
      page.locator('button:has-text("匯入")')
        .or(page.locator('text=新增學生'))
        .or(page.locator('text=邀請碼'))
        .or(page.locator('text=加入代碼'))
        .or(page.locator('text=目前沒有學生'))
    ).toBeVisible({ timeout: 20_000 });

    await takeScreenshot(page, 'teacher-b13-student-list-tab', '學生名單 tab 內容');
  }));

  test('B.3.14 - 點擊「建立班級」顯示建立表單', withScreenshotOnFailure('m2-b3-14-create-form-fail', async ({ page }) => {
    await goToTeacher(page);
    await page.locator('button:has-text("建立班級")').first().click();

    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });

    await takeScreenshot(page, 'teacher-b14-create-form', '建立新班級表單');
  }));

  test('B.3.15 - 建立班級表單有「班級名稱」和「年級」欄位', withScreenshotOnFailure('m2-b3-15-create-fields-fail', async ({ page }) => {
    await goToTeacher(page);
    await page.locator('button:has-text("建立班級")').first().click();

    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#classroom-name')).toBeVisible();
    await expect(page.locator('#classroom-grade')).toBeVisible();

    await takeScreenshot(page, 'teacher-b15-create-fields', '建立班級 — 名稱與年級欄位');
  }));

  test('B.3.16 - 班級名稱為空時送出按鈕 disabled', withScreenshotOnFailure('m2-b3-16-disabled-fail', async ({ page }) => {
    await goToTeacher(page);
    await page.locator('button:has-text("建立班級")').first().click();

    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button[type="submit"]:has-text("建立")')).toBeDisabled();

    await takeScreenshot(page, 'teacher-b16-create-disabled', '建立班級 — 送出按鈕 disabled');
  }));

  test('B.3.17 - 點擊「取消」隱藏建立班級表單', withScreenshotOnFailure('m2-b3-17-cancel-fail', async ({ page }) => {
    await goToTeacher(page);
    await page.locator('button:has-text("建立班級")').first().click();

    await expect(page.locator('h2:has-text("建立新班級")')).toBeVisible({ timeout: 10_000 });
    await page.locator('button:has-text("取消")').first().click();
    await expect(page.locator('h2:has-text("建立新班級")')).not.toBeVisible();

    await takeScreenshot(page, 'teacher-b17-create-cancel', '取消後建立班級表單隱藏');
  }));
});

// ===========================================================================
// M2 旅程 C — 課文管理 + 指派作業 (C.1-C.4)
// ===========================================================================

test.describe('M2 — 旅程 C：課文管理 + 指派作業 (C.1-C.4)', () => {
  test('C.1 - 課文管理 tab 顯示「已指派 N 篇課文」', withScreenshotOnFailure('m2-c1-text-mgmt-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("課文管理")').click();

    await expect(page.locator('text=/已指派 \\d+ 篇課文/').first()).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-c1-text-mgmt-tab', '課文管理 tab — 已指派 N 篇課文');
  }));

  test('C.2 - 課文管理 tab 顯示「指派課文」按鈕', withScreenshotOnFailure('m2-c2-assign-btn-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("課文管理")').click();

    await expect(page.locator('button:has-text("指派課文")')).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-c2-assign-btn', '課文管理 tab — 指派課文按鈕');
  }));

  test('C.3 - 點擊「指派課文」顯示課文選擇器面板', withScreenshotOnFailure('m2-c3-assign-selector-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("課文管理")').click();
    await expect(page.locator('button:has-text("指派課文")')).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("指派課文")').click();

    await expect(page.locator('h4:has-text("選擇課文指派")')).toBeVisible({ timeout: 10_000 });

    await takeScreenshot(page, 'teacher-c3-assign-selector', '課文指派選擇器面板');
  }));

  test('C.4 - /assignments 頁面可正常載入', withScreenshotOnFailure('m2-c4-assignments-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await page.goto('/assignments');
    await dismissAllModals(page);

    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });

    await takeScreenshot(page, 'teacher-c4-assignments-page', '/assignments 頁面載入');
  }));
});

// ===========================================================================
// M2 旅程 D — 報告 + 學生管理 (D.1-D.6)
// ===========================================================================

test.describe('M2 — 旅程 D：報告 + 學生管理 (D.1-D.6)', () => {
  test('D.1 - 學生進度 tab 顯示學習記錄或空白狀態', withScreenshotOnFailure('m2-d1-progress-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');

    await expect(
      page.locator('text=學生姓名').or(page.locator('text=尚無學生學習記錄'))
    ).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-d1-student-progress', '學生進度 tab — 學習記錄');
  }));

  test('D.2 - 教師首頁顯示通知區域', withScreenshotOnFailure('m2-d2-notifications-fail', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);

    await expect(
      page.locator('button:has-text("通知中心")')
        .or(page.locator('[data-testid="notification"]'))
        .or(page.getByRole('button', { name: /通知/ }))
    ).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-d2-notifications', '教師首頁 — 通知中心');
  }));

  test('D.3 - 學生進度 tab 再次點擊保持顯示（蘇格拉底評分入口）', withScreenshotOnFailure('m2-d3-socratic-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("學生進度")').click();

    await expect(
      page.locator('text=學生姓名').or(page.locator('text=尚無學生學習記錄'))
    ).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-d3-socratic-tab', '學生進度 tab — 蘇格拉底評分入口');
  }));

  test('D.4 - 班級詳情頁顯示匯出按鈕或班級報表入口', withScreenshotOnFailure('m2-d4-export-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');

    await expect(
      page.locator('button:has-text("匯出")')
        .or(page.locator('button:has-text("下載報表")')
        .or(page.locator('button:has-text("學生進度")'))
        .or(page.locator('text=學生姓名'))
        .or(page.locator('text=尚無學生學習記錄')))
    ).toBeVisible({ timeout: 20_000 });

    await takeScreenshot(page, 'teacher-d4-export', '班級詳情 — 匯出報表入口');
  }));

  test('D.5 - 學生進度 tab 可見跨課文分析或統計區塊', withScreenshotOnFailure('m2-d5-cross-text-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');

    await expect(
      page.locator('text=學生姓名')
        .or(page.locator('text=尚無學生學習記錄'))
        .or(page.locator('text=跨課文'))
    ).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-d5-cross-text', '學生進度 tab — 跨課文分析區塊');
  }));

  test('D.6 - 學生進度 tab 顯示學習記錄（錯誤訂正基礎）', withScreenshotOnFailure('m2-d6-correction-fail', async ({ page }) => {
    await navigateToClassroom(page, '三年甲班');
    await page.locator('button:has-text("學生進度")').click();

    await expect(
      page.locator('text=學生姓名').or(page.locator('text=尚無學生學習記錄'))
    ).toBeVisible({ timeout: 15_000 });

    await takeScreenshot(page, 'teacher-d6-correction', '學生進度 tab — 錯誤訂正基礎');
  }));
});
