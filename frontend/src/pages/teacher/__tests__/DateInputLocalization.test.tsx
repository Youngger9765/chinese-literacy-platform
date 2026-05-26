/**
 * TDD test for issue #1988
 * Verifies all <input type="date"> in teacher assignment forms have lang="zh-TW".
 *
 * Strategy: parse the TSX source files as text strings.
 * This is simpler than full render (which needs 20+ mocked props) and directly
 * catches the attribute presence — which is exactly the regression to prevent.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TEACHER_COMPONENTS = path.resolve(
  __dirname,
  '../components'
);
const ADMIN_PAGES = path.resolve(__dirname, '../../admin');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Returns true if every <input type="date"> block in the source
 * has lang="zh-TW" on the same element (within the same JSX tag).
 */
function allDateInputsHaveLang(source: string): { ok: boolean; missing: number } {
  // Split on each occurrence of type="date" to find all date inputs
  const parts = source.split('type="date"');
  let missing = 0;

  // Skip the first part (before any date input), check each following part
  for (let i = 1; i < parts.length; i++) {
    // Look backwards from the split point to find the opening < of this tag
    const before = parts[i - 1];
    const tagStart = before.lastIndexOf('<input');
    if (tagStart === -1) continue;

    // The full tag spans from tagStart in before + the 'type="date"' + forward to the closing />
    const tagFragment = before.slice(tagStart) + 'type="date"' + parts[i].split('/>')[0];

    if (!tagFragment.includes('lang="zh-TW"')) {
      missing++;
    }
  }

  return { ok: missing === 0, missing };
}

describe('Date input lang="zh-TW" attribute (#1988)', () => {
  it('AssignmentCreateForm has lang="zh-TW" on all date inputs', () => {
    const source = readFile(path.join(TEACHER_COMPONENTS, 'AssignmentCreateForm.tsx'));
    const { ok, missing } = allDateInputsHaveLang(source);
    expect(missing, `${missing} date input(s) missing lang="zh-TW"`).toBe(0);
    expect(ok).toBe(true);
  });

  it('AssignmentInlineEdit has lang="zh-TW" on all date inputs', () => {
    const source = readFile(path.join(TEACHER_COMPONENTS, 'AssignmentInlineEdit.tsx'));
    const { ok, missing } = allDateInputsHaveLang(source);
    expect(missing, `${missing} date input(s) missing lang="zh-TW"`).toBe(0);
    expect(ok).toBe(true);
  });

  it('SemesterPanel (admin) has lang="zh-TW" on all date inputs', () => {
    const source = readFile(path.join(ADMIN_PAGES, 'SemesterPanel.tsx'));
    const { ok, missing } = allDateInputsHaveLang(source);
    expect(missing, `${missing} date input(s) missing lang="zh-TW"`).toBe(0);
    expect(ok).toBe(true);
  });
});
