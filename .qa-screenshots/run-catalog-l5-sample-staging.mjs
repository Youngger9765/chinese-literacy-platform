/**
 * Catalog L5 sample QA on staging — spotlight v2 + figure image load.
 * Usage: node .qa-screenshots/run-catalog-l5-sample-staging.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app';
const API = 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

/** Stratified catalog sample (excl dev7/test15 overlap where possible) */
const CATALOG_CODES = [
  'G4-L2',
  'G4-L4',
  'G4-L24',
  'G5-L8',
  'G5-L22',
  'G6-L10',
  'G6-L15',
  'G7-L10',
  'G7-L23',
  'G8-L4',
  'G8-L11',
  'G9-L8',
  '文-L1',
  'G5-L3',
  'G7-L5',
];

const PROBE = () => {
  const b = document.body.innerText || '';
  const btns = [...document.querySelectorAll('button')];
  const radios = document.querySelectorAll('input[type="radio"]').length;
  const textareas = document.querySelectorAll('textarea').length;
  const confirmBtns = btns.filter((x) => x.textContent.trim() === '確認').length;
  const passageLabels = (b.match(/閱讀文本/g) || []).length;
  const dualCol = !!document.querySelector('.lg\\:grid-cols-5');
  const figureLabels = (b.match(/圖[一二三四五六七八九十\d]/g) || []).length;
  const lessonImgs = [...document.querySelectorAll('img')].filter(
    (img) =>
      img.src.includes('lessons-images') ||
      img.src.includes('lingoleap-assets') ||
      (img.alt || '').includes('圖'),
  );
  const loadedImgs = lessonImgs.filter((img) => img.complete && img.naturalWidth > 0);
  const brokenImgs = lessonImgs.filter((img) => img.complete && img.naturalWidth === 0);
  const h2 = document.querySelector('header h2, h2');
  return {
    hasV2: b.includes('閱讀聚光燈'),
    strategyTitle: (h2?.textContent || '').slice(0, 80),
    dualCol,
    passages: passageLabels,
    singles: radios || confirmBtns,
    freeText: textareas,
    figureLabels,
    lessonImgCount: lessonImgs.length,
    loadedImgCount: loadedImgs.length,
    brokenImgCount: brokenImgs.length,
    empty: b.trim().length < 200,
    onLogin: location.pathname.includes('/login'),
    url: location.href,
  };
};

/** Normalize G4-L2 → G4-L02 to match API grade_code */
function normalizeLessonCode(code) {
  const m = code.match(/^(G\d+)-L(\d+)$/);
  if (m) return `${m[1]}-L${String(m[2]).padStart(2, '0')}`;
  return code;
}

async function fetchStoriesIndex() {
  const res = await fetch(`${API}/api/stories?page_size=300`);
  if (!res.ok) throw new Error(`stories list ${res.status}`);
  const data = await res.json();
  const items = data.items || data.stories || data;
  const byCode = new Map();
  for (const s of items) {
    const code = s.lesson_code || s.grade_code;
    if (code) {
      byCode.set(code, s);
      byCode.set(normalizeLessonCode(code), s);
      // also index unpadded variant
      const m = code.match(/^(G\d+)-L0*(\d+)$/);
      if (m) byCode.set(`${m[1]}-L${Number(m[2])}`, s);
    }
  }
  return byCode;
}

async function fetchApi(id) {
  const res = await fetch(`${API}/api/stories/${id}`);
  if (!res.ok) return null;
  const d = await res.json();
  const sv2 = d.spotlight_v2;
  if (!sv2) return { hasSpotlightV2: false, imageCount: (d.images || []).length };
  const blocks = sv2.blocks || [];
  const figureBlocks = blocks.filter((x) => x.type === 'figure');
  const boundAssets = figureBlocks.filter((x) => x.asset).length;
  return {
    hasSpotlightV2: true,
    strategyName: sv2.strategy_name,
    blockCount: blocks.length,
    figures: figureBlocks.length,
    boundFigureAssets: boundAssets,
    imageCount: (d.images || []).length,
    images: (d.images || []).map((i) => i.filename || i.figure_label).slice(0, 5),
  };
}

async function loginStudent(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: /學生/ }).click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 45000 });
  await page.waitForTimeout(500);
}

async function gotoLesson(page, lessonId) {
  await page.goto(`${BASE}/learn/${lessonId}/reading-strategy`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(1000);
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
  if (!probe.hasV2) reasons.push('missing_v2_header');
  if (probe.empty) reasons.push('empty_page');
  if (consoleErrors.length > 0) reasons.push(`console_${consoleErrors.length}`);
  if (api && !api.hasSpotlightV2) reasons.push('api_no_spotlight_v2');
  if (api?.figures > 0 && api.boundFigureAssets < api.figures) {
    reasons.push('unbound_figure_assets');
  }
  if (api?.figures > 0 && api.imageCount === 0) {
    reasons.push('api_missing_images');
  }
  if (api?.figures > 0 && probe.brokenImgCount > 0) {
    reasons.push('broken_figure_img');
  }
  if (api?.figures > 0 && probe.loadedImgCount === 0 && probe.figureLabels > 0) {
    reasons.push('figure_not_rendered');
  }
  if (reasons.length === 0) return { verdict: 'PASS', reasons: [] };
  const hard = reasons.filter((r) => !r.startsWith('console_'));
  return { verdict: hard.length ? 'FAIL' : 'WARN', reasons };
}

async function main() {
  const byCode = await fetchStoriesIndex();
  const lessons = CATALOG_CODES.map((code) => {
    const s = byCode.get(code);
    if (!s) return { code, id: null, missing: true };
    return { code, id: s.id, title: s.title };
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await loginStudent(page);

  const rows = [];
  for (const lesson of lessons) {
    consoleErrors.length = 0;
    if (!lesson.id) {
      rows.push({
        lesson: lesson.code,
        verdict: 'FAIL',
        reasons: ['story_not_in_api'],
        missing: true,
      });
      console.log(`FAIL id=???? ${lesson.code} story_not_in_api`);
      continue;
    }

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
      `${v.padEnd(4)} id=${String(lesson.id).padStart(4)} ${lesson.code.padEnd(8)} v2=${probe.hasV2} fig=${api?.figures || 0} imgs=${probe.loadedImgCount}/${probe.lessonImgCount} apiImg=${api?.imageCount} ${reasons.join(',')}`,
    );
  }

  await browser.close();

  const outJsonl = join(REPO_ROOT, '.qa-screenshots/catalog-l5-sample-qa.jsonl');
  writeFileSync(outJsonl, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const pass = rows.filter((r) => r.verdict === 'PASS').length;
  const warn = rows.filter((r) => r.verdict === 'WARN').length;
  const fail = rows.filter((r) => r.verdict === 'FAIL').length;
  const md = [
    '# Catalog L5 sample QA (staging)',
    '',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    `Result: PASS=${pass} WARN=${warn} FAIL=${fail} / ${rows.length}`,
    '',
    '| code | id | verdict | figures | loaded imgs | reasons |',
    '|------|-----|---------|---------|-------------|---------|',
    ...rows.map(
      (r) =>
        `| ${r.lesson} | ${r.id || '-'} | ${r.verdict} | ${r.api?.figures ?? '-'} | ${r.loadedImgCount ?? '-'} | ${(r.reasons || []).join('; ') || '-'} |`,
    ),
    '',
    `JSONL: ${outJsonl}`,
  ].join('\n');
  writeFileSync(join(REPO_ROOT, '.qa-screenshots/catalog-l5-sample-qa-2026-06-20.md'), md);

  console.log(`\nCatalog L5: PASS=${pass} WARN=${warn} FAIL=${fail} / ${rows.length}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
