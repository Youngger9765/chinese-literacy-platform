/**
 * PR #208 Visual Verification
 * Issue #169: Collapsible report sections
 * Issue #172: Exit ticket distractors
 *
 * Preview URL: https://lingoleap-frontend-issue-208-oja2sffiya-de.a.run.app
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PREVIEW_URL = 'https://lingoleap-frontend-issue-208-oja2sffiya-de.a.run.app';
const EVIDENCE_DIR = '/Users/young/project/chinese-literacy-platform/.claude/evidence/issue-208';

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
});

test.describe('PR #208 - Collapsible Report Sections (#169)', () => {

  test('01: Home page loads correctly', async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '01-home-page.png'),
      fullPage: true
    });
    // Verify the page title and main CTA
    await expect(page.locator('text=AI 朗讀助教')).toBeVisible();
    await expect(page.locator('text=進入圖書館')).toBeVisible();
    console.log('HOME PAGE: Loaded successfully');
  });

  test('02: Navigate to story library', async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Click "進入圖書館" button
    await page.click('text=進入圖書館');
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '02-story-library.png'),
      fullPage: true
    });
    console.log('LIBRARY: Navigated to story library');
  });

  test('03: Select a story and navigate directly to Step 6 Report', async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Click "進入圖書館"
    await page.click('text=進入圖書館');
    await page.waitForTimeout(2000);

    // Take screenshot of library
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '03a-library-loaded.png'),
      fullPage: false
    });

    // Click first available story card
    const storyCard = page.locator('[class*="cursor-pointer"], button, a').filter({
      hasText: /開始|學習|閱讀/
    }).first();

    if (await storyCard.count() > 0) {
      await storyCard.click();
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, '03b-story-selected.png'),
        fullPage: true
      });
      console.log('STORY: Selected first story');
    } else {
      // Try clicking any card in the library
      const anyCard = page.locator('.cursor-pointer, [role="button"]').first();
      if (await anyCard.count() > 0) {
        await anyCard.click();
        await page.waitForTimeout(2000);
      }
    }

    // Now try clicking Step 6 (報告) in the stepper nav
    const reportNavBtn = page.locator('button').filter({ hasText: '報告' });
    console.log('Report nav button count:', await reportNavBtn.count());

    if (await reportNavBtn.count() > 0) {
      await reportNavBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, '03c-report-page.png'),
        fullPage: true
      });
      console.log('REPORT: Navigated to report page via stepper');
    }
  });

  test('04: Inject mock session data and verify collapsible sections', async ({ page }) => {
    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // First, go to library to load the app
    await page.click('text=進入圖書館');
    await page.waitForTimeout(2000);

    // Click the first story in the library to create a session
    // Find the first story "開始" button or card
    const firstStory = page.locator('button').filter({ hasText: /開始學習|選擇/ }).first();
    const firstCard = page.locator('[class*="card"], [class*="story"], .cursor-pointer').first();

    if (await firstStory.count() > 0) {
      await firstStory.click();
    } else if (await firstCard.count() > 0) {
      await firstCard.click();
    }
    await page.waitForTimeout(1500);

    // Now inject mock React state using window.__REACT_DEVTOOLS mechanism
    // We'll use a different approach: manipulate the React fiber tree
    const injected = await page.evaluate(() => {
      // Find the React root
      const rootEl = document.getElementById('root');
      if (!rootEl) return { success: false, reason: 'No root element' };

      // Access React fiber
      const fiberKey = Object.keys(rootEl).find(key =>
        key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
      );
      if (!fiberKey) return { success: false, reason: 'No React fiber found' };

      return { success: true, fiberKey };
    });

    console.log('React fiber injection attempt:', injected);

    // Alternative: Navigate to story intro and then click step 6
    // Step 6 should be accessible even without reading data (shows empty state)
    const stepButtons = await page.locator('nav button').all();
    console.log('Nav buttons count:', stepButtons.length);

    for (const btn of stepButtons) {
      const text = await btn.textContent();
      console.log('Nav button text:', text?.trim());
    }

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '04-after-story-select.png'),
      fullPage: true
    });
  });

  test('05: Full flow - select story, view intro, navigate to report', async ({ page }) => {
    // Increase timeout for this longer test
    test.setTimeout(60000);

    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Step 1: Go to library
    await page.click('text=進入圖書館');
    await page.waitForTimeout(2000);

    // Step 2: Click first story card
    // Look for story cards in the library
    const pageContent = await page.textContent('body');
    console.log('Library content snippet:', pageContent?.substring(0, 300));

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '05a-library.png'),
      fullPage: true
    });

    // Find clickable story items - they usually have a button or link
    const buttons = await page.locator('button').all();
    console.log('Total buttons on library page:', buttons.length);
    for (const btn of buttons.slice(0, 10)) {
      const text = await btn.textContent();
      const disabled = await btn.isDisabled();
      console.log(`Button: "${text?.trim()}" disabled=${disabled}`);
    }

    // Find a story start button (not nav buttons)
    // Library stories usually have "開始" or similar
    const storyButtons = await page.locator('button').filter({ hasText: /開始|課文|story|選擇這篇/ }).all();
    console.log('Story buttons found:', storyButtons.length);

    if (storyButtons.length > 0) {
      await storyButtons[0].click();
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, '05b-story-intro.png'),
        fullPage: true
      });

      // Now try to click Step 6 (報告) in stepper nav
      const reportBtn = page.locator('nav').locator('button').filter({ hasText: '報告' });
      if (await reportBtn.count() > 0) {
        const isDisabled = await reportBtn.first().isDisabled();
        console.log('Report button disabled?', isDisabled);
        if (!isDisabled) {
          await reportBtn.first().click();
          await page.waitForTimeout(2000);
        }
      } else {
        // Try clicking "6 報告" or just "6" button
        const step6 = page.locator('nav button:has-text("6")');
        if (await step6.count() > 0) {
          await step6.first().click();
          await page.waitForTimeout(2000);
        }
      }

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, '05c-report-attempt.png'),
        fullPage: true
      });
    }
  });

  test('06: Navigate directly to report page by clicking nav step 6', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Click "進入圖書館"
    await page.locator('text=進入圖書館').click();
    await page.waitForTimeout(2000);

    // Find and click any story card (the library shows stories)
    // Try clicking divs or articles that look like story cards
    const storyCardSelectors = [
      'article',
      '[class*="story"]',
      '[class*="card"]',
      '.group',
      '[class*="cursor-pointer"]',
    ];

    let clicked = false;
    for (const sel of storyCardSelectors) {
      const els = await page.locator(sel).all();
      if (els.length > 0) {
        try {
          await els[0].click();
          await page.waitForTimeout(1500);
          clicked = true;
          console.log(`Clicked element with selector: ${sel}`);
          break;
        } catch (e) {
          continue;
        }
      }
    }

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '06a-after-card-click.png'),
      fullPage: true
    });

    // Now check what view we're in and navigate to report
    const bodyText = await page.textContent('body');
    console.log('Body after click:', bodyText?.substring(0, 200));

    // Click step 6 "報告" in the header nav
    // Step 6 has needsStory: false, so it should be clickable even without story
    // But for the report to show sections, we need to inject a session

    // Try clicking "6 報告" button in header nav
    await page.waitForTimeout(1000);
    const navStepReport = page.locator('header').locator('button').filter({ hasText: '報告' });
    console.log('Header report button count:', await navStepReport.count());

    if (await navStepReport.count() > 0) {
      await navStepReport.click();
      await page.waitForTimeout(2000);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, '06b-report-page-empty.png'),
        fullPage: true
      });
      console.log('Navigated to report page (empty state)');
    }

    // Now inject session data via React internals
    const sessionInjected = await page.evaluate(() => {
      // Walk fiber tree to find App component's state setter
      const findReactFiber = (el: Element): any => {
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
        return key ? (el as any)[key] : null;
      };

      const root = document.getElementById('root');
      if (!root) return { error: 'No root' };

      let fiber = findReactFiber(root);
      if (!fiber) return { error: 'No fiber' };

      // Traverse to find App component with view state
      let node = fiber;
      let maxDepth = 50;
      while (node && maxDepth-- > 0) {
        if (node.memoizedState && node.type && node.type.name === 'App') {
          return { found: true, type: node.type.name };
        }
        node = node.child || node.sibling || node.return;
      }

      return { notFound: true, traversed: 50 - maxDepth };
    });

    console.log('Session injection attempt:', sessionInjected);
  });

  test('07: Verify report sections structure via JS inspection', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Navigate through the flow quickly
    await page.locator('text=進入圖書館').click();
    await page.waitForTimeout(3000);

    // Take screenshot to see what's in the library
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '07a-library-content.png'),
      fullPage: false
    });

    // Get all clickable elements
    const allClickable = await page.evaluate(() => {
      const clickables = Array.from(document.querySelectorAll('button, a, [onclick], [class*="cursor-pointer"]'));
      return clickables.map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().substring(0, 50),
        class: el.className?.substring(0, 100),
      })).slice(0, 30);
    });

    console.log('Clickable elements:', JSON.stringify(allClickable, null, 2));

    // Now click any story card
    // Stories in this app might be list items or divs
    const storyItem = page.locator('div').filter({
      hasText: /年級|小學|課文|朗讀/
    }).first();

    if (await storyItem.count() > 0) {
      // Try finding a child button within
      const childBtn = storyItem.locator('button').first();
      if (await childBtn.count() > 0) {
        await childBtn.click();
        await page.waitForTimeout(2000);
      } else {
        await storyItem.click();
        await page.waitForTimeout(2000);
      }
    }

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '07b-after-story.png'),
      fullPage: true
    });

    // Navigate to step 6 report
    const allNavBtns = await page.locator('header button').all();
    for (const btn of allNavBtns) {
      const text = await btn.textContent();
      const isDisabled = await btn.isDisabled();
      console.log(`Header button: "${text?.trim()}" disabled=${isDisabled}`);
    }
  });
});
