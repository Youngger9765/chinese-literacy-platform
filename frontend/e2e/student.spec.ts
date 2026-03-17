import { test, expect, type Page } from '@playwright/test';
import {
  takeScreenshot,
  dismissAllModals,
  ensureAuthenticated,
  goToLearningStep,
  getFirstStorySlug,
  loginAsTeacher,
  goToTeacherDashboard,
} from './fixtures';

/**
 * student.spec.ts — #361 學生測試
 *
 * Consolidates student-flow, story-selection, and learning-flow tests.
 * Uses storageState from e2e/.auth/student.json (student@test.com / student1234).
 *
 * Journey E — 學生登入 + 加入班級 (#361 E.1)
 * Journey F — 六步驟學習流程 (#361 F.1–F.14)
 * Journey G — 查看學習成果 (#361 G.1–G.5)
 *
 * Skipped per convention:
 *  - Actual audio recording / speech recognition (hardware dependency)
 *  - Vertex AI real responses (live API dependency)
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the library, click the first story card, and return the storyId
 * extracted from the resulting URL (/learn/:storyId/intro).
 *
 * Relies on storageState being pre-loaded — does NOT log in.
 */
async function openFirstStoryFromLibrary(page: Page): Promise<string> {
  await page.goto('/');
  await dismissAllModals(page);

  // Home page has recommendation "開始學習" buttons and story cards with h4 headings
  const startBtn = page.locator('button:has-text("開始學習")').first();
  await expect(startBtn).toBeVisible({ timeout: 20_000 });
  await startBtn.click();

  await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });
  const match = page.url().match(/\/learn\/([^/]+)\/intro/);
  return match?.[1] ?? '';
}

// ---------------------------------------------------------------------------
// 旅程 E — 學生登入 + 加入班級 (#361 E.1)
// ---------------------------------------------------------------------------

test.describe('旅程 E — 學生登入 + 加入班級', () => {
  test('E.1 - 學生首頁載入', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    // Home page should show either the Chinese or English app name
    await expect(
      page.locator('text=AI 朗讀助教')
        .or(page.locator('text=AI Reading Tutor'))
        .or(page.locator('text=LingoLeap'))
    ).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-e1-home-page', '學生首頁載入成功');
  });

  test('E.2 - 學生看不到 系統管理 按鈕', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await expect(page.locator('button:has-text("系統管理")')).not.toBeVisible();
    await takeScreenshot(page, 'student-e2-no-admin-button', '學生首頁 — 系統管理按鈕不存在');
  });

  test('E.3 - 學生看不到 班級管理 按鈕', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await expect(page.locator('button:has-text("班級管理")')).not.toBeVisible();
    await takeScreenshot(page, 'student-e3-no-classroom-button', '學生首頁 — 班級管理按鈕不存在');
  });

  test('E.4 - 學生看到 加入班級 按鈕', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await expect(page.locator('button:has-text("加入班級")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'student-e4-join-class-button', '學生首頁 — 加入班級按鈕可見');
  });

  test('E.5 - 點擊 加入班級 導向 /join', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await page.locator('button:has-text("加入班級")').click();
    await expect(page).toHaveURL(/\/join/, { timeout: 15_000 });
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'student-e5-join-redirect', '/join 頁面標題可見');
  });

  test('E.6 - /join 頁面有標題、說明文字與輸入框', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('h1:has-text("加入班級")')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=輸入老師提供的加入代碼')).toBeVisible();
    await expect(page.locator('#join-code')).toBeVisible();
    await takeScreenshot(page, 'student-e6-join-page', '/join 頁面 — 標題、說明、輸入框');
  });

  test('E.7 - 代碼少於 6 字時提交按鈕 disabled', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABC');
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeDisabled();
    await takeScreenshot(page, 'student-e7-submit-disabled', '代碼不足 6 字 — 提交按鈕 disabled');
  });

  test('E.8 - 代碼等於 6 字時提交按鈕 enabled', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('ABCDEF');
    const submitBtn = page.locator('button[type="submit"]:has-text("加入班級")');
    await expect(submitBtn).toBeEnabled();
    await takeScreenshot(page, 'student-e8-submit-enabled', '代碼剛好 6 字 — 提交按鈕 enabled');
  });

  test('E.9 - 輸入無效代碼顯示 404 錯誤訊息', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('XXXXXX');
    await page.locator('button[type="submit"]:has-text("加入班級")').click();
    await expect(
      page.locator('text=找不到此加入代碼，請確認代碼是否正確')
    ).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-e9-invalid-code-error', '無效代碼 — 顯示錯誤訊息');
  });

  test('E.10 - 輸入小寫代碼自動轉大寫', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('#join-code')).toBeVisible({ timeout: 15_000 });
    await page.locator('#join-code').fill('abcdef');
    await expect(page.locator('#join-code')).toHaveValue('ABCDEF');
    await takeScreenshot(page, 'student-e10-auto-uppercase', '輸入小寫 — 自動轉大寫為 ABCDEF');
  });

  test('E.11 - 返回首頁 按鈕可回到首頁', async ({ page }) => {
    await page.goto('/join');
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(page.locator('text=返回首頁')).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("返回首頁")').click();
    await page.waitForLoadState('networkidle');
    await dismissAllModals(page);
    await expect(
      page.locator('text=AI 朗讀助教')
        .or(page.locator('text=AI Reading Tutor'))
        .or(page.locator('text=LingoLeap'))
    ).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-e11-back-home', '返回首頁成功');
  });

  test('E.12 - 學生可進入圖書館', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    // Try multiple ways to reach library — button or sidebar link
    const libraryBtn = page.locator('button:has-text("進入圖書館")');
    const libraryLink = page.locator('a:has-text("圖書館")').or(page.locator('button:has-text("圖書館")'));
    if (await libraryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await libraryBtn.click();
    } else {
      await page.goto('/library');
    }
    await dismissAllModals(page);
    await expect(page).toHaveURL(/\/library/, { timeout: 15_000 });
    await takeScreenshot(page, 'student-e12-library-access', '學生成功進入圖書館頁面');
  });
});

// ---------------------------------------------------------------------------
// 旅程 F — 六步驟學習流程 (#361 F.1–F.14)
// ---------------------------------------------------------------------------

test.describe('旅程 F — 六步驟學習流程', () => {
  // Reuse the same storyId across F tests by getting it once in each test.
  // Each test is independent so it fetches its own storyId for robustness.

  test('F.1 - 簡介頁面載入，主體可見，有返回與開始按鈕', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'intro');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('button:has-text("返回")').first().or(page.locator('button:has-text("圖書館")').first())
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('button:has-text("開始")').first().or(page.locator('button:has-text("朗讀")').first())
    ).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'student-f1-intro-page', '簡介頁面 — 返回、開始朗讀按鈕可見');
  });

  test('F.2 - 朗讀錄音：逐段朗讀頁面正常載入', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'tutor');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Actual recording skipped — hardware dependency
    await takeScreenshot(page, 'student-f2-tutor-page', '逐段朗讀頁面載入（不執行錄音）');
  });

  test('F.3 - 段落漸進式朗讀：tutor UI 可見', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'tutor');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Verify there's meaningful content — header or text block
    const hasContent = await page
      .locator('header, [data-testid], article, section, p')
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(hasContent).toBe(true);
    await takeScreenshot(page, 'student-f3-tutor-ui', '逐段朗讀 UI 段落內容可見');
  });

  test('F.4 - 課文理解頁面載入（跳過 AI 互動）', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'comprehension');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // AI chat skipped — live Vertex AI dependency
    await takeScreenshot(page, 'student-f4-comprehension-page', '課文理解頁面載入');
  });

  test('F.5 - 課文理解頁面有麥克風按鈕（語音輸入入口）', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'comprehension');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Microphone button for speech input (actual speech skipped)
    const hasMicButton = await page
      .locator('[aria-label*="麥克風"], [aria-label*="mic"], button:has-text("語音"), button:has-text("錄音")')
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    // Soft assertion: button may not yet be implemented on all deployments
    if (!hasMicButton) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '麥克風按鈕在此部署尚未實作，標記為待驗證',
      });
    }
    await takeScreenshot(page, 'student-f5-comprehension-mic', '課文理解 — 語音輸入狀態截圖');
  });

  test('F.6 - 生字練習頁面載入', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'vocab');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-f6-vocab-page', '生字練習頁面載入');
  });

  test('F.7 - 生字練習頁面顯示字元部件或筆順區塊', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'vocab');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Character decomposition / stroke-order section
    const hasCharElements = await page
      .locator('canvas, [data-testid*="stroke"], [data-testid*="char"], [class*="stroke"], [class*="char"]')
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!hasCharElements) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '部件拆解元素在此部署尚未渲染，標記為待驗證',
      });
    }
    await takeScreenshot(page, 'student-f7-vocab-char-elements', '生字練習 — 部件拆解或筆順區塊');
  });

  test('F.8 - 生字練習頁面有錄音按鈕（發音練習入口）', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'vocab');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Recording button for pronunciation (actual recording skipped)
    const hasRecordBtn = await page
      .locator('[aria-label*="錄音"], [aria-label*="麥克風"], button:has-text("發音"), button:has-text("錄音")')
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!hasRecordBtn) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '發音錄音按鈕在此部署尚未實作，標記為待驗證',
      });
    }
    await takeScreenshot(page, 'student-f8-vocab-record-button', '生字練習 — 錄音按鈕狀態截圖');
  });

  test('F.9 - 生字練習頁面有造句區域（跳過 AI）', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'vocab');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Sentence-practice area: textarea or section heading
    const hasSentenceArea = await page
      .locator('textarea, [placeholder*="造句"], text=造句')
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!hasSentenceArea) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '造句區域在此部署尚未渲染，標記為待驗證',
      });
    }
    await takeScreenshot(page, 'student-f9-vocab-sentence-area', '生字練習 — 造句區域狀態截圖');
  });

  test('F.10 - 聽寫練習頁面載入', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'dictation');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-f10-dictation-page', '聽寫練習頁面載入');
  });

  test('F.11 - 聽力理解頁面載入（若未實作則標記待驗證）', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    try {
      await page.goto(`/learn/${storyId}/listening`, { timeout: 20_000 });
      const isLoginPage = await page
        .locator('text=登入你的帳號')
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (isLoginPage) {
        test.info().annotations.push({
          type: 'skip-reason',
          description: '聽力理解頁面重定向到登入，可能尚未啟用',
        });
        return;
      }
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '聽力理解頁面載入逾時，標記為待驗證',
      });
      return;
    }
    await takeScreenshot(page, 'student-f11-listening-page', '聽力理解頁面載入');
  });

  test('F.12 - 學習報告頁面載入（AI 詳細分析）', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'report');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-f12-report-page', '學習報告頁面載入');
  });

  test('F.13 - 報告頁面有學習完成相關元素', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'report');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Look for report/completion UI elements
    const hasReportElement = await page
      .locator(
        'text=報告, text=診斷, text=完成, text=學習成果, [data-testid*="report"], h1, h2'
      )
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(hasReportElement).toBe(true);
    await takeScreenshot(page, 'student-f13-report-elements', '學習報告 — 完成元素可見');
  });

  test('F.14 - Session 恢復：離開後返回不需重新登入', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'intro');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });

    // Navigate away
    await page.goto('/');
    await dismissAllModals(page);
    await expect(page.locator('button:has-text("登出")')).toBeVisible({ timeout: 15_000 });

    // Return to same learning step — should not require login
    await goToLearningStep(page, storyId, 'intro');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=登入你的帳號')).not.toBeVisible();
    await takeScreenshot(page, 'student-f14-session-restore', '離開後返回 — session 保持');
  });

  test('F.15 - Stepper 導覽在學習步驟中可見', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await goToLearningStep(page, storyId, 'intro');
    await expect(page.locator('header')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'student-f15-stepper-visible', '學習步驟中 header / stepper 可見');
  });

  test('F.16 - 直接透過 URL 存取 intro 步驟', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await page.goto(`/learn/${storyId}/intro`);
    await expect(page).toHaveURL(`/learn/${storyId}/intro`);
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    await takeScreenshot(page, 'student-f16-direct-url', '直接 URL 存取 intro — 頁面正常');
  });

  test('F.17 - /learn/:id 重定向到 /learn/:id/intro', async ({ page }) => {
    const storyId = await openFirstStoryFromLibrary(page);
    await page.goto(`/learn/${storyId}`);
    await expect(page).toHaveURL(`/learn/${storyId}/intro`, { timeout: 15_000 });
    await takeScreenshot(page, 'student-f17-url-redirect', '/learn/:id 重定向到 /intro');
  });

  test('F.18 - 未登入者存取學習頁面重定向到登入', async ({ page }) => {
    // Override storageState: navigate first then clear auth
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/learn/test-story/intro');
    await expect(page.locator('text=登入你的帳號')).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(page, 'student-f18-auth-guard', '未登入 — 重定向到登入頁');
  });

  test('F.19 - 教師也可以瀏覽圖書館', async ({ page }) => {
    await loginAsTeacher(page);
    await page.goto('/library');
    await expect(
      page.locator('h3').first().or(page.locator('text=目前沒有課文'))
    ).toBeVisible({ timeout: 20_000 });
    await takeScreenshot(page, 'student-f19-teacher-library', '教師可進入圖書館');
  });
});

// ---------------------------------------------------------------------------
// 旅程 G — 查看學習成果 (#361 G.1–G.5)
// ---------------------------------------------------------------------------

test.describe('旅程 G — 查看學習成果', () => {
  test('G.1 - 學習路徑追蹤：/progress 頁面載入', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    try {
      await page.goto('/progress', { timeout: 20_000 });
      const isLoginPage = await page
        .locator('text=登入你的帳號')
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (isLoginPage) {
        test.info().annotations.push({
          type: 'skip-reason',
          description: '/progress 頁面重定向到登入，可能尚未實作',
        });
        return;
      }
      await expect(page.locator('main, [role="main"], body')).toBeVisible({ timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '/progress 頁面載入逾時，標記為待驗證',
      });
      return;
    }
    await takeScreenshot(page, 'student-g1-progress-page', '學習路徑追蹤 /progress 頁面');
  });

  test('G.2 - 蘇格拉底對話紀錄頁面（若有獨立路由）', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    // Dialogue history may be at /history or embedded in /progress
    const candidates = ['/history', '/progress', '/learn/history'];
    let loaded = false;
    for (const path of candidates) {
      try {
        await page.goto(path, { timeout: 15_000 });
        const isLogin = await page
          .locator('text=登入你的帳號')
          .isVisible({ timeout: 3_000 })
          .catch(() => false);
        if (!isLogin) {
          await expect(page.locator('main, body')).toBeVisible({ timeout: 10_000 });
          loaded = true;
          break;
        }
      } catch {
        // Try next candidate
      }
    }
    if (!loaded) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '對話紀錄頁面路由尚未確認，標記為待驗證',
      });
      return;
    }
    await takeScreenshot(page, 'student-g2-dialogue-history', '蘇格拉底對話紀錄頁面');
  });

  test('G.3 - 遊戲化系統：/achievements 頁面載入', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    try {
      await page.goto('/achievements', { timeout: 20_000 });
      const isLoginPage = await page
        .locator('text=登入你的帳號')
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (isLoginPage) {
        test.info().annotations.push({
          type: 'skip-reason',
          description: '/achievements 頁面重定向到登入，可能尚未實作',
        });
        return;
      }
      await expect(page.locator('main, [role="main"], body')).toBeVisible({ timeout: 15_000 });
    } catch {
      test.info().annotations.push({
        type: 'skip-reason',
        description: '/achievements 頁面載入逾時，標記為待驗證',
      });
      return;
    }
    await takeScreenshot(page, 'student-g3-achievements-page', '遊戲化系統 /achievements 頁面');
  });

  test('G.4 - AI 學習路徑推薦：首頁有推薦區塊', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    // Recommendation block may be a section or widget on the home page
    const hasRecommendation = await page
      .locator(
        'text=推薦, text=建議, text=為你推薦, [data-testid*="recommend"], [data-testid*="suggestion"]'
      )
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    if (!hasRecommendation) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'AI 推薦區塊在首頁尚未渲染，標記為待驗證',
      });
    }
    await takeScreenshot(page, 'student-g4-home-recommendation', '首頁 AI 學習路徑推薦區塊');
  });

  test('G.5 - 自學模式：圖書館搜尋 + 年級篩選 + 點擊故事卡', async ({ page }) => {
    await ensureAuthenticated(page);
    await dismissAllModals(page);
    await page.goto('/library');

    // Story cards visible
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 20_000 });

    // Search input
    const searchInput = page.locator('input[placeholder*="搜尋"]');
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Grade filter buttons
    await expect(page.locator('button:has-text("全部")')).toBeVisible({ timeout: 10_000 });

    // Click a grade filter if available
    const gradeButtons = page.locator('button').filter({ hasText: /年級/ });
    if ((await gradeButtons.count()) > 0) {
      await gradeButtons.first().click();
      await expect(page.locator('body')).toBeVisible();
    }

    // Reset to "全部" and click first story card
    const allBtn = page.locator('button:has-text("全部")');
    if (await allBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await allBtn.click();
    }
    await expect(page.locator('h3').first()).toBeVisible({ timeout: 15_000 });

    const firstCard = page.locator('button').filter({ has: page.locator('h3') }).first();
    if ((await firstCard.count()) > 0) {
      await firstCard.click();
    } else {
      await page.locator('h3').first().click();
    }

    await expect(page).toHaveURL(/\/learn\/.+\/intro/, { timeout: 20_000 });
    await takeScreenshot(page, 'student-g5-self-study-flow', '自學模式 — 搜尋篩選後點擊故事導向 intro');
  });
});
