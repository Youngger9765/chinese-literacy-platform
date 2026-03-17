#!/usr/bin/env node
/**
 * E2E Report Generator for LingoLeap
 *
 * Reads Playwright JSON results + screenshot sidecar captions,
 * inlines all images as base64, and produces a single self-contained
 * e2e-report.html using the report-template.html template.
 *
 * Usage:
 *   npx tsx e2e/scripts/generate-report.ts
 *
 * Inputs:
 *   test-results/results.json        — Playwright JSON reporter output
 *   e2e/screenshots/<module>/*.png   — screenshots taken during tests
 *   e2e/screenshots/<module>/*.caption.json — caption sidecar files
 *   e2e/report-template.html         — HTML template with {{PLACEHOLDER}} markers
 *
 * Output:
 *   e2e-report.html (in frontend root)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Paths (all resolved from the frontend/ root = cwd of the script)
// ESM-compatible __dirname replacement
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const FRONTEND_DIR = path.resolve(__dirname, '../..');
const RESULTS_PATH = path.join(FRONTEND_DIR, 'test-results', 'results.json');
const SCREENSHOTS_DIR = path.join(FRONTEND_DIR, 'e2e', 'screenshots');
const TEMPLATE_PATH = path.join(FRONTEND_DIR, 'e2e', 'report-template.html');
const OUTPUT_PATH = path.join(FRONTEND_DIR, 'e2e-report.html');

// ---------------------------------------------------------------------------
// Types matching Playwright JSON reporter output
// ---------------------------------------------------------------------------

interface PlaywrightTestResult {
  status: 'expected' | 'unexpected' | 'skipped' | 'flaky';
  startTime?: string;
  duration?: number;
  error?: { message?: string; stack?: string };
  attachments?: Array<{ name: string; contentType: string; path?: string; body?: string }>;
}

interface PlaywrightSpec {
  title: string;
  ok: boolean;
  tests: PlaywrightTestResult[];
  line?: number;
  column?: number;
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
  line?: number;
}

interface PlaywrightResults {
  suites: PlaywrightSuite[];
  stats?: {
    expected?: number;
    unexpected?: number;
    skipped?: number;
    flaky?: number;
    duration?: number;
    startTime?: string;
  };
}

// ---------------------------------------------------------------------------
// Spec file → tab mapping
// ---------------------------------------------------------------------------

interface TabDef {
  id: string;
  label: string;
  specPatterns: string[];
}

const TAB_DEFS: TabDef[] = [
  {
    id: 'teacher',
    label: '🧑‍🏫 教師測試 (#360)',
    specPatterns: ['teacher'],
  },
  {
    id: 'student',
    label: '🧑‍🎓 學生測試 (#361)',
    specPatterns: ['student', 'm1-auth', 'm2-student', 'm3-learning'],
  },
  {
    id: 'admin',
    label: '🏫 管理員測試 (#362)',
    specPatterns: ['admin', 'm5-admin'],
  },
  {
    id: 'infra',
    label: '🔧 非功能性 (#363)',
    specPatterns: ['infra', 'm6-misc', 'preview'],
  },
];

// Journey letter prefix mapping per tab
const JOURNEY_PREFIXES: Record<string, string[]> = {
  teacher: ['A', 'B', 'C', 'D'],
  student: ['E', 'F', 'G'],
  admin: ['H'],
  infra: ['N'],
};

// ---------------------------------------------------------------------------
// Screenshot + caption helpers
// ---------------------------------------------------------------------------

interface CaptionData {
  name: string;
  caption: string;
  module: string;
}

/** Walk all screenshot directories and build a name → { imgBase64, caption } map. */
function buildScreenshotMap(): Map<string, { imgBase64: string; caption: string }> {
  const map = new Map<string, { imgBase64: string; caption: string }>();

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    return map;
  }

  const modules = fs.readdirSync(SCREENSHOTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const mod of modules) {
    const modDir = path.join(SCREENSHOTS_DIR, mod);
    const files = fs.readdirSync(modDir);

    for (const file of files) {
      if (!file.endsWith('.png')) continue;

      const name = path.basename(file, '.png');
      const imgPath = path.join(modDir, file);
      const captionPath = path.join(modDir, `${name}.caption.json`);

      let caption = '';
      if (fs.existsSync(captionPath)) {
        try {
          const data: CaptionData = JSON.parse(fs.readFileSync(captionPath, 'utf-8'));
          caption = data.caption ?? '';
        } catch {
          // ignore malformed JSON
        }
      }

      try {
        const imgBuffer = fs.readFileSync(imgPath);
        const imgBase64 = `data:image/png;base64,${imgBuffer.toString('base64')}`;
        map.set(name, { imgBase64, caption });
      } catch {
        // ignore unreadable images
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Test result normalization
// ---------------------------------------------------------------------------

type TestStatus = 'pass' | 'skip' | 'fail';

interface NormalizedTest {
  title: string;
  status: TestStatus;
  describe: string;
  specFile: string;
  screenshotName?: string;
}

function resolveStatus(tests: PlaywrightTestResult[]): TestStatus {
  if (tests.length === 0) return 'skip';
  const statuses = tests.map(t => t.status);
  if (statuses.some(s => s === 'unexpected')) return 'fail';
  if (statuses.every(s => s === 'skipped')) return 'skip';
  return 'pass';
}

/**
 * Derive a likely screenshot name from a test title.
 * The convention in fixtures.ts is:  "{module}-{seq}-{slug}"
 * We try to match by converting the test title to slug format.
 */
function deriveScreenshotName(specFile: string, describeTitle: string, testTitle: string): string {
  // Extract module prefix from spec file (e.g. "teacher-flow" → "teacher")
  const base = path.basename(specFile, '.spec.ts').replace(/-flow$/, '').replace(/-dashboard$/, '');

  // Combine describe + test title for slugging
  const combined = `${describeTitle} ${testTitle}`
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${base}-${combined}`;
}

/** Flatten all specs from a suite tree. */
function flattenSpecs(
  suite: PlaywrightSuite,
  specFile: string,
  describePath: string[]
): NormalizedTest[] {
  const results: NormalizedTest[] = [];
  const currentDescribe = suite.title
    ? [...describePath, suite.title]
    : describePath;

  if (suite.specs) {
    for (const spec of suite.specs) {
      const status = resolveStatus(spec.tests ?? []);
      const describeTitle = currentDescribe.join(' > ');
      results.push({
        title: spec.title,
        status,
        describe: describeTitle,
        specFile,
        screenshotName: deriveScreenshotName(specFile, describeTitle, spec.title),
      });
    }
  }

  if (suite.suites) {
    for (const child of suite.suites) {
      results.push(...flattenSpecs(child, specFile, currentDescribe));
    }
  }

  return results;
}

/** Extract spec file name from a top-level suite title. */
function specFileFromSuite(suite: PlaywrightSuite): string {
  // Playwright JSON puts the file path in suite.file or suite.title
  return suite.file ?? suite.title ?? '';
}

/** Determine which tab a spec file belongs to. */
function resolveTab(specFile: string): string {
  const lower = specFile.toLowerCase();
  for (const tab of TAB_DEFS) {
    if (tab.specPatterns.some(p => lower.includes(p))) {
      return tab.id;
    }
  }
  return 'infra'; // default bucket
}

// ---------------------------------------------------------------------------
// HTML generation helpers
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<TestStatus, string> = {
  pass: '<span class="status-icon status-pass" aria-label="pass">✓</span>',
  skip: '<span class="status-icon status-skip" aria-label="skip">−</span>',
  fail: '<span class="status-icon status-fail" aria-label="fail">✗</span>',
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildThumbnailHtml(
  screenshotName: string | undefined,
  screenshotMap: Map<string, { imgBase64: string; caption: string }>
): string {
  if (!screenshotName) return '<span class="no-screenshot">—</span>';

  // Try exact match first, then prefix match
  let entry = screenshotMap.get(screenshotName);
  if (!entry) {
    // Fallback: find any key that starts with the same module prefix
    for (const [key, val] of screenshotMap.entries()) {
      if (screenshotName.startsWith(key.split('-')[0])) {
        entry = val;
        break;
      }
    }
  }

  if (!entry) return '<span class="no-screenshot">—</span>';

  const captionEscaped = escapeHtml(entry.caption);
  return `<img
      class="screenshot-thumb"
      src="${entry.imgBase64}"
      alt="${captionEscaped}"
      title="${captionEscaped}"
      data-caption="${captionEscaped}"
      loading="lazy"
    />`;
}

interface JourneyGroup {
  letter: string;
  title: string;
  tests: NormalizedTest[];
}

function groupTestsByJourney(
  tests: NormalizedTest[],
  tabId: string
): JourneyGroup[] {
  const prefixes = JOURNEY_PREFIXES[tabId] ?? ['Z'];

  // Group by describe block
  const byDescribe = new Map<string, NormalizedTest[]>();
  for (const test of tests) {
    const key = test.describe || '(root)';
    if (!byDescribe.has(key)) byDescribe.set(key, []);
    byDescribe.get(key)!.push(test);
  }

  const groups: JourneyGroup[] = [];
  let idx = 0;
  for (const [describeTitle, describeTests] of byDescribe.entries()) {
    const letter = prefixes[idx] ?? String.fromCharCode(65 + idx); // A, B, C...
    groups.push({ letter, title: describeTitle, tests: describeTests });
    idx++;
  }

  return groups;
}

function buildJourneyHtml(
  group: JourneyGroup,
  screenshotMap: Map<string, { imgBase64: string; caption: string }>,
  groupIndex: number
): string {
  const pass = group.tests.filter(t => t.status === 'pass').length;
  const fail = group.tests.filter(t => t.status === 'fail').length;
  const skip = group.tests.filter(t => t.status === 'skip').length;
  const total = group.tests.length;

  const statusClass = fail > 0 ? 'journey-has-fail' : skip === total ? 'journey-all-skip' : 'journey-all-pass';
  const groupId = `journey-${groupIndex}`;

  const rows = group.tests.map(test => {
    const thumb = buildThumbnailHtml(test.screenshotName, screenshotMap);
    return `
      <tr class="test-row test-${test.status}">
        <td class="test-status-cell">${STATUS_ICON[test.status]}</td>
        <td class="test-title-cell">${escapeHtml(test.title)}</td>
        <td class="test-screenshot-cell">${thumb}</td>
      </tr>`;
  }).join('');

  return `
    <div class="journey-card ${statusClass}" id="${groupId}">
      <button
        class="journey-header"
        aria-expanded="true"
        aria-controls="${groupId}-body"
        onclick="toggleJourney(this)"
      >
        <span class="journey-letter">${escapeHtml(group.letter)}</span>
        <span class="journey-title">${escapeHtml(group.title)}</span>
        <span class="journey-stats">
          <span class="stat-pass">${pass} pass</span>
          <span class="stat-sep">/</span>
          <span class="stat-skip">${skip} skip</span>
          <span class="stat-sep">/</span>
          <span class="stat-fail">${fail} fail</span>
          <span class="stat-total">(${total} total)</span>
        </span>
        <span class="journey-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="journey-body" id="${groupId}-body">
        <table class="test-table">
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

function buildTabContent(
  tabId: string,
  tests: NormalizedTest[],
  screenshotMap: Map<string, { imgBase64: string; caption: string }>,
  activeTabId: string
): string {
  const isActive = tabId === activeTabId;
  const groups = groupTestsByJourney(tests, tabId);

  if (groups.length === 0) {
    return `
      <div class="tab-panel ${isActive ? 'tab-panel--active' : ''}" id="panel-${tabId}" role="tabpanel" aria-labelledby="tab-${tabId}">
        <div class="empty-panel">この tab にテストはありません</div>
      </div>`;
  }

  const journeysHtml = groups
    .map((g, i) => buildJourneyHtml(g, screenshotMap, i + tabId.charCodeAt(0)))
    .join('\n');

  return `
    <div class="tab-panel ${isActive ? 'tab-panel--active' : ''}" id="panel-${tabId}" role="tabpanel" aria-labelledby="tab-${tabId}">
      ${journeysHtml}
    </div>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // 1. Read JSON results
  if (!fs.existsSync(RESULTS_PATH)) {
    console.error(`[generate-report] Results file not found: ${RESULTS_PATH}`);
    console.error('Run Playwright with JSON reporter first:');
    console.error('  npx playwright test --reporter=json');
    process.exit(1);
  }

  let rawResults: PlaywrightResults;
  try {
    rawResults = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
  } catch (err) {
    console.error(`[generate-report] Failed to parse results JSON: ${err}`);
    process.exit(1);
  }

  // 2. Read template
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`[generate-report] Template not found: ${TEMPLATE_PATH}`);
    process.exit(1);
  }
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

  // 3. Build screenshot map
  const screenshotMap = buildScreenshotMap();
  console.log(`[generate-report] Loaded ${screenshotMap.size} screenshot(s)`);

  // 4. Flatten all tests and bucket into tabs
  const tabBuckets = new Map<string, NormalizedTest[]>();
  for (const tab of TAB_DEFS) {
    tabBuckets.set(tab.id, []);
  }

  let totalPass = 0;
  let totalSkip = 0;
  let totalFail = 0;

  for (const topSuite of rawResults.suites ?? []) {
    const specFile = specFileFromSuite(topSuite);
    const tabId = resolveTab(specFile);
    const tests = flattenSpecs(topSuite, specFile, []);

    const bucket = tabBuckets.get(tabId) ?? [];
    bucket.push(...tests);
    tabBuckets.set(tabId, bucket);

    for (const t of tests) {
      if (t.status === 'pass') totalPass++;
      else if (t.status === 'skip') totalSkip++;
      else totalFail++;
    }
  }

  const totalAll = totalPass + totalSkip + totalFail;

  // 5. Compute progress bar percentages (avoid divide-by-zero)
  const pct = (n: number): string =>
    totalAll === 0 ? '0' : ((n / totalAll) * 100).toFixed(1);

  // 6. Determine default active tab (first tab with tests, fallback to first)
  const activeTabId =
    TAB_DEFS.find(t => (tabBuckets.get(t.id)?.length ?? 0) > 0)?.id ?? TAB_DEFS[0].id;

  // 7. Build tab buttons HTML
  const tabsHtml = TAB_DEFS.map(tab => {
    const tests = tabBuckets.get(tab.id) ?? [];
    const fail = tests.filter(t => t.status === 'fail').length;
    const badge = fail > 0 ? ` <span class="tab-fail-badge">${fail}</span>` : '';
    const isActive = tab.id === activeTabId;
    return `<button
      class="tab-btn ${isActive ? 'tab-btn--active' : ''}"
      id="tab-${tab.id}"
      role="tab"
      aria-selected="${isActive}"
      aria-controls="panel-${tab.id}"
      onclick="switchTab('${tab.id}')"
    >${escapeHtml(tab.label)}${badge}</button>`;
  }).join('\n');

  // 8. Build tab content HTML
  const contentHtml = TAB_DEFS.map(tab => {
    const tests = tabBuckets.get(tab.id) ?? [];
    return buildTabContent(tab.id, tests, screenshotMap, activeTabId);
  }).join('\n');

  // 9. Timestamp
  const timestamp = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  // 10. Inject into template
  const html = template
    .replace(/\{\{TIMESTAMP\}\}/g, escapeHtml(timestamp))
    .replace(/\{\{TOTAL\}\}/g, String(totalAll))
    .replace(/\{\{PASS\}\}/g, String(totalPass))
    .replace(/\{\{SKIP\}\}/g, String(totalSkip))
    .replace(/\{\{FAIL\}\}/g, String(totalFail))
    .replace(/\{\{PASS_PCT\}\}/g, pct(totalPass))
    .replace(/\{\{SKIP_PCT\}\}/g, pct(totalSkip))
    .replace(/\{\{FAIL_PCT\}\}/g, pct(totalFail))
    .replace(/\{\{TABS_HTML\}\}/g, tabsHtml)
    .replace(/\{\{CONTENT_HTML\}\}/g, contentHtml);

  // 11. Write output
  fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
  const sizeKb = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);

  console.log(`[generate-report] Report written: ${OUTPUT_PATH} (${sizeKb} KB)`);
  console.log(`[generate-report] Stats: ${totalPass} pass / ${totalSkip} skip / ${totalFail} fail (total ${totalAll})`);
}

main();
