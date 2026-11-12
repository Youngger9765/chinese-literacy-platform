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
