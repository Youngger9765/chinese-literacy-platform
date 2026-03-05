import { test, expect } from '@playwright/test';

const LOCAL_URL = 'http://localhost:3173';

/**
 * Issue #173 - AFTER: Verify fix for empty Section 2 when accuracy=0%
 *
 * After fix: Section 2 should show a meaningful fallback message
 * "語音辨識資料不足，準確度過低時建議重新朗讀" instead of empty content.
 */
test('Issue #173 - AFTER: Section 2 shows fallback message when accuracy=0% with empty transcription', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(LOCAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  // Screenshot: homepage
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/10-after-homepage.png',
    fullPage: false
  });

  // Navigate into library
  await page.click('button:has-text("進入圖書館")');
  await page.waitForTimeout(2000);

  // Click a story
  const cards = page.locator('button, [role="button"], .cursor-pointer');
  const count = await cards.count();
  let clicked = false;
  for (let i = 0; i < Math.min(count, 10); i++) {
    const card = cards.nth(i);
    const text = await card.textContent();
    if (text && (text.includes('開始') || text.includes('學習') || text.includes('閱讀'))) {
      await card.click();
      clicked = true;
      break;
    }
  }
  if (!clicked && count > 1) {
    await cards.nth(1).click();
  }
  await page.waitForTimeout(2000);

  // Inject buggy session and navigate to REPORT
  const result = await page.evaluate(() => {
    function getFiber(el: Element): any {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (key) return (el as any)[key];
      return null;
    }

    function findAppDispatchers(fiber: any, depth = 0): any[] | null {
      if (!fiber || depth > 300) return null;

      if (fiber.memoizedState) {
        let hook = fiber.memoizedState;
        const dispatchers: any[] = [];
        while (hook && dispatchers.length < 15) {
          if (hook.queue?.dispatch) {
            dispatchers.push({ val: hook.memoizedState, dispatch: hook.queue.dispatch });
          }
          hook = hook.next;
        }

        const firstVal = dispatchers[0]?.val;
        if (typeof firstVal === 'string' &&
            ['HOME', 'LIBRARY', 'INTRO', 'TUTOR', 'COMPREHENSION', 'VOCAB', 'FULL_READING', 'REPORT', 'WRITE'].includes(firstVal) &&
            dispatchers.length >= 4) {
          return dispatchers;
        }
      }

      const fromChild = findAppDispatchers(fiber.child, depth + 1);
      if (fromChild) return fromChild;
      return findAppDispatchers(fiber.sibling, depth + 1);
    }

    let dispatchers: any[] | null = null;
    const allEls = document.querySelectorAll('*');
    for (const el of Array.from(allEls).slice(0, 50)) {
      const fiber = getFiber(el);
      if (!fiber) continue;
      let f = fiber;
      while (f && !dispatchers) {
        dispatchers = findAppDispatchers(f, 0);
        f = f.return;
      }
      if (dispatchers) break;
    }

    if (!dispatchers) return { error: 'dispatchers not found' };

    // Same bug scenario: accuracy=0, cpm=143, empty transcription, empty lineBreakdown
    const buggySession = {
      storyId: 'test-story',
      startedAt: Date.now(),
      readingAttempt: {
        storyId: 'test-story',
        accuracy: 0,
        fluency: 0,
        cpm: 143,
        mispronouncedWords: ['山', '高', '大'],
        transcription: '',
        timestamp: Date.now(),
        lineBreakdown: []
      },
      comprehensionResult: null,
      vocabResult: null,
      fullReadingResult: {
        matchRate: 0.04,
        feedback: '繼續加油',
        cpm: 143,
        durationMs: 60000,
        errorBreakdown: { correct: 3, wrong: 50, missing: 10, extra: 5 },
        diffTokens: [],
        transcript: ''
      }
    };

    try {
      dispatchers[3].dispatch(buggySession);
      dispatchers[0].dispatch('REPORT');
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  console.log('Injection result:', JSON.stringify(result));
  await page.waitForTimeout(2000);

  // Screenshot the fixed report
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/11-after-report-full.png',
    fullPage: true
  });

  await page.screenshot({
    path: '/tmp/bugfix/issue-173/12-after-report-viewport.png',
    fullPage: false
  });

  // Scroll to section 2
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/13-after-section2.png',
    fullPage: false
  });

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('=== AFTER PAGE TEXT ===');
  console.log(pageText.substring(0, 1000));

  // Verify the fix
  const hasSection2 = pageText.includes('錄音內容與智能分析');
  const hasFallbackMessage = pageText.includes('語音辨識資料不足');
  const hasOldEmptyState = pageText.includes('尚未完成朗讀練習');

  console.log('Has section 2 header:', hasSection2);
  console.log('Has new fallback message:', hasFallbackMessage);
  console.log('Has old empty state (should be false):', hasOldEmptyState);

  // Assertions
  expect((result as any).success).toBe(true);
  expect(hasSection2).toBe(true);
  expect(hasFallbackMessage).toBe(true);   // New: fallback message shown
  expect(hasOldEmptyState).toBe(false);     // Section 2 should not say "尚未完成"
});
