import { test, expect } from '@playwright/test';

const LOCAL_URL = 'http://localhost:3175';

/**
 * Issue #173 - AFTER: Verify fix for Section 2 blank with whitespace transcription.
 *
 * Root cause: LiveTutor produces transcription = '   ' (whitespace from joining empty strings)
 * PR #185 fallback only handled '' (empty string), not '   ' (whitespace).
 *
 * Fix: Use .trim() when checking transcription values.
 * After fix: Section 2 should show "語音辨識資料不足..." instead of a blank "語音轉文字" box.
 */
test('Issue #173 - AFTER: Section 2 shows fallback with whitespace transcription', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(LOCAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: '/tmp/bugfix/issue-173/30-after-homepage.png',
    fullPage: false
  });

  // Navigate into library and select a story
  await page.click('button:has-text("進入圖書館")');
  await page.waitForTimeout(2000);

  const cards = page.locator('button, [role="button"], .cursor-pointer');
  const count = await cards.count();
  if (count > 1) {
    await cards.nth(1).click();
  }
  await page.waitForTimeout(2000);

  // Inject the REAL bug scenario: whitespace transcription
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

    // Real bug scenario: whitespace transcription ('   ') from joining empty line transcripts
    const whitespaceTranscription = ['', '', '', ''].join(' '); // '   '

    const realBugSession = {
      storyId: 'test-story',
      startedAt: Date.now(),
      readingAttempt: {
        storyId: 'test-story',
        accuracy: 0,
        fluency: 0,
        cpm: 0,
        mispronouncedWords: [],
        transcription: whitespaceTranscription,  // '   ' — real whitespace scenario
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
        transcript: '   '  // also whitespace
      }
    };

    try {
      dispatchers[3].dispatch(realBugSession);
      dispatchers[0].dispatch('REPORT');
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  console.log('Injection result:', JSON.stringify(result));
  await page.waitForTimeout(2000);

  // Screenshot full fixed report
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/31-after-report-full.png',
    fullPage: true
  });

  await page.screenshot({
    path: '/tmp/bugfix/issue-173/32-after-report-viewport.png',
    fullPage: false
  });

  // Scroll to section 2
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/33-after-section2.png',
    fullPage: false
  });

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('=== AFTER PAGE TEXT ===');
  console.log(pageText.substring(0, 2000));

  const hasFallbackMessage = pageText.includes('語音辨識資料不足');
  const hasBlankTranscriptionBox = pageText.includes('語音轉文字');
  const hasOldEmptyState = pageText.includes('尚未完成朗讀練習');

  console.log('Has fallback message (should be TRUE):', hasFallbackMessage);
  console.log('Has blank transcription box (should be FALSE):', hasBlankTranscriptionBox);
  console.log('Has old empty state (should be FALSE):', hasOldEmptyState);

  // Assert fix works
  expect((result as any).success).toBe(true);
  expect(hasFallbackMessage).toBe(true);        // NEW: fallback message shows for whitespace
  expect(hasBlankTranscriptionBox).toBe(false);  // Fixed: no blank "語音轉文字" box
  expect(hasOldEmptyState).toBe(false);          // Outer condition unaffected
});
