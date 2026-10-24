import { test, expect } from './fixtures/pageerror-fixture';
import { chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getIapProxyAuthHeader } from './utils/iapAuth';

/**
 * progressRecheck3694.spec.ts — rerunnable regression check for #3694/#3695/#3707
 * ("學生做完的關卡會被系統清掉，作業永遠不算完成" and its siblings).
 *
 * Ported from the ad-hoc recheck.mjs script written while diagnosing the
 * teacher-reported bug (#3682) — that script is what caught #3707 in the
 * first place (the production symptom: reopening a lesson sends a
 * steps_completed: [] PUT before the student's real progress has loaded).
 * This file is the same checks, committed so they run on every PR instead
 * of living only in a throwaway scratchpad.
 *
 * Creates its own disposable QA teacher / classroom / student / assignment
 * for lesson 20017 (感情小日記1) — self-contained, no dependency on seeded
 * demo data. Headless only (project config already enforces this).
 *
 * Three checks, run as one continuous flow because (b) and (c) build on the
 * half-done progress (a) establishes:
 *   (a) reopening the lesson N times, never acting, must never shrink the
 *       server's steps_completed — and the frontend must never even SEND a
 *       PUT with fewer completed steps than the server already has.
 *   (b) resuming via 班級作業→繼續 keeps the round param (`?p=`) and saves
 *       progress under the required (round-keyed) step id, not a bare one.
 *   (c) finishing every remaining step and reaching the report through the
 *       real entry (assignments list → 繼續/開始) shows 已完成 on the
 *       teacher's assignment page, with each step solved exactly once.
 */

const FE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
const BE = process.env.E2E_BACKEND_URL
  || 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';
const REOPENS = Number(process.env.E2E_RECHECK_REOPENS || '6');
const LESSON = '20017';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_FIXTURE = path.join(__dirname, 'fixtures', 'recheck-read.wav');

// #3707 — fixed by test/issue-3707-empty-save-on-reopen (useLearningSessionBootstrap's
// hasCheckedStoredSession / hasCheckedForOrphanedSession gates). Flip to `true` once
// that fix has merged AND deployed to the environment this spec runs against, then
// delete this flag + the branch below that reads it (check (a) becomes a normal,
// unconditional assertion again). Until then this spec reports the known gap via a
// test annotation instead of failing the whole gate on an environment that hasn't
// received the fix yet — same idiom multiTextJourney.spec.ts uses for EXPECT_DEPLOYED.
const EXPECT_3707_FIXED = true; // #3711 merged to staging (5f5995666, descendant-verified) and confirmed serving 100% traffic — flipping now per task instructions.

// 10 min wasn't enough margin — the original recheck.mjs's own successful runs
// against real environments (see the scratchpad logs this was ported from)
// typically took ~11-12 min end to end for this same full (a)+(b)+(c) flow.
test.describe.configure({ timeout: 900_000 });

// ── API helpers (plain fetch — this is Node, not a browser context) ─────────
// #3719: plain Node `fetch` doesn't go through Playwright's request/page
// fixtures, so it does NOT inherit playwright.config.ts's extraHTTPHeaders —
// the IAP header has to be added explicitly here.
async function api(method: string, path: string, body?: unknown, tok?: string) {
  const r = await fetch(BE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...getIapProxyAuthHeader(),
      ...(tok ? { Authorization: 'Bearer ' + tok } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j: unknown;
  try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${String(t).slice(0, 200)}`);
  return j as unknown;
}
const login = async (email: string, password: string) =>
  ((await api('POST', '/api/auth/login', { email, password })) as { access_token: string }).access_token;
const pw = () => 'QaRecheck-' + crypto.randomBytes(4).toString('hex') + 'A1!';

interface Account {
  teacher: { email: string; pw: string };
  classroom: number;
  student: { username: string; pw: string; id: number };
  assignment: number;
}

async function setup(): Promise<Account> {
  const ts = Date.now();
  const t = { email: `qa-recheck-${ts}@example.com`, pw: pw() };
  await api('POST', '/api/auth/register', { email: t.email, password: t.pw, name: 'QA回歸檢查老師', role: 'teacher' });
  const tt = await login(t.email, t.pw);
  await api('POST', '/api/auth/accept-terms', {}, tt);
  const me = (await api('GET', '/api/users/me', null, tt)) as { roles: Array<{ scope_id?: string }> };
  const school = me.roles.find((r) => r.scope_id)?.scope_id;
  const c = (await api('POST', '/api/classrooms', { name: `QA回歸檢查-${ts}-請勿使用`, school_id: Number(school), grade: 4 }, tt)) as { id: number };
  const b = (await api('POST', `/api/classrooms/${c.id}/students/batch`, { students: [{ name: 'QA回歸學生', seat_number: '1' }] }, tt)) as {
    created: Array<{ user_id: number; username: string; password: string }>;
  };
  const s0 = b.created[0];
  const s = { username: s0.username, pw: pw(), id: s0.user_id };
  let st = await login(s.username, s0.password);
  await api('POST', '/api/auth/change-password', { old_password: s0.password, new_password: s.pw }, st);
  st = await login(s.username, s.pw);
  await api('POST', '/api/auth/accept-terms', {}, st);
  const a = (await api('POST', `/api/classrooms/${c.id}/assignments`, { story_id: LESSON, title: 'QA 回歸檢查 感情小日記1' }, tt)) as { id: number };
  return { teacher: t, classroom: c.id, student: s, assignment: a.id };
}

async function serverProgress(acc: Account) {
  const tok = await login(acc.student.username, acc.student.pw);
  const my = (await api('GET', '/api/assignments/my', null, tok)) as
    | Array<{ id?: number; assignment_id?: number; session_id?: number; submission?: { session_id?: number }; status?: string }>
    | { assignments?: Array<{ id?: number; assignment_id?: number; session_id?: number; submission?: { session_id?: number }; status?: string }> };
  const rows = Array.isArray(my) ? my : my.assignments || [];
  const row = rows.find((x) => (x.id ?? x.assignment_id) === acc.assignment) || (Array.isArray(my) ? my[0] : undefined);
  const sid = row?.session_id ?? row?.submission?.session_id;
  if (!sid) return { status: row?.status, done: [] as string[], sid: null as number | null };
  const p = (await api('GET', `/api/learning/sessions/${sid}/progress`, null, tok)) as {
    step_progress?: { steps_completed?: string[]; current_step?: string };
  };
  return { status: row?.status, sid, done: p.step_progress?.steps_completed || [], cur: p.step_progress?.current_step };
}

// ── Browser helpers ──────────────────────────────────────────────────────────
interface PutRecord { tag: string; url?: string; v?: number; cur?: string | null; done: string[]; status?: number }

/** Tracks every context this spec opens, so (1) the pageerror check below can
 *  cover ALL of them (the auto-wired pageerror-fixture only covers the
 *  default `page` fixture — everything here is additional, manually-created
 *  contexts, same pattern recheck.mjs used before this was a Playwright
 *  test) and (2) nothing is left open if an assertion throws mid-flow. */
function makeActorFactory(browser: Browser, puts: PutRecord[], pageErrors: string[]) {
  let storage: Awaited<ReturnType<BrowserContext['storageState']>> | null = null;
  const openContexts: BrowserContext[] = [];

  async function newPage(acc: Account, tag: string): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      permissions: ['microphone'],
      // #3719: this browser/context is launched manually (`chromium.launch()`),
      // not the test's default `page` fixture — it does NOT inherit
      // playwright.config.ts's extraHTTPHeaders, so the IAP header must be
      // passed explicitly here too.
      extraHTTPHeaders: getIapProxyAuthHeader(),
      ...(storage ? { storageState: storage } : {}),
    });
    openContexts.push(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (err) => pageErrors.push(`[${tag}] ${err.message}`));
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().includes('/progress')) {
        try {
          const j = JSON.parse(r.postData() || '{}');
          puts.push({ tag, url: (r.url().match(/sessions\/(\d+)/) || [])[1], v: j.version, cur: j.current_step, done: j.steps_completed || [] });
        } catch { /* beacon/non-JSON */ }
      }
    });
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && r.url().includes('/progress')) {
        const last = [...puts].reverse().find((p) => p.tag === tag && p.status === undefined);
        if (last) last.status = r.status();
      }
    });
    if (!storage) {
      await page.goto(FE + '/login');
      await page.waitForTimeout(2500);
      await page.locator('input').first().fill(acc.student.username);
      await page.locator('input[type=password]').fill(acc.student.pw);
      await page.locator('button[type=submit]').first().click();
      await page.waitForTimeout(4000);
      storage = await ctx.storageState();
    }
    return { ctx, page };
  }

  async function closeCtx(ctx: BrowserContext, page: Page) {
    await page.waitForTimeout(7000); // > 5s debounce — let any pending PUT fire before we capture storageState
    storage = await ctx.storageState();
    // Close the tab the way a child does, so beforeunload/pagehide run and the
    // app's keepalive flush (useProgressSync) sends whatever the debounce still
    // holds. ctx.close() alone skips unload handlers, so a save the debounce
    // re-armed during the wait above would be dropped by the TEST, not the app.
    await page.close({ runBeforeUnload: true });
    await new Promise((r) => setTimeout(r, 3000));
    await ctx.close();
    openContexts.splice(openContexts.indexOf(ctx), 1);
  }

  async function closeAllRemaining() {
    for (const ctx of [...openContexts]) await ctx.close().catch(() => {});
  }

  return { newPage, closeCtx, closeAllRemaining };
}

const ok = (page: Page) => page.getByRole('button', { name: '我知道了' }).click({ timeout: 1500 }).catch(() => {});
const skipTour = (page: Page) => page.getByRole('button', { name: '跳過' }).click({ timeout: 2500 }).catch(() => {});
const nextLevel = async (page: Page) => {
  await page.getByRole('button', { name: /下一關/ }).first().click();
  await page.waitForTimeout(3500);
  await ok(page);
};

const fmtPut = (p: PutRecord) => `v${p.v} ${p.status ?? '?'} [${p.tag}] cur=${p.cur} done=[${p.done.map((d) => d.split('#')[0]).join(',')}]`;

test('重開不縮水 / 繼續接續正確 / 做完老師端顯示完成 (#3694/#3695/#3707)', async ({ page: defaultPage }) => {
  const puts: PutRecord[] = [];
  const pageErrors: string[] = [];
  // A dedicated browser (not the ambient `browser` fixture) because
  // --use-file-for-fake-audio-capture is a browser-LAUNCH flag, not a
  // per-context option — the key-passage-reading solver's 完成/非常流暢
  // flow needs a real (fake-device) audio source behind the granted
  // microphone permission, same as the original recheck.mjs this is
  // ported from. Closed in the `finally` block below either way.
  const ownBrowser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${AUDIO_FIXTURE}`],
  });
  const { newPage, closeCtx, closeAllRemaining } = makeActorFactory(ownBrowser, puts, pageErrors);
  // The pageerror-fixture already wires the default `page` into its own
  // after-test assertion; also forward its errors into our shared pool so
  // the final assertion (and any screenshots we attach) see everything in
  // one place regardless of which context produced it.
  defaultPage.on('pageerror', (err) => pageErrors.push(`[default] ${err.message}`));

  const story = (await api('GET', `/api/stories/${LESSON}`)) as {
    step_sequence: string[];
    vocabulary: Array<{ word: string; definition: string }>;
    fill_in_blank: Array<{ sentence: string; answer: number }>;
    vocab_bank: string[];
    vocab_review: { answer_paths: Array<{ cells: Array<[number, number]> }> };
  };
  const REQUIRED = story.step_sequence.filter((k) => !/^(lesson-intro|report)$/.test(k.split('#')[0]));
  const P: Record<string, string> = Object.fromEntries(story.step_sequence.map((k) => [k.split('#')[0], k.split('#')[1]]));
  const url = (base: string) => `${FE}/learn/${LESSON}/${base}${P[base] ? '?p=' + P[base] : ''}`;

  // Step solvers — these answer keys are lesson 20017 (感情小日記1) specific,
  // derived from the lesson's own served content where the API shape allows
  // (vocabulary/fill_in_blank/vocab_review), hardcoded where it doesn't
  // (comprehension MCQ choice text, keypoints-table cell answers, spotlight
  // choices) — same as the original recheck.mjs this is ported from.
  const VMAP: Record<string, string> = Object.fromEntries(story.vocabulary.map((v) => [v.definition, v.word]));
  const FIB: Record<string, string> = Object.fromEntries(
    story.fill_in_blank.map((x) => [x.sentence.split('（')[0].slice(-8), story.vocab_bank[x.answer]]),
  );
  const COMP = ['當她穿著', '害羞與緊張', '感到不確定', '小智', '像是在腦袋裡播'];

  const solve: Record<string, (pg: Page) => Promise<void>> = {
    'full-text-annotate': async (pg) => {
      await ok(pg);
      await pg.getByRole('button', { name: /完成標記/ }).click();
      await pg.waitForTimeout(4000);
    },
    'key-passage-reading': async (pg) => {
      await pg.getByRole('button', { name: /開始朗讀/ }).click();
      await pg.waitForTimeout(46000);
      await pg.getByRole('button', { name: /^check_circle 完成/ }).click();
      for (let i = 0; i < 15 && !(await pg.getByRole('button', { name: /非常流暢/ }).count()); i++) await pg.waitForTimeout(4000);
      await pg.getByRole('button', { name: /非常流暢/ }).click();
      await pg.waitForTimeout(800);
      await nextLevel(pg);
    },
    'vocab-definition': async (pg) => {
      await ok(pg);
      const redo = pg.getByRole('button', { name: '重新做題' });
      if (await redo.count()) { await redo.click(); await pg.waitForTimeout(1500); }
      for (let i = 0; i < 9; i++) {
        await pg.waitForTimeout(1300);
        const t = await pg.locator('body').innerText();
        const def = Object.keys(VMAP).find((k) => t.includes(k));
        if (!def) break;
        await pg.locator('button:visible', { hasText: VMAP[def] }).last().click();
        await pg.waitForTimeout(1300);
      }
      await pg.getByRole('button', { name: /前往拖拉配對/ }).click();
      await pg.waitForTimeout(2500);
      await ok(pg);
      for (let it = 0; it < 15; it++) {
        const zones = pg.getByText('拖拉語詞到這裡');
        if (!(await zones.count())) break;
        const z = zones.first();
        const def = await z.evaluate((e, keys) => {
          let p: HTMLElement | null = e as HTMLElement;
          for (let i = 0; i < 8; i++) {
            p = p!.parentElement;
            if (!p) return null;
            const h = (keys as string[]).filter((k) => p!.innerText.includes(k));
            if (h.length === 1) return h[0];
            if (h.length > 1) return null;
          }
          return null;
        }, Object.keys(VMAP));
        if (!def) break;
        await pg.locator('[draggable=true]:visible', { hasText: VMAP[def] }).first().dragTo(z, { timeout: 5000 }).catch(() => {});
        await pg.waitForTimeout(600);
      }
      await pg.waitForTimeout(2000);
      await nextLevel(pg);
    },
    'vocab-application': async (pg) => {
      await ok(pg);
      for (let i = 0; i < 8; i++) {
        await pg.waitForTimeout(1300);
        const t = await pg.locator('body').innerText();
        const k = Object.keys(FIB).find((kk) => t.includes(kk));
        if (!k) break;
        await pg.locator('button:visible', { hasText: FIB[k] }).first().click();
        await pg.waitForTimeout(1300);
      }
      await pg.waitForTimeout(1500);
      await nextLevel(pg);
    },
    'keypoints-table': async (pg) => {
      await ok(pg);
      const ins = pg.locator('input[placeholder="　"]:visible');
      const A = ['聯絡簿', '體育', '心跳', '眼神', '名字'];
      for (let i = 0; i < (await ins.count()); i++) await ins.nth(i).fill(A[i] || 'x');
      await pg.getByText('不知所措').click();
      await pg.getByText('深情思念').click();
      await pg.getByRole('button', { name: '提交答案' }).click();
      await pg.waitForTimeout(15000);
      await nextLevel(pg);
    },
    spotlight: async (pg) => {
      await ok(pg);
      const o = pg.getByRole('button', { name: '難以區分', exact: true });
      const n = await o.count();
      for (let i = 0; i < n; i++) await o.nth(i).click();
      await pg.getByText('A. 如果有頻繁的聊天').first().click();
      await pg.getByRole('button', { name: '確認', exact: true }).click().catch(() => {});
      await pg.waitForTimeout(1500);
      await pg.locator('textarea:visible').last().fill('會一直想著對方');
      await pg.getByRole('button', { name: '送出', exact: true }).click().catch(() => {});
      await pg.waitForTimeout(6000);
      await nextLevel(pg);
    },
    comprehension: async (pg) => {
      await ok(pg);
      const redo = pg.getByRole('button', { name: '全部重做' });
      if (await redo.count()) { await redo.click(); await pg.waitForTimeout(1500); }
      for (const p of COMP) {
        await pg.waitForTimeout(1200);
        await pg.locator('button:visible', { hasText: p }).first().click();
        await pg.waitForTimeout(2200);
        const nx = pg.getByRole('button', { name: /下一題|看結果|完成|提交/ });
        if (await nx.count()) await nx.last().click().catch(() => {});
      }
      await pg.waitForTimeout(4000);
      await nextLevel(pg);
    },
    'vocab-review': async (pg) => {
      await ok(pg);
      const cell = (r: number, c: number) => pg.locator('table tbody tr').nth(r - 1).locator('td').nth(c - 1);
      for (const p of story.vocab_review.answer_paths) {
        const a = await cell(...p.cells[0]).boundingBox();
        const b = await cell(...p.cells.at(-1)!).boundingBox();
        if (!a || !b) continue;
        await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await pg.mouse.down();
        await pg.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
        await pg.mouse.up();
        await pg.waitForTimeout(500);
      }
      await pg.waitForTimeout(2000);
      await nextLevel(pg);
    },
    'knowledge-station': async (pg) => { await nextLevel(pg); },
  };

  // Declared outside try so the finally block's teardown can reach it even
  // if something after setup() throws (and is undefined if setup() itself
  // throws — teardown below guards for that).
  let acc: Account | undefined;
  try {
    // Start the assignment through the real entry (sets the assignment context), half-finish it.
    acc = await setup();
    {
      const { ctx, page } = await newPage(acc, 'start');
      await page.goto(FE + '/assignments');
      await page.waitForTimeout(4000);
      await skipTour(page);
      await page.getByRole('button', { name: /^(開始|繼續)$/ }).first().click();
      await page.waitForTimeout(5000);
      await page.getByRole('button', { name: '開始學習' }).click();
      await page.waitForTimeout(4000);
      for (const s of ['full-text-annotate', 'key-passage-reading', 'vocab-definition', 'vocab-application']) await solve[s](page);
      await closeCtx(ctx, page);
    }
    const base = await serverProgress(acc);

    // ── (a) reopen N times at later steps, never act — completed steps must never shrink. ──
    await test.step('(a) 重開不會讓已完成關卡變少，也不送出比基準少的 PUT', async () => {
      const before = puts.length;
      const targets = ['keypoints-table', 'spotlight', 'comprehension', 'vocab-review'];
      const shrinks: string[] = [];
      const seen = new Set(base.done);
      for (let i = 0; i < REOPENS; i++) {
        const { ctx, page } = await newPage(acc, `reopen${i + 1}`);
        await page.goto(url(targets[i % targets.length]));
        await page.waitForTimeout(4000);
        await ok(page);
        await closeCtx(ctx, page);
        const srv = await serverProgress(acc);
        const lost = [...seen].filter((k) => !srv.done.includes(k));
        if (lost.length) shrinks.push(`after reopen${i + 1}: server lost [${lost.join(', ')}]`);
        srv.done.forEach((k) => seen.add(k));
      }
      const reopenPuts = puts.slice(before);
      const badPuts = reopenPuts.filter((p) => base.done.some((k) => !p.done.includes(k)));

      const detail = [
        `基準 done=[${base.done.map((d) => d.split('#')[0]).join(',')}]`,
        ...shrinks,
        ...(badPuts.length ? ['送出了比基準少的 PUT：', ...badPuts.map(fmtPut)] : [`${reopenPuts.length} 筆 PUT 都沒有少`]),
      ].join('\n');

      if (!EXPECT_3707_FIXED && (shrinks.length || badPuts.length)) {
        test.info().annotations.push({ type: 'known-issue-3707', description: detail });
      } else {
        expect(shrinks, detail).toEqual([]);
        expect(badPuts, detail).toEqual([]);
      }
    });

    // ── (b) resume via 班級作業→繼續 at comprehension; finish it; saved key must be the required id. ──
    let landed = '';
    await test.step('(b) 從「班級作業→繼續」接續：網址帶輪次、完成存成必做關卡的 id', async () => {
      {
        const { ctx, page } = await newPage(acc, 'pin'); // make comprehension the "current step"
        await page.goto(url('comprehension'));
        await page.waitForTimeout(4000);
        await closeCtx(ctx, page);
      }
      const bStart = puts.length;
      {
        const { ctx, page } = await newPage(acc, 'resume');
        await page.goto(FE + '/assignments');
        await page.waitForTimeout(4000);
        await skipTour(page);
        await page.getByRole('button', { name: /^(繼續|開始)$/ }).first().click();
        await page.waitForTimeout(6000);
        landed = page.url();
        if (/\/comprehension/.test(landed)) {
          await solve['comprehension'](page);
        } else if (/\/report/.test(landed)) {
          const b = page.getByRole('button', { name: '繼續未完成關卡' });
          if (await b.count()) {
            await b.click();
            await page.waitForTimeout(5000);
            landed = page.url();
          }
          if (/\/comprehension/.test(landed)) await solve['comprehension'](page);
        }
        await closeCtx(ctx, page);
      }
      const afterB = await serverProgress(acc);
      const bPuts = puts.slice(bStart);
      const bareKeys = [...new Set(bPuts.flatMap((p) => p.done))].filter((k) => !k.includes('#') && P[k]);
      const reqComp = REQUIRED.find((k) => k.startsWith('comprehension'));

      expect(landed, `落地網址 ${landed.replace(FE, '')}`).toMatch(/[?&]p=/);
      expect(bareKeys, `PUT 裡出現沒有輪次的 key：[${bareKeys.join(', ')}]\n${bPuts.map(fmtPut).join('\n')}`).toEqual([]);
      expect(afterB.done, `必做 id=${reqComp}`).toContain(reqComp);
    });

    // ── (c) finish whatever is missing, reach the report through the real entry, teacher must see 完成. ──
    await test.step('(c) 做完全部關卡，老師作業頁顯示完成', async () => {
      let rounds = 0;
      const redoLog: string[] = [];
      for (let round = 0; round < 3; round++) {
        const s = await serverProgress(acc);
        const missing = REQUIRED.filter((k) => !s.done.includes(k));
        if (!missing.length) break;
        rounds++;
        redoLog.push(`第${round + 1}輪要補：[${missing.map((k) => k.split('#')[0]).join(',')}]`);
        const { ctx, page } = await newPage(acc, `finish${round}`);
        await page.goto(FE + '/assignments');
        await page.waitForTimeout(4000);
        await skipTour(page);
        const cardBtn = page.getByRole('button', { name: /^(繼續|開始)$/ });
        if (await cardBtn.count()) { await cardBtn.first().click(); await page.waitForTimeout(5000); } else redoLog.push('  （作業卡上已沒有繼續按鈕）');
        for (const k of missing) {
          const b = k.split('#')[0];
          await page.goto(url(b));
          await page.waitForTimeout(4000);
          page.setDefaultTimeout(12000);
          await solve[b](page).catch(async (e) => {
            redoLog.push(`  [finish] ${b} 操作失敗（改按下一關）：${String(e.message || e).split('\n')[0].slice(0, 80)}`);
            await page.getByRole('button', { name: /下一關/ }).first().click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(3000);
          });
          page.setDefaultTimeout(30000);
        }
        await closeCtx(ctx, page);
      }
      {
        const { ctx, page } = await newPage(acc, 'report'); // real entry → report (this is what triggers 繳交)
        await page.goto(FE + '/assignments');
        await page.waitForTimeout(4000);
        await skipTour(page);
        const rb = page.getByRole('button', { name: /^(繼續|開始)$/ });
        if (await rb.count()) { await rb.first().click(); await page.waitForTimeout(6000); }
        if (!/\/report/.test(page.url())) await page.goto(`${FE}/learn/${LESSON}/report`);
        await page.waitForTimeout(10000);
        await test.info().attach('student-report', { body: await page.screenshot(), contentType: 'image/png' });
        await closeCtx(ctx, page);
      }
      const fin = await serverProgress(acc);
      const tctx = await ownBrowser.newContext({ viewport: { width: 1180, height: 820 }, extraHTTPHeaders: getIapProxyAuthHeader() }); // #3719
      const tp = await tctx.newPage();
      tp.on('pageerror', (err) => pageErrors.push(`[teacher] ${err.message}`));
      await tp.goto(FE + '/login');
      await tp.waitForTimeout(2500);
      await tp.locator('input').first().fill(acc.teacher.email);
      await tp.locator('input[type=password]').fill(acc.teacher.pw);
      await tp.locator('button[type=submit]').first().click();
      await tp.waitForTimeout(4000);
      await tp.goto(`${FE}/teacher/assignments?classroom=${acc.classroom}`);
      await tp.waitForTimeout(4000);
      await skipTour(tp);
      await tp.locator('tr', { hasText: 'QA 回歸檢查' }).first().click();
      await tp.waitForTimeout(5000);
      await test.info().attach('teacher-assignment-detail', { body: await tp.screenshot({ fullPage: true }), contentType: 'image/png' });
      const ttext = (await tp.locator('body').innerText()).replace(/\s+/g, ' ');
      const rowTxt = (ttext.match(/QA回歸學生[^Q]{0,60}/) || [''])[0];
      const teacherDone = /已完成[:：]\s*1/.test(ttext) && !/QA回歸學生\s*進行中/.test(ttext);
      await tctx.close();

      const detail = [
        `伺服器 done ${REQUIRED.filter((k) => fin.done.includes(k)).length}/${REQUIRED.length}，缺 [${REQUIRED.filter((k) => !fin.done.includes(k)).map((k) => k.split('#')[0]).join(',')}]`,
        `補做輪數 ${rounds}（每關做一次就該記住，>1 代表做過的又掉了）`,
        ...redoLog,
        `作業狀態（學生端 API）=${fin.status}`,
        `老師頁：${(ttext.match(/已完成[:：]\s*\d+/) || ['?'])[0]}｜${rowTxt.trim()}`,
      ].join('\n');

      expect(teacherDone, detail).toBe(true);
      expect(rounds, `補做輪數 ${rounds} — 做過的關卡又掉了\n${detail}`).toBeLessThanOrEqual(1);
    });
  } finally {
    // Critic review: without this, every qualifying push leaves one more
    // disposable teacher+classroom+student+assignment row in the shared
    // staging DB forever. Best-effort — a teardown failure (or acc being
    // undefined because setup() itself threw) must not mask whatever the
    // test's own assertions already found.
    if (acc) {
      const teacherTok = await login(acc.teacher.email, acc.teacher.pw).catch(() => undefined);
      if (teacherTok) await api('DELETE', `/api/classrooms/${acc.classroom}`, undefined, teacherTok).catch(() => {});
    }
    await closeAllRemaining();
    await ownBrowser.close();
    // Covers every context this test opened, in addition to the
    // pageerror-fixture's own check of the default `page`.
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  }
});
