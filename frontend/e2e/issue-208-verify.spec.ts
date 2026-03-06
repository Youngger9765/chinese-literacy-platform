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

test('Step 1: Preview URL loads correctly', async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-home-page.png'), fullPage: true });

  // Verify page loaded
  const title = await page.title();
  console.log('Page title:', title);

  // Take screenshot of what's on screen
  const bodyText = await page.textContent('body');
  console.log('Body text (first 500 chars):', bodyText?.substring(0, 500));
});

test('Step 2: Navigate story library and select a story', async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-home-loaded.png'), fullPage: true });

  // Look for story cards or navigation to start learning
  const storyLinks = await page.locator('a, button').all();
  console.log('Number of interactive elements:', storyLinks.length);

  // Try to find and click first story
  const startButton = page.locator('button, a').filter({ hasText: /開始|學習|閱讀|Start|story|課文/i }).first();
  if (await startButton.count() > 0) {
    await startButton.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-after-story-click.png'), fullPage: true });
  }
});

test('Step 3: Check page structure for report sections', async ({ page }) => {
  // Navigate directly to the preview URL and look at the page structure
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Get the full page structure
  const html = await page.content();
  console.log('Page HTML length:', html.length);

  // Look for any story/course links
  const links = await page.locator('a[href*="story"], a[href*="course"], a[href*="lesson"]').all();
  console.log('Story links found:', links.length);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-page-structure.png'), fullPage: true });
});
