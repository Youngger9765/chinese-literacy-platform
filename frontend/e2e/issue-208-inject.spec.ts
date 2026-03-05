/**
 * PR #208 State Injection - Find App fiber correctly
 * The root element uses __reactContainer$, not __reactFiber$
 * We need to find a non-root element to get the fiber key
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

test('Inject session and verify collapsible sections', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Navigate to library and select a story to establish session context
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);

  // Select first story
  let storySelected = false;
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) {
      await card.click();
      storySelected = true;
      console.log('Selected story:', text?.substring(0, 50));
      break;
    }
  }
  await page.waitForTimeout(2000);

  // Inject state using React fiber - find fiber from a non-root element
  const result = await page.evaluate(() => {
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
        totalChars: 5,
        practicedChars: ['戴', '資', '穎'],
      },
      fullReadingResult: {
        matchRate: 0.82,
        transcript: '代資穎第一名台灣第一人',
        diffTokens: [
          { type: 'wrong', char: '代', expected: '戴' },
        ],
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

    // Find a non-root element that has __reactFiber$ key
    const allEls = Array.from(document.querySelectorAll('*'));
    let fiberKey: string | null = null;
    let fiberNode: any = null;

    for (const el of allEls) {
      const keys = Object.getOwnPropertyNames(el);
      const k = keys.find(k => k.startsWith('__reactFiber$'));
      if (k) {
        fiberKey = k;
        fiberNode = (el as any)[k];
        break;
      }
    }

    if (!fiberKey || !fiberNode) return { error: 'No reactFiber found on any element' };

    // Traverse up the fiber tree to find App component
    const findComponent = (node: any, componentName: string, maxDepth = 200): any => {
      let current = node;
      let depth = 0;
      while (current && depth < maxDepth) {
        if (current.type && typeof current.type === 'function' &&
            current.type.name === componentName) {
          return current;
        }
        // Try parent (return)
        current = current.return;
        depth++;
      }
      return null;
    };

    const appFiber = findComponent(fiberNode, 'App');
    if (!appFiber) {
      // Try finding any component with setState that has view state
      // Look for the component name differently - in minified builds, names might be different
      let current = fiberNode;
      const componentNames: string[] = [];
      while (current) {
        if (current.type?.name) componentNames.push(current.type.name);
        current = current.return;
      }
      return { error: 'App not found', componentNames: componentNames.slice(0, 20), fiberKey };
    }

    // Found App! Now get the dispatchers
    const dispatchers: Function[] = [];
    let hook = appFiber.memoizedState;
    let hookIndex = 0;
    const hookInfo: any[] = [];

    while (hook) {
      const info: any = {
        index: hookIndex,
        hasDispatch: !!hook.queue?.dispatch,
        type: typeof hook.memoizedState,
      };
      if (hook.memoizedState !== null && hook.memoizedState !== undefined) {
        if (typeof hook.memoizedState === 'string') info.value = hook.memoizedState;
        else if (typeof hook.memoizedState === 'number') info.value = hook.memoizedState;
        else if (typeof hook.memoizedState === 'boolean') info.value = hook.memoizedState;
        else if (hook.memoizedState === null) info.value = null;
        else info.value = '(object)';
      }
      hookInfo.push(info);

      if (hook.queue?.dispatch) {
        dispatchers.push(hook.queue.dispatch);
      }
      hook = hook.next;
      hookIndex++;
    }

    if (dispatchers.length < 4) {
      return { error: `only ${dispatchers.length} dispatchers`, hookInfo };
    }

    // Dispatch state updates
    // The order in App.tsx is:
    // useState<AppView>(AppView.HOME)        -> hook 0
    // useState<Story|null>(null)              -> hook 1
    // useState<ReadingAttempt|null>(null)     -> hook 2
    // useState<LearningSession|null>(null)    -> hook 3
    // useState<string>('')                   -> hook 4 (writingChar)
    // useState<string>('')                   -> hook 5 (writeInput)
    // useState<number>(320)                  -> hook 6 (rightPanelWidth)

    try {
      dispatchers[0]('REPORT');       // setView = REPORT
      dispatchers[1](mockStory);      // setSelectedStory
      dispatchers[3](mockSession);    // setSession
      return {
        success: true,
        dispatcherCount: dispatchers.length,
        hookInfo,
      };
    } catch (e: any) {
      return { error: e.message, hookInfo };
    }
  });

  console.log('Injection result:', JSON.stringify(result, null, 2));

  await page.waitForTimeout(3000);
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'inject-01-after-dispatch.png'),
    fullPage: true
  });

  const bodyText = await page.textContent('body');
  console.log('Body after injection:', bodyText?.substring(0, 500));

  // Check if report sections are visible
  const sections = await page.evaluate(() => {
    return {
      ariaExpanded: Array.from(document.querySelectorAll('[aria-expanded]')).map(el => ({
        text: el.textContent?.trim().substring(0, 80),
        expanded: el.getAttribute('aria-expanded'),
      })),
      chevrons: Array.from(document.querySelectorAll('svg')).filter(s =>
        s.querySelector('path')?.getAttribute('d')?.includes('M19 9')
      ).map(s => ({
        class: s.className?.baseVal,
      })),
    };
  });
  console.log('Sections:', JSON.stringify(sections, null, 2));
});

test('Direct fiber traverse - find all component names', async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    // Find any element with __reactFiber$
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

    if (!fiberKey) return { error: 'no fiber key found' };

    // Walk up to root collecting component names
    const names: string[] = [];
    let current = startFiber;
    let depth = 0;
    while (current && depth < 500) {
      if (current.type) {
        const name = current.type.name || current.type.displayName || (typeof current.type === 'string' ? current.type : null);
        if (name) names.push(name);
      }
      current = current.return;
      depth++;
    }

    return { fiberKey, names: names.slice(0, 40), depth };
  });

  console.log('Component tree:', JSON.stringify(result, null, 2));
});

test('Check if production build minifies function names', async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check if React is in development or production mode
  const devMode = await page.evaluate(() => {
    return {
      // React 16+ stores this
      isDev: typeof (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined',
      // Check for any global React instance
      hasReact: typeof (window as any).React !== 'undefined',
      // Check process.env
      nodeEnv: typeof process !== 'undefined' ? (process as any).env?.NODE_ENV : 'unknown',
    };
  });
  console.log('Dev mode info:', devMode);

  // Check source maps
  const response = await page.request.get(PREVIEW_URL);
  const html = await response.text();
  const jsFiles = html.match(/src="([^"]*\.js)"/g) || [];
  console.log('JS files found:', jsFiles.slice(0, 5));
});
