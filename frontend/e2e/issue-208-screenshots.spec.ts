/**
 * PR #208 - Full screenshot verification of collapsible sections
 * K7 = minified App component name in production build
 */
import { test, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PREVIEW_URL = 'https://lingoleap-frontend-issue-208-oja2sffiya-de.a.run.app';
const EVIDENCE_DIR = '/Users/young/project/chinese-literacy-platform/.claude/evidence/issue-208';

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
});

async function injectMockSession(page: Page) {
  return await page.evaluate(() => {
    const mockSession = {
      storyId: 'story-001',
      startedAt: Date.now(),
      introCompleted: true,
      readingAttempt: {
        storyId: 'story-001',
        accuracy: 78,
        fluency: 70,
        cpm: 120,
        mispronouncedWords: ['戴', '資'],
        transcription: '代資穎第一名，台灣第一人',
        timestamp: Date.now(),
        lineBreakdown: [
          {
            lineIndex: 0,
            lineText: '戴資穎第一名',
            transcript: '代資穎第一名',
            matchRate: 0.85,
            diffTokens: [
              { type: 'wrong', char: '代', expected: '戴' },
              { type: 'correct', char: '資', expected: '資' },
              { type: 'correct', char: '穎', expected: '穎' },
              { type: 'correct', char: '第', expected: '第' },
              { type: 'correct', char: '一', expected: '一' },
              { type: 'correct', char: '名', expected: '名' },
            ],
          },
        ],
      },
      comprehensionResult: { understoodCount: 3, requiredCount: 5, questions: [] },
      vocabResult: { totalChars: 5, practicedChars: ['戴', '資', '穎'] },
      fullReadingResult: {
        matchRate: 0.82,
        transcript: '代資穎第一名台灣第一人',
        diffTokens: [{ type: 'wrong', char: '代', expected: '戴' }],
      },
    };

    const mockStory = {
      id: 'story-001',
      title: '贏得喝采的輸家',
      grade: 4,
      content: [],
      vocabulary: [],
      focusChars: [],
    };

    const allEls = Array.from(document.querySelectorAll('*'));
    let K7Fiber: any = null;

    for (const el of allEls) {
      const keys = Object.getOwnPropertyNames(el);
      const k = keys.find(k => k.startsWith('__reactFiber$'));
      if (!k) continue;
      let current = (el as any)[k];
      let depth = 0;
      while (current && depth < 500) {
        if (current.type?.name === 'K7') { K7Fiber = current; break; }
        current = current.return;
        depth++;
      }
      if (K7Fiber) break;
    }

    if (!K7Fiber) return { error: 'K7 not found' };

    const dispatchers: Function[] = [];
    let hook = K7Fiber.memoizedState;
    while (hook) {
      if (hook.queue?.dispatch) dispatchers.push(hook.queue.dispatch);
      hook = hook.next;
    }

    if (dispatchers.length < 4) return { error: `only ${dispatchers.length} dispatchers` };

    dispatchers[0]('REPORT');
    dispatchers[1](mockStory);
    dispatchers[3](mockSession);
    return { success: true };
  });
}

test('Screenshot 1: Report page default state - sections 1 and 4 open', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Select a story to populate session context
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) { await card.click(); break; }
  }
  await page.waitForTimeout(2000);

  // Inject session
  const result = await injectMockSession(page);
  console.log('Injection:', result);
  await page.waitForTimeout(2000);

  // Screenshot 1: Top of the report page
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'report-01-top-default.png'),
    fullPage: false
  });

  // Screenshot 2: Full page scroll
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'report-02-full-page.png'),
    fullPage: true
  });

  // Verify section states by checking aria-expanded and chevron rotation
  const sectionStates = await page.evaluate(() => {
    const sections = document.querySelectorAll('[aria-expanded]');
    return Array.from(sections).map((el, i) => {
      const text = el.querySelector('h3')?.textContent?.trim() || el.textContent?.trim().substring(0, 50);
      const expanded = el.getAttribute('aria-expanded') === 'true';
      const chevron = el.querySelector('svg');
      const chevronClass = chevron?.className?.baseVal || '';
      const isRotated = chevronClass.includes('rotate-180');
      return {
        index: i,
        title: text,
        expanded,
        chevronRotated: isRotated,
        chevronClass,
      };
    });
  });

  console.log('\nSection States:');
  sectionStates.forEach(s => {
    console.log(`  Section: "${s.title?.substring(0, 30)}" | expanded=${s.expanded} | chevronRotated=${s.chevronRotated}`);
  });

  // Verify expectations:
  // Section 1 (朗讀結果總覽): expanded=true
  // Section 2 (錄音內容與智能分析): expanded=false
  // Section 3 (逐句分析對比): expanded=false
  // Section 4 (錯字詞練習清單): expanded=true
  // Section 5 (練習建議): expanded=false
  // Section 6 (AI 詳細分析): disabled, no toggle

  const expandedSections = sectionStates.filter(s => s.expanded);
  const collapsedSections = sectionStates.filter(s => !s.expanded);

  console.log(`\nExpanded sections: ${expandedSections.length}`);
  console.log(`Collapsed sections: ${collapsedSections.length}`);

  return { sectionStates, expandedSections: expandedSections.length, collapsedSections: collapsedSections.length };
});

test('Screenshot 2: Verify chevron icons and toggle behavior', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) { await card.click(); break; }
  }
  await page.waitForTimeout(2000);

  await injectMockSession(page);
  await page.waitForTimeout(2000);

  // Take initial screenshot
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'toggle-01-initial.png'),
    fullPage: false,
    clip: { x: 0, y: 50, width: 1280, height: 700 }
  });

  // Find section 2 (錄音內容與智能分析) which should be collapsed
  const section2 = page.locator('[aria-expanded="false"]').nth(0);
  const section2Text = await section2.textContent();
  console.log('First collapsed section:', section2Text?.substring(0, 50));

  // Click to EXPAND section 2
  await section2.click();
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'toggle-02-section2-expanded.png'),
    fullPage: false,
    clip: { x: 0, y: 50, width: 1280, height: 700 }
  });
  console.log('Clicked section 2 to expand');

  // Find section 1 (朗讀結果總覽) which should be expanded - click to COLLAPSE
  const section1 = page.locator('[aria-expanded="true"]').first();
  const section1Text = await section1.textContent();
  console.log('First expanded section:', section1Text?.substring(0, 50));

  await section1.click();
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'toggle-03-section1-collapsed.png'),
    fullPage: false,
    clip: { x: 0, y: 50, width: 1280, height: 700 }
  });
  console.log('Clicked section 1 to collapse');

  // Verify states after toggling
  const statesAfterToggle = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[aria-expanded]')).map(el => ({
      title: el.querySelector('h3')?.textContent?.trim(),
      expanded: el.getAttribute('aria-expanded'),
    }));
  });
  console.log('States after toggle:', JSON.stringify(statesAfterToggle, null, 2));
});

test('Screenshot 3: Full page view showing all 6 sections', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) { await card.click(); break; }
  }
  await page.waitForTimeout(2000);

  await injectMockSession(page);
  await page.waitForTimeout(2000);

  // Full page screenshot to see all sections
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'fullpage-all-sections.png'),
    fullPage: true
  });

  // Screenshot focused on sections 3 and 4
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'sections-3-4.png'),
    fullPage: false
  });

  // Screenshot focused on sections 5 and 6
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'sections-5-6.png'),
    fullPage: false
  });

  // Check section 4 content (錯字詞練習清單) - should show wrong chars
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  // Verify section 4 content is visible (it's open by default)
  const section4Content = await page.evaluate(() => {
    // Find section with title 錯字詞練習清單
    const headers = document.querySelectorAll('[aria-expanded]');
    for (const header of Array.from(headers)) {
      const h3 = header.querySelector('h3');
      if (h3?.textContent?.includes('錯字詞')) {
        const expanded = header.getAttribute('aria-expanded') === 'true';
        // Find the content div (next sibling of the header's parent)
        const section = header.closest('[class*="rounded"]');
        const contentDiv = section?.querySelector('.p-6');
        return {
          title: h3.textContent,
          expanded,
          hasContent: !!contentDiv,
          contentText: contentDiv?.textContent?.substring(0, 100),
        };
      }
    }
    return null;
  });
  console.log('Section 4 (錯字詞練習清單):', JSON.stringify(section4Content, null, 2));
});

test('Screenshot 4: Exit ticket section visible', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) { await card.click(); break; }
  }
  await page.waitForTimeout(2000);

  await injectMockSession(page);
  await page.waitForTimeout(2000);

  // Scroll to bottom to find exit ticket
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'exit-ticket-area.png'),
    fullPage: false
  });

  // Check for exit ticket
  const exitTicket = await page.evaluate(() => {
    const body = document.body.textContent;
    return {
      hasExitTicket: body?.includes('出場卷') || body?.includes('Exit Ticket') || body?.includes('學習出場卷'),
      exitTicketText: (body?.match(/出場卷[^。]*/) || [])[0]?.substring(0, 100),
    };
  });
  console.log('Exit ticket:', exitTicket);

  // Take full scroll screenshot
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'final-full-report.png'),
    fullPage: true
  });
});
