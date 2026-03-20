const { chromium } = require('playwright');
const path = require('path');

const EVIDENCE_DIR = '/Users/young/project/chinese-literacy-platform/.claude/evidence/issue-368';
const FRONTEND_URL = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

async function screenshot(page, name) {
  const filePath = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot: ${name}.png`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const networkErrors = [];
  page.on('response', async res => {
    if (res.status() >= 400 && res.url().includes('lingoleap-backend')) {
      let body = '';
      try { body = await res.text(); } catch {}
      networkErrors.push(`${res.status()} ${res.url()} ${body.substring(0, 200)}`);
    }
  });

  try {
    // LOGIN
    console.log('[1] Login');
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[placeholder*="email" i], input[type="email"]', 'teacher@test.com');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"], button:has-text("登入")');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Navigate to classroom
    console.log('[2] Go to 班級管理 → 三年甲班');
    await page.click('a:has-text("班級管理"), button:has-text("班級管理")');
    await page.waitForTimeout(2000);
    await page.locator('text=三年甲班').first().click();
    await page.waitForTimeout(2000);

    // Click 我的課文 tab
    console.log('[3] Click 我的課文 tab');
    await page.locator('button:has-text("我的課文")').first().click();
    await page.waitForTimeout(2000);
    await screenshot(page, 'final-01-my-texts-empty');

    // Click 新增課文 button
    console.log('[4] Open 新增課文 dialog');
    await page.locator('button:has-text("新增課文")').first().click();
    await page.waitForTimeout(1500);
    await screenshot(page, 'final-02-dialog-opened');

    // Fill the TITLE inside the modal
    // The modal has a specific input for 課文標題
    console.log('[5] Fill form');
    // Look for the title input within the modal dialog
    const modal = page.locator('.fixed.inset-0, [role="dialog"], dialog').first();
    const titleInput = page.locator('input[placeholder="請輸入課文標題"]').first();
    if (await titleInput.isVisible().catch(() => false)) {
      await titleInput.click({ force: true });
      await titleInput.fill('Playwright測試課文');
      console.log('Title filled: Playwright測試課文');
    } else {
      console.log('Title input not found by placeholder, trying generic...');
      // Find the first text input in the modal area
      const inputs = await page.locator('input[type="text"], input:not([type="hidden"]):not([type="password"]):not([type="email"])').all();
      for (const inp of inputs) {
        const placeholder = await inp.getAttribute('placeholder').catch(() => '');
        const visible = await inp.isVisible().catch(() => false);
        console.log(`  input placeholder="${placeholder}" visible=${visible}`);
      }
    }

    // Grade - select 5 年級 in the modal (second select - first is the filter)
    const gradeSelects = await page.locator('select').all();
    // The modal grade select shows "4 年級" as default (no blank option)
    for (let i = 0; i < gradeSelects.length; i++) {
      const opts = await gradeSelects[i].locator('option').allTextContents();
      const val = await gradeSelects[i].inputValue().catch(() => '');
      const visible = await gradeSelects[i].isVisible().catch(() => false);
      if (visible && opts.includes('5 年級') && !opts.includes('所有年級')) {
        await gradeSelects[i].selectOption('5');
        console.log(`Grade set to 5 年級 (select[${i}])`);
        break;
      }
    }

    // Genre - select 記敘文 in the modal
    for (let i = 0; i < gradeSelects.length; i++) {
      const opts = await gradeSelects[i].locator('option').allTextContents();
      const visible = await gradeSelects[i].isVisible().catch(() => false);
      if (visible && opts.includes('記敘文') && !opts.includes('所有體裁')) {
        await gradeSelects[i].selectOption('記敘文');
        console.log(`Genre set to 記敘文 (select[${i}])`);
        break;
      }
    }

    // Paragraph text
    const textarea = page.locator('textarea[placeholder="第 1 段內容..."]').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.click({ force: true });
      await textarea.fill('這是由Playwright自動化測試建立的課文段落。本段落包含測試內容，用於驗證課文庫功能是否正常運作。');
      console.log('Paragraph filled');
    }

    await screenshot(page, 'final-03-form-filled');

    // SUBMIT - use force:true to bypass overlay interception
    console.log('[6] Submit via force click on 建立課文');
    const buildBtn = page.locator('button:has-text("建立課文")').first();
    if (await buildBtn.isVisible().catch(() => false)) {
      // Use evaluate to click directly via JS to avoid overlay intercept issue
      await buildBtn.evaluate(btn => btn.click());
      console.log('Clicked 建立課文 via JS evaluate');
    } else {
      console.log('建立課文 button not visible');
    }

    await page.waitForTimeout(4000);
    await screenshot(page, 'final-04-after-submit');

    // Check result
    const finalText = await page.textContent('body');
    const createdFound = finalText.includes('Playwright測試課文');
    console.log('\n[7] RESULT');
    console.log('Created text visible in list:', createdFound);
    console.log('Has success toast:', finalText.includes('成功') || finalText.includes('已建立'));
    console.log('Has error:', finalText.includes('錯誤') || finalText.includes('失敗'));
    console.log('Dialog still open:', await page.locator('input[placeholder="請輸入課文標題"]').isVisible().catch(() => false));

    await screenshot(page, 'final-05-final-state');

    console.log('\n=== SUMMARY ===');
    console.log('Network errors:', networkErrors.length);
    networkErrors.forEach(e => console.log(' ', e));

  } catch (err) {
    console.error('FATAL:', err.message);
    await screenshot(page, 'final-error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
