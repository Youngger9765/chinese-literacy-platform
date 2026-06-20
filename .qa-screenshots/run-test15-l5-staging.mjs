/**
 * One-off batch L5 QA: test15 spotlight on staging (14 lessons).
 * Usage: node .qa-screenshots/run-test15-l5-staging.mjs
 */
import { chromium } from 'playwright';

const BASE = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';
const LESSONS = [
  { id: 1010, fixture: 'G4-SL10', expect: '推論策略' },
  { id: 6, fixture: 'G4-L13', expect: '換位思考' },
  { id: 1034, fixture: 'G5-SL7', expect: '推論策略' },
  { id: 10, fixture: 'G5-SL10', expect: '推論策略' },
  { id: 1053, fixture: 'G5-L26', expect: '表格' },
  { id: 1057, fixture: 'G6-SL3', expect: '解決問題' },
  { id: 18, fixture: 'G6-SL8', expect: '摘要策略' },
  { id: 22, fixture: 'G6-L14', expect: '自我提問' },
  { id: 33, fixture: 'G7-SL9', expect: '4F' },
  { id: 37, fixture: 'G7-L17', expect: '科學探究' },
  { id: 1098, fixture: 'G7-L19', expect: '自我提問' },
  { id: 1114, fixture: 'G8-SL4', expect: '推論策略' },
  { id: 1118, fixture: 'G8-SL8', expect: '推論策略' },
  { id: 54, fixture: 'G9-SL9', expect: '圖表' },
];

async function loginStudent(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  const btn = page.getByRole('button', { name: /學生.*小明|小明/ });
  await btn.click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await loginStudent(page);

  const results = [];
  for (const lesson of LESSONS) {
    consoleErrors.length = 0;
    const url = `${BASE}/learn/${lesson.id}/reading-strategy`;
    let status = 'PASS';
    let note = '';

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(800);

      const body = await page.locator('body').innerText();
      const hasV2Header = body.includes('閱讀聚光燈');
      const hasStrategy = body.includes(lesson.expect);
      const legacyOnly = body.includes('StrategyExercise') && !hasV2Header;

      if (!hasV2Header) {
        status = 'FAIL';
        note = 'missing 閱讀聚光燈 header (v2 BlockSequenceRenderer)';
      } else if (!hasStrategy) {
        status = 'WARN';
        note = `v2 OK but expected text "${lesson.expect}" not found`;
      }

      if (consoleErrors.length > 0) {
        status = status === 'PASS' ? 'WARN' : status;
        note += (note ? '; ' : '') + `console errors: ${consoleErrors.length}`;
      }
    } catch (err) {
      status = 'FAIL';
      note = String(err.message || err).slice(0, 120);
    }

    results.push({ ...lesson, status, note });
    console.log(`${status.padEnd(4)} id=${String(lesson.id).padStart(4)} ${lesson.fixture} ${note}`);
  }

  await browser.close();

  const pass = results.filter((r) => r.status === 'PASS').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\nL5 summary: PASS=${pass} WARN=${warn} FAIL=${fail} / ${results.length}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
