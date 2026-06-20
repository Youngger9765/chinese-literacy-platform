/**
 * Deep L5 QA: test15 spotlight on staging (dev7-parity probes).
 * Outputs JSONL + summary. Usage: node .qa-screenshots/run-test15-l5-deep-staging.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BASE = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';
const API = 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

const LESSONS = [
  { id: 1010, fixture: 'G4-SL10', code: 'G4-L10' },
  { id: 6, fixture: 'G4-L13', code: 'G4-L13' },
  { id: 1034, fixture: 'G5-SL7', code: 'G5-L7' },
  { id: 10, fixture: 'G5-SL10', code: 'G5-L10' },
  { id: 1053, fixture: 'G5-L26', code: 'G5-L26' },
  { id: 1057, fixture: 'G6-SL3', code: 'G6-L3' },
  { id: 18, fixture: 'G6-SL8', code: 'G6-L08' },
  { id: 22, fixture: 'G6-L14', code: 'G6-L14' },
  { id: 33, fixture: 'G7-SL9', code: 'G7-L09' },
  { id: 37, fixture: 'G7-L17', code: 'G7-L17' },
  { id: 1098, fixture: 'G7-L19', code: 'G7-L19' },
  { id: 1114, fixture: 'G8-SL4', code: 'G8-L3b' },
  { id: 1118, fixture: 'G8-SL8', code: 'G8-L6b' },
  { id: 54, fixture: 'G9-SL9', code: 'G9-L09' },
];

const PROBE = () => {
  const b = document.body.innerText || '';
  const btns = [...document.querySelectorAll('button')];
  const radios = document.querySelectorAll('input[type="radio"]').length;
  const textareas = document.querySelectorAll('textarea').length;
  const confirmBtns = btns.filter((x) => x.textContent.trim() === '確認').length;
  const passageLabels = (b.match(/閱讀文本/g) || []).length;
  const dualCol = !!document.querySelector('.lg\\:grid-cols-5');
  const figures = (b.match(/圖表參考|圖一|圖二|figure/gi) || []).length;
  const spotlightNav = btns.some(
    (x) =>
      (x.getAttribute('aria-label') || '').includes('聚光燈') ||
      x.textContent.includes('閱讀聚光燈'),
  );
  const h2 = document.querySelector('header h2, h2');
  return {
    hasV2: b.includes('閱讀聚光燈'),
    strategyTitle: (h2?.textContent || '').slice(0, 80),
    hasGuide: b.includes('策略') || b.includes('祕訣') || b.includes('步驟') || b.includes('思考'),
    dualCol,
    passages: passageLabels,
    singles: radios || confirmBtns,
    freeText: textareas,
    figures,
    hasSpotlightNav: spotlightNav,
    hasLegacyOnly: !b.includes('閱讀聚光燈') && (b.includes('StrategyExercise') || b.includes('閱讀策略練習')),
    empty: b.trim().length < 200,
    onLogin: location.pathname.includes('/login'),
    url: location.href,
  };
};

async function fetchApi(id) {
  const res = await fetch(`${API}/api/stories/${id}`);
  if (!res.ok) return null;
  const d = await res.json();
  const sv2 = d.spotlight_v2;
  if (!sv2) return { hasSpotlightV2: false };
  const blocks = sv2.blocks || [];
  const countType = (t) => blocks.filter((x) => x.type === t).length;
  return {
    hasSpotlightV2: true,
    strategyName: sv2.strategy_name,
    blockCount: blocks.length,
    guides: countType('guide') + countType('section'),
    passages: countType('passage'),
    singles: blocks.filter((x) => x.type === 'single').length,
    freeText: blocks.filter((x) => x.type === 'free_text').length,
    figures: countType('figure'),
  };
}

async function loginStudent(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: /學生/ }).click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 45000 });
  await page.waitForTimeout(500);
}

async function ensureLoggedIn(page) {
  if (!page.url().includes('/login')) return;
  await loginStudent(page);
}

async function gotoLesson(page, lessonId) {
  await page.goto(`${BASE}/learn/${lessonId}/reading-strategy`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(800);
  if (page.url().includes('/login')) {
    await loginStudent(page);
    await page.goto(`${BASE}/learn/${lessonId}/reading-strategy`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(1200);
  }
}

function verdict(probe, api, consoleErrors) {
  const reasons = [];
  if (probe.onLogin) reasons.push('redirect_login');
  if (probe.hasLegacyOnly) reasons.push('legacy_ui');
  if (!probe.hasV2) reasons.push('missing_v2_header');
  if (probe.empty) reasons.push('empty_page');
  if (consoleErrors.length > 0) reasons.push(`console_${consoleErrors.length}`);
  if (api && !api.hasSpotlightV2) reasons.push('api_no_spotlight_v2');
  if (reasons.length === 0) return { verdict: 'PASS', reasons: [] };
  const hard = reasons.filter((r) => !r.startsWith('console_'));
  return { verdict: hard.length ? 'FAIL' : 'WARN', reasons };
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

  const rows = [];
  for (const lesson of LESSONS) {
    consoleErrors.length = 0;
    const api = await fetchApi(lesson.id);
    let probe = {};
    let err = null;

    try {
      await gotoLesson(page, lesson.id);
      probe = await page.evaluate(PROBE);
    } catch (e) {
      err = String(e.message || e).slice(0, 160);
    }

    const { verdict: v, reasons } = err
      ? { verdict: 'FAIL', reasons: ['navigation_error'] }
      : verdict(probe, api, consoleErrors);

    const row = {
      lesson: lesson.code,
      fixture: lesson.fixture,
      id: String(lesson.id),
      verdict: v,
      reasons,
      error: err,
      ...probe,
      api,
      console_errors: consoleErrors.length,
    };
    rows.push(row);
    console.log(
      `${v.padEnd(4)} id=${String(lesson.id).padStart(4)} ${lesson.fixture.padEnd(8)} v2=${probe.hasV2} dual=${probe.dualCol} pass=${probe.passages} singles=${probe.singles} ft=${probe.freeText} ${reasons.join(',')}`,
    );
  }

  await browser.close();

  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(join(REPO_ROOT, '.qa-screenshots/spotlight-test15-deep-qa.jsonl'), jsonl);

  const pass = rows.filter((r) => r.verdict === 'PASS').length;
  const warn = rows.filter((r) => r.verdict === 'WARN').length;
  const fail = rows.filter((r) => r.verdict === 'FAIL').length;
  console.log(`\nDeep L5: PASS=${pass} WARN=${warn} FAIL=${fail} / ${rows.length}`);
  console.log('JSONL: .qa-screenshots/spotlight-test15-deep-qa.jsonl');
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
