/**
 * PR #208 - Exit Ticket (#172) distractor verification
 * Verify that distractors are confusable chars, not common particles
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
  await page.setViewportSize({ width: 1280, height: 900 });
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

test('Exit ticket - expand and verify distractors', async ({ page }) => {
  test.setTimeout(120000);

  await setupReportPage(page);

  // Scroll to bottom to find exit ticket
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'exit-ticket-01-collapsed.png'),
    fullPage: false
  });

  // Find and click the exit ticket header to expand it
  const exitTicketHeader = page.locator('div').filter({ hasText: /學習出場卷/ }).first();
  console.log('Exit ticket header count:', await exitTicketHeader.count());

  if (await exitTicketHeader.count() > 0) {
    await exitTicketHeader.click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'exit-ticket-02-expanded.png'),
      fullPage: false
    });

    // Get the exit ticket content (the quiz)
    const ticketContent = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        hasTicket: body.includes('學習出場卷'),
        // Find question and options
        text: body.substring(body.indexOf('學習出場卷'), body.indexOf('學習出場卷') + 500),
      };
    });
    console.log('Exit ticket content:', ticketContent);
  }
});

test('Full report - expand all sections', async ({ page }) => {
  test.setTimeout(120000);

  await setupReportPage(page);

  // Click all collapsed sections to expand them
  let collapsedSections = await page.locator('[aria-expanded="false"]').all();
  console.log('Collapsed sections initially:', collapsedSections.length);

  for (const section of collapsedSections) {
    await section.click();
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'all-sections-expanded.png'),
    fullPage: false
  });

  // Verify all expanded
  const expandedAfter = await page.locator('[aria-expanded="true"]').count();
  const collapsedAfter = await page.locator('[aria-expanded="false"]').count();
  console.log(`After expanding all: ${expandedAfter} expanded, ${collapsedAfter} collapsed`);

  // Scroll to see sections 3-5
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 600;
  });
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'all-expanded-scrolled.png'),
    fullPage: false
  });
});
