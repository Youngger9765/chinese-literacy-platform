/**
 * PR #208 Final Visual Verification
 * Strategy: Select a story, navigate to intro, then use "6報告" nav button
 * to get to the hasNoData empty state — then verify the Section component
 * structure by examining the source code behavior via JS injection of
 * a mock LearningSession directly into the React component state.
 *
 * Alternative: Use the React __SECRET_INTERNALS to find and update state.
 */
import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PREVIEW_URL = 'https://lingoleap-frontend-issue-208-oja2sffiya-de.a.run.app';
const EVIDENCE_DIR = '/Users/young/project/chinese-literacy-platform/.claude/evidence/issue-208';

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
});

async function selectStoryAndGoToReport(page: Page) {
  // 1. Load home
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // 2. Go to library
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // 3. Click first story card (DIV with cursor-pointer class in the library grid)
  const firstStoryCard = page.locator('div.cursor-pointer, [class*="cursor-pointer"]').first();
  await firstStoryCard.click();
  await page.waitForTimeout(2000);

  // Now we should be on Intro page with a story selected
  // At this point, session is created with storyId set
}

test('A: Verify report page accessible via stepper after selecting story', async ({ page }) => {
  await selectStoryAndGoToReport(page);

  // Take screenshot of intro page
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'A1-intro-page.png'),
    fullPage: true
  });

  const bodyText = await page.textContent('body');
  console.log('Current page content:', bodyText?.substring(0, 300));

  // Now navigate to Step 6 Report via the stepper
  const reportBtn = page.locator('header button').filter({ hasText: '報告' });
  console.log('Report button count:', await reportBtn.count());
  const isDisabled = await reportBtn.first().isDisabled();
  console.log('Report button disabled?', isDisabled);

  if (!isDisabled) {
    await reportBtn.first().click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'A2-report-no-data.png'),
    fullPage: true
  });
});

test('B: Inject mock session via React internal state update', async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Go to library
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // Click first story card to establish a session
  const firstCard = page.locator('div').filter({ hasText: /年級/ }).first();
  await firstCard.locator('.cursor-pointer, [class*="cursor-pointer"]').first().click().catch(async () => {
    // If that fails, just click the first cursor-pointer div
    await page.locator('.cursor-pointer').first().click();
  });
  await page.waitForTimeout(2000);

  // Try to find the React root fiber and traverse to inject state
  const result = await page.evaluate(() => {
    // Look for __reactFiber$ keys on DOM elements
    const rootEl = document.getElementById('root');
    if (!rootEl) return { error: 'no root' };

    // In React 18+, look for __reactFiber$<randomId>
    const allKeys = Object.keys(rootEl);
    const fiberKeys = allKeys.filter(k => k.includes('__reactFiber') || k.includes('__reactInternalInstance') || k.includes('_reactRootContainer'));
    return { keys: fiberKeys, allKeysCount: allKeys.length };
  });

  console.log('Root element keys:', result);

  // Try accessing via __react_root
  const fiberResult = await page.evaluate(() => {
    const rootEl = document.getElementById('root');
    if (!rootEl) return null;

    // React 18 root
    const reactRoot = (rootEl as any)._reactRootContainer;
    if (reactRoot) return { type: 'legacy', found: true };

    // React 18+ concurrent mode
    const keys = Object.getOwnPropertyNames(rootEl);
    const fiberKey = keys.find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return { type: 'none', keys: keys.slice(0, 5) };

    const fiber = (rootEl as any)[fiberKey];
    // Traverse to find a component with 'setView' or 'session' state
    const traverse = (node: any, depth = 0): any => {
      if (!node || depth > 100) return null;
      if (node.memoizedState && node.stateNode) {
        return { found: true, type: node.type?.name, depth };
      }
      return traverse(node.child, depth + 1) || traverse(node.sibling, depth + 1);
    };

    return traverse(fiber);
  });

  console.log('Fiber result:', JSON.stringify(fiberResult));
});

test('C: Navigate to report and verify section structure via DOM inspection', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Navigate to library and select a story
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // Click the first story card in the library grid
  // From test output, cards have class "bg-white rounded-xl overflow-hidden border border-gray-200 hover:border-accent transition-all cursor"
  const storyCards = page.locator('.cursor-pointer').all();
  const cards = await storyCards;

  // Filter to cards that are story cards (not nav buttons)
  // The library cards have aria or contain grade info
  let storyClicked = false;
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) {
      await card.click();
      storyClicked = true;
      console.log('Clicked story card:', text?.substring(0, 50));
      break;
    }
  }

  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'C1-after-story-select.png'),
    fullPage: true
  });

  // Should now be on intro page, session created
  const bodyText = await page.textContent('body');
  console.log('After story select:', bodyText?.substring(0, 200));

  // Navigate to report via stepper
  await page.locator('header button').filter({ hasText: '報告' }).click();
  await page.waitForTimeout(2000);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'C2-report-empty-state.png'),
    fullPage: true
  });

  console.log('Empty state report - need reading data to show sections');
  console.log('Report content:', (await page.textContent('body'))?.substring(0, 300));

  // Since we cannot complete a reading without microphone, we need to inject
  // a mock session. Let's try manipulating window.__APP_STATE or similar debug hooks.
  // Check if there's any debug mode or test data feature
  const hasDebugMode = await page.evaluate(() => {
    return typeof (window as any).__REACT_DEBUG !== 'undefined' ||
           typeof (window as any).__APP_STATE !== 'undefined' ||
           typeof (window as any).__SET_SESSION !== 'undefined';
  });
  console.log('Has debug mode:', hasDebugMode);
});

test('D: Verify Section collapsible component via source analysis', async ({ page }) => {
  /**
   * Since we can't easily inject React state into a production build,
   * we'll verify the Section component behavior by:
   * 1. Checking the rendered HTML/DOM structure when we reach the report page
   * 2. Looking for chevron SVGs (the rotate class is the key indicator)
   * 3. Verifying aria-expanded attributes
   * 4. Testing toggle behavior if we can reach the report with data
   *
   * The PR source code was already verified to have the correct implementation:
   * - Section 1: defaultOpen={true}
   * - Section 2: defaultOpen={false}
   * - Section 3: defaultOpen={false}
   * - Section 4: defaultOpen={true}
   * - Section 5: defaultOpen={false}
   * - Section 6: defaultOpen={false} + disabled
   */
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Go to library -> select story -> get to intro
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // Find and click a story card
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) {
      await card.click();
      console.log('Selected story:', text?.substring(0, 50));
      break;
    }
  }
  await page.waitForTimeout(2000);

  // Navigate to report
  await page.locator('header button').filter({ hasText: '報告' }).click();
  await page.waitForTimeout(2000);

  // We're at the empty state - let's check the DOM for the Section component structure
  const sectionData = await page.evaluate(() => {
    // Look for sections with the expected structure
    const sections = document.querySelectorAll('[role="button"][aria-expanded]');
    return Array.from(sections).map(s => ({
      text: s.textContent?.trim().substring(0, 100),
      ariaExpanded: s.getAttribute('aria-expanded'),
      hasChevron: !!s.querySelector('svg'),
    }));
  });
  console.log('Sections with aria-expanded:', JSON.stringify(sectionData));

  // Also check for SVG chevrons
  const chevrons = await page.evaluate(() => {
    const svgs = document.querySelectorAll('svg');
    return Array.from(svgs).map(s => ({
      class: s.className?.baseVal,
      pathD: s.querySelector('path')?.getAttribute('d'),
    })).filter(s => s.pathD?.includes('M19 9'));
  });
  console.log('Chevron SVGs:', JSON.stringify(chevrons));

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'D1-report-dom-inspection.png'),
    fullPage: true
  });
});

test('E: Mock session injection attempt via React internals (production build)', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Inject mock session via React setState override trick
  // This involves finding the App component fiber and calling setState
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // Select a story first to create session state
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) {
      await card.click();
      break;
    }
  }
  await page.waitForTimeout(2000);

  // Now try to find React fiber and dispatch state update
  const injectionResult = await page.evaluate(() => {
    // Search for React fiber on various DOM elements
    const allElements = document.querySelectorAll('*');
    let fiberKey: string | null = null;
    let fiberNode: any = null;

    for (const el of Array.from(allElements).slice(0, 20)) {
      const keys = Object.getOwnPropertyNames(el);
      const key = keys.find(k => k.startsWith('__reactFiber'));
      if (key) {
        fiberKey = key;
        fiberNode = (el as any)[key];
        break;
      }
    }

    if (!fiberKey || !fiberNode) return { error: 'No fiber found on any element' };

    // Walk up to find App component
    const traverseUp = (node: any, depth = 0): any => {
      if (!node || depth > 200) return null;
      if (node.type && typeof node.type === 'function' && node.type.name === 'App') {
        return node;
      }
      return traverseUp(node.return, depth + 1);
    };

    const appFiber = traverseUp(fiberNode);
    if (!appFiber) return { error: 'App fiber not found', fiberKey };

    // Get the queue for setState
    let stateNode = appFiber.memoizedState;
    const states = [];
    while (stateNode) {
      states.push({
        memoizedState: typeof stateNode.memoizedState === 'object' ? 'object' : typeof stateNode.memoizedState,
        queue: stateNode.queue ? 'present' : 'absent',
      });
      stateNode = stateNode.next;
    }
    return { found: true, states };
  });

  console.log('Fiber injection result:', JSON.stringify(injectionResult));

  // If fiber found, try the dispatch approach
  if ((injectionResult as any).found) {
    const dispatchResult = await page.evaluate(() => {
      // Mock session with reading data
      const mockSession = {
        storyId: 'test-story',
        startedAt: Date.now(),
        introCompleted: true,
        readingAttempt: {
          storyId: 'test-story',
          accuracy: 78,
          fluency: 70,
          cpm: 120,
          mispronouncedWords: ['戴', '資'],
          transcription: '這是一段測試的朗讀文字',
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
              ],
            },
            {
              lineIndex: 1,
              lineText: '台灣第一人',
              transcript: '台灣第一人',
              matchRate: 1.0,
              diffTokens: [],
            },
          ],
        },
        comprehensionResult: {
          understoodCount: 3,
          requiredCount: 5,
          questions: [],
        },
        vocabResult: {
          totalWords: 10,
          practicedWords: ['戴', '資', '穎', '累', '計'],
        },
        fullReadingResult: {
          matchRate: 0.82,
          transcript: '測試全文朗讀',
          diffTokens: [],
        },
      };

      // Find React fiber
      const allElements = document.querySelectorAll('*');
      let fiberKey: string | null = null;
      let fiberNode: any = null;

      for (const el of Array.from(allElements).slice(0, 50)) {
        const keys = Object.getOwnPropertyNames(el);
        const key = keys.find(k => k.startsWith('__reactFiber'));
        if (key) {
          fiberKey = key;
          fiberNode = (el as any)[key];
          break;
        }
      }

      if (!fiberKey) return { error: 'no fiber' };

      // Traverse to App
      const traverseUp = (node: any, depth = 0): any => {
        if (!node || depth > 200) return null;
        if (node.type && typeof node.type === 'function' && node.type.name === 'App') {
          return node;
        }
        return traverseUp(node.return, depth + 1);
      };

      const appFiber = traverseUp(fiberNode);
      if (!appFiber) return { error: 'no app fiber' };

      // Get state hooks
      let hook = appFiber.memoizedState;
      const dispatchers: any[] = [];
      while (hook) {
        if (hook.queue && hook.queue.dispatch) {
          dispatchers.push(hook.queue.dispatch);
        }
        hook = hook.next;
      }

      if (dispatchers.length < 4) return { error: `insufficient dispatchers: ${dispatchers.length}` };

      // App state order (based on App.tsx useState order):
      // 0: view (AppView)
      // 1: selectedStory
      // 2: lastAttempt
      // 3: session
      // 4: writingChar
      // 5: writeInput
      // 6: rightPanelWidth

      // Set session (dispatcher index 3)
      try {
        dispatchers[3](mockSession);
        dispatchers[0]('REPORT'); // Set view to REPORT
        dispatchers[1]({ id: 'test-story', title: '贏得喝采的輸家', level: 4, content: '測試' }); // Set selectedStory
        return { success: true, dispatcherCount: dispatchers.length };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    console.log('Dispatch result:', JSON.stringify(dispatchResult));
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'E1-after-injection.png'),
      fullPage: true
    });
  }
});

test('F: Final verification - Section chevrons and collapse behavior', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Full navigation flow + state injection
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // Select first story
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) {
      await card.click();
      break;
    }
  }
  await page.waitForTimeout(2000);

  // Inject mock session via React fiber dispatch
  const injected = await page.evaluate(() => {
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
            ],
          },
        ],
      },
      comprehensionResult: {
        understoodCount: 3,
        requiredCount: 5,
        questions: [],
      },
      vocabResult: {
        totalWords: 5,
        practicedWords: ['戴', '資', '穎'],
      },
      fullReadingResult: {
        matchRate: 0.82,
        transcript: '代資穎第一名台灣第一人',
        diffTokens: [
          { type: 'wrong', char: '代', expected: '戴' },
        ],
      },
    };

    // Find fiber
    const allEls = document.querySelectorAll('*');
    let fiber: any = null;
    for (const el of Array.from(allEls)) {
      const k = Object.getOwnPropertyNames(el).find(k => k.startsWith('__reactFiber'));
      if (k) { fiber = (el as any)[k]; break; }
    }
    if (!fiber) return { error: 'no fiber' };

    // Find App fiber by traversing up
    const findApp = (n: any, d = 0): any => {
      if (!n || d > 200) return null;
      if (n.type?.name === 'App') return n;
      return findApp(n.return, d + 1);
    };

    const app = findApp(fiber);
    if (!app) return { error: 'no app' };

    // Collect dispatchers in order
    const dispatchers: Function[] = [];
    let h = app.memoizedState;
    while (h) {
      if (h.queue?.dispatch) dispatchers.push(h.queue.dispatch);
      h = h.next;
    }

    if (dispatchers.length < 4) return { error: `only ${dispatchers.length} dispatchers` };

    // Dispatch in correct order (based on App.tsx useState declarations):
    // useState<AppView>(AppView.HOME) -> index 0
    // useState<Story|null>(null) -> index 1
    // useState<ReadingAttempt|null>(null) -> index 2
    // useState<LearningSession|null>(null) -> index 3
    dispatchers[0]('REPORT');     // setView
    dispatchers[1]({ id: 'story-001', title: '贏得喝采的輸家', grade: 4, content: [], vocabulary: [], focusChars: [] }); // setSelectedStory
    dispatchers[3](mockSession);  // setSession

    return { success: true, count: dispatchers.length };
  });

  console.log('Injection result:', JSON.stringify(injected));
  await page.waitForTimeout(2000);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'F1-report-with-data.png'),
    fullPage: true
  });

  const bodyText = await page.textContent('body');
  console.log('Report body after injection:', bodyText?.substring(0, 500));

  // Check for section headers with chevrons
  const sections = await page.evaluate(() => {
    // Find all elements with aria-expanded
    const expanded = document.querySelectorAll('[aria-expanded]');
    return Array.from(expanded).map(el => ({
      text: el.textContent?.trim().substring(0, 80),
      ariaExpanded: el.getAttribute('aria-expanded'),
      hasRotatedChevron: !!el.querySelector('.rotate-180'),
    }));
  });
  console.log('Sections found:', JSON.stringify(sections, null, 2));

  if (sections.length > 0) {
    // We have sections! Verify default state
    console.log('SUCCESS: Found collapsible sections on report page');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'F2-sections-visible.png'),
      fullPage: true
    });

    // Click a collapsed section to expand it
    const collapsedSection = page.locator('[aria-expanded="false"]').first();
    if (await collapsedSection.count() > 0) {
      await collapsedSection.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'F3-after-expand.png'),
        fullPage: true
      });
      console.log('Clicked collapsed section to expand');
    }

    // Click an expanded section to collapse it
    const expandedSection = page.locator('[aria-expanded="true"]').first();
    if (await expandedSection.count() > 0) {
      await expandedSection.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, 'F4-after-collapse.png'),
        fullPage: true
      });
      console.log('Clicked expanded section to collapse');
    }
  }
});
