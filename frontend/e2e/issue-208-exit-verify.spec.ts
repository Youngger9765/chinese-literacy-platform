/**
 * PR #208 - Final exit ticket distractor verification
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

async function setupAndExpandExitTicket(page: Page) {
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
      vocabResult: { totalChars: 5, practicedChars: ['戴', '資', '穎'] },
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

  // Scroll and expand exit ticket
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(500);

  // Click the exit ticket header
  await page.getByText('學習出場卷').click({ force: true });
  await page.waitForTimeout(1000);
}

test('Full exit ticket quiz screenshot', async ({ page }) => {
  test.setTimeout(120000);

  await setupAndExpandExitTicket(page);

  // Take screenshot of exit ticket area
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'exit-quiz-expanded.png'),
    fullPage: false
  });

  // Get the actual text content of the quiz
  const quizContent = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const txt = main.textContent || '';
    const start = txt.indexOf('學習出場卷');
    const end = txt.indexOf('準備好讀下一個故事');
    return txt.substring(start, end);
  });
  console.log('Quiz content:', quizContent);

  // Get individual option buttons
  const options = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const quizButtons = buttons.filter(b => {
      const txt = b.textContent?.trim();
      return txt && txt.length === 1 && /[\u4e00-\u9fff]/.test(txt);
    });
    return quizButtons.map(b => ({
      text: b.textContent?.trim(),
      class: b.className?.substring(0, 100),
      disabled: b.disabled,
    }));
  });
  console.log('Option buttons:', JSON.stringify(options));

  // Verify no common particles in options
  const COMMON_PARTICLES = ['的', '了', '在', '是', '有', '和', '與', '也', '都', '就', '把', '被', '讓', '給'];
  const optionTexts = options.map(o => o.text).filter(Boolean) as string[];
  const hasParticles = optionTexts.some(t => COMMON_PARTICLES.includes(t));

  console.log('\n=== EXIT TICKET DISTRACTOR VERIFICATION (#172) ===');
  console.log('Question: 你讀成了「代」，正確的字應該是？');
  console.log('Options:', optionTexts.join(', '));
  console.log('Correct answer should be: 戴');
  console.log('Has common particles:', hasParticles, '(expected: false)');
  console.log('Contains "戴" (correct answer):', optionTexts.includes('戴'), '(expected: true)');

  // Check if confusables are present (from CONFUSABLE_CHARS['代'] = ['伐', '從'])
  const hasConfusable = optionTexts.includes('伐') || optionTexts.includes('從');
  console.log('Contains confusable chars (伐 or 從):', hasConfusable);
});

test('All 4 exit ticket options screenshot', async ({ page }) => {
  test.setTimeout(120000);

  await page.setViewportSize({ width: 1280, height: 1200 });
  await setupAndExpandExitTicket(page);

  // Large viewport screenshot to see all options
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'exit-ticket-all-options.png'),
    fullPage: false
  });
});
