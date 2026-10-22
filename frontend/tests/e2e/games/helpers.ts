/**
 * Shared setup helpers for the game-area e2e specs (#3685).
 *
 * All data creation goes through the app's own public APIs — the same
 * endpoints the real frontend calls — never direct DB writes. Gameplay
 * itself is driven through the real browser UI in each spec; these
 * helpers only get freshly-named QA accounts logged in and past the
 * first-login gates (forced password change + terms-of-service) so the
 * spec body can start at the real entry point (sidebar → game hub).
 *
 * Account naming: every email contains `qa-game-e2e` so these are
 * trivially recognizable as disposable QA fixtures on staging, matching
 * this repo's existing test-domain convention (see
 * `test_seed_service.py`'s `_DEMO_EMAIL_DOMAIN`).
 */
import type { APIRequestContext, Page } from '@playwright/test';

export const BACKEND = process.env.E2E_BACKEND_URL
  || 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

// Matches the repo's existing test-account domain convention
// (test_seed_service.py's `_DEMO_EMAIL_DOMAIN = "testdata.lingoleap.dev"`).
// `.test`/`.example` are RFC 2606 reserved TLDs that pydantic's email
// validator rejects outright — this must be a real, non-reserved TLD.
const QA_DOMAIN = 'qa-game-e2e.lingoleap.dev';

export function uniqueTag(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function randomPassword(): string {
  return `QaGame${uniqueTag()}Aa`;
}

// ── Raw API helpers (same endpoints the app itself calls) ──────────────────

async function apiPost(request: APIRequestContext, path: string, token: string | null, data?: unknown) {
  const res = await request.post(`${BACKEND}${path}`, {
    data: data ?? {},
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`POST ${path} -> ${res.status()}: ${body}`);
  }
  return res.json();
}

async function apiGet(request: APIRequestContext, path: string, token: string | null) {
  const res = await request.get(`${BACKEND}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`GET ${path} -> ${res.status()}: ${body}`);
  }
  return res.json();
}

async function apiPatch(request: APIRequestContext, path: string, token: string | null, data: unknown) {
  const res = await request.patch(`${BACKEND}${path}`, {
    data,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`PATCH ${path} -> ${res.status()}: ${body}`);
  }
  return res.json();
}

export async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${BACKEND}/api/auth/login`, { data: { email, password } });
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return body.access_token as string;
}

/** admin@test.com / admin1234 is the repo's long-standing system_admin demo
 * account (used by demo-path.spec.ts and full-qa.spec.ts already). We only
 * use admin power for the one thing a plain teacher token cannot do:
 * creating a classroom's school with an `organization_id` set, which is a
 * prerequisite for the league's same-org invite check (league_service.py
 * `_require_same_org`). Everything else (features, students, invites,
 * gameplay) runs under the teacher/student's own token. */
export async function adminToken(request: APIRequestContext): Promise<string> {
  return apiLogin(request, 'admin@test.com', 'admin1234');
}

export async function firstOrganizationId(request: APIRequestContext, token: string): Promise<string> {
  const body = await apiGet(request, '/api/organizations', token);
  const items = body.items as Array<{ id: string }>;
  if (!items.length) throw new Error('No organization exists on staging to attach a school to');
  return items[0].id;
}

export interface QaTeacher {
  email: string;
  password: string;
  token: string;
  userId: number;
}

/** Register a brand-new teacher via the app's own self-registration
 * endpoint (POST /api/auth/register) — exactly what a real teacher
 * signing up would call. */
export async function registerTeacher(request: APIRequestContext, label: string): Promise<QaTeacher> {
  const tag = uniqueTag();
  const email = `qa-${label}-${tag}@${QA_DOMAIN}`;
  const password = randomPassword();
  await apiPost(request, '/api/auth/register', null, { email, password, name: `QA ${label} 老師`, role: 'teacher' });
  const token = await apiLogin(request, email, password);
  const me = await apiGet(request, '/api/users/me', token);
  return { email, password, token, userId: me.id as number };
}

/** Create a school already attached to an existing organization (as
 * system_admin) so two independently-registered teachers' classrooms can
 * pass the league's same-org invite check. A self-registered teacher's
 * auto-created school always has `organization_id = null` (see
 * auth_registration_service.py), so this step cannot be skipped. */
export async function createOrgLinkedSchool(request: APIRequestContext, name: string): Promise<number> {
  const admin = await adminToken(request);
  const orgId = await firstOrganizationId(request, admin);
  const school = await apiPost(request, '/api/schools', admin, { name, organization_id: orgId });
  return school.id as number;
}

export interface QaClassroom {
  id: number;
  joinCode: string;
}

/** Create a classroom for `teacher` inside `schoolId`. When `schoolId` is
 * omitted, uses admin power to create it directly in the teacher's own
 * auto-assigned school (fast path for modes that don't need cross-school
 * linkage, e.g. team_arena/pk/live_quiz/escape_room setup). When
 * `schoolId` is given (the org-linked school from createOrgLinkedSchool),
 * admin creates the classroom on the teacher's behalf via the documented
 * `teacher_id` override (classroom_crud.py) — a regular teacher token
 * cannot create a classroom in a school they are not a member of. */
export async function createClassroomForTeacher(
  request: APIRequestContext,
  teacher: QaTeacher,
  name: string,
  opts: { schoolId?: number; grade?: number } = {},
): Promise<QaClassroom> {
  let schoolId = opts.schoolId;
  let token = teacher.token;
  if (schoolId == null) {
    const me = await apiGet(request, '/api/users/me', teacher.token);
    const schoolRole = (me.roles as Array<{ scope_type: string; scope_id: string }>).find(
      (r) => r.scope_type === 'school',
    );
    if (!schoolRole) throw new Error(`teacher ${teacher.email} has no school scope`);
    schoolId = Number(schoolRole.scope_id);
  } else {
    token = await adminToken(request);
  }
  const body: Record<string, unknown> = { name, school_id: schoolId, grade: opts.grade ?? 4 };
  if (token !== teacher.token) body.teacher_id = teacher.userId;
  const classroom = await apiPost(request, '/api/classrooms', token, body);
  return { id: classroom.id as number, joinCode: classroom.join_code as string };
}

export async function enableClassroomFeatures(
  request: APIRequestContext,
  teacher: QaTeacher,
  classroomId: number,
  features: { pk_human?: boolean; live_quiz?: boolean; league?: boolean },
): Promise<void> {
  await apiPatch(request, `/api/classrooms/${classroomId}/pk-settings`, teacher.token, features);
}

export interface QaStudent {
  name: string;
  username: string;
  email: string;
  password: string;
  userId: number;
}

/** Batch-create N real student accounts in a classroom (POST
 * /classrooms/{id}/students/batch) — same endpoint a teacher's roster
 * upload UI calls. Returns login credentials for each. */
export async function batchCreateStudents(
  request: APIRequestContext,
  teacher: QaTeacher,
  classroomId: number,
  count: number,
  labelPrefix: string,
): Promise<QaStudent[]> {
  const tag = uniqueTag().slice(-4);
  const students = Array.from({ length: count }, (_, i) => ({
    name: `${labelPrefix}${tag}-${i + 1}`,
    seat_number: `${tag}${i + 1}`,
  }));
  const res = await apiPost(request, `/api/classrooms/${classroomId}/students/batch`, teacher.token, { students });
  if (res.errors?.length) throw new Error(`batch create errors: ${JSON.stringify(res.errors)}`);
  const created = res.created as Array<{ name: string; username: string; password: string; user_id: number }>;
  return created.map((c) => ({
    name: c.name,
    username: c.username,
    email: `${c.username.toLowerCase()}@student.lingoleap.local`,
    password: c.password,
    userId: c.user_id,
  }));
}

// ── Real-UI login (forced password change + terms gate included) ──────────

async function acceptTermsIfShown(page: Page): Promise<void> {
  // The exact copy/checkbox-count on this screen has drifted from
  // TermsModal.tsx's source at least once already (staging showed a
  // single-checkbox "我了解這是學習平台…" student variant with a "同意並
  // 繼續" button, not the 4-checkbox "使用條款同意書" this repo's source
  // currently defines) — match loosely on structure, not exact copy.
  const heading = page.getByRole('heading', { name: /使用條款/ });
  await heading.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (!(await heading.count())) return;
  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    await boxes.nth(i).check({ force: true });
  }
  await page.getByRole('button', { name: /同意/ }).click();
  await page.waitForTimeout(1000);
}

/** A brand-new student account's first landing on `/student` shows a
 * "歡迎來到朗朗上口！" onboarding tour overlay with a "跳過" (skip)
 * button — its backdrop blocks every other click until dismissed. */
async function skipOnboardingTourIfShown(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: '跳過' });
  // Whether this shows at all appears to depend on which page the student
  // lands on post-terms (observed: shown after landing on `/student`, not
  // after `/library`) — wait briefly rather than an instant, racy count().
  await skip.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  if (await skip.count()) {
    await skip.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Log a student or teacher in through the REAL `/login` form (not token
 * injection) — this is the real entry point the issue asks every spec to
 * walk from. Handles the two first-login gates a fresh batch-created
 * student always hits: forced `/change-password`, then the terms modal.
 *
 * For a fresh student account, pass `newPassword` — any value satisfying
 * the password-strength rule works, it is never used again by the spec.
 */
export async function loginViaUI(
  page: Page,
  email: string,
  password: string,
  opts: { newPassword?: string } = {},
): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.getByRole('button', { name: '登入', exact: true }).click();

  await page.waitForFunction(
    () => !location.pathname.startsWith('/login'),
    null,
    { timeout: 30000 },
  );

  if (page.url().includes('/change-password')) {
    const newPassword = opts.newPassword ?? randomPassword();
    await page.fill('#current-password', password);
    await page.fill('#new-password', newPassword);
    await page.fill('#confirm-password', newPassword);
    await page.getByRole('button', { name: '設定新密碼' }).click();
    await page.waitForFunction(
      () => !location.pathname.startsWith('/change-password'),
      null,
      { timeout: 30000 },
    );
  }

  await page.waitForTimeout(500);
  await acceptTermsIfShown(page);
  await skipOnboardingTourIfShown(page);

  // #3714: StudentHome's own classroom-fetch effect calls an unguarded
  // `navigate(..., {replace:true})` when it resolves — with no "component
  // still mounted" check. If that fetch is still in flight when the next
  // helper clicks a sidebar item (openGameHubViaSidebar, immediately
  // after this function returns in every spec), the late response can
  // silently drag the browser BACK to `/library?classroom=X` seconds
  // later, overriding wherever the user has since navigated to — this is
  // the real bug, reproduced live and reported, not inferred. Letting that
  // fetch settle here (its usual real-world latency) before any spec's
  // next click closes the race window this harness would otherwise walk
  // straight into, every time, for every spec.
  await page.waitForTimeout(4000);
}

/** Navigate from wherever the student currently is to the game hub via the
 * real sidebar entry (not a direct `page.goto('/game-hub')`). */
export async function openGameHubViaSidebar(page: Page): Promise<void> {
  await page.getByRole('button', { name: '遊戲區' }).first().click();
  await page.waitForURL(/\/(game-hub|teacher\/game-hub)/, { timeout: 15000 });
}

/** Click a game-hub card by its exact label (e.g. "多人對抗賽", "PK 對戰",
 * "迷城密室", "課堂搶答", "跨班賽季"). Throws a clear error if the card is
 * locked (teacher hasn't enabled the classroom feature yet) instead of a
 * confusing Playwright timeout. */
export async function openGameHubCard(page: Page, label: string): Promise<void> {
  // The hub page is a lazy-loaded chunk (`lazy(() => import(...))`) — right
  // after the sidebar click flips the URL, there is a brief Suspense
  // fallback before any card renders. Wait (not an instant `.count()`
  // check) before deciding the card is actually missing/locked.
  //
  // Student hub cards (StudentGameHubPage) set `aria-label={card.label}`
  // exactly. Teacher hub cards (TeacherGameHubPage) have no aria-label at
  // all — their accessible name is the label + description text
  // concatenated (emoji is aria-hidden) — so match "starts with label"
  // instead of an exact match to cover both.
  const unlocked = page.getByRole('button', { name: new RegExp(`^${label}(?!（)`) });
  const locked = page.getByRole('button', { name: new RegExp(`^${label}（`) });

  // Try the unlocked form first, generously — the lock state itself can
  // briefly render as "locked" before the classrooms fetch resolves, so
  // racing the two waits can catch that transient and misreport a truly
  // unlocked card as locked. Only fall back to checking "locked" once the
  // unlocked form has genuinely never shown up.
  //
  // One retry built in: CI hit a case (#3685) where the current page was
  // not actually the game hub at all — `/library?classroom=X` — because
  // of the real #3714 navigation race (StudentHome's unguarded async
  // redirect winning against the user's own subsequent click). A reload
  // re-triggers that exact same race (it reloads `/library`, not
  // `/game-hub`) so it cannot help; re-clicking the sidebar entry again
  // does, since by the second attempt the stale redirect has long since
  // fired and can't win a second time.
  for (let attempt = 0; attempt < 2; attempt++) {
    const appeared = await unlocked.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
    if (appeared) {
      await unlocked.click();
      return;
    }
    if (await locked.count()) {
      throw new Error(`Game hub card "${label}" is locked (classroom feature not enabled)`);
    }
    if (attempt === 0) {
      await openGameHubViaSidebar(page);
    }
  }
  throw new Error(`Game hub card "${label}" not found at all (even after retrying the sidebar click)`);
}
