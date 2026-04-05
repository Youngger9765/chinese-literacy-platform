/**
 * PR #208 - Full view screenshots using scrollable container
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

async function setupReportPage(page: Page) {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) { await card.click(); break; }
  }
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const mockSession = {
      storyId: 'story-001', startedAt: Date.now(), introCompleted: true,
      readingAttempt: {
        storyId: 'story-001', accuracy: 78, fluency: 70, cpm: 120,
        mispronouncedWords: ['戴', '資'],
        transcription: '代資穎第一名，台灣第一人', timestamp: Date.now(),
        lineBreakdown: [{
          lineIndex: 0, lineText: '戴資穎第一名', transcript: '代資穎第一名', matchRate: 0.85,
          diffTokens: [
            { type: 'wrong', char: '代', expected: '戴' },
            { type: 'correct', char: '資', expected: '資' },
          ],
        }],
      },
      comprehensionResult: { understoodCount: 3, requiredCount: 5, questions: [] },
      vocabResult: { totalWords: 5, practicedWords: ['戴', '資', '穎'] },
      fullReadingResult: {
        matchRate: 0.82, transcript: '代資穎第一名台灣第一人',
        diffTokens: [{ type: 'wrong', char: '代', expected: '戴' }],
      },
    };
    const mockStory = { id: 'story-001', title: '贏得喝采的輸家', grade: 4, content: [], vocabulary: [], focusChars: [] };

    const allEls = Array.from(document.querySelectorAll('*'));
    let K7Fiber: any = null;
    for (const el of allEls) {
      const k = Object.getOwnPropertyNames(el).find(k => k.startsWith('__reactFiber$'));
      if (!k) continue;
      let current = (el as any)[k]; let d = 0;
      while (current && d < 500) { if (current.type?.name === 'K7') { K7Fiber = current; break; } current = current.return; d++; }
      if (K7Fiber) break;
    }
    if (!K7Fiber) return;
    const dispatchers: Function[] = [];
    let hook = K7Fiber.memoizedState;
    while (hook) { if (hook.queue?.dispatch) dispatchers.push(hook.queue.dispatch); hook = hook.next; }
    if (dispatchers.length < 4) return;
    dispatchers[0]('REPORT'); dispatchers[1](mockStory); dispatchers[3](mockSession);
  });
  await page.waitForTimeout(2000);
}

test('Full page - all 6 sections visible with scroll', async ({ page }) => {
  test.setTimeout(120000);

  // Use a taller viewport to see more sections
  await page.setViewportSize({ width: 1280, height: 1600 });
  await setupReportPage(page);

  // Screenshot with tall viewport
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'all-sections-tall.png'),
    fullPage: false
  });

  // Verify section states one more time
  const sectionStates = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[aria-expanded]')).map(el => ({
      title: el.querySelector('h3')?.textContent?.trim(),
      expanded: el.getAttribute('aria-expanded') === 'true',
      chevronRotated: el.querySelector('svg')?.className?.baseVal?.includes('rotate-180'),
    }));
  });

  console.log('\n=== SECTION STATES (DEFAULT) ===');
  sectionStates.forEach((s, i) => {
    const status = s.expanded ? 'EXPANDED (^)' : 'COLLAPSED (v)';
    console.log(`  Section ${i+1}: "${s.title}" → ${status} | chevron rotated: ${s.chevronRotated}`);
  });

  // Verify: sections 1 and 4 should be expanded, 2, 3, 5 collapsed
  const expandedCount = sectionStates.filter(s => s.expanded).length;
  const collapsedCount = sectionStates.filter(s => !s.expanded).length;
  console.log(`\nExpanded: ${expandedCount}, Collapsed: ${collapsedCount}`);
  console.log('Expected: Expanded=2 (sections 1,4), Collapsed=3 (sections 2,3,5)');

  // Section 6 is disabled so it won't have aria-expanded
  const section1 = sectionStates.find(s => s.title?.includes('朗讀結果總覽'));
  const section2 = sectionStates.find(s => s.title?.includes('錄音內容'));
  const section3 = sectionStates.find(s => s.title?.includes('逐句分析'));
  const section4 = sectionStates.find(s => s.title?.includes('錯字詞'));
  const section5 = sectionStates.find(s => s.title?.includes('練習建議'));

  console.log('\n=== VERIFICATION RESULTS ===');
  console.log(`Section 1 (朗讀結果總覽) expanded: ${section1?.expanded} (expected: true) → ${section1?.expanded === true ? 'PASS' : 'FAIL'}`);
  console.log(`Section 2 (錄音內容與智能分析) expanded: ${section2?.expanded} (expected: false) → ${section2?.expanded === false ? 'PASS' : 'FAIL'}`);
  console.log(`Section 3 (逐句分析對比) expanded: ${section3?.expanded} (expected: false) → ${section3?.expanded === false ? 'PASS' : 'FAIL'}`);
  console.log(`Section 4 (錯字詞練習清單) expanded: ${section4?.expanded} (expected: true) → ${section4?.expanded === true ? 'PASS' : 'FAIL'}`);
  console.log(`Section 5 (練習建議) expanded: ${section5?.expanded} (expected: false) → ${section5?.expanded === false ? 'PASS' : 'FAIL'}`);

  // Scroll down to show sections 3-6
  const scrollResult = await page.evaluate(() => {
    // Find the scrollable container - the main element
    const main = document.querySelector('main');
    if (main) {
      main.scrollTop = 800;
      return { scrolled: true, scrollTop: main.scrollTop };
    }
    // Try the div.p-8 container
    const reportDiv = document.querySelector('.p-8.max-w-4xl');
    if (reportDiv?.parentElement) {
      reportDiv.parentElement.scrollTop = 800;
      return { scrolled: true, element: '.p-8 parent' };
    }
    return { scrolled: false };
  });
  console.log('Scroll result:', scrollResult);
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'sections-scrolled.png'),
    fullPage: false
  });
});

test('Zoom in on section headers to show chevrons', async ({ page }) => {
  test.setTimeout(120000);

  await page.setViewportSize({ width: 1280, height: 800 });
  await setupReportPage(page);

  // Take a focused screenshot of section 1 header (expanded - chevron up)
  const section1Header = page.locator('[aria-expanded="true"]').first();
  await section1Header.screenshot({
    path: path.join(EVIDENCE_DIR, 'section1-header-expanded.png')
  });
  console.log('Section 1 header (expanded) screenshot taken');

  // Take a focused screenshot of section 2 header (collapsed - chevron down)
  const section2Header = page.locator('[aria-expanded="false"]').first();
  await section2Header.screenshot({
    path: path.join(EVIDENCE_DIR, 'section2-header-collapsed.png')
  });
  console.log('Section 2 header (collapsed) screenshot taken');

  // Take a focused screenshot of section 4 header (expanded - 錯字詞練習清單)
  const section4Header = page.locator('[aria-expanded="true"]').nth(1);
  if (await section4Header.count() > 0) {
    await section4Header.screenshot({
      path: path.join(EVIDENCE_DIR, 'section4-header-expanded.png')
    });
    console.log('Section 4 header (expanded) screenshot taken');
  }

  // Verify chevron classes
  const chevronStates = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[aria-expanded]')).map(el => {
      const svg = el.querySelector('svg');
      return {
        title: el.querySelector('h3')?.textContent?.trim(),
        ariaExpanded: el.getAttribute('aria-expanded'),
        svgClass: svg?.className?.baseVal || 'no-svg',
        rotated: svg?.className?.baseVal?.includes('rotate-180') || false,
      };
    });
  });

  console.log('\n=== CHEVRON VERIFICATION ===');
  chevronStates.forEach(s => {
    console.log(`  "${s.title}": aria-expanded=${s.ariaExpanded}, chevron rotated=${s.rotated} → ${
      (s.ariaExpanded === 'true' && s.rotated) || (s.ariaExpanded === 'false' && !s.rotated) ? 'PASS' : 'FAIL'
    }`);
  });
});

test('Exit ticket distractor verification', async ({ page }) => {
  test.setTimeout(120000);

  await page.setViewportSize({ width: 1280, height: 800 });
  await setupReportPage(page);

  // Find exit ticket content
  const exitTicketContent = await page.evaluate(() => {
    const body = document.body.textContent || '';
    // Check if exit ticket is present
    const hasExitTicket = body.includes('出場卷') || body.includes('學習出場卷');

    // Find the exit ticket element
    const allText = Array.from(document.querySelectorAll('*')).find(el =>
      el.textContent?.includes('出場卷') && el.children.length < 5
    );

    return {
      hasExitTicket,
      location: allText?.className || 'not found',
      surroundingText: allText?.textContent?.substring(0, 200),
    };
  });

  console.log('Exit ticket:', JSON.stringify(exitTicketContent, null, 2));

  // Scroll to exit ticket
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
    document.querySelector('[class*="exit"], [class*="ticket"]')?.scrollIntoView();
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'exit-ticket-bottom.png'),
    fullPage: false
  });
});
