#!/usr/bin/env node
/**
 * 產生 /help 的實機截圖（#3151）
 *
 *   node tools/help-screenshots/capture.mjs [--base <url>] [--only <id,id>] [--check]
 *
 * `--check` 不寫檔，只回報「規格裡的選擇器現在還找得到嗎」—— UI 改版後截圖會
 * 悄悄過期，而過期的圖比沒有圖更糟（讀者照著找不到的按鈕操作）。這個模式可以掛 CI。
 *
 * ⛔ 一律 headless。這台機器的規則是瀏覽器永遠不准彈到畫面上。
 *
 * 為什麼不用 mock 資料：這些圖是給老師和學生照著操作的，畫面必須是真的。
 * 代價是 staging 上有真實班級名稱，所以規格裡有 `redact`，而且**塗掉是在截圖之前
 * 改 DOM**，不是事後裁切 —— 事後裁切會把原始像素留在檔案裡。
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { DEVICES, SHOTS } from './shots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const OUT_DIR = join(REPO, 'frontend', 'public', 'help-shots');

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = argOf('--base', 'https://lingoleap-frontend-staging-958347263320.asia-east1.run.app');
const ONLY = (argOf('--only', '') || '').split(',').filter(Boolean);
const CHECK_ONLY = args.includes('--check');
/** 每張圖之間的間隔。詳見迴圈內註解 —— 沒有它會被 per-IP 限流踢掉。 */
const PACE_MS = Number(argOf('--pace', '2500'));

const DEMO_BUTTON = { teacher: '李老師', student: '小明' };

const problems = [];
const manifest = { generatedAt: new Date().toISOString(), base: BASE, shots: [] };
try {
  manifest.commit = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
} catch { manifest.commit = 'unknown'; }

/** 紅框 + 說明標籤，直接注入 DOM 再截圖 */
async function annotate(page, items) {
  const found = [];
  for (const { sel, note } of items) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) { problems.push(`annotate 選擇器找不到: ${sel}`); continue; }
    const box = await loc.boundingBox();
    if (!box) { problems.push(`annotate 元素不可見: ${sel}`); continue; }
    found.push(sel);
    await page.evaluate(({ box, note }) => {
      const pad = 6;
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute', zIndex: 2147483000, pointerEvents: 'none',
        left: (box.x + window.scrollX - pad) + 'px',
        top: (box.y + window.scrollY - pad) + 'px',
        width: (box.width + pad * 2) + 'px',
        height: (box.height + pad * 2) + 'px',
        border: '3px solid #e11d48', borderRadius: '8px',
        boxShadow: '0 0 0 3px rgba(225,29,72,.18)',
      });
      document.body.appendChild(d);
      if (note) {
        const t = document.createElement('div');
        t.textContent = note;
        Object.assign(t.style, {
          position: 'absolute', zIndex: 2147483001, pointerEvents: 'none',
          left: (box.x + window.scrollX - pad) + 'px',
          top: Math.max(0, box.y + window.scrollY - pad - 30) + 'px',
          background: '#e11d48', color: '#fff', font: '600 14px/1.4 system-ui, sans-serif',
          padding: '4px 10px', borderRadius: '6px', whiteSpace: 'nowrap',
        });
        document.body.appendChild(t);
      }
    }, { box, note });
  }
  return found;
}

/**
 * 把內部字樣換成中性示範文字，改 DOM 之後才截圖，原始像素不會留在檔案裡。
 *
 * ⛔ 兩件事是刻意這樣寫的：
 *
 * 1. **選擇器沒命中要報錯，不准靜默跳過。** 第一版寫 `if (n === 0) continue`，
 *    結果四個 redact 規則全都沒中、班級卡片整排明文躺在圖上，而輸出跟「本來就
 *    沒東西要遮」一模一樣 —— 我是親眼看圖才發現的。沒有命中數的遮蔽等於沒有遮蔽。
 *
 * 2. **用替換而不是模糊。** 模糊在使用說明裡看起來像頁面壞掉，讀者會以為功能有問題。
 *    替換後畫面乾淨，而且該拿掉的內部字樣（測試班名之類）真的不在檔案裡。
 */
async function sanitize(page, rules, shotId) {
  const applied = [];
  /** 被蓋掉的原始字串，處理完要確認它們不在可見文字裡 */
  const leftovers = [];
  for (const { sel, text, mode, hide, expect } of rules || []) {
    const n = await page.locator(sel).count();
    if (n === 0) {
      problems.push(`${shotId}: sanitize 規則沒命中任何元素 → ${sel}（規則失效等於沒遮）`);
      continue;
    }
    // ⛔ 匹配數必須跟宣告的一致。
    //
    // 「我的選擇器比我想的匹配更多」這件事在這支腳本上連咬三次：先是四個規則全沒中、
    // 再是外層與內層都被改造成三連重複、最後是憑空在標題列生出一個班名。每一次都是
    // 跑完看圖才發現。數量寫死是唯一能把它變成「當場失敗」的辦法，而且未來 DOM 一改也會叫。
    if (typeof expect === 'number' && n !== expect) {
      problems.push(`${shotId}: ${sel} 匹配 ${n} 個，宣告 ${expect} 個 —— 選擇器範圍跟預期不符，先確認再跑`);
      continue;
    }

    // 記下原始文字，處理完要斷言它真的不在頁面上了。
    //
    // 這是唯一不需要把敏感字串寫進 repo 就能驗洩漏的方法：規則自己知道它蓋掉了什麼，
    // 所以拿「蓋掉之前那段字」當禁字去搜處理後的頁面。前面靠眼睛看圖才發現遮蔽沒生效，
    // 這一關把它變成機械檢查。
    const before = await page.locator(sel).evaluateAll(
      els => els.map(e => (e.textContent || '').trim()).filter(t => t.length > 3),
    );

    if (hide) {
      await page.locator(sel).evaluateAll(els => {
        for (const e of els) { e.style.visibility = 'hidden'; e.setAttribute('data-hidden-for-manual', 'true'); }
      });
      applied.push({ sel, matched: n, action: 'hidden', hiddenTextCount: before.length });
      leftovers.push(...before.map(t => ({ sel, text: t, how: 'hidden' })));
      continue;
    }
    // text 可以是字串或陣列。陣列按元素順序輪替，這樣一排篩選鈕不會全部變成同一個字。
    const texts = Array.isArray(text) ? text : [text];
    const written = await page.locator(sel).evaluateAll((els, { texts, mode }) => {
      // ⚠️ 只處理**最內層**的匹配元素。
      //
      // `:has-text()` 會連祖先一起匹配，所以第一版把外層與內層都改了一次，外層最後
      // 同時含自己的字與子元素的字 —— 畫面上出現「你在 2 個班級…你在 2 個班級…你在 2 個班級」
      // 這種三連。那比沒遮更糟：使用說明上出現壞掉的字串，讀者會以為產品壞了。
      // 判準是「這個匹配元素裡面有沒有另一個匹配元素」，有就跳過它，只寫葉節點。
      //
      // mode 'own' 是另一種情況：要換的字跟一個該保留的子元素住在同一格。
      // 例：卡片上的「📍 <班名>」後面緊接著一個 <span>｜<老師>指派</span>，
      // 整格覆寫會把指派那段一起吃掉。這時只換自身的文字節點。
      const target = mode === 'own' ? els : els.filter(e => !els.some(o => o !== e && e.contains(o)));
      target.forEach((e, i) => {
        const t = texts[i % texts.length];
        if (mode === 'own') {
          let hit = false;
          for (const node of e.childNodes) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) { node.textContent = t; hit = true; }
          }
          if (!hit) return;   // 這一格沒有自身文字 → 不是目標，別亂寫
        } else {
          e.textContent = t;
        }
        e.setAttribute('data-sanitized', 'true');
      });
      return target.length;
    }, { texts, mode });
    applied.push({ sel, matched: n, written, texts });
    leftovers.push(...before.map(t => ({ sel, text: t, how: 'replaced' })));
  }
  // 負向對照：剛才蓋掉的字，現在不准還出現在可見文字裡。
  // ⚠️ 只比對「被蓋掉的那一段」本身；替換後的中性文字若剛好含相同子字串不算漏
  //    （例如原本是「三年甲班」、替換也用「三年甲班」），所以先濾掉替換用字。
  if (leftovers.length) {
    const visible = await page.evaluate(() => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const out = [];
      let n;
      while ((n = walk.nextNode())) {
        const el = n.parentElement;
        if (!el) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        const t = n.textContent.trim();
        if (t) out.push(t);
      }
      return out.join('\n');
    });
    const substitutes = new Set(
      applied.flatMap(a => (a.texts || [])).map(t => String(t)),
    );
    for (const { sel, text, how } of leftovers) {
      if (substitutes.has(text)) continue;
      if (visible.includes(text)) {
        problems.push(`${shotId}: 「${text.slice(0, 18)}…」${how} 之後仍出現在可見文字裡 → ${sel}`);
      }
    }
  }

  return applied;
}

async function main() {
  if (!CHECK_ONLY) await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const shots = ONLY.length ? SHOTS.filter(s => ONLY.includes(s.id)) : SHOTS;
  const byRole = new Map();
  for (const s of shots) {
    if (!byRole.has(s.role)) byRole.set(s.role, []);
    byRole.get(s.role).push(s);
  }

  for (const [deviceKey, device] of Object.entries(DEVICES)) {
    for (const [role, roleShots] of byRole) {
      const ctx = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        // 1.5 而不是 2：scale 2 的整頁圖單張到 1.9MB，16 張就 5.6MB 進 repo。
        // 1.5 在這些介面上字還是清楚的（親眼看過才定這個值）。
        deviceScaleFactor: 1.5,
      });
      const page = await ctx.newPage();

      if (role !== 'anon') {
        await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 90000 });
        const btn = page.locator(`text=${DEMO_BUTTON[role]}`).first();
        if ((await btn.count()) === 0) {
          problems.push(`${role}: 一鍵登入鈕「${DEMO_BUTTON[role]}」找不到，該環境可能關了 demo 登入`);
          await ctx.close();
          continue;
        }
        await btn.click();
        await page.waitForURL(u => !String(u).includes('/login'), { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(1200);
      }

      for (const shot of roleShots) {
        // 節流。第一版沒有這個，跑到後半段就被踢回 /login，而失敗的那幾張每次都不一樣 ——
        // 累積性而非路由性。等 65 秒後同樣的路徑全部正常、API 零非 2xx，形狀跟後端的
        // per-IP 讀取限流一致（`GlobalRateLimitMiddleware`）。不是產品缺陷，是這支腳本
        // 自己打太快。⛔ 別把節流拿掉然後去修一個沒壞的東西。
        await page.waitForTimeout(PACE_MS);

        let landed = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          await page.goto(BASE + shot.path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
          await page.waitForTimeout(1200);
          landed = page.url();
          if (!(landed.includes('/login') && role !== 'anon')) break;
          // 被踢回登入頁 → 退避後重登再試，而不是直接記成失敗
          await page.waitForTimeout(20000 * attempt);
          const btn = page.locator(`text=${DEMO_BUTTON[role]}`).first();
          await page.goto(BASE + '/login', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
          if (await btn.count()) {
            await btn.click();
            await page.waitForURL(u => !String(u).includes('/login'), { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1200);
          }
        }

        if (landed && landed.includes('/login') && role !== 'anon') {
          problems.push(`${shot.id}: 三次都被踢回 /login（已含退避重登）`);
          continue;
        }

        const sanitized = await sanitize(page, shot.sanitize, shot.id);
        const found = await annotate(page, shot.annotate || []);

        const rel = `help-shots/${shot.id}-${deviceKey}.png`;
        if (!CHECK_ONLY) {
          const opts = { path: join(OUT_DIR, `${shot.id}-${deviceKey}.png`) };
          if (shot.clip) {
            const el = page.locator(shot.clip).first();
            if (await el.count()) {
              const b = await el.boundingBox();
              if (b) opts.clip = {
                x: Math.max(0, b.x - 16), y: Math.max(0, b.y - 40),
                width: Math.min(device.width, b.width + 32),
                height: b.height + 56,
              };
            }
          } else {
            opts.fullPage = false;   // 視窗內就好；整頁在 iPad 尺寸下字太小
          }
          await page.screenshot(opts);
        }

        manifest.shots.push({
          id: shot.id, device: deviceKey, path: rel, url: shot.path, role,
          annotated: found, expectedAnnotations: (shot.annotate || []).map(a => a.sel),
          sanitized,
        });
        console.log(`  ${CHECK_ONLY ? 'checked' : 'wrote'} ${rel}  (紅框 ${found.length}/${(shot.annotate || []).length})`);
      }
      await ctx.close();
    }
  }
  await browser.close();

  if (!CHECK_ONLY) {
    await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\nmanifest: frontend/public/help-shots/manifest.json  (${manifest.shots.length} 張)`);
  }

  if (problems.length) {
    console.log('\n⚠️ 問題（選擇器失效代表截圖已經或即將過期）:');
    for (const p of problems) console.log('  - ' + p);
    process.exit(1);
  }
  console.log('\n全部選擇器都命中，沒有過期的圖。');
}

main().catch(e => { console.error(e); process.exit(1); });
