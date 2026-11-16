/**
 * Regression lock — issue #4005.
 *
 * Earlier PRs (#3990, #3994, #3996) recolored *some* teacher-workspace
 * elements from LingoLeap's indigo brand accent (`--color-accent`,
 * rgb(86 74 191) / #564ABF) to Junyi's teal (#19A696) / blue (#4990E2), but
 * production still showed purple on the 指派任務 tab's 建立任務／指派課文
 * buttons and the 全部／進行中 status-badge counts — because those specific
 * elements (`AssignmentTab.tsx`, `TextManagementTab.tsx`, and ~25 other
 * teacher-only files) were never swept.
 *
 * This test statically scans every teacher-only source file for the raw
 * Tailwind accent utility tokens (`bg-accent`, `text-accent`, `border-accent`,
 * `ring-accent`, `bg-accent-bg`, `bg-accent-hover`, etc. — anything that
 * resolves to the indigo `--color-accent` CSS variable) and fails if any
 * remain. It intentionally does NOT flag `accent-[#...]` bracket-notation
 * classes (that's how this fix expresses "teal"/"blue" explicitly) or the
 * word "accent" inside comments/prose.
 *
 * Documented exceptions (not teacher-only, or deliberately deferred):
 *   - frontend/src/pages/teacher/live/**        — TeacherLiveQuiz* game-mode
 *     screens; index.css already documents these as "out of this PRD's
 *     three flows" (intentionally untouched, same decision as the cream
 *     `bg-surface` exception).
 *   - frontend/src/components/layout/Sidebar.tsx, NavButton.tsx — shared
 *     across teacher/student/admin (mobile bottom tab bar + "switch
 *     identity" drawer); recoloring them would leak into student/admin
 *     views. Mobile-only (`md:hidden`), out of this ticket's desktop sweep.
 *   - frontend/src/components/league/EnergyBar.tsx — shared with student
 *     pages (LearningHistoryPage.tsx) and BattleHero.tsx; handled via an
 *     additive `tone="teacher"` option instead (see teacher-only
 *     LeagueProgressTab.tsx, which now passes that new tone).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');

// Any `<prefix>-accent` (optionally with `-bg`/`-bg-subtle`/`-hover`/`-light`
// suffix, optionally with a trailing `/NN` opacity modifier) that is NOT
// already bracket-notation (`bg-[#...]`). Mirrors the sweep script's pattern.
const RAW_ACCENT_TOKEN =
  /\b(border-t|border-l|border-r|border-b|border|bg|text|ring|from|to|divide|decoration|outline|caret)-accent(-bg-subtle|-bg|-hover|-light)?(\/\d+)?\b/;

// The same indigo pasted in as a raw value (`text-[#564ABF]`, inline style
// `rgb(86, 74, 191)`) — the fix itself uses bracket hex, so a revert would
// most likely come back in this shape, which RAW_ACCENT_TOKEN can't see.
const RAW_PURPLE_LITERAL = /#564abf\b|rgba?\(\s*86\s*,?\s+74\s*,?\s+191\b/i;

const TEACHER_ONLY_DIRS = [
  'pages/teacher',
  'components/teacher',
];

// Files outside the teacher folders that are only rendered by teacher pages
// (verified by grepping importers in PR #4021 review). EnergyBar is shared
// with student pages and is locked by its `tone` prop default instead.
const TEACHER_ONLY_FILES = ['components/ui/ZhTWDatePicker.tsx'];

// Relative to SRC_ROOT. Directories/files intentionally excluded — see the
// file header for why each one is safe to leave alone.
const EXCLUDED = [
  'pages/teacher/live', // deliberately deferred game-mode screens (index.css)
];

function isExcluded(relPath: string): boolean {
  return EXCLUDED.some((ex) => relPath === ex || relPath.startsWith(ex + path.sep));
}

function listTsxFiles(dir: string): string[] {
  const abs = path.join(SRC_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const relChild = path.join(dir, entry.name);
    if (isExcluded(relChild)) continue;
    if (entry.isDirectory()) {
      out.push(...listTsxFiles(relChild));
    } else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out.push(relChild);
    }
  }
  return out;
}

describe('teacher workspace stays off the LingoLeap indigo accent (#4005)', () => {
  const files = [...TEACHER_ONLY_DIRS.flatMap(listTsxFiles), ...TEACHER_ONLY_FILES];

  it('found a non-trivial number of teacher-only files to scan', () => {
    // Guards against the scan silently matching zero files (e.g. a renamed
    // directory) and the whole test going vacuously green.
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s has no raw indigo-accent Tailwind classes', (relPath) => {
    const content = fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf-8');
    const lines = content.split('\n');
    const offenders: string[] = [];
    lines.forEach((line, idx) => {
      const m = line.match(RAW_ACCENT_TOKEN) ?? line.match(RAW_PURPLE_LITERAL);
      if (m) {
        offenders.push(`  line ${idx + 1}: ${m[0]} -- ${line.trim().slice(0, 100)}`);
      }
    });
    expect(offenders, `${relPath} still references the indigo accent:\n${offenders.join('\n')}`).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression lock — WCAG AA small-text contrast (teacher-small-text-contrast
// ticket). The full-strength Junyi teal (#19A696, 3.03:1 vs white) and blue
// (#4990E2, 3.30:1 vs white) both fail WCAG AA's 4.5:1 minimum for small
// text (anything under 18.66px bold / 24px regular). Large/bold uses (the
// join-code displays, the circular avatar initial) are allowed to keep the
// original hue — only SMALL text/backgrounds were moved to the darker
// small-text shades (#11806F teal, #2A73C2 blue). This scans every
// className (string literal or template literal) in the same teacher-only
// file set above and fails if a small-text class (`text-xs`/`text-sm`) ever
// shares an element string with the ORIGINAL full-strength hex used either
// as white-on-color background or as the text color itself — both shapes
// that measured under 4.5:1 before this fix.
//
// Verified red→green: temporarily reverting ClassroomDetail.tsx's
// `bg-[#11806F] hover:bg-[#0E7366]` back to `bg-[#19A696] hover:bg-[#15897B]`
// makes this test fail with that exact line flagged; restoring the fix
// makes it pass again (see PR description for the captured before/after
// `npm run test` output).
const SMALL_SIZE_TOKEN = /\btext-(xs|sm)\b/;
const WHITE_ON_RAW_JUNYI_BG = /\btext-white\b.*\bbg-\[#(?:19A696|4990E2)\](?!\/)|bg-\[#(?:19A696|4990E2)\](?!\/).*\btext-white\b/s;
const RAW_JUNYI_TEXT_COLOR = /\btext-\[#(?:19A696|4990E2)\]/;

// Matches className="...", className={`...`}, className={'...'} — covers
// every className shape used across the teacher tree, including multi-line
// template literals with ternary branches (the ternary's string branches are
// plain substrings of the captured template body, so they're still seen).
const CLASSNAME_VALUE = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/gs;

function extractClassNameValues(content: string): { value: string; line: number }[] {
  const results: { value: string; line: number }[] = [];
  let match: RegExpExecArray | null;
  CLASSNAME_VALUE.lastIndex = 0;
  while ((match = CLASSNAME_VALUE.exec(content)) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    const line = content.slice(0, match.index).split('\n').length;
    results.push({ value, line });
  }
  return results;
}

describe('teacher views keep small Junyi-colored text at or above WCAG AA 4.5:1 (teacher-small-text-contrast)', () => {
  // Reuses the exact same teacher-only file set as the indigo-accent lock
  // above (same ownership boundary: what's safe to recolor without leaking
  // into student/admin views is identical for both tickets).
  const files = [...TEACHER_ONLY_DIRS.flatMap(listTsxFiles), ...TEACHER_ONLY_FILES];

  it('found a non-trivial number of teacher-only files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s has no small-text element using the full-strength (sub-4.5:1) Junyi hex', (relPath) => {
    const content = fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf-8');
    const offenders: string[] = [];
    for (const { value, line } of extractClassNameValues(content)) {
      if (!SMALL_SIZE_TOKEN.test(value)) continue;
      if (WHITE_ON_RAW_JUNYI_BG.test(value) || RAW_JUNYI_TEXT_COLOR.test(value)) {
        offenders.push(`  line ${line}: ${value.slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      `${relPath} has small text (text-xs/text-sm) paired with the raw sub-4.5:1 Junyi hex:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// Sidebar.tsx is shared by every role, so it can't be swept like the teacher
// folders. Its mobile nav active states carry teacher-nav-active-* hooks that
// index.css recolors only under .font-teacher-ui; lock both halves.
//
// #WCAG-AA (teacher-small-text-contrast): all three hooks render small text
// (10px bottom-nav label / 14px drawer items with text-sm) or small white
// text on a solid fill, so they were moved from the raw #19A696 (3.03:1) to
// the small-text shade #11806F (4.84:1) — assert the darker shade landed,
// not the pre-fix hex.
describe('shared Sidebar mobile nav uses Junyi colors in teacher views', () => {
  const sidebar = fs.readFileSync(path.join(SRC_ROOT, 'components/layout/Sidebar.tsx'), 'utf-8');
  const css = fs.readFileSync(path.join(SRC_ROOT, 'index.css'), 'utf-8');
  it.each(['teacher-nav-active-text', 'teacher-nav-active-solid', 'teacher-nav-active-soft'])(
    '%s is applied in Sidebar and recolored under .font-teacher-ui with the WCAG-AA small-text shade',
    (hook) => {
      expect(sidebar).toContain(hook);
      const rule = new RegExp(`\\.font-teacher-ui \\.${hook}\\s*\\{([^}]*)\\}`).exec(css);
      expect(rule, `${hook} rule not found in index.css`).not.toBeNull();
      expect(rule![1]).toMatch(/#11806F/);
      expect(rule![1]).not.toMatch(/#19A696\b/);
    },
  );

  it('teacher-brand-mark (logo tile + avatar initial, both text-sm white text) uses the WCAG-AA small-text shade', () => {
    const rule = /\.font-teacher-ui \.teacher-brand-mark\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'teacher-brand-mark rule not found in index.css').not.toBeNull();
    expect(rule![1]).toMatch(/#11806F/);
    expect(rule![1]).not.toMatch(/#19A696\b/);
  });
});

// #4026: translucent teal hovers / gradient stops wash small teal or white
// text below 4.5:1 (hover:bg-[#19A696]/70 under text-[#11806F] ~2.25:1;
// to-[#11806F]/80 under white text ~3.4:1). Use solid tints instead.
describe('teacher views avoid translucent teal fills under small text (#4026)', () => {
  const TRANSLUCENT_TEAL = /hover:bg-\[#(19A696|11806F)\]\/([2-9]\d)|(to|from|via)-\[#(19A696|11806F)\]\/\d+/i; // pale /5–/10 tints are fine
  const files = [...TEACHER_ONLY_DIRS.flatMap(listTsxFiles), ...TEACHER_ONLY_FILES];
  it.each(files)('%s has no translucent teal fill', (relPath) => {
    const lines = fs.readFileSync(path.join(SRC_ROOT, relPath), 'utf-8').split('\n');
    const hits = lines.flatMap((l, i) => (TRANSLUCENT_TEAL.test(l) ? [`  line ${i + 1}: ${l.trim().slice(0, 100)}`] : []));
    expect(hits, `${relPath}:\n${hits.join('\n')}`).toEqual([]);
  });
});
