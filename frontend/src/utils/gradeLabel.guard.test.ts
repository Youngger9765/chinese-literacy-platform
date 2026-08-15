import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guard against a fifth copy of the naming rule (#2683).
 *
 * `第 {grade} 級` was hardcoded in four places — the library filter, the story
 * card badge, the recommendation list (which had its OWN `gradeLabel(grade:
 * number)`), and the intro panel. Fixing the filter alone left the card rendering
 * 「第 文言文 級」 on staging, which is how this was found: on the deployed page,
 * after the filter itself looked correct.
 *
 * A grep is the right shape of test here. The alternative — mounting four
 * components — asserts less and breaks more.
 */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('grade label has exactly one home', () => {
  it('no component builds the label inline', () => {
    const offenders = tsxFiles(join(__dirname, '..'))
      // gradeLabel.ts itself quotes the pattern in the comment explaining why it exists.
      .filter((f) => !f.endsWith('gradeLabel.ts'))
      .filter((f) => /第\s*\{[^}]*\}\s*級/.test(readFileSync(f, 'utf-8')))
      .map((f) => f.replace(/.*\/src\//, 'src/'));
    expect(offenders).toEqual([]);
  });

  it('no component defines a second gradeLabel', () => {
    const offenders = tsxFiles(join(__dirname, '..'))
      .filter((f) => !f.endsWith('gradeLabel.ts'))
      .filter((f) => /function gradeLabel|const gradeLabel\s*=/.test(readFileSync(f, 'utf-8')))
      .map((f) => f.replace(/.*\/src\//, 'src/'));
    expect(offenders).toEqual([]);
  });
});
