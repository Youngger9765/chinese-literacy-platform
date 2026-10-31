#!/usr/bin/env node
/**
 * island-playability-sweep.cjs — #3780 PRD §C「每一課都能用」
 *
 * 對全平台 179 課逐課走一次真實入口（登入 → 進島 → 跳過開場 → 等 3D 世界
 * 就緒），檢查五件事，一課失敗不中斷別課：
 *   ① 全程 0 pageerror
 *   ② 島上建築數（header「N/Y 座亮燈」的 Y）＝ fixture 的 step_sequence
 *      **去重後**站數——跟 `islandTemplate.ts` 的 `buildStopsFromSequence`
 *      同一套規則：一課多篇同個 base step type 出現多次只收斂成一站
 *      （該檔 docstring 明寫是刻意設計）。這是跟「真實資料」比對，抓的是
 *      content.stops 的生成邏輯跟平台資料對不上，不是跟原始字串長度比。
 *   ③ 出生畫面有「進入」卡（發現新去處）或港口燈塔文字可見
 *   ④ 清單模式（IslandListMode.tsx）列出的 <li> 數 ＝ header 的 Y
 *      （這是跟「同一頁另一個 UI」比對，抓的是清單渲染邏輯跟 header
 *      算出來的 STOPS.length 兜不起來——兩邊故意不是同一個斷言）
 *   ⑤ 從清單模式點「進入港口燈塔」，封面頁 iframe 有載入真內容
 *      （不靠開場旁白的「聽這句」——那條路在這個帳號已經走過一次的課
 *      上不會再出現，清單模式的「進入」在設計上跟 3D 走近完全同一條
 *      路徑，見 IslandListMode.tsx 檔頭註解，兩種起點都該測得到）
 *
 * 限速：一次只跑一課，每課之間停 2 秒，不要壓 preview。
 *
 * 用法：
 *   node scripts/island-playability-sweep.cjs [N或id1,id2,...] [mutate]
 *   node scripts/island-playability-sweep.cjs 10 mutate   # 驗證腳本本身：
 *     對第 1 課故意塞一個不存在的分項，斷言「收到」正確的比對失敗
 *   node scripts/island-playability-sweep.cjs 10          # 先跑 10 課
 *   node scripts/island-playability-sweep.cjs             # 跑全部 179 課
 *
 * 輸出：N/179 通過（不是百分比）＋ 失敗清單（每課列出具體是哪一項、
 * 數字差多少），結果同時寫一份 JSON 到 SWEEP_OUT_DIR（預設 scratchpad）。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FE = process.env.PLAYWRIGHT_BASE_URL
  || 'https://lingoleap-frontend-issue-3780-oja2sffiya-de.a.run.app';
const FIXTURE_PATH = path.join(
  __dirname,
  '../src/pages/lab/island/__tests__/fixtures/all-lessons-step-sequence.json',
);
const OUT_DIR = process.env.SWEEP_OUT_DIR
  || '/private/tmp/claude-501/-Users-young-project-chinese-literacy-platform/4b0a5225-3edc-455d-b8d2-a925784bd7aa/scratchpad/island-verify';
const DELAY_BETWEEN_LESSONS_MS = 2000;
const NAV_TIMEOUT = 45_000;

function loadLessons() {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
  return data.lessons;
}

/**
 * 15 種合法 step 型態——跟 `islandTemplate.ts` 的 `STEP_BUILDING_META` 鍵一致
 * （手動抄一份，不 import TS 模組進這支純 CJS 腳本）。
 */
const KNOWN_STEP_TYPES = new Set([
  'lesson-intro', 'full-text-annotate', 'key-passage-reading', 'vocab-definition',
  'vocab-application', 'spotlight', 'keypoints-table', 'comprehension', 'vocab-review',
  'knowledge-station', 'report', 'classical-text', 'classical-sentence-matching',
  'classical-word-matching', 'classical-self-challenge',
]);

/**
 * 島上真正會蓋幾棟建築——跟 `islandTemplate.ts` 的 `buildStopsFromSequence`
 * 同一套規則：**一課多篇（同個 base step 出現多次）收斂成一站**（見該檔
 * docstring「取第一次出現的順序」），不是 `step_sequence.length`。
 *
 * #3780 PRD §C 十度複審修正：第一版這支腳本直接拿 `step_sequence.length`
 * 當「期望建築數」，在 5 課多篇課文（20029/20063/20111/20137/20144）
 * 全部誤判成「漏蓋站」——但那 5 課剛好就是 repo 既有 `multiTextJourney.spec.ts`
 * 鎖住的那 5 課多篇課文，數字對得正正好是「unique base type 數」，不是
 * 隨機的部分數字，加上 `buildStopsFromSequence` 自己的 docstring 明寫
 * 這是刻意設計——這是量具的單位錯了，不是島上真的漏蓋站（同一型的教訓
 * 見 memory feedback_a_count_has_a_unit.md）。174 課沒事是因為單文課
 * raw length 剛好等於 unique 數，巧合掩蓋了量具的錯。
 */
function expectedStationCount(stepSequence) {
  const bases = [];
  for (const raw of stepSequence) {
    const base = raw.split('#')[0];
    if (KNOWN_STEP_TYPES.has(base) && !bases.includes(base)) bases.push(base);
  }
  return bases.length;
}

async function loginFresh(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
  const demo = page.getByRole('button', { name: /小明/ }).first();
  await demo.click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 60_000 });
  return { context, page, pageErrors };
}

/** 跳過冷開場與開場旁白（不管走哪一條都用「直接上岸走」最快抵達主畫面
 * ——開場旁白本身的內容已有別支 e2e 專門鎖，這裡只是要抵達主畫面）。
 * 這個帳號之前已經造訪過的課不會再出現開場旁白，兩種情況都要吃得下。 */
async function reachMainView(page) {
  const coldOpenBtn = page.getByRole('button', { name: /點一下，進入喝采島/ });
  if (await coldOpenBtn.count()) { await coldOpenBtn.click(); await page.waitForTimeout(600); }
  for (let i = 0; i < 25; i++) {
    const landBtn = page.getByRole('button', { name: /直接上岸走/ });
    if (await landBtn.count()) {
      const box = await landBtn.boundingBox();
      if (box) await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
      break;
    }
    const cont = page.getByRole('button', { name: /^繼續$/ });
    if (!(await cont.count())) break; // 已經在主畫面（這次沒有開場旁白）
    const box = await cont.boundingBox();
    if (box) await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
    await page.waitForTimeout(300);
  }
  // 世界建立＋開場鏡頭飛行穩定
  await page.waitForTimeout(4000);
}

async function checkLesson(browser, lesson) {
  const result = {
    id: lesson.id,
    title: lesson.title,
    expectedStations: expectedStationCount(lesson.step_sequence),
    checks: {},
    reasons: [],
    pass: true,
  };
  let context;
  try {
    const logged = await loginFresh(browser);
    context = logged.context;
    const page = logged.page;
    const pageErrors = logged.pageErrors;

    await page.goto(`${FE}/lab/island/${lesson.id}`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });
    await page.waitForTimeout(1200);
    await reachMainView(page);

    // ① 0 pageerror
    result.checks.pageerror = pageErrors.length === 0;
    if (!result.checks.pageerror) {
      result.reasons.push(`pageerror x${pageErrors.length}（第一筆：${pageErrors[0]}）`);
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const headerMatch = bodyText.match(/(\d+)\s*\/\s*(\d+)\s*座亮燈/);
    const headerTotal = headerMatch ? Number(headerMatch[2]) : null;

    // ② header 的 Y（島上建築數）＝ fixture 去重後的站數（一課多篇同型態
    // 收斂成一站，見 expectedStationCount() 的說明）
    result.checks.stationCountMatchesFixture = headerTotal === result.expectedStations;
    if (!result.checks.stationCountMatchesFixture) {
      result.reasons.push(`建築數 header=${headerTotal === null ? '找不到' : headerTotal} vs fixture去重後=${result.expectedStations}（原始長度=${lesson.step_sequence.length}）`);
    }

    // ③ 出生畫面有「進入」卡（發現新去處，accessible name 剛好是「進入」
    // 兩個字，跟清單模式每列的 aria-label="進入{站名}" 不會混淆）或港口燈塔
    // 文字可見——此刻清單模式還沒開，不會有歧義。
    // 補一條 WASD 操作提示當第三條路：這個帳號是共用帳號，被這支腳本或
    // 別人重複掃過的課會整個島都已經點亮，頂部「自由探索 X、Y、Z」的提示
    // 文字會輪到後面幾區、不再提港口燈塔，連帶讓「發現新去處」卡也不會出
    // 現（沒有新東西好發現）——這時「港口燈塔」三個字只可能透過滑鼠剛好
    // 懸停在建築上的提示框出現，位置不確定、不該當作判準。WASD 操作提示
    // 不管進度如何只要主畫面真的渲染出來就一定在，用它當「這不是空白／
    // 壞掉畫面」的保底訊號，不會讓已完成的課被誤判成壞掉。
    const enterCardVisible = (await page.getByRole('button', { name: '進入', exact: true }).count()) > 0;
    const lighthouseTextVisible = bodyText.includes('港口燈塔');
    const wasdHintVisible = bodyText.includes('WASD');
    result.checks.spawnShowsEntryOrLighthouse = enterCardVisible || lighthouseTextVisible || wasdHintVisible;
    if (!result.checks.spawnShowsEntryOrLighthouse) {
      result.reasons.push('出生畫面沒有「進入」卡、沒有「港口燈塔」文字、也沒有 WASD 操作提示（畫面可能真的空白或壞掉）');
    }

    // ④＋⑤ 開清單模式：IslandListMode.tsx 對每一站都渲染一個 <li>（鎖著的
    // 站沒有「進入」按鈕但 <li> 本身仍在），所以站數要數 <li>，不能數
    // 「進入」按鈕（新課一開始 zone 1/2 都還在霧裡，數按鈕會低估）。
    const listBtn = page.getByRole('button', { name: /清單模式/ });
    let listCount = null;
    if (await listBtn.count()) {
      await listBtn.click();
      await page.waitForTimeout(500);
      const dialog = page.getByRole('dialog', { name: '站點清單' });
      listCount = await dialog.locator('li').count();
    }
    result.checks.listCountMatchesHeader = listCount !== null && headerTotal !== null && listCount === headerTotal;
    if (!result.checks.listCountMatchesHeader) {
      result.reasons.push(`清單 <li> 數=${listCount === null ? '找不到清單' : listCount} vs header=${headerTotal === null ? '找不到' : headerTotal}`);
    }

    // ⑤ 清單模式點「進入港口燈塔」（aria-label 精準鎖定，不靠開場旁白
    // 的「聽這句」——已造訪過的課不會再出現那條路，兩種起點都要測得到），
    // 封面頁 iframe 要載到真內容。
    let iframeLoaded = false;
    const enterLighthouse = page.getByRole('button', { name: '進入港口燈塔', exact: true });
    if (await enterLighthouse.count()) {
      await enterLighthouse.click();
      let iframeText = '';
      for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(1000);
        iframeText = await page.frameLocator('iframe').locator('body').innerText().catch(() => '');
        if (iframeText.trim().length > 50) break;
      }
      iframeLoaded = iframeText.trim().length > 50;
      const backBtn = page.getByRole('button', { name: /回到島上/ });
      if (await backBtn.count()) await backBtn.click();
    } else {
      result.reasons.push('清單模式裡找不到「進入港口燈塔」按鈕');
    }
    result.checks.coverPageIframeLoaded = iframeLoaded;
    if (!iframeLoaded && (await enterLighthouse.count())) {
      result.reasons.push('封面頁 iframe 沒載到內容（15 秒內文字不足 50 字）');
    }

    result.pass = Object.values(result.checks).every(Boolean);
  } catch (e) {
    result.pass = false;
    result.reasons.push(`腳本例外: ${String((e && e.message) || e).slice(0, 300)}`);
  } finally {
    if (context) await context.close().catch(() => {});
  }
  return result;
}

async function main() {
  const selectArg = process.argv[2];
  const mutateArg = process.argv[3];
  const all = loadLessons();

  if (all.length !== 179) {
    console.error(`⚠️ fixture 課數是 ${all.length} 不是預期的 179，先確認 fixture 本身沒壞再跑`);
  }

  // 參數消歧義：一個裸數字可能是「前 N 課」或「指定某一課 id」，兩者長得
  // 一模一樣（例如 `20011`）。用「這份 fixture 最多 179 課」這個事實區分：
  // ≤179 當作「前 N 課」（跑驗證批次時的用法），>179 當作單一課程 id
  // （沒有任何課文 id 會落在 1~179 區間，179 課的真實 id 都是 20000+）。
  // 逗號分隔一律當作指定課程 id 清單，不受此規則影響。
  let lessons = all;
  if (selectArg && /^\d+$/.test(selectArg)) {
    const n = Number(selectArg);
    lessons = n <= all.length ? all.slice(0, n) : all.filter((l) => l.id === n);
    if (n > all.length && lessons.length === 0) {
      console.error(`⚠️ 找不到課程 id ${n}，fixture 裡沒有這一課`);
      process.exit(1);
    }
  } else if (selectArg) {
    const ids = new Set(selectArg.split(',').map((s) => Number(s.trim())));
    lessons = all.filter((l) => ids.has(l.id));
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--mute-audio'],
  });

  const results = [];
  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    let lessonForCheck = lesson;
    let isMutationProbe = false;
    if (mutateArg === 'mutate' && i === 0) {
      // 量具自我檢查（不是真的壞課）：對第一課塞一個「這課原本沒有、但
      // 確實是合法型態」的額外站（不能塞完全不存在的型態字串——那種會被
      // expectedStationCount() 的 KNOWN_STEP_TYPES 過濾掉，對修正後的邏輯
      // 來說零作用，驗不到東西）。動態挑一個這課目前沒有的合法型態，不
      // 寫死特定型態名——不管第一課剛好是誰都保證塞得進去一個會被算到的
      // 新站。比對式如果連這個都抓不到差異，整支腳本就只是裝飾品。
      const existingBases = new Set(lesson.step_sequence.map((s) => s.split('#')[0]));
      const absentType = [...KNOWN_STEP_TYPES].find((t) => !existingBases.has(t));
      if (!absentType) {
        console.error(`  ⚠️ 第 ${lesson.id} 課已經涵蓋全部 ${KNOWN_STEP_TYPES.size} 種型態，塞不出一個新站做自我檢查，換下一課再試`);
      } else {
        isMutationProbe = true;
        lessonForCheck = {
          ...lesson,
          step_sequence: [...lesson.step_sequence, `${absentType}#SELFCHECK_FAKE_ROUND`],
        };
        console.log(`[0/${lessons.length}] 量具自我檢查：對第 ${lesson.id} 課塞一個假站（${absentType}），預期 ② 轉紅……`);
      }
    }
    console.log(`[${i + 1}/${lessons.length}] 第 ${lessonForCheck.id} 課「${lessonForCheck.title}」...`);
    const result = await checkLesson(browser, lessonForCheck);
    if (isMutationProbe) {
      result._mutationProbe = true;
      if (result.checks.stationCountMatchesFixture === false) {
        console.log('  ✅ 量具自我檢查通過：假站確實讓 ② 轉紅（如預期），分得開');
      } else if (result.checks.stationCountMatchesFixture === true) {
        console.error('  🔴 量具壞了：塞了假站之後 ② 竟然還是過關，比對邏輯沒有鑑別力！先修腳本再跑全部。');
        process.exitCode = 2;
      } else {
        // undefined：連 ② 都還沒跑到就先例外中斷（例如登入逾時），這不是
        // 「比對沒有鑑別力」，是這一輪沒跑到比對本身——沒有驗證到任何事，
        // 不能算過也不能算沒分得開，必須重跑一次才能下結論。
        console.error('  ⚠️ 量具自我檢查沒有結論：這一輪在跑到 ② 之前就先例外中斷，需要重跑才能驗證分不分得開');
        process.exitCode = 2;
      }
    }
    results.push(result);
    console.log(result.pass ? '  ✅ PASS' : `  ❌ FAIL: ${result.reasons.join('; ')}`);
    if (i < lessons.length - 1) await new Promise((r) => setTimeout(r, DELAY_BETWEEN_LESSONS_MS));
  }

  await browser.close();

  const real = results.filter((r) => !r._mutationProbe);
  const passCount = real.filter((r) => r.pass).length;
  console.log(`\n=== ${passCount}/${real.length} 通過 ===`);
  const failed = real.filter((r) => !r.pass);
  if (failed.length) {
    console.log('失敗清單：');
    for (const f of failed) {
      console.log(`  第 ${f.id} 課「${f.title}」: ${f.reasons.join('; ')}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `sweep-result-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ passCount, total: real.length, results }, null, 1));
  console.log(`結果存到: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
