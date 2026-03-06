/**
 * PR #208 - K7 is the minified name of App component
 * Need to find it and inject state
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

test('Find K7 (App) fiber and inject session', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Navigate to library and select story
  await page.locator('text=進入圖書館').click();
  await page.waitForTimeout(2000);
  for (const card of await page.locator('[class*="rounded-xl"][class*="cursor"]').all()) {
    const text = await card.textContent();
    if (text && /年級/.test(text)) {
      await card.click();
      console.log('Selected:', text?.substring(0, 40));
      break;
    }
  }
  await page.waitForTimeout(2000);

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

    // Find ALL elements and search for any element with a fiber key that traverses to K7
    const allEls = Array.from(document.querySelectorAll('*'));
    let K7Fiber: any = null;
    let foundFiberKey: string | null = null;

    for (const el of allEls) {
      const keys = Object.getOwnPropertyNames(el);
      const k = keys.find(k => k.startsWith('__reactFiber$'));
      if (!k) continue;
      const fiber = (el as any)[k];

      // Walk UP the fiber tree to find K7
      let current = fiber;
      let depth = 0;
      while (current && depth < 500) {
        if (current.type?.name === 'K7') {
          K7Fiber = current;
          foundFiberKey = k;
          break;
        }
        current = current.return;
        depth++;
      }
      if (K7Fiber) break;
    }

    if (!K7Fiber) {
      // Collect all unique component names from all fibers we can find
      const allNames = new Set<string>();
      for (const el of allEls.slice(0, 100)) {
        const keys = Object.getOwnPropertyNames(el);
        const k = keys.find(k => k.startsWith('__reactFiber$'));
        if (!k) continue;
        let current = (el as any)[k];
        let d = 0;
        while (current && d < 100) {
          if (current.type?.name) allNames.add(current.type.name);
          current = current.return;
          d++;
        }
      }
      return { error: 'K7 not found', allComponentNames: Array.from(allNames) };
    }

    // Get dispatchers from K7 (App)
    const dispatchers: Function[] = [];
    const hookInfo: any[] = [];
    let hook = K7Fiber.memoizedState;
    let i = 0;
    while (hook) {
      const info: any = { index: i, hasDispatch: !!hook.queue?.dispatch, stateType: typeof hook.memoizedState };
      if (typeof hook.memoizedState === 'string') info.value = hook.memoizedState;
      if (typeof hook.memoizedState === 'number') info.value = hook.memoizedState;
      hookInfo.push(info);
      if (hook.queue?.dispatch) dispatchers.push(hook.queue.dispatch);
      hook = hook.next;
      i++;
    }

    if (dispatchers.length < 4) {
      return { error: `Only ${dispatchers.length} dispatchers`, hookInfo };
    }

    // Dispatch: view=REPORT, selectedStory=mockStory, session=mockSession
    try {
      dispatchers[0]('REPORT');
      dispatchers[1](mockStory);
      dispatchers[3](mockSession);
      return { success: true, count: dispatchers.length, hookInfo };
    } catch (e: any) {
      return { error: e.message, hookInfo };
    }
  });

  console.log('Injection result:', JSON.stringify(result, null, 2));
  await page.waitForTimeout(3000);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'K7-01-after-inject.png'),
    fullPage: true
  });

  const body = await page.textContent('body');
  console.log('Body after inject:', body?.substring(0, 500));
});

test('Traverse fiber tree more deeply to find all names', async ({ page }) => {
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const allEls = Array.from(document.querySelectorAll('*'));
    const allNames = new Set<string>();
    let maxDepth = 0;

    for (const el of allEls) {
      const keys = Object.getOwnPropertyNames(el);
      const k = keys.find(k => k.startsWith('__reactFiber$'));
      if (!k) continue;

      let current = (el as any)[k];
      let d = 0;
      while (current && d < 500) {
        if (current.type?.name) allNames.add(current.type.name);
        else if (typeof current.type === 'function') {
          // Unnamed function
          allNames.add(`[fn:${current.type.toString().substring(0, 30)}]`);
        }
        current = current.return;
        d++;
      }
      if (d > maxDepth) maxDepth = d;
    }

    return { names: Array.from(allNames), maxDepth };
  });

  console.log('All component names found:', JSON.stringify(result, null, 2));
});
