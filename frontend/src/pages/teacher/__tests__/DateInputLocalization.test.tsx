/**
 * TDD test for issue #1988
 * Verifies all <input type="date"> in teacher assignment forms have lang="zh-TW".
 *
 * Strategy: parse the TSX source files as text strings.
 * This is simpler than full render (which needs 20+ mocked props) and directly
 * catches the attribute presence — which is exactly the regression to prevent.
 *
 * Note: SemesterPanel was refactored in a parallel PR and no longer contains
 * inline date inputs, so only teacher components are tested here.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TEACHER_COMPONENTS = path.resolve(
  __dirname,
  '../components'
);

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Returns how many <input type="date"> blocks are missing lang="zh-TW".
 */
function countMissingLang(source: string): number {
  const parts = source.split('type="date"');
  let missing = 0;

  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1];
    const tagStart = before.lastIndexOf('<input');
    if (tagStart === -1) continue;

    const tagFragment = before.slice(tagStart) + 'type="date"' + parts[i].split('/>')[0];

    if (!tagFragment.includes('lang="zh-TW"')) {
      missing++;
    }
  }

  return missing;
}

describe('Date input lang="zh-TW" attribute (#1988)', () => {
  it('AssignmentCreateForm has lang="zh-TW" on all date inputs', () => {
    const source = readFile(path.join(TEACHER_COMPONENTS, 'AssignmentCreateForm.tsx'));
    const missing = countMissingLang(source);
    expect(missing, `${missing} date input(s) missing lang="zh-TW"`).toBe(0);
  });

  it('AssignmentInlineEdit has lang="zh-TW" on all date inputs', () => {
    const source = readFile(path.join(TEACHER_COMPONENTS, 'AssignmentInlineEdit.tsx'));
    const missing = countMissingLang(source);
    expect(missing, `${missing} date input(s) missing lang="zh-TW"`).toBe(0);
  });
});
