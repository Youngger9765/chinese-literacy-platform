const { chromium } = require('playwright');
const path = require('path');

const EVIDENCE_DIR = '/Users/young/project/chinese-literacy-platform/.claude/evidence/issue-368';
const FRONTEND_URL = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

async function screenshot(page, name) {
  const filePath = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot saved: ${name}.png`);
  return filePath;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // Step 1: Navigate to login
    console.log('\n--- Step 1: Navigate to login ---');
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await screenshot(page, '01-login-page');
    console.log('Login page loaded');

    // Step 2: Login as teacher
    console.log('\n--- Step 2: Login as teacher ---');
    await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="Email" i]', 'teacher@test.com');
    await page.fill('input[type="password"], input[name="password"]', 'test1234');
    await screenshot(page, '02-login-filled');

    await page.click('button[type="submit"], button:has-text("登入"), button:has-text("Login")');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await screenshot(page, '03-after-login');
    console.log(`After login URL: ${page.url()}`);

    // Step 3: Navigate to teacher dashboard
    console.log('\n--- Step 3: Teacher dashboard ---');
    const currentUrl = page.url();
    if (!currentUrl.includes('dashboard') && !currentUrl.includes('teacher')) {
      // Try navigating to dashboard
      await page.goto(`${FRONTEND_URL}/teacher/dashboard`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    await screenshot(page, '04-teacher-dashboard');
    console.log(`Dashboard URL: ${page.url()}`);

    // Step 4: Find and click on a classroom
    console.log('\n--- Step 4: Find classroom ---');
    // Look for classroom cards or links
    const classroomSelectors = [
      'a[href*="classroom"]',
      'button:has-text("班級")',
      '.classroom-card',
      '[data-testid="classroom"]',
      'div:has-text("班級") button',
    ];

    let classroomClicked = false;
    for (const sel of classroomSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(2000);
        classroomClicked = true;
        console.log(`Clicked classroom with selector: ${sel}`);
        break;
      }
    }

    if (!classroomClicked) {
      console.log('No classroom found with standard selectors, checking page content...');
      const pageText = await page.textContent('body');
      console.log('Page text (first 500 chars):', pageText.substring(0, 500));
    }

    await screenshot(page, '05-classroom-or-dashboard');
    console.log(`URL after classroom click: ${page.url()}`);

    // Step 5: Look for "我的課文" tab
    console.log('\n--- Step 5: Find 我的課文 tab ---');
    await page.waitForTimeout(1000);

    const myTextTabSelectors = [
      'button:has-text("我的課文")',
      'a:has-text("我的課文")',
      '[role="tab"]:has-text("我的課文")',
      'span:has-text("我的課文")',
    ];

    let tabClicked = false;
    for (const sel of myTextTabSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(2000);
        tabClicked = true;
        console.log(`Clicked tab with selector: ${sel}`);
        break;
      }
    }

    if (!tabClicked) {
      console.log('我的課文 tab not found, looking for text library navigation...');
      // Check if there's a text library link in the nav
      const textLibrarySelectors = [
        'a[href*="text-library"]',
        'a[href*="texts"]',
        'button:has-text("課文")',
        'a:has-text("課文庫")',
        'nav a',
      ];

      for (const sel of textLibrarySelectors) {
        const elements = page.locator(sel);
        const count = await elements.count();
        if (count > 0) {
          console.log(`Found ${count} elements with selector: ${sel}`);
          for (let i = 0; i < Math.min(count, 3); i++) {
            const text = await elements.nth(i).textContent().catch(() => '');
            console.log(`  - "${text}"`);
          }
        }
      }
    }

    await screenshot(page, '06-my-texts-tab');
    console.log(`URL after tab click: ${page.url()}`);

    // Check page content for any errors or relevant elements
    const bodyText = await page.textContent('body');
    console.log('\nPage contains "我的課文":', bodyText.includes('我的課文'));
    console.log('Page contains "課文庫":', bodyText.includes('課文庫'));
    console.log('Page contains "新增":', bodyText.includes('新增'));
    console.log('Page contains "建立":', bodyText.includes('建立'));

    // Step 6: Test creating a new text
    console.log('\n--- Step 6: Create new text ---');
    const createButtonSelectors = [
      'button:has-text("新增課文")',
      'button:has-text("建立課文")',
      'button:has-text("新增")',
      'button:has-text("建立")',
      'button:has-text("Create")',
      '[data-testid="create-text"]',
      'button svg + span:has-text("課文")',
    ];

    let createClicked = false;
    for (const sel of createButtonSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        await page.waitForTimeout(2000);
        createClicked = true;
        console.log(`Clicked create button with selector: ${sel}`);
        break;
      }
    }

    if (!createClicked) {
      console.log('Create button not found');
    }

    await screenshot(page, '07-create-text-dialog');

    // Fill in the form if dialog appeared
    const titleInput = page.locator('input[placeholder*="標題"], input[name="title"], input[placeholder*="title" i]').first();
    if (await titleInput.isVisible().catch(() => false)) {
      console.log('Form dialog appeared, filling in details...');
      await titleInput.fill('Playwright測試課文');

      // Find grade selector
      const gradeSelectors = [
        'select[name="grade"]',
        'input[name="grade"]',
        '[placeholder*="年級"]',
      ];
      for (const sel of gradeSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          const tagName = await el.evaluate(e => e.tagName.toLowerCase());
          if (tagName === 'select') {
            await el.selectOption('5');
          } else {
            await el.fill('5');
          }
          break;
        }
      }

      // Find genre selector
      const genreSelectors = [
        'select[name="genre"]',
        'input[name="genre"]',
        '[placeholder*="文體"]',
        '[placeholder*="genre" i]',
      ];
      for (const sel of genreSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          const tagName = await el.evaluate(e => e.tagName.toLowerCase());
          if (tagName === 'select') {
            await el.selectOption({ label: '記敘文' }).catch(() => el.selectOption('narrative'));
          } else {
            await el.fill('記敘文');
          }
          break;
        }
      }

      // Add paragraph text
      const textAreaSelectors = [
        'textarea[name="content"]',
        'textarea[placeholder*="段落"]',
        'textarea',
      ];
      for (const sel of textAreaSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          await el.fill('這是由Playwright自動化測試建立的課文段落。本段落包含測試內容，用於驗證課文庫功能是否正常運作。');
          break;
        }
      }

      await screenshot(page, '08-form-filled');

      // Submit
      const submitSelectors = [
        'button[type="submit"]:has-text("建立")',
        'button[type="submit"]:has-text("新增")',
        'button[type="submit"]:has-text("確認")',
        'button[type="submit"]',
        'button:has-text("建立課文")',
        'button:has-text("確認新增")',
      ];

      for (const sel of submitSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          await el.click();
          await page.waitForTimeout(3000);
          console.log(`Clicked submit with selector: ${sel}`);
          break;
        }
      }

      await screenshot(page, '09-after-submit');
    } else {
      console.log('Create form/dialog did not appear');
      await screenshot(page, '08-no-form');
    }

    // Step 7: Verify created text appears
    console.log('\n--- Step 7: Verify created text ---');
    await page.waitForTimeout(2000);
    const finalBodyText = await page.textContent('body');
    const textFound = finalBodyText.includes('Playwright測試課文');
    console.log('Created text found in page:', textFound);
    await screenshot(page, '10-final-state');

    // Summary
    console.log('\n=== TEST SUMMARY ===');
    console.log(`Final URL: ${page.url()}`);
    console.log(`Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.log('Errors:');
      consoleErrors.forEach(e => console.log(`  - ${e}`));
    }
    console.log(`Created text visible: ${textFound}`);

  } catch (error) {
    console.error('Test error:', error.message);
    await screenshot(page, 'error-state').catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
