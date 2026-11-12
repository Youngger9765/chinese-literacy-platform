/**
 * 課堂搶答 (live_quiz) — issue #3685.
 *
 * Three tests:
 *  1. (passing) Teacher real journey (sidebar → 遊戲區 → 課堂搶答 → setup
 *     → 開場) hosting for a real classroom; two enrolled students join via
 *     the real numeric-keypad UI and reach the waiting lobby.
 *  2. (passing, fixed by #3710) Playing a full game to the podium/
 *     leaderboard — previously blocked by a real bug: once the server-
 *     timed reading phase ended, every player's (and the host's) screen
 *     stayed stuck showing "看大螢幕讀題" forever and never revealed
 *     options, because the poll's version-based "unchanged" shortcut
 *     didn't encode that time-derived sub-phase transition. A page reload
 *     recovered instantly (proving it was a stale-cache bug, not a slow
 *     reading timer) — reproduced live on staging with a real account,
 *     not inferred from source.
 *  3. (passing, fixed by #3708) A student NOT enrolled in the host's
 *     classroom cannot join by code anymore — `join_game` now checks
 *     `ClassroomStudent` membership for the joining user, not just that
 *     the game's classroom has the feature on.
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
  BACKEND,
} from './helpers';

const MAX_ROUNDS = 150;

test.describe('課堂搶答 live_quiz', () => {
  test('teacher hosts, two enrolled students join via the real keypad and reach the lobby', async ({ page, browser, request }) => {
    test.setTimeout(180_000);

    const teacher = await registerTeacher(request, 'lq-teacher');
    const classroom = await createClassroomForTeacher(request, teacher, 'QA Live Quiz Class');
    await enableClassroomFeatures(request, teacher, classroom.id, { live_quiz: true });
    const students = await batchCreateStudents(request, teacher, classroom.id, 2, 'lq');

    const errors: string[] = [];
    const watch = (label: string, p: typeof page) => {
      p.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`[${label}] console: ${m.text().slice(0, 200)}`); });
    };
    watch('teacher', page);

    // ── Teacher: real entry → sidebar → 遊戲區 → 課堂搶答 → setup → 開場 ──
    await loginViaUI(page, teacher.email, teacher.password);
    await openGameHubViaSidebar(page);
    await openGameHubCard(page, '課堂搶答');
    await expect(page.getByRole('heading', { name: '班級經營' })).toBeVisible();
    await page.selectOption('select >> nth=0', { label: 'QA Live Quiz Class' });
    // Select the first available story checkbox (whichever lesson is first
    // in this environment's catalogue — the setup form itself has no
    // "select all" so picking one is the realistic minimum a teacher does).
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: '開場' }).click();
    await page.waitForURL(/\/teacher\/live\/[A-Z0-9]{6}/i, { timeout: 20000 });
    const code = page.url().split('/').pop()!;
    expect(code).toMatch(/^[A-Z0-9]{6}$/i);
    await expect(page.getByText(code)).toBeVisible();

    // ── Two enrolled students join via the real numeric-keypad UI ────────
    const ctxA = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const ctxB = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const sa = await ctxA.newPage();
    const sb = await ctxB.newPage();
    watch('studentA', sa);
    watch('studentB', sb);

    for (const [p, s] of [[sa, students[0]], [sb, students[1]]] as const) {
      await loginViaUI(p, s.email, s.password);
      await openGameHubViaSidebar(p);
      await openGameHubCard(p, '課堂搶答');
      await expect(p.getByRole('heading', { name: '加入課堂搶答' })).toBeVisible();
      for (const digit of code) {
        await p.getByRole('button', { name: digit, exact: true }).click();
      }
      await p.getByRole('button', { name: '下一步' }).click();
      await p.getByRole('button', { name: '確認加入' }).click();
      await expect(p.getByText('等待老師開始')).toBeVisible({ timeout: 15000 });
    }

    // ── Teacher's lobby reflects both real joins (not a fixed sleep — the
    // host's own lobby poll needs a moment to pick up each join). ────────
    await expect(async () => {
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/已加入\s*2\s*人/);
    }).toPass({ timeout: 15000, intervals: [1000] });

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toHaveLength(0);
    await ctxA.close();
    await ctxB.close();
  });

  /**
   * #3710 — fixed. Exercises the real game-to-leaderboard path end to
   * end; previously could not progress past round 1 because the polled
   * state_version never changed when the reading phase ended on the
   * clock alone.
   */
  test('teacher hosts, two enrolled students play a full game to the leaderboard', async ({ page, browser, request }) => {
    test.setTimeout(300_000);

    const teacher = await registerTeacher(request, 'lq-teacher-full');
    const classroom = await createClassroomForTeacher(request, teacher, 'QA Live Quiz Full Class');
    await enableClassroomFeatures(request, teacher, classroom.id, { live_quiz: true });
    const students = await batchCreateStudents(request, teacher, classroom.id, 2, 'lqfull');

    const errors: string[] = [];
    const watch = (label: string, p: typeof page) => {
      p.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`[${label}] console: ${m.text().slice(0, 200)}`); });
    };
    watch('teacher', page);

    await loginViaUI(page, teacher.email, teacher.password);
    await openGameHubViaSidebar(page);
    await openGameHubCard(page, '課堂搶答');
    await expect(page.getByRole('heading', { name: '班級經營' })).toBeVisible();
    await page.selectOption('select >> nth=0', { label: 'QA Live Quiz Full Class' });
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: '開場' }).click();
    await page.waitForURL(/\/teacher\/live\/[A-Z0-9]{6}/i, { timeout: 20000 });
    const code = page.url().split('/').pop()!;

    const ctxA = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const ctxB = await browser.newContext({ extraHTTPHeaders: getIapProxyAuthHeader() }) /* #3719 */;
    const sa = await ctxA.newPage();
    const sb = await ctxB.newPage();
    watch('studentA', sa);
    watch('studentB', sb);

    for (const [p, s] of [[sa, students[0]], [sb, students[1]]] as const) {
      await loginViaUI(p, s.email, s.password);
      await openGameHubViaSidebar(p);
      await openGameHubCard(p, '課堂搶答');
      for (const digit of code) {
        await p.getByRole('button', { name: digit, exact: true }).click();
      }
      await p.getByRole('button', { name: '下一步' }).click();
      await p.getByRole('button', { name: '確認加入' }).click();
      await expect(p.getByText('等待老師開始')).toBeVisible({ timeout: 15000 });
    }

    await page.getByRole('button', { name: '開始搶答' }).click();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      await page.waitForTimeout(500);
      for (const p of [sa, sb]) {
        const group = p.getByRole('group', { name: '選項' });
        if (await group.count()) {
          const btn = group.getByRole('button').first();
          // The answer window can close between the check and the click; the
          // options then unmount and an unbounded click would hang the test.
          if (await btn.count() && !(await btn.isDisabled())) await btn.click({ timeout: 2000 }).catch(() => {});
        }
      }
      // Same race as the student-button fix above (#3710/#3735), on the
      // host's own controls: the poll can land a 'question' -> 'reveal' or
      // 'reveal' -> next-'question' transition between this count() check
      // and the click's actionability wait, unmounting this exact button —
      // an unbounded click then waits forever for text that won't reappear
      // until a LATER loop iteration reaches it, deadlocking this whole
      // for-loop (reproduced on CI: stuck on this exact line for the full
      // 300s budget while the page had already moved on to the next round's
      // question screen). Bound + swallow, same as line 162, and let the
      // next iteration's fresh count() decide what to do.
      const revealBtn = page.getByRole('button', { name: '揭曉答案' });
      if (await revealBtn.count()) {
        await revealBtn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      const nextBtn = page.getByRole('button', { name: /下一題|查看頒獎台/ });
      if (await nextBtn.count()) {
        await nextBtn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      if (await page.getByRole('heading', { level: 1 }).count()) {
        const h1 = await page.getByRole('heading', { level: 1 }).first().innerText();
        if (h1 && !h1.includes('班級經營')) break; // podium reached
      }
    }

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
    for (const p of [sa, sb]) {
      // The end screen shows both 「課堂搶答結束！」 and a 「題答對」 stat line, so
      // a text match on either is ambiguous under strict mode; on the student
      // screen 「課堂搶答結束！」 is a <p>, not a heading, so match its text alone.
      await expect(p.getByText(/課堂搶答結束/)).toBeVisible({ timeout: 20000 });
    }

    expect(errors, `console/page errors:\n${errors.join('\n')}`).toHaveLength(0);
    await ctxA.close();
    await ctxB.close();
  });

  /**
   * #3685 acceptance criterion: "a student not in the class cannot join".
   *
   * #3708 — fixed. `live_quiz.engine.join_game` checks that the joining
   * user is a `ClassroomStudent` of the game's classroom. This test uses
   * an outsider student enrolled in a different classroom and verifies
   * rejection through the real `/live` → type code → confirm flow.
   */
  test('a student outside the class should not be able to join by code', async ({ page, request }) => {
    test.setTimeout(60_000);

    const teacher = await registerTeacher(request, 'lq-teacher-outsider');
    const classroomA = await createClassroomForTeacher(request, teacher, 'QA Live Quiz Class A');
    await enableClassroomFeatures(request, teacher, classroomA.id, { live_quiz: true });
    const classroomB = await createClassroomForTeacher(request, teacher, 'QA Live Quiz Class B (unrelated)');
    // Outsider's OWN classroom also has live_quiz on (so their game-hub card
    // is unlocked and they reach `/live` the same real way every other
    // student in this suite does) — the question under test is whether the
    // backend checks membership in THIS SPECIFIC game's classroom (A), not
    // whether the feature is enabled anywhere.
    await enableClassroomFeatures(request, teacher, classroomB.id, { live_quiz: true });
    const [outsider] = await batchCreateStudents(request, teacher, classroomB.id, 1, 'outsider');

    const teacherToken = teacher.token;
    const storiesRes = await request.get(`${BACKEND}/api/stories?page_size=1`, { headers: { Authorization: `Bearer ${teacherToken}` } });
    const firstStoryId = (await storiesRes.json()).stories[0].id as string;
    const storyDetail = await (await request.get(`${BACKEND}/api/stories/${firstStoryId}`, { headers: { Authorization: `Bearer ${teacherToken}` } })).json();

    const createRes = await request.post(`${BACKEND}/api/live-quiz/games`, {
      headers: { Authorization: `Bearer ${teacherToken}` },
      data: {
        lesson_uids: [storyDetail.lesson_uid],
        source_modules: ['comprehension'],
        seconds: 30,
        reading_pace: 'standard',
        question_count_mode: 10,
        classroom_id: classroomA.id,
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const code = (await createRes.json()).code as string;

    await loginViaUI(page, outsider.email, outsider.password);
    await openGameHubViaSidebar(page);
    await openGameHubCard(page, '課堂搶答');
    for (const digit of code) {
      await page.getByRole('button', { name: digit, exact: true }).click();
    }
    await page.getByRole('button', { name: '下一步' }).click();
    await page.getByRole('button', { name: '確認加入' }).click();
    await page.waitForTimeout(2000);

    // The outsider should see a rejection, not the lobby/question state
    // of a class they are not in.
    await expect(page.getByText(/等待老師開始|看大螢幕讀題/)).not.toBeVisible();
  });
});
