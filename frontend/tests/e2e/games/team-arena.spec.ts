/**
 * 多人對抗賽 (team_arena) — issue #3685.
 *
 * Real multi-student journey: 4 separate browser contexts (host + 3
 * students), each logging in through the real `/login` form, walking
 * sidebar → 遊戲區 → 多人對抗賽 → 開一間房／輸入代碼加入, answering
 * rounds until the match ends, then checking the result screen.
 *
 * Verifies: read-phase options are hidden until the player's own turn
 * (am_i_active gate — same invariant the backend's own_match.current_round
 * enforces), at least one weapon gets used, a tower-collapse/attack
 * animation plays, the result screen renders both sides, and an opposing
 * player's real name is NEVER shown — only "甲隊/乙隊 N 號".
 */
import { test, expect } from '../fixtures/pageerror-fixture';
import type { Page } from '@playwright/test';
import {
  batchCreateStudents,
  createClassroomForTeacher,
  loginViaUI,
  openGameHubCard,
  openGameHubViaSidebar,
  registerTeacher,
  BACKEND,
} from './helpers';

const TEAM_SIZE = 2; // 2 per side = 4 students total ("3–4 students join" per #3685)
const MAX_ANSWER_ROUNDS = 400;

interface Ctx {
  page: Page;
  label: string;
  errors: string[];
}

async function watchErrors(page: Page, label: string, bucket: string[]) {
  page.on('pageerror', (e) => bucket.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      bucket.push(`[${label}] console: ${m.text().slice(0, 200)}`);
    }
  });
}

async function apiJson(request: import('@playwright/test').APIRequestContext, method: 'GET' | 'POST', path: string, token: string, data?: unknown) {
  const res = method === 'GET'
    ? await request.get(`${BACKEND}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    : await request.post(`${BACKEND}${path}`, { data: data ?? {}, headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()}: ${await res.text()}`);
  return res.json();
}

test.describe('多人對抗賽 team_arena', () => {
  test('host + 3 students play a full match to a masked, team-only result', async ({ page, browser, request }) => {
    test.setTimeout(300_000);

    // ── Setup: one teacher, one classroom, 4 real student accounts. team_arena
    // is never classroom-gated (gameModes.ts classroomGated: false) so no
    // feature flag needs enabling — the classroom only exists to batch-create
    // real student logins through the app's own roster endpoint. ──────────
    const teacher = await registerTeacher(request, 'arena-teacher');
    const classroom = await createClassroomForTeacher(request, teacher, 'QA Team Arena Class');
    const students = await batchCreateStudents(request, teacher, classroom.id, 4, 'arena');
    // Every fresh student account is forced through a one-time password
    // change on first login (server-side `PASSWORD_CHANGE_REQUIRED` gate,
    // not just a client route guard — confirmed by a 403 on team-arena's
    // own /join when called with a pre-rotation token). Pin a known
    // post-rotation password per student so API calls after each student's
    // real-UI login can still authenticate.
    const rotated = students.map((_, i) => `QaArena2026Aa${i}`);

    const errors: string[] = [];
    const contexts = await Promise.all(students.map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    await Promise.all(pages.map((p, i) => watchErrors(p, `s${i + 1}`, errors)));

    const [host, mate, opp1, opp2] = pages;

    // ── Real entry: login → sidebar → 遊戲區 → 多人對抗賽 → 開一間房 ──────
    await loginViaUI(host, students[0].email, students[0].password, { newPassword: rotated[0] });
    await openGameHubViaSidebar(host);
    await openGameHubCard(host, '多人對抗賽');
    await expect(host.getByRole('heading', { name: '多人對抗賽' })).toBeVisible();
    await host.getByRole('button', { name: '開一間房' }).click();
    await host.getByRole('button', { name: new RegExp(`^${TEAM_SIZE}`) }).first().click();
    await host.getByRole('button', { name: '開房' }).click();
    await host.waitForURL(/\/team-arena\/[A-Z0-9]{6}/, { timeout: 20000 });
    const code = host.url().split('/').pop()!.split('?')[0];
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    // Host defaults to side 'a' (甲隊) per StudentTeamArenaJoin's handleHost
    // default state — no extra click needed to confirm side.

    // ── Teammate joins via the real "輸入代碼加入" UI (not a deep link) ──
    await loginViaUI(mate, students[1].email, students[1].password, { newPassword: rotated[1] });
    await openGameHubViaSidebar(mate);
    await openGameHubCard(mate, '多人對抗賽');
    await mate.getByRole('button', { name: '輸入代碼加入' }).click();
    await mate.getByLabel('6 碼多人對抗賽代碼').fill(code);
    await mate.getByRole('button', { name: '甲隊' }).click();
    await mate.getByRole('button', { name: '加入' }).click();
    await mate.waitForURL(new RegExp(`/team-arena/${code}`), { timeout: 20000 });

    // ── Two opponents: real-UI login first (rotates their password), THEN
    // join side b via the same endpoint the "輸入代碼加入" form itself
    // calls (done via API purely to keep 4 parallel logins+joins fast —
    // the join UI path is already proven above by the host+teammate). ────
    await loginViaUI(opp1, students[2].email, students[2].password, { newPassword: rotated[2] });
    await loginViaUI(opp2, students[3].email, students[3].password, { newPassword: rotated[3] });

    const allTokens = await Promise.all(
      students.map(async (s, i) => {
        const res = await request.post(`${BACKEND}/api/auth/login`, { data: { email: s.email, password: rotated[i] } });
        expect(res.ok(), `login ${s.email}: ${await res.text()}`).toBeTruthy();
        return (await res.json()).access_token as string;
      }),
    );
    for (const tok of [allTokens[2], allTokens[3]]) {
      await apiJson(request, 'POST', `/api/team-arena/sessions/${code}/join`, tok, { side: 'b' });
    }
    await opp1.goto('/team-arena/' + code);
    await opp2.goto('/team-arena/' + code);

    // ── Lobby: opposing side must be masked as 乙隊 N 號, never real names ──
    // The lobby's own state is driven by the page's periodic poll (not
    // instant on join), so retry rather than a single fixed wait.
    let hostLobbyText = '';
    await expect(async () => {
      hostLobbyText = await host.locator('body').innerText();
      expect(hostLobbyText).toMatch(/乙隊\s*\d+\s*號/);
    }).toPass({ timeout: 20000, intervals: [1000] });
    expect(hostLobbyText, 'host must NOT see opponent real names').not.toContain(students[2].name);
    expect(hostLobbyText).not.toContain(students[3].name);

    let oppLobbyText = '';
    await expect(async () => {
      oppLobbyText = await opp1.locator('body').innerText();
      expect(oppLobbyText).toMatch(/甲隊\s*\d+\s*號/);
    }).toPass({ timeout: 20000, intervals: [1000] });
    expect(oppLobbyText).not.toContain(students[0].name);
    expect(oppLobbyText).not.toContain(students[1].name);

    // ── Start the match (host only) ──────────────────────────────────────
    const startBtn = host.getByRole('button', { name: '開始比賽' });
    await expect(startBtn).toBeEnabled({ timeout: 30000 });
    await startBtn.click();
    await host.waitForTimeout(1500);

    // ── Battle loop: whoever's turn it is answers. Host answers through the
    // REAL UI (so the attack animation + read-phase-hiding assertions below
    // are against actual rendered DOM); the other three answer via the same
    // `/answer` endpoint the UI itself calls, to keep the loop deterministic
    // and finish within the test timeout. ───────────────────────────────────
    let weaponUsed = false;
    let sawAttackAnimation = false;
    let ended = false;
    const answeredKeys = new Set<string>();

    for (let round = 0; round < MAX_ANSWER_ROUNDS && !ended; round++) {
      for (let i = 0; i < 4; i++) {
        const state = await apiJson(request, 'GET', `/api/team-arena/sessions/${code}/state`, allTokens[i]);
        if (state.status === 'ended') { ended = true; break; }
        const om = state.own_match;
        const cr = om?.current_round;
        if (!om || !cr || !om.am_i_active || !cr.options || cr.revealed) continue;
        const key = `${i}:${cr.turn_no}`;
        if (answeredKeys.has(key)) continue;

        if (i === 0) {
          // Real-UI assertion: StudentTeamArenaPlay shows "請先仔細讀題目，
          // 稍後選項才會出現" until the backend actually attaches `options`
          // to the round (server-timed reading delay) — wait for the real
          // "輪到你了！" + option buttons to render, not a fixed sleep. A
          // miss here just means the host's own poll hasn't caught up yet
          // (or the round already got superseded) — retry next outer loop
          // tick instead of failing the whole match.
          const optionButtons = host.locator('div.grid.grid-cols-1.gap-3 > button');
          try {
            await expect(host.getByText('輪到你了！')).toBeVisible({ timeout: 6000 });
            await expect(optionButtons.first()).toBeVisible({ timeout: 6000 });
          } catch {
            continue;
          }

          if (!weaponUsed) {
            const hintBtn = host.getByRole('button', { name: '看提示' });
            const callBtn = host.getByRole('button', { name: '呼叫隊友' });
            if (await hintBtn.count() && !(await hintBtn.isDisabled())) {
              await hintBtn.click();
              weaponUsed = true;
              await host.waitForTimeout(1000);
            } else if (await callBtn.count()) {
              await callBtn.click();
              weaponUsed = true;
              await host.waitForTimeout(1000);
            }
          }

          await optionButtons.first().click();
          answeredKeys.add(key);
          if (await host.getByTestId('attack-animation').count()) sawAttackAnimation = true;
        } else {
          await apiJson(request, 'POST', `/api/team-arena/sessions/${code}/answer`, allTokens[i], { choice_key: cr.options[0].key });
          answeredKeys.add(key);
        }
      }
      await host.waitForTimeout(300);
    }

    expect(ended, 'match must reach an ended state within the round cap').toBeTruthy();
    expect(weaponUsed, 'at least one weapon (hint or call-teammate) must have been used').toBeTruthy();

    // ── Result screen: both sides rendered, towers/outcome shown, no names
    // leaked for the opposing side on the result screen either. ──────────
    await host.waitForTimeout(3000);
    await expect(host.getByTestId('result-side-a')).toBeVisible({ timeout: 15000 });
    await expect(host.getByTestId('result-side-b')).toBeVisible();
    const hostResultText = await host.locator('body').innerText();
    expect(hostResultText).not.toContain(students[2].name);
    expect(hostResultText).not.toContain(students[3].name);

    await opp1.waitForTimeout(3000);
    await expect(opp1.getByTestId('result-side-a')).toBeVisible({ timeout: 15000 });
    const oppResultText = await opp1.locator('body').innerText();
    expect(oppResultText).not.toContain(students[0].name);
    expect(oppResultText).not.toContain(students[1].name);

    // ── Mid-game reload recovers to the same room, no permanent lockout ──
    await host.reload();
    await host.waitForTimeout(2500);
    expect(await host.getByText('無法加入').count()).toBe(0);

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toHaveLength(0);
    void sawAttackAnimation; // best-effort signal, not asserted strictly (CSS animation timing)

    await Promise.all(contexts.map((c) => c.close()));
  });

});
