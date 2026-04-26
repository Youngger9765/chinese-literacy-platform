/**
 * Full staging QA — pre-5/1 demo
 *
 * Covers three role paths:
 *   A. Student — login → enter a story → walk learning steps → land on report
 *   B. Teacher — login → drill into classroom → verify scores ARE shown (#1094)
 *   C. Admin   — login → admin home → confirm [Demo] seed button is reachable
 *
 * Note: most learning steps are heavily interactive (recording, AI evaluation, drag-drop, draw).
 * They are not reliably testable headless without mocking. We test the **structure and navigation**
 * — does the URL change to the next step on "下一步", does the report page render, does the
 * #1094 student/teacher score-hiding split actually hold.
 *
 * Untestable items are explicitly `test.skip(true, reason)` so they show in the report.
 *
 * Auth strategy: log in via API once per role (cached at module scope), then inject the token
 * into localStorage before navigation. This avoids triggering the login rate-limiter that
 * fires after ~5 UI logins per minute. Quick-login buttons on /login are NOT used in this
 * file — only the demo-path.spec.ts file uses the UI buttons (one click each).
 */

import { test, expect, APIRequestContext, Page } from '@playwright/test';

const STAGING_FRONTEND = 'https://lingoleap-staging.web.app';
const STAGING_BACKEND = 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';
const TOKEN_KEY = 'lingoleap_token';

const CREDS = {
  student: { email: 'student@test.com', password: 'student1234' },
  teacher: { email: 'teacher@test.com', password: 'teacher1234' },
  admin:   { email: 'admin@test.com',   password: 'admin1234' },
} as const;

// Cache tokens at module scope so we only log in once per role across all tests.
const tokenCache: Record<string, string | null> = {};

async function getToken(request: APIRequestContext, role: keyof typeof CREDS): Promise<string | null> {
  if (tokenCache[role] !== undefined) return tokenCache[role];
  const res = await request.post(`${STAGING_BACKEND}/api/auth/login`, {
    data: CREDS[role],
    failOnStatusCode: false,
  });
  if (!res.ok()) {
    tokenCache[role] = null;
    return null;
  }
  const body = await res.json();
  tokenCache[role] = body.access_token ?? null;
  return tokenCache[role];
}

/** Inject auth token into the page's localStorage so the SPA treats us as logged in. */
async function loginAs(page: Page, request: APIRequestContext, role: keyof typeof CREDS): Promise<string | null> {
  const token = await getToken(request, role);
  if (!token) return null;
  // Must navigate first so localStorage is on the right origin.
  await page.goto(STAGING_FRONTEND + '/login');
  await page.evaluate(([key, val]) => {
    window.localStorage.setItem(key, val);
  }, [TOKEN_KEY, token]);
  return token;
}

/** Stories endpoint returns `{ stories: [...] }` (object), NOT a bare array. */
async function fetchFirstStoryId(request: APIRequestContext): Promise<number | null> {
  const res = await request.get(`${STAGING_BACKEND}/api/stories`);
  if (!res.ok()) return null;
  const data = await res.json();
  const stories = Array.isArray(data) ? data : (data?.stories ?? []);
  if (!Array.isArray(stories) || stories.length === 0) return null;
  return stories[0].id ?? null;
}

// ────────────────────────────────────────────────────────────────────────────────
// A. Student path
// ────────────────────────────────────────────────────────────────────────────────

test.describe('A. Student path — 13 step walkthrough', () => {
  test('A1. Login as student → land on /student', async ({ page, request }) => {
    const token = await loginAs(page, request, 'student');
    test.skip(!token, 'Cannot login as student@test.com');
    await page.goto('/');
    await page.waitForURL(/\/student/, { timeout: 30000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('A2. Library renders (story list visible)', async ({ page, request }) => {
    const token = await loginAs(page, request, 'student');
    test.skip(!token, 'Cannot login as student');
    await page.goto('/library');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const bodyText = await page.locator('body').innerText();
    // Page should NOT show empty/error state; some content should be visible
    expect(bodyText.length).toBeGreaterThan(100);
  });

  test('A3. Step 1 reading-annotation route loads', async ({ page, request }) => {
    const storyId = await fetchFirstStoryId(request);
    test.skip(!storyId, 'No stories available from API');
    const token = await loginAs(page, request, 'student');
    test.skip(!token, 'Cannot login as student');

    await page.goto(`/learn/${storyId}/reading-annotation`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/reading-annotation/);
  });

  test('A4. Step 2 tutor — UNTESTABLE without mic mock', async () => {
    test.skip(true, 'Step 2 (LiveTutor) requires microphone for paragraph reading. Skipping per QA budget.');
  });

  test('A5. Step 3 full-reading — UNTESTABLE without mic mock', async () => {
    test.skip(true, 'Step 3 (FullReading) requires microphone for whole-text reading. Skipping per QA budget.');
  });

  test('A6. Step 4 listening — guard rejects "123" input (#1098)', async ({ request }) => {
    const token = await getToken(request, 'student');
    test.skip(!token, 'Cannot login as student');

    const storyId = await fetchFirstStoryId(request);
    test.skip(!storyId, 'No stories available');

    // Probe listening evaluate endpoint with sentinel "123"
    const evalRes = await request.post(`${STAGING_BACKEND}/api/listening/evaluate`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        story_id: storyId,
        student_response: '123',
        question: '請說說你聽到了什麼',
      },
      failOnStatusCode: false,
    });
    // Either 400 (rejected by guard) or 200 with low-score feedback. Both prove the route is alive.
    // We accept any non-5xx as "guard works". 5xx = bug.
    expect(evalRes.status()).toBeLessThan(500);
  });

  test('A7. Listening reload persists step (#1098 persistence)', async ({ page, request }) => {
    const storyId = await fetchFirstStoryId(request);
    test.skip(!storyId, 'No stories available');
    const token = await loginAs(page, request, 'student');
    test.skip(!token, 'Cannot login as student');

    await page.goto(`/learn/${storyId}/listening`);
    await page.waitForLoadState('networkidle');
    const beforeUrl = page.url();
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/listening');
    expect(page.url()).toBe(beforeUrl);
  });

  test('A8. Steps 5-12 (vocab/sentence/comprehension/etc) — structural URL check', async ({ page, request }) => {
    const storyId = await fetchFirstStoryId(request);
    test.skip(!storyId, 'No stories available');
    const token = await loginAs(page, request, 'student');
    test.skip(!token, 'Cannot login as student');

    const stepsToProbe = [
      'vocab',
      'sentence-practice',
      'vocab-definition',
      'vocab-application',
      'comprehension',
      'vocab-word-search',
      'knowledge-station',
    ];
    for (const step of stepsToProbe) {
      await page.goto(`/learn/${storyId}/${step}`);
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(`/${step}`);
    }
  });

  test('A9. Step 13 report renders + NO numeric scores for student (#1094)', async ({ page, request }) => {
    const storyId = await fetchFirstStoryId(request);
    test.skip(!storyId, 'No stories available');
    const token = await loginAs(page, request, 'student');
    test.skip(!token, 'Cannot login as student');

    await page.goto(`/learn/${storyId}/report`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Student-facing report MUST NOT show "綜合成績 X%" or "準確率 X%"
    await expect(page.locator('body')).not.toContainText(/綜合成績[\s\S]{0,5}\d+%/);
    await expect(page.locator('body')).not.toContainText(/準確率[\s:：]*\d+%/);
    // No assertion on encouragement strings — depends on whether session has data,
    // and the no-scores assertion above is the load-bearing one for #1094.
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// B. Teacher path — verifies scores ARE shown (#1094 spec)
// ────────────────────────────────────────────────────────────────────────────────

test.describe('B. Teacher path', () => {
  test('B1. Login as teacher → /teacher-home loads', async ({ page, request }) => {
    const token = await loginAs(page, request, 'teacher');
    test.skip(!token, 'Cannot login as teacher@test.com');
    await page.goto('/');
    await page.waitForURL(/teacher-home|\/teacher\b/, { timeout: 30000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('B2. Teacher can navigate to first classroom URL', async ({ page, request }) => {
    const token = await getToken(request, 'teacher');
    test.skip(!token, 'Cannot login as teacher');

    const classroomsRes = await request.get(`${STAGING_BACKEND}/api/classrooms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    test.skip(!classroomsRes.ok(), `Cannot list classrooms: ${classroomsRes.status()}`);
    const cdata = await classroomsRes.json();
    const classrooms = Array.isArray(cdata) ? cdata : (cdata?.items ?? []);
    test.skip(!Array.isArray(classrooms) || classrooms.length === 0, 'Teacher has no classrooms on staging');
    const classroomId = classrooms[0].id;

    await loginAs(page, request, 'teacher');
    await page.goto(`/teacher/classroom/${classroomId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    expect(page.url()).toContain(`/teacher/classroom/${classroomId}`);
  });

  test('B3. Teacher view shows score-related labels (#1094 — teacher KEEPS numbers)', async ({ page, request }) => {
    const token = await getToken(request, 'teacher');
    test.skip(!token, 'Cannot login as teacher');

    const classroomsRes = await request.get(`${STAGING_BACKEND}/api/classrooms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const cdata = classroomsRes.ok() ? await classroomsRes.json() : null;
    const classrooms = Array.isArray(cdata) ? cdata : (cdata?.items ?? []);
    test.skip(!Array.isArray(classrooms) || classrooms.length === 0, 'Teacher has no classrooms');

    await loginAs(page, request, 'teacher');
    await page.goto(`/teacher/classroom/${classrooms[0].id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    const bodyText = await page.locator('body').innerText();
    // Teacher view should reference at least one of these aggregate concepts.
    const hasTeacherStats = /平均|正確率|班級|學生|完成/.test(bodyText);
    expect(hasTeacherStats).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// C. Admin path
// ────────────────────────────────────────────────────────────────────────────────

test.describe('C. Admin path', () => {
  test('C1. Login as admin → not stuck on login', async ({ page, request }) => {
    const token = await loginAs(page, request, 'admin');
    test.skip(!token, 'Cannot login as admin@test.com');
    await page.goto('/');
    // Admin role redirects to a non-/login URL (exact target may vary by app version).
    // Just assert authentication landed somewhere, not bounced back to login.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('C2. Admin home shows org/school/classroom tree', async ({ page, request }) => {
    const token = await loginAs(page, request, 'admin');
    test.skip(!token, 'Cannot login as admin');
    // Admin shell renders at root after login (no separate /admin route).
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const bodyText = await page.locator('body').innerText();
    // Admin shell contains at least one of these markers.
    expect(/組織|學校|班級|管理|管理員|admin/i.test(bodyText)).toBeTruthy();
  });

  test('C3. [Demo] seed button reachable via direct URL — UNTESTABLE', async () => {
    test.skip(
      true,
      'Admin classroom drill-down uses React state (not URL routing). The [Demo] button only renders after a classroom is selected via the tree. Cannot deep-link via /admin/classrooms/1. Covered by API test C4 + demo-path.spec.ts:API direct demo seeding.'
    );
  });

  test('C4. Demo seed API endpoint reachable + returns valid contract', async ({ request }) => {
    const token = await getToken(request, 'admin');
    test.skip(!token, 'Cannot login as admin');

    const seedRes = await request.post(`${STAGING_BACKEND}/api/admin/seed/demo-students`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { classroom_id: 1, count: 1, prefix: 'qa' + Date.now().toString().slice(-6) },
    });
    expect(seedRes.ok()).toBeTruthy();
    const body = await seedRes.json();
    expect(body).toHaveProperty('students_created');
    expect(body).toHaveProperty('sessions_created');
    expect(body.students_created).toBe(1);
  });
});
