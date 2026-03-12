const { chromium } = require('playwright');
const path = require('path');

const EVIDENCE_DIR = '/Users/young/project/chinese-literacy-platform/.claude/evidence/issue-368';
const FRONTEND_URL = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

async function screenshot(page, name) {
  const filePath = path.join(EVIDENCE_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot: ${name}.png`);
  return filePath;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    // --- LOGIN ---
    console.log('\n[1] Login');
    await page.goto(`${FRONTEND_URL}/login`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.fill('input[placeholder*="email" i], input[type="email"]', 'teacher@test.com');
    await page.fill('input[type="password"]', 'test1234');
    await page.click('button[type="submit"], button:has-text("登入")');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    console.log(`Logged in. URL: ${page.url()}`);

    // --- GO TO 班級管理 ---
    console.log('\n[2] Navigate to 班級管理');
    await page.click('a:has-text("班級管理"), button:has-text("班級管理")');
    await page.waitForTimeout(2000);
    await screenshot(page, 'v2-01-classroom-list');
    console.log(`URL: ${page.url()}`);

    // Log all visible text to understand page structure
    const allLinks = await page.locator('a, button').allTextContents();
    console.log('All buttons/links:', allLinks.filter(t => t.trim()));

    // --- CLICK CLASSROOM CARD (三年甲班 or 五年乙班) ---
    console.log('\n[3] Click classroom card');
    // Classroom cards are divs that contain the class name - click on "三年甲班"
    const classroomCard = page.locator('text=三年甲班').first();
    if (await classroomCard.isVisible()) {
      await classroomCard.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('三年甲班 not found, trying first classroom card...');
      await page.locator('.cursor-pointer, [role="button"]').first().click();
      await page.waitForTimeout(3000);
    }
    await screenshot(page, 'v2-02-classroom-detail');
    console.log(`URL: ${page.url()}`);

    // Log all tabs/nav items
    const tabs = await page.locator('[role="tab"], button').allTextContents();
    console.log('Tabs/buttons on page:', tabs.filter(t => t.trim()));

    // Check page text
    const bodyText = await page.textContent('body');
    console.log('Has 我的課文:', bodyText.includes('我的課文'));
    console.log('Has 課文庫:', bodyText.includes('課文庫'));
    console.log('Has 課文:', bodyText.includes('課文'));

    // --- LOOK FOR 我的課文 TAB ---
    console.log('\n[4] Looking for 我的課文 tab');
    const myTextTab = page.locator('[role="tab"]:has-text("我的課文"), button:has-text("我的課文")').first();
    if (await myTextTab.isVisible().catch(() => false)) {
      console.log('Found 我的課文 tab!');
      await myTextTab.click();
      await page.waitForTimeout(2000);
      await screenshot(page, 'v2-03-my-texts-tab');
    } else {
      console.log('我的課文 tab NOT FOUND on this page');
      // Print all text content to understand what tabs exist
      const pageContent = await page.textContent('body');
      const lines = pageContent.split('\n').map(l => l.trim()).filter(l => l);
      console.log('Page lines (first 30):', lines.slice(0, 30));
      await screenshot(page, 'v2-03-no-my-texts-tab');

      // Try navigating directly to teacher text library if it exists
      console.log('\nTrying direct navigation to text library...');
      const possibleRoutes = [
        '/teacher/texts',
        '/teacher/text-library',
        '/teacher/my-texts',
        '/teacher/classroom/texts',
      ];
      for (const route of possibleRoutes) {
        await page.goto(`${FRONTEND_URL}${route}`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);
        const url = page.url();
        const text = await page.textContent('body');
        if (!text.includes('找不到') && !text.includes('404') && url.includes(route)) {
          console.log(`Route ${route} exists!`);
          await screenshot(page, `v2-direct-${route.replace(/\//g, '-')}`);
          break;
        }
        console.log(`Route ${route}: not found or redirected to ${url}`);
      }
    }

    // Current page state
    await screenshot(page, 'v2-04-current-state');
    console.log(`\nFinal URL: ${page.url()}`);

    // --- Look for 課文庫 tab anywhere ---
    console.log('\n[5] Checking all tabs on classroom detail page');
    // Go back to classroom if redirected
    await page.goto(`${FRONTEND_URL}/teacher`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Click 三年甲班
    const card = page.locator('text=三年甲班').first();
    if (await card.isVisible()) {
      await card.click();
      await page.waitForTimeout(3000);
    }
    await screenshot(page, 'v2-05-classroom-detail-2');

    // Get ALL tab text
    const allTabTexts = await page.locator('[role="tab"]').allTextContents();
    console.log('All [role="tab"] items:', allTabTexts);

    const allButtonTexts = await page.locator('button').allTextContents();
    console.log('All buttons:', allButtonTexts.filter(t => t.trim()));

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Console errors: ${consoleErrors.length}`);
    consoleErrors.forEach(e => console.log('  ERR:', e));

  } catch (err) {
    console.error('FATAL ERROR:', err.message);
    await screenshot(page, 'v2-error').catch(() => {});
  } finally {
    await browser.close();
  }
}

main();
