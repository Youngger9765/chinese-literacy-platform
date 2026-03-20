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

  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', res => {
    if (res.status() >= 400 && res.url().includes('lingoleap-backend')) {
      networkErrors.push(`${res.status()} ${res.url()}`);
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
    console.log('[2] Go to 班級管理 and click 三年甲班');
    await page.click('a:has-text("班級管理"), button:has-text("班級管理")');
    await page.waitForTimeout(2000);
    await page.locator('text=三年甲班').first().click();
    await page.waitForTimeout(2000);

    // Click 我的課文 tab
    console.log('[3] Click 我的課文 tab');
    await page.locator('button:has-text("我的課文")').first().click();
    await page.waitForTimeout(2000);
    await screenshot(page, 'v3-01-my-texts-empty');

    // Click 新增課文 button
    console.log('[4] Click 新增課文');
    const addBtn = page.locator('button:has-text("新增課文")').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
    } else {
      // Try the link "建立第一篇課文"
      await page.locator('a:has-text("建立第一篇課文"), button:has-text("建立第一篇課文")').first().click();
    }
    await page.waitForTimeout(2000);
    await screenshot(page, 'v3-02-create-dialog');

    // Log what's visible now
    const bodyText = await page.textContent('body');
    console.log('Dialog opened - body contains:');
    const relevantLines = bodyText.split('\n').map(l => l.trim()).filter(l => l).slice(0, 50);
    console.log(relevantLines);

    // Fill in the form
    console.log('[5] Fill in the form');

    // Title
    const titleInput = page.locator('input[placeholder*="標題"], input[name="title"], input[placeholder*="title" i], label:has-text("標題") + input, label:has-text("標題") ~ input').first();
    if (await titleInput.isVisible().catch(() => false)) {
      await titleInput.fill('Playwright測試課文');
      console.log('Title filled');
    } else {
      // Try broader search
      const inputs = await page.locator('input[type="text"], input:not([type])').all();
      console.log(`Found ${inputs.length} text inputs`);
      if (inputs.length > 0) {
        await inputs[0].fill('Playwright測試課文');
        console.log('Filled first text input as title');
      }
    }

    await screenshot(page, 'v3-03-title-filled');

    // Grade selector
    const gradeSelect = page.locator('select[name="grade"], select').first();
    if (await gradeSelect.isVisible().catch(() => false)) {
      await gradeSelect.selectOption('5').catch(async () => {
        // Try to find grade by label
        const gradeOptions = await gradeSelect.locator('option').allTextContents();
        console.log('Grade options:', gradeOptions);
        const grade5Option = gradeOptions.find(o => o.includes('5') || o.includes('五'));
        if (grade5Option) await gradeSelect.selectOption({ label: grade5Option });
      });
      console.log('Grade selected');
    }

    // Genre/体裁 selector
    const genreSelects = await page.locator('select').all();
    console.log(`Found ${genreSelects.length} selects`);
    for (let i = 0; i < genreSelects.length; i++) {
      const opts = await genreSelects[i].locator('option').allTextContents();
      console.log(`Select[${i}] options:`, opts);
    }

    if (genreSelects.length >= 2) {
      const genreOpts = await genreSelects[1].locator('option').allTextContents();
      const narrativeOpt = genreOpts.find(o => o.includes('記敘') || o.includes('narrative'));
      if (narrativeOpt) {
        await genreSelects[1].selectOption({ label: narrativeOpt });
        console.log('Genre selected:', narrativeOpt);
      }
    }

    // Add paragraph text
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('這是由Playwright自動化測試建立的課文段落。本段落包含測試內容，用於驗證課文庫功能是否正常運作。');
      console.log('Paragraph text filled');
    } else {
      console.log('No textarea found for paragraph');
    }

    await screenshot(page, 'v3-04-form-filled');

    // Submit
    console.log('[6] Submit form');
    const submitBtn = page.locator('button[type="submit"], button:has-text("建立"), button:has-text("新增"), button:has-text("儲存"), button:has-text("確認")').last();
    const submitBtns = await page.locator('button[type="submit"], button:has-text("建立"), button:has-text("確認"), button:has-text("儲存")').all();
    console.log(`Found ${submitBtns.length} possible submit buttons`);
    for (const btn of submitBtns) {
      const text = await btn.textContent().catch(() => '');
      const visible = await btn.isVisible().catch(() => false);
      console.log(`  btn: "${text.trim()}" visible:${visible}`);
    }

    // Click the most likely submit button (not cancel)
    const confirmBtn = page.locator('button:has-text("建立課文"), button:has-text("新增課文"), button:has-text("儲存"), button:has-text("確認新增")').first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
    } else {
      // Click last submit button
      const allSubmitBtns = await page.locator('button[type="submit"]').all();
      if (allSubmitBtns.length > 0) {
        await allSubmitBtns[allSubmitBtns.length - 1].click();
      }
    }

    await page.waitForTimeout(3000);
    await screenshot(page, 'v3-05-after-submit');

    // Check result
    const finalText = await page.textContent('body');
    console.log('\n[7] RESULT');
    console.log('Created text visible:', finalText.includes('Playwright測試課文'));
    console.log('Has error:', finalText.includes('錯誤') || finalText.includes('失敗'));

    await screenshot(page, 'v3-06-final');

    console.log('\n=== SUMMARY ===');
    console.log('Console errors:', consoleErrors.length);
    consoleErrors.forEach(e => console.log(' ', e));
    console.log('Network errors:', networkErrors.length);
    networkErrors.forEach(e => console.log(' ', e));

  } catch (err) {
    console.error('FATAL:', err.message);
    await screenshot(page, 'v3-error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
