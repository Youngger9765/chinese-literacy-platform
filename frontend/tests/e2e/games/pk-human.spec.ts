/**
 * 雙人 PK (pk_human) — issue #3685.
 *
 * Two real students, two browser contexts, full real-UI journey: login →
 * sidebar → 遊戲區 → PK 對戰 → one creates an invite code, the other
 * redeems it → both tap through the VS screen → answer every round →
 * both land on a result screen with a score and an outcome.
 */
import { test, expect } from '../fixtures/pageerror-fixture';
import { getIapProxyAuthHeader } from '../utils/iapAuth';
import {
  batchCreateStudents,
  createClassroomForTeacher,
  enableClassroomFeatures,
  loginViaUI,
  openGameHubCard,
  openGameHubViaSidebar,
  registerTeacher,
} from './helpers';

const MAX_ROUNDS = 90;

test.describe('PK 對戰 pk_human', () => {
  test('two students complete a full invite-code match to a result screen', async ({ browser, request }) => {
    test.setTimeout(150_000);

    const teacher = await registerTeacher(request, 'pk-teacher');
    const classroom = await createClassroomForTeacher(request, teacher, 'QA PK Class');
    await enableClassroomFeatures(request, teacher, classroom.id, { pk_human: true });
    const students = await batchCreateStudents(request, teacher, classroom.id, 2, 'pk');

    const ctxA = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const ctxB = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    const errors: string[] = [];
    for (const [label, p] of [['A', a], ['B', b]] as const) {
      p.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
      p.on('console', (m) => {
        if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
          errors.push(`[${label}] console: ${m.text().slice(0, 200)}`);
        }
      });
    }

    // ── Real entry: A creates an invite code ─────────────────────────────
    await loginViaUI(a, students[0].email, students[0].password);
    await openGameHubViaSidebar(a);
    await openGameHubCard(a, 'PK 對戰');
    await expect(a.getByRole('heading', { name: 'PK 對戰' })).toBeVisible();
    await a.getByRole('button', { name: '產生邀請碼給同學' }).click();
    await a.getByRole('button', { name: '產生邀請碼', exact: true }).click();
    await a.waitForURL(/\/pk\/queue\/\d+/, { timeout: 15000 });
    await expect(a.getByText('等待同學輸入邀請碼')).toBeVisible();
    const codeText = (await a.locator('p.text-3xl').innerText()).trim();
    expect(codeText).toMatch(/^[A-Z0-9]{6}$/);

    // ── Real entry: B redeems the code through the "有邀請碼嗎？" UI ──────
    await loginViaUI(b, students[1].email, students[1].password);
    await openGameHubViaSidebar(b);
    await openGameHubCard(b, 'PK 對戰');
    await b.getByRole('button', { name: '有邀請碼嗎？' }).click();
    await b.getByPlaceholder('輸入 6 碼邀請碼').fill(codeText);
    await b.getByRole('button', { name: '加入' }).click();

    // Both land on the match once the redeem flips A's queue to "matched".
    await a.waitForURL(/\/pk\/match\/\d+/, { timeout: 20000 });
    await b.waitForURL(/\/pk\/match\/\d+/, { timeout: 20000 });

    // ── VS screen → battle (per-browser local phase, each taps their own).
    // Both pages just navigated via waitForURL above, so the match page's
    // lazy chunk may still be mounting — wait for the real button rather
    // than an instant, racy count() check. ─────────────────────────────────
    for (const p of [a, b]) {
      const vsBtn = p.getByRole('button', { name: '開始對戰' });
      await vsBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      if (await vsBtn.count()) await vsBtn.click();
    }

    // ── Answer every round on both sides until a result screen appears ──
    let aDone = false;
    let bDone = false;
    for (let i = 0; i < MAX_ROUNDS && !(aDone && bDone); i++) {
      for (const [p, doneRef] of [[a, 'a'], [b, 'b']] as const) {
        if ((doneRef === 'a' && aDone) || (doneRef === 'b' && bDone)) continue;
        const resultHeading = p.getByRole('heading', { level: 1 }).filter({ hasText: /你贏了！|平手|再接再厲！/ });
        if (await resultHeading.count()) {
          if (doneRef === 'a') aDone = true; else bDone = true;
          continue;
        }
        // Still on the VS screen (either page could lag the other) — tap it.
        const vsBtn = p.getByRole('button', { name: '開始對戰' });
        if (await vsBtn.count()) { await vsBtn.click(); continue; }
        const group = p.getByRole('group', { name: '選項' });
        if (!(await group.count())) continue;
        const firstOption = group.getByRole('button').first();
        if (await firstOption.count() && !(await firstOption.isDisabled())) {
          await firstOption.click();
        }
      }
      await a.waitForTimeout(500);
    }

    expect(aDone, 'student A must reach the PK result screen').toBeTruthy();
    expect(bDone, 'student B must reach the PK result screen').toBeTruthy();

    for (const p of [a, b]) {
      await expect(p.getByText(/^\d+$/).first()).toBeVisible();
      const bodyText = await p.locator('body').innerText();
      expect(bodyText).toMatch(/你贏了！|平手|再接再厲！/);
    }

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toHaveLength(0);

    await ctxA.close();
    await ctxB.close();
  });
});
