/**
 * #2889 — 學習紀錄 must show BOTH lists, without anyone having to click.
 *
 * Reported as 「我去自學頁面 也沒有看到任何紀錄留存」. The records were there. The page
 * opened on 作業回顧, which for a student who practises on their own is empty:
 * measured on staging for the demo student, 9 completed assignment sessions
 * against 554 self-study ones. You landed on 「還沒有作業學習紀錄」 and the 554 were
 * behind an unlabelled click.
 *
 * Owner's call: 「自學紀錄跟作業回顧都要有」. Defaulting to 自學 would have moved the
 * problem rather than removed it — the other list would still have been hidden.
 * So there are no tabs: both render, every time.
 *
 * Asserted against the source rather than a render, deliberately. The behaviour
 * here is structural (what the page is made of), and a render test would need the
 * auth context and two endpoints stubbed to tell us something the structure
 * already states. The end-to-end evidence is the staging run in the PR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', 'LearningHistoryPage.tsx'), 'utf-8');

describe('#2889 學習紀錄：兩段都要在', () => {
  it('renders both lists, self first', () => {
    const order = [...SRC.matchAll(/\{ key: '(self|assignment)', label:/g)].map((m) => m[1]);
    expect(order).toEqual(['self', 'assignment']);
  });

  it('names both sections', () => {
    // Positive control for the test above: without it, deleting one section
    // entirely would still leave a one-element array that "starts with self".
    expect(SRC).toContain("label: '自學紀錄'");
    expect(SRC).toContain("label: '作業回顧'");
  });

  it('has no tab state left behind — nothing is one click away', () => {
    // The whole point. A surviving activeTab would mean one list is still hidden.
    expect(SRC).not.toMatch(/useState<TabKey>/);
    expect(SRC).not.toMatch(/setActiveTab/);
  });

  it('maps over the whole list, not a slice of it', () => {
    // The array having two entries proves nothing if the render only walks part
    // of it. Caught by mutation: `SECTIONS.slice(0, 1).map(...)` passed every
    // other test in this file while hiding 作業回顧 exactly as before.
    const render = SRC.match(/\{SECTIONS[^}]*\.map\(/);
    expect(render, 'SECTIONS is not rendered with .map at all').not.toBeNull();
    expect(render![0]).toBe('{SECTIONS.map(');
  });

  it('still fetches each list separately, so one empty list cannot blank the other', () => {
    // Each section mounts its own TabContent with its own source; a shared
    // fetch would let 作業回顧's 9 rows page over 自學's 554.
    expect(SRC).toMatch(/<TabContent source=\{section\.key\} \/>/);
  });
});
