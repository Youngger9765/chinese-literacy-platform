/**
 * 跨班賽季 + 劇情包 (league) — issue #3685.
 *
 * Two teachers, two classrooms, the real cross-class invite wizard
 * (teacher A "發出邀請" → teacher B "輸入邀請碼" → "接受邀請"), then a
 * student in classroom A's real `/student/our-class` page (reached via
 * sidebar → 遊戲區 → 跨班賽季, not a direct URL) renders the two-class
 * standings/BattleHero.
 *
 * For "a student's play updates their score": league points are derived
 * from `LearningSession.completed_at` with a real ≥3-minute anti-farming
 * floor (league_scoring.py `MIN_COMPLETION_DURATION`) — there is no
 * faster, still-real path. This test starts a real teacher-assigned
 * session via the app's own `/assignments/{id}/start` and `/submit`
 * endpoints (exactly what finishing a real assignment calls), waits the
 * real 3+ minutes, then reloads the student's own page and checks "我的
 * 貢獻" went from 0 to something. `test.setTimeout` is raised accordingly.
 */
import { test, expect } from '../fixtures/pageerror-fixture';
import { getIapProxyAuthHeader } from '../utils/iapAuth';
import {
  adminToken,
  batchCreateStudents,
  createClassroomForTeacher,
  createOrgLinkedSchool,
  enableClassroomFeatures,
  loginViaUI,
  openGameHubCard,
  openGameHubViaSidebar,
  registerTeacher,
  BACKEND,
} from './helpers';

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function watchErrors(label: string, p: import('@playwright/test').Page, bucket: string[]) {
  p.on('pageerror', (e) => bucket.push(`[${label}] pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      bucket.push(`[${label}] console: ${m.text().slice(0, 200)}`);
    }
  });
}

test.describe('跨班賽季 league', () => {
  test('two teachers run the real invite wizard and a student sees the two-class board', async ({ page, browser, request }) => {
    test.setTimeout(180_000);

    const schoolId = await createOrgLinkedSchool(request, `QA League School ${Date.now()}`);
    const teacherA = await registerTeacher(request, 'league-a');
    const teacherB = await registerTeacher(request, 'league-b');
    const classroomA = await createClassroomForTeacher(request, teacherA, 'QA League Class A', { schoolId });
    const classroomB = await createClassroomForTeacher(request, teacherB, 'QA League Class B', { schoolId });
    await enableClassroomFeatures(request, teacherA, classroomA.id, { league: true });
    await enableClassroomFeatures(request, teacherB, classroomB.id, { league: true });
    const [studentA] = await batchCreateStudents(request, teacherA, classroomA.id, 1, 'league');
    await batchCreateStudents(request, teacherB, classroomB.id, 1, 'league-b');

    const ctxB = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const pageB = await ctxB.newPage();
    const errors: string[] = [];
    watchErrors('teacherA', page, errors);
    watchErrors('teacherB', pageB, errors);

    // ── Teacher A: real entry → sidebar → 遊戲區 → 跨班賽季 → 發出邀請 ────
    await loginViaUI(page, teacherA.email, teacherA.password);
    await openGameHubViaSidebar(page);
    await openGameHubCard(page, '跨班賽季');
    await expect(page.getByRole('heading', { name: '跨班賽季' })).toBeVisible();
    await page.getByRole('button', { name: '發出邀請' }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    // game_start must be in the FUTURE at creation time — accept_invitation
    // auto-expires any invitation whose game_start has already passed
    // (league_service.py: `now >= invitation.game_start` -> EXPIRED). The
    // datetime-local input also truncates to minute precision, so a few
    // minutes' buffer survives that rounding plus the real time the UI
    // steps below take.
    const start = toLocalInputValue(new Date(Date.now() + 3 * 60 * 1000));
    const end = toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await page.fill('#invite-start', start);
    await page.fill('#invite-end', end);
    await page.getByRole('button', { name: '產生邀請碼' }).click();
    const code = (await page.locator('p.font-mono.font-black').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);

    // ── Teacher B: real entry → 跨班賽季 → 輸入邀請碼 → 接受邀請 ──────────
    await loginViaUI(pageB, teacherB.email, teacherB.password);
    await openGameHubViaSidebar(pageB);
    await openGameHubCard(pageB, '跨班賽季');
    await pageB.getByRole('button', { name: '輸入邀請碼' }).click();
    await pageB.getByPlaceholder('例如 AB3CD9EF').fill(code);
    await pageB.getByRole('button', { name: '查詢' }).click();
    await expect(pageB.getByText(/邀請來自/)).toBeVisible({ timeout: 10000 });
    await pageB.getByRole('button', { name: '接受邀請' }).click();
    await pageB.waitForTimeout(2000);

    // ── Student in class A: real entry → sidebar → 跨班賽季 → see board ──
    const ctxS = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const pageS = await ctxS.newPage();
    watchErrors('student', pageS, errors);
    await loginViaUI(pageS, studentA.email, studentA.password);
    await openGameHubViaSidebar(pageS);
    await openGameHubCard(pageS, '跨班賽季');
    await expect(pageS.getByRole('heading', { name: '我們班' })).toBeVisible();
    await expect(pageS.getByText('老師還沒有開啟跨班賽季')).toHaveCount(0);
    await expect(pageS.getByTestId('student-story-intro')).toBeVisible({ timeout: 15000 });
    await expect(pageS.getByText('我的貢獻')).toBeVisible();

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toHaveLength(0);
    await ctxB.close();
    await ctxS.close();
  });

  test('a student completing a real teacher-assigned lesson updates their league contribution', async ({ page, request }) => {
    // Real anti-farming floor is 3 minutes (league_scoring.py
    // MIN_COMPLETION_DURATION) — there is no faster real path to a counted
    // completion, so this test genuinely waits for it.
    test.setTimeout(6 * 60 * 1000);

    const schoolId = await createOrgLinkedSchool(request, `QA League Score School ${Date.now()}`);
    const teacherA = await registerTeacher(request, 'league-score-a');
    const teacherB = await registerTeacher(request, 'league-score-b');
    const classroomA = await createClassroomForTeacher(request, teacherA, 'QA League Score Class A', { schoolId });
    const classroomB = await createClassroomForTeacher(request, teacherB, 'QA League Score Class B', { schoolId });
    await enableClassroomFeatures(request, teacherA, classroomA.id, { league: true });
    await enableClassroomFeatures(request, teacherB, classroomB.id, { league: true });
    const [studentA] = await batchCreateStudents(request, teacherA, classroomA.id, 1, 'score');
    await batchCreateStudents(request, teacherB, classroomB.id, 1, 'score-b');

    const invRes = await request.post(`${BACKEND}/api/league/invitations`, {
      headers: { Authorization: `Bearer ${teacherA.token}` },
      data: {
        inviter_classroom_id: classroomA.id,
        inviter_team_grade: 4,
        // Same future-game_start requirement as the other test above —
        // must not have passed yet at accept time, or the invitation
        // auto-expires before it can be accepted.
        game_start: new Date(Date.now() + 60 * 1000).toISOString(),
        game_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(invRes.ok(), await invRes.text()).toBeTruthy();
    const code = (await invRes.json()).code as string;
    const acceptRes = await request.post(`${BACKEND}/api/league/invitations/${code}/accept`, {
      headers: { Authorization: `Bearer ${teacherB.token}` },
      data: { invitee_classroom_id: classroomB.id, invitee_team_grade: 4 },
    });
    expect(acceptRes.ok(), await acceptRes.text()).toBeTruthy();

    const storiesRes = await request.get(`${BACKEND}/api/stories?page_size=1`, { headers: { Authorization: `Bearer ${teacherA.token}` } });
    const firstStoryId = (await storiesRes.json()).stories[0].id as string;
    const assignRes = await request.post(`${BACKEND}/api/classrooms/${classroomA.id}/assignments`, {
      headers: { Authorization: `Bearer ${teacherA.token}` },
      data: { story_id: String(firstStoryId), assignment_type: 'reading' },
    });
    expect(assignRes.ok(), await assignRes.text()).toBeTruthy();
    const assignmentId = (await assignRes.json()).id as number;

    // ── Baseline: real UI, my contribution starts at 0 ────────────────────
    await loginViaUI(page, studentA.email, studentA.password);
    await openGameHubViaSidebar(page);
    await openGameHubCard(page, '跨班賽季');
    const contributionValue = page.locator('text=我的貢獻').locator('xpath=following-sibling::p[1]');
    await expect(contributionValue).toBeVisible({ timeout: 15000 });
    const before = (await contributionValue.innerText()).trim();

    // ── Real assignment session: start now, finish ≥3 real minutes later ──
    // Driven through the already-authenticated browser page itself (not a
    // fresh API login) because loginViaUI already rotated this student's
    // password past the forced first-login change — the original temp
    // password from batchCreateStudents no longer works.
    // Absolute BACKEND URL, not a relative `/api/...` path — a relative
    // fetch resolves against the CURRENT PAGE's origin, which only happens
    // to proxy `/api/**` to the backend on `lingoleap-staging.web.app`
    // (Firebase Hosting rewrite). CI's PLAYWRIGHT_BASE_URL points directly
    // at the Cloud Run frontend service instead, which has no such rewrite
    // and returned a bare nginx 405 for this POST (#3685 CI failure). The
    // real app itself always calls the backend's own absolute origin
    // (`VITE_API_URL`), so this is also just matching real behavior, not a
    // CI-only patch.
    await page.evaluate(async ({ id, backend }) => {
      const token = window.localStorage.getItem('lingoleap_token');
      const res = await fetch(`${backend}/api/assignments/${id}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`start failed: ${res.status} ${await res.text()}`);
    }, { id: assignmentId, backend: BACKEND });

    await page.waitForTimeout(3 * 60 * 1000 + 10_000);

    await page.evaluate(async ({ id, backend }) => {
      const token = window.localStorage.getItem('lingoleap_token');
      const res = await fetch(`${backend}/api/assignments/${id}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`submit failed: ${res.status} ${await res.text()}`);
    }, { id: assignmentId, backend: BACKEND });

    await page.reload();
    await expect(contributionValue).toBeVisible({ timeout: 15000 });
    const after = (await contributionValue.innerText()).trim();

    expect(before).toBe('0');
    expect(after, `expected contribution to increase from "${before}" after a real completed assignment`).not.toBe('0');
  });
});
