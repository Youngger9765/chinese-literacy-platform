/**
 * 迷城密室 (escape_room) — issue #3685.
 *
 * Single-student real journey: login → sidebar → 遊戲區 → 迷城密室 →
 * 開始探索 → answer chambers until the first one unlocks (or the whole
 * run escapes). Server never exposes the correct answer to the client
 * (`_safe_question` strips `correct_key`) — this spec learns it the same
 * way a persistent human player effectively could: by observing whether
 * `mist_distance` moved toward escape (+10) or away (-10) after an
 * answer, then re-using that choice next time the SAME question recurs
 * (a chamber that isn't unlocked yet cycles back through its own fixed
 * question list). Every actual answer submission is a real click on the
 * rendered option button — the mist-delta read is a parallel read-only
 * poll of the same `/state` endpoint the page itself already polls.
 */
import { test, expect } from '../fixtures/pageerror-fixture';
import {
  batchCreateStudents,
  createClassroomForTeacher,
  loginViaUI,
  openGameHubCard,
  openGameHubViaSidebar,
  registerTeacher,
  BACKEND,
} from './helpers';

const MAX_ATTEMPTS = 120;

async function getState(request: import('@playwright/test').APIRequestContext, runId: string, token: string) {
  const res = await request.get(`${BACKEND}/api/escape-room/runs/${runId}/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), `GET state -> ${res.status()}`).toBeTruthy();
  return res.json();
}

test.describe('迷城密室 escape_room', () => {
  test('a student plays real chambers until the first one unlocks', async ({ page, request }) => {
    test.setTimeout(120_000);

    const teacher = await registerTeacher(request, 'escape-teacher');
    const classroom = await createClassroomForTeacher(request, teacher, 'QA Escape Room Class');
    const [student] = await batchCreateStudents(request, teacher, classroom.id, 1, 'escape');

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`console: ${m.text().slice(0, 200)}`);
    });

    // loginViaUI forces this fresh account through the mandatory first-login
    // password change — pin the resulting password so a separate API login
    // below (for read-only state polling) can still authenticate.
    const rotatedPassword = 'QaEscapeRoom2026Aa';
    await loginViaUI(page, student.email, student.password, { newPassword: rotatedPassword });
    await openGameHubViaSidebar(page);
    await openGameHubCard(page, '迷城密室');
    await expect(page.getByRole('heading', { name: '迷城密室' })).toBeVisible();
    await page.getByRole('button', { name: '開始探索' }).click();
    await page.waitForURL(/\/escape-room\/run\/\d+/, { timeout: 20000 });
    const runId = page.url().split('/').pop()!;

    const loginRes = await request.post(`${BACKEND}/api/auth/login`, { data: { email: student.email, password: rotatedPassword } });
    expect(loginRes.ok(), await loginRes.text()).toBeTruthy();
    const studentToken = (await loginRes.json()).access_token as string;

    const learnedCorrectKey = new Map<string, string>();
    const triedThisCycle = new Map<string, Set<string>>();
    let reachedFirstChamberUnlock = false;
    let escaped = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const state = await getState(request, runId, studentToken);
      if (state.status !== 'in_progress') {
        escaped = state.status === 'escaped';
        break;
      }
      if ((state.unlocked_chambers ?? 0) >= 1) {
        reachedFirstChamberUnlock = true;
        break;
      }
      const question = state.rescue_question ?? state.current_chamber ?? state.gate_question;
      if (!question) { await page.waitForTimeout(500); continue; }
      const questionKey = `${question.chamber_index ?? 'other'}::${question.stem}`;

      let keyToClick = learnedCorrectKey.get(questionKey);
      if (!keyToClick) {
        const tried = triedThisCycle.get(questionKey) ?? new Set<string>();
        const untried = question.options.find((o: { key: string }) => !tried.has(o.key));
        keyToClick = (untried ?? question.options[0]).key;
        tried.add(keyToClick);
        triedThisCycle.set(questionKey, tried);
      }

      const before = state.mist_distance;
      // When a rescue_question is active, StudentEscapeRoomRun renders BOTH
      // the base chamber/gate question (disabled underneath) AND the rescue
      // dialog's own question (enabled, on top) — by design, see
      // escape_room/engine.py's _maybe_expire_chamber comment: "A rescue dialog
      // blocks the base chamber question (the frontend disables its
      // ChoiceButtons while rescue_question is present)". Both can carry the
      // same lettered option (e.g. "選項 A："), so an unscoped locator hits
      // Playwright's strict-mode violation. Scope to the dialog whenever
      // `question` resolved to the rescue question (see the `??` chain above).
      const scope = state.rescue_question ? page.getByRole('dialog', { name: '救援題' }) : page;
      const optionBtn = scope.locator(`[aria-label^="選項 ${keyToClick}："]`);
      await expect(optionBtn).toBeVisible({ timeout: 10000 });
      await optionBtn.click();
      await page.waitForTimeout(600);

      const after = await getState(request, runId, studentToken);
      if (after.status !== 'in_progress') {
        escaped = after.status === 'escaped';
        if ((after.unlocked_chambers ?? 0) >= 1 || escaped) reachedFirstChamberUnlock = true;
        break;
      }
      if ((after.mist_distance ?? 0) > before) {
        learnedCorrectKey.set(questionKey, keyToClick);
      }
    }

    expect(
      reachedFirstChamberUnlock || escaped,
      `expected the first chamber to unlock (or the whole run to escape) within ${MAX_ATTEMPTS} answer attempts`,
    ).toBeTruthy();

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toHaveLength(0);
  });
});
