import { test, expect } from '@playwright/test';

const STAGING_URL = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

/**
 * Issue #173 — Real-world reproduction of Section 2 blank bug.
 *
 * PR #185 added a fallback for `transcription === ''` (empty string).
 * But the real LiveTutor produces `transcription = '   '` (whitespace) when
 * all line transcripts are empty:
 *   allResults.map(r => r.transcript).join(' ')
 *   → ['', '', '', ''].join(' ') → '   '
 *
 * '   ' is truthy in JS, so `!readingAttempt?.transcription` === false
 * → fallback never triggers → Section 2 still blank.
 *
 * This test proves the bug persists on staging with the real whitespace scenario.
 */
test('Issue #173 - BEFORE (real): Section 2 blank with whitespace transcription', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(STAGING_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  // Navigate into library and select a story
  await page.click('button:has-text("進入圖書館")');
  await page.waitForTimeout(2000);

  const cards = page.locator('button, [role="button"], .cursor-pointer');
  const count = await cards.count();
  if (count > 1) {
    await cards.nth(1).click();
  }
  await page.waitForTimeout(2000);

  // Inject buggy session: REAL scenario with whitespace transcription
  // (what LiveTutor actually produces: ['', '', '', ''].join(' ') = '   ')
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

    // REAL SCENARIO: transcription is WHITESPACE (not empty string '')
    // LiveTutor: allResults.map(r => r.transcript).join(' ')
    // With 4 lines all empty: ['', '', '', ''].join(' ') = '   '
    const whitespaceTranscription = ['', '', '', ''].join(' '); // '   '
    console.log('whitespaceTranscription repr:', JSON.stringify(whitespaceTranscription));
    console.log('is falsy?', !whitespaceTranscription);  // false! It's truthy
    console.log('trim falsy?', !whitespaceTranscription.trim());  // true

    const realBugSession = {
      storyId: 'test-story',
      startedAt: Date.now(),
      readingAttempt: {
        storyId: 'test-story',
        accuracy: 0,
        fluency: 0,
        cpm: 0,
        mispronouncedWords: [],
        transcription: whitespaceTranscription,  // '   ' — the REAL bug!
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

  // Screenshot full report
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/20-before-whitespace-report.png',
    fullPage: true
  });

  // Scroll to section 2
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/21-before-whitespace-section2.png',
    fullPage: false
  });

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('=== PAGE TEXT (whitespace scenario) ===');
  console.log(pageText.substring(0, 2000));

  const hasFallbackMessage = pageText.includes('語音辨識資料不足');
  const section2Content = await page.locator('text=錄音內容與智能分析').first().locator('..').locator('..').textContent();
  console.log('Section 2 container text:', section2Content?.substring(0, 200));

  console.log('Has fallback message:', hasFallbackMessage);

  // BUG: fallback should appear but doesn't due to whitespace transcription
  // This assertion DOCUMENTS the bug — it will be false (bug exists)
  console.log('BUG CONFIRMED IF FALSE:', hasFallbackMessage ? 'FIXED' : 'BUG STILL EXISTS');
});
