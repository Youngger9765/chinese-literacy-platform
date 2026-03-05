import { test, expect } from '@playwright/test';

const STAGING_URL = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';

/**
 * Issue #173: 逐段朗讀 0% 準確度時報告資料矛盾
 *
 * Bug scenario: readingAttempt with accuracy=0, cpm=143 but empty transcription/lineBreakdown.
 * Expected: All sections with available data should display normally.
 * Actual: Section 2 may show "尚未完成朗讀練習" or be empty despite CPM data existing.
 */
test('Issue #173 - BEFORE: Report with 0% accuracy reading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(STAGING_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.screenshot({
    path: '/tmp/bugfix/issue-173/00-before-homepage.png',
    fullPage: true
  });

  // Navigate into library
  await page.click('button:has-text("進入圖書館")');
  await page.waitForTimeout(2000);

  await page.screenshot({
    path: '/tmp/bugfix/issue-173/01-before-library.png',
    fullPage: true
  });

  // Click a story card
  const cards = page.locator('button, [role="button"], .cursor-pointer');
  const count = await cards.count();
  console.log(`Found ${count} clickable elements`);

  // Try to find story cards and click one
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
  if (!clicked) {
    // Just click the second item (skip first button which might be home)
    await cards.nth(1).click();
  }
  await page.waitForTimeout(2000);

  await page.screenshot({
    path: '/tmp/bugfix/issue-173/02-before-story-selected.png',
    fullPage: true
  });

  // Inject buggy session state using React internals
  // React 18 uses __reactContainer$ for root, but __reactFiber$ for elements
  const result = await page.evaluate(() => {
    // Find any React element to get the fiber
    function getFiber(el: Element): any {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (key) return (el as any)[key];
      return null;
    }

    // Walk up from root to find App fiber
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

        // App has view as first hook (string from AppView enum)
        // and has enough hooks (at least 4: view, selectedStory, lastAttempt, session)
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

    // Try to get fiber from various elements
    const elements = [
      document.querySelector('#root > div'),
      document.querySelector('header'),
      document.querySelector('main'),
      document.querySelector('[class*="h-screen"]'),
      document.querySelector('[class*="flex"]'),
    ];

    let dispatchers: any[] | null = null;
    for (const el of elements) {
      if (!el) continue;
      const fiber = getFiber(el);
      if (!fiber) continue;
      // Walk up the fiber tree (return chain)
      let f = fiber;
      while (f && !dispatchers) {
        dispatchers = findAppDispatchers(f, 0);
        f = f.return;
      }
      if (dispatchers) break;
    }

    if (!dispatchers) {
      // Try walking all elements
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
    }

    if (!dispatchers) {
      return { error: 'dispatchers not found after exhaustive search' };
    }

    // Bug scenario from issue #173:
    // Student reads with ~0% accuracy, gets CPM=143 (data exists), but everything is wrong
    // transcription is empty (speech recognition returns nothing useful at 0% accuracy)
    // lineBreakdown is empty (no line-by-line data)
    const buggySession = {
      storyId: 'test-story',
      startedAt: Date.now(),
      readingAttempt: {
        storyId: 'test-story',
        accuracy: 0,
        fluency: 0,
        cpm: 143,
        mispronouncedWords: ['山', '高', '大', '水', '力'],
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
      dispatchers[3].dispatch(buggySession);  // session
      dispatchers[0].dispatch('REPORT');       // view
      return { success: true, hookCount: dispatchers.length };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  console.log('Injection result:', JSON.stringify(result));
  await page.waitForTimeout(2000);

  // Take full-page screenshot of report
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/03-before-report-full.png',
    fullPage: true
  });

  // Viewport screenshot (visible area)
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/04-before-report-viewport.png',
    fullPage: false
  });

  // Scroll to section 2 area
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/05-before-section2.png',
    fullPage: false
  });

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('=== PAGE TEXT ===');
  console.log(pageText.substring(0, 1000));

  const hasReport = pageText.includes('朗讀結果總覽') || pageText.includes('恭喜完成練習');
  const hasSection2 = pageText.includes('錄音內容與智能分析');
  const hasNotCompleted = pageText.includes('尚未完成朗讀練習');
  const hasScore = pageText.includes('綜合成績');

  console.log('Has report:', hasReport);
  console.log('Has section 2:', hasSection2);
  console.log('Has "尚未完成":', hasNotCompleted);
  console.log('Has overall score:', hasScore);

  // Injection should have worked
  if ((result as any).error) {
    console.log('ERROR: State injection failed:', (result as any).error);
  }

  // Take a final screenshot regardless
  await page.screenshot({
    path: '/tmp/bugfix/issue-173/06-before-final.png',
    fullPage: true
  });
});
