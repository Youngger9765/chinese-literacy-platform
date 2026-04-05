/**
 * Issue #169: Collapsible report sections verification
 * Tests that report sections expand/collapse correctly:
 * - Sections 1 & 4: expanded by default
 * - Sections 2, 3, 5, 6: collapsed by default
 * - Clicking collapsed section expands it
 * - Clicking expanded section collapses it
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://localhost:3099';
const EVIDENCE_DIR = path.join(__dirname, '..', '..', '.claude', 'evidence', 'issue-169');

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
});

/**
 * Navigate to library, select first story, then inject React state
 * to jump directly to the Report view with mock session data.
 */
async function navigateToReport(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });

  // Go to library
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // Select first story card
  const storyCards = page.locator('.cursor-pointer').filter({ hasText: /年級/ });
  if (await storyCards.count() > 0) {
    await storyCards.first().click();
    await page.waitForTimeout(1000);
  }

  // Inject state via React fiber to jump to REPORT view
  const injected = await page.evaluate(() => {
    const mockSession = {
      storyId: '1',
      startedAt: Date.now(),
      introCompleted: true,
      readingAttempt: {
        storyId: '1',
        accuracy: 85,
        fluency: 78,
        cpm: 105,
        mispronouncedWords: ['戴', '資'],
        transcription: '代資穎是台灣羽球選手',
        timestamp: Date.now(),
        lineBreakdown: [
          {
            lineIndex: 0,
            lineText: '戴資穎是台灣羽球選手',
            transcript: '代資穎是台灣羽球選手',
            matchRate: 0.9,
            diffTokens: [
              { type: 'wrong', char: '代', expected: '戴' },
              { type: 'correct', char: '資' },
              { type: 'correct', char: '穎' },
              { type: 'correct', char: '是' },
              { type: 'correct', char: '台' },
              { type: 'correct', char: '灣' },
              { type: 'correct', char: '羽' },
              { type: 'correct', char: '球' },
              { type: 'correct', char: '選' },
              { type: 'correct', char: '手' },
            ],
          },
        ],
      },
      comprehensionResult: { understoodCount: 4, requiredCount: 5, questions: [] },
      vocabResult: { totalWords: 5, practicedWords: ['戴', '資', '穎'] },
      fullReadingResult: {
        matchRate: 0.88,
        transcript: '代資穎是台灣羽球選手',
        diffTokens: [{ type: 'wrong', char: '代', expected: '戴' }],
      },
    };

    // Find React fiber from any DOM element
    const allEls = Array.from(document.querySelectorAll('*'));
    let fiberKey: string | null = null;
    let startFiber: any = null;

    for (const el of allEls) {
      const keys = Object.getOwnPropertyNames(el);
      const k = keys.find(k => k.startsWith('__reactFiber$'));
      if (k) {
        fiberKey = k;
        startFiber = (el as any)[k];
        break;
      }
    }
    if (!startFiber) return { error: 'No React fiber found' };

    // Walk up fiber tree to find App component
    let current = startFiber;
    let appFiber: any = null;
    for (let i = 0; i < 300 && current; i++) {
      if (current.type?.name === 'App') {
        appFiber = current;
        break;
      }
      current = current.return;
    }
    if (!appFiber) return { error: 'App component not found in fiber tree' };

    // Collect useState dispatchers
    const dispatchers: Function[] = [];
    let hook = appFiber.memoizedState;
    while (hook) {
      if (hook.queue?.dispatch) dispatchers.push(hook.queue.dispatch);
      hook = hook.next;
    }

    if (dispatchers.length < 4) return { error: `Only ${dispatchers.length} dispatchers` };

    // App.tsx hook order: [0]=view, [1]=selectedStory, [2]=lastAttempt, [3]=session
    dispatchers[0]('REPORT');
    dispatchers[3](mockSession);
    return { success: true };
  });

  if (!injected || 'error' in injected) {
    throw new Error(`State injection failed: ${JSON.stringify(injected)}`);
  }

  await page.waitForTimeout(1500);
}

/**
 * Get section header buttons with their titles and expanded state.
 * Expanded = has a sibling div.p-6 (content area).
 */
async function getSectionStates(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    // Each Section is a rounded-3xl div with a button header + optional content div
    const sectionDivs = Array.from(document.querySelectorAll('.rounded-3xl.border'));
    return sectionDivs.map(div => {
      const button = div.querySelector('button');
      const title = button?.querySelector('h3')?.textContent?.trim() ?? '';
      const numberEl = button?.querySelector('span');
      const number = parseInt(numberEl?.textContent?.trim() ?? '0', 10);
      const contentDiv = div.querySelector('.p-6');
      const expanded = !!contentDiv;
      const chevron = button?.querySelector('svg');
      const hasChevron = !!chevron;
      const isDisabled = div.classList.contains('bg-gray-50');
      return { number, title, expanded, hasChevron, isDisabled };
    });
  });
}

test.describe('#169 Collapsible Report Sections', () => {

  test('01: Default expand/collapse state', async ({ page }) => {
    await navigateToReport(page);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '01-report-initial.png'),
      fullPage: true,
    });

    const sections = await getSectionStates(page);
    console.log('Section states:', JSON.stringify(sections, null, 2));

    // Sections 1 & 4 should be expanded by default
    const s1 = sections.find(s => s.number === 1);
    const s4 = sections.find(s => s.number === 4);
    expect(s1?.expanded).toBe(true);
    expect(s4?.expanded).toBe(true);

    // Sections 2, 3, 5, 6 should be collapsed by default
    const s2 = sections.find(s => s.number === 2);
    const s3 = sections.find(s => s.number === 3);
    const s5 = sections.find(s => s.number === 5);
    const s6 = sections.find(s => s.number === 6);
    expect(s2?.expanded).toBe(false);
    expect(s3?.expanded).toBe(false);
    expect(s5?.expanded).toBe(false);
    expect(s6?.expanded).toBe(false);
  });

  test('02: Click to expand a collapsed section', async ({ page }) => {
    await navigateToReport(page);

    // Section 2 should be collapsed
    let sections = await getSectionStates(page);
    expect(sections.find(s => s.number === 2)?.expanded).toBe(false);

    // Click Section 2 header to expand
    const s2Button = page.locator('button:has(h3:text("錄音內容與智能分析"))');
    await s2Button.click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '02-section2-expanded.png'),
      fullPage: true,
    });

    sections = await getSectionStates(page);
    expect(sections.find(s => s.number === 2)?.expanded).toBe(true);
    // Section 1 should still be expanded
    expect(sections.find(s => s.number === 1)?.expanded).toBe(true);
  });

  test('03: Click to collapse an expanded section', async ({ page }) => {
    await navigateToReport(page);

    // Section 1 should be expanded
    let sections = await getSectionStates(page);
    expect(sections.find(s => s.number === 1)?.expanded).toBe(true);

    // Click Section 1 header to collapse
    const s1Button = page.locator('button:has(h3:text("朗讀結果總覽"))');
    await s1Button.click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '03-section1-collapsed.png'),
      fullPage: true,
    });

    sections = await getSectionStates(page);
    expect(sections.find(s => s.number === 1)?.expanded).toBe(false);
  });

  test('04: Chevron rotation matches expand/collapse state', async ({ page }) => {
    await navigateToReport(page);

    // Check chevron classes
    const chevronStates = await page.evaluate(() => {
      const sectionDivs = Array.from(document.querySelectorAll('.rounded-3xl.border'));
      return sectionDivs.map(div => {
        const button = div.querySelector('button');
        const number = parseInt(button?.querySelector('span')?.textContent?.trim() ?? '0', 10);
        const svg = button?.querySelector('svg');
        const rotated = svg?.classList.contains('rotate-180') ?? false;
        return { number, rotated };
      });
    });

    console.log('Chevron states:', JSON.stringify(chevronStates, null, 2));

    // Expanded sections (1, 4) should have rotate-180 (chevron pointing up)
    expect(chevronStates.find(c => c.number === 1)?.rotated).toBe(true);
    expect(chevronStates.find(c => c.number === 4)?.rotated).toBe(true);

    // Collapsed sections (2, 3, 5) should NOT have rotate-180
    expect(chevronStates.find(c => c.number === 2)?.rotated).toBe(false);
    expect(chevronStates.find(c => c.number === 3)?.rotated).toBe(false);
    expect(chevronStates.find(c => c.number === 5)?.rotated).toBe(false);
  });

  test('05: All sections expanded screenshot', async ({ page }) => {
    await navigateToReport(page);

    // Expand all collapsed sections (2, 3, 5)
    for (const title of ['錄音內容與智能分析', '逐句分析對比', '練習建議']) {
      const btn = page.locator(`button:has(h3:text("${title}"))`);
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '05-all-expanded.png'),
      fullPage: true,
    });

    const sections = await getSectionStates(page);
    // Sections 1-5 should all be expanded now (6 is disabled)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(sections.find(s => s.number === n)?.expanded).toBe(true);
    }
  });

  test('06: Full page collapsed vs expanded comparison', async ({ page }) => {
    await navigateToReport(page);

    // Take "mostly collapsed" screenshot (default state)
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '06a-default-view.png'),
      fullPage: true,
    });

    // Count visible content areas in default state (collapsed = fewer .p-6 divs)
    const defaultContentCount = await page.locator('.rounded-3xl.border .p-6').count();

    // Now expand all
    for (const title of ['錄音內容與智能分析', '逐句分析對比', '練習建議']) {
      const btn = page.locator(`button:has(h3:text("${title}"))`);
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }

    const expandedContentCount = await page.locator('.rounded-3xl.border .p-6').count();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '06b-all-expanded-view.png'),
      fullPage: true,
    });

    console.log(`Content areas: default=${defaultContentCount}, expanded=${expandedContentCount}`);
    // More content areas visible when expanded
    expect(expandedContentCount).toBeGreaterThan(defaultContentCount);
  });
});
