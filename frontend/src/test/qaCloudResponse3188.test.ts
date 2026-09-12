/**
 * #3188 回歸鎖：QA 看板被拒絕時，畫面不可以講成「雲端沒有已存的 review」。
 *
 * 壞掉的樣子（staging 實測 2026-09-12）：
 *   GET /api/keypoints-qa/reviews → 404
 *   {"detail":"QA board is disabled: QA_TOOLS_SHARED_SECRET is not configured"}
 * 而 app.js 直接 res.json() 不看 res.ok → j.reviews 是 undefined → list=[] →
 * 顯示「雲端沒有已存的 review。」。審查者會以為自己存的東西不見了。
 *
 * 這裡測的是**出貨的那支檔案本身**（讀 public/qa-shared/qaCloudResponse.js 執行它），
 * 不是抄一份邏輯進測試 —— 抄本上的綠證明不了出貨的那份。
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';

type QaCloud = { failureMessage(status: number, body?: unknown): string | null };
let qaCloud: QaCloud;

const SRC = resolve(__dirname, '../../public/qa-shared/qaCloudResponse.js');

beforeAll(() => {
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(SRC, 'utf8'))();
  qaCloud = (window as unknown as { qaCloud: QaCloud }).qaCloud;
});

describe('#3188 被拒絕時要說出原因，不可以講成「沒有資料」', () => {
  it('量具本身有效：那支出貨檔案真的掛上了 window.qaCloud', () => {
    expect(qaCloud, `${SRC} 沒有定義 window.qaCloud`).toBeTruthy();
    expect(typeof qaCloud.failureMessage).toBe('function');
  });

  it('⭐ 停用（404 + disabled detail）→ 說「停用」，且不可以出現「沒有」', () => {
    const m = qaCloud.failureMessage(404, { detail: 'QA board is disabled: QA_TOOLS_SHARED_SECRET is not configured' });
    expect(m).toBeTruthy();
    expect(m).toContain('停用');
    expect(m, '講成「沒有」就是在說謊').not.toContain('沒有已存');
  });

  it('⭐ 未授權（401 / 403）→ 說權限，不說沒有資料', () => {
    for (const s of [401, 403]) {
      const m = qaCloud.failureMessage(s, { detail: 'Not authenticated' });
      expect(m, `HTTP ${s} 應該要有訊息`).toBeTruthy();
      expect(m).toContain('權限');
      expect(m).not.toContain('沒有已存');
    }
  });

  it('⭐ 伺服器錯誤（500 / 503）→ 說伺服器，並帶上狀態碼', () => {
    for (const s of [500, 503]) {
      const m = qaCloud.failureMessage(s, null);
      expect(m).toContain('伺服器');
      expect(m, '訊息要帶狀態碼，否則看的人沒東西可查').toContain(String(s));
    }
  });

  it('沒歸類到的非 2xx（418）也要有訊息，且帶狀態碼', () => {
    const m = qaCloud.failureMessage(418, null);
    expect(m).toBeTruthy();
    expect(m).toContain('418');
  });

  it('404 但不是停用（例如路由打錯）→ 仍要有訊息，不可以靜靜當成空清單', () => {
    const m = qaCloud.failureMessage(404, { detail: 'Not Found' });
    expect(m).toBeTruthy();
    expect(m).toContain('404');
  });

  // ── 負向對照：成功的時候必須回 null，否則正常路徑會被這個訊息蓋掉 ──
  it('對照：2xx 一律回 null（200 / 201 / 204）', () => {
    for (const s of [200, 201, 204]) {
      expect(qaCloud.failureMessage(s, null), `HTTP ${s} 不該被當成失敗`).toBeNull();
    }
  });

  it('對照：body 形狀奇怪（null / 空物件 / 數字 / 陣列 / detail 非字串）也不可以丟例外', () => {
    for (const d of [null, undefined, {}, 42, [], { detail: 99 }, { detail: {} }]) {
      expect(() => qaCloud.failureMessage(404, d)).not.toThrow();
    }
  });

  // ── 第二種失敗：HTTP 200 但 body 自己說 ok:false ──────────────────────
  // keypoints_qa.py:130 / :152 —— bucket 取不到、或列舉炸掉時，後端回的是
  // 200 + {"ok":false,"reviews":[],"reason":...}。只看 res.ok 會放行。
  it('⭐ 200 但 ok:false（儲存空間掛了）→ 要說「沒讀到」，不可以當成沒有資料', () => {
    const m = qaCloud.failureMessage(200, { ok: false, reviews: [], reason: 'storage unavailable' });
    expect(m, '200+ok:false 被當成成功 —— 畫面又會講成「雲端沒有已存的 review」').toBeTruthy();
    expect(m).toContain('storage unavailable');
    expect(m).not.toContain('沒有已存');
  });

  it('⭐ 200 + ok:false 但沒給 reason → 仍要有訊息，不可以是空的', () => {
    const m = qaCloud.failureMessage(200, { ok: false, reviews: [] });
    expect(m).toBeTruthy();
    expect((m as string).length).toBeGreaterThan(6);
  });

  it('對照：200 + ok:true（正常情況）仍然回 null', () => {
    expect(qaCloud.failureMessage(200, { ok: true, count: 3, reviews: [{}, {}, {}] })).toBeNull();
  });

  it('對照：200 且 body 根本沒有 ok 欄位（單筆 review 的 payload）回 null', () => {
    expect(qaCloud.failureMessage(200, { lessons: [], reviewer: 'a' })).toBeNull();
  });
});

/**
 * 接線與行為要各有各的斷言 —— helper 是對的，不代表看板真的有呼叫它。
 * 這幾條是靜態檢查，所以每一條都先證明「我真的讀到那個檔案、也認得它的結構」，
 * 否則檔案被改名或搬走時，這裡會靜靜地全綠。
 */
describe('#3188 兩個看板真的接上了這支 helper', () => {
  const BOARDS = ['keypoints-qa', 'spotlight-qa'] as const;
  const read = (p: string) => readFileSync(resolve(__dirname, '../../public/' + p), 'utf8');

  it('量具有效：兩個看板的 app.js 都讀得到，而且都有 loadCloudBtn', () => {
    for (const b of BOARDS) {
      const src = read(`${b}/app.js`);
      expect(src.length, `${b}/app.js 是空的`).toBeGreaterThan(1000);
      expect(src, `${b}/app.js 找不到 loadCloudBtn —— 檔案結構變了，下面的斷言不算數`)
        .toContain('loadCloudBtn');
    }
  });

  it('⭐ 每個看板都在讀 j.reviews 之前先問過 failureMessage', () => {
    for (const b of BOARDS) {
      const src = read(`${b}/app.js`);
      // ⚠️ 比對 'j.reviews' 會打到註解文字（我自己的註解裡就有這四個字），
      // 所以比對的是真正取值的那個運算式。
      const asked = src.indexOf('qaCloud.failureMessage');
      const used = src.indexOf('(j && j.reviews)');
      expect(asked, `${b}/app.js 沒有呼叫 qaCloud.failureMessage`).toBeGreaterThan(-1);
      expect(used, `${b}/app.js 找不到取 reviews 的那個運算式`).toBeGreaterThan(-1);
      expect(asked, `${b}/app.js 先取了 reviews 才檢查失敗 —— 順序反了`).toBeLessThan(used);
    }
  });


  it('⭐ 點一筆載回（loadCloudReview）也要先問過，否則會 alert「已載回 0 課」', () => {
    for (const b of BOARDS) {
      const src = read(`${b}/app.js`);
      const fn = src.indexOf('async function loadCloudReview');
      expect(fn, `${b}/app.js 找不到 loadCloudReview`).toBeGreaterThan(-1);
      const body = src.slice(fn, fn + 2600);
      const asked = body.indexOf('qaCloud.failureMessage');
      const used = body.indexOf('payload.lessons');
      expect(asked, `${b} 的 loadCloudReview 沒有檢查失敗`).toBeGreaterThan(-1);
      expect(used, `${b} 的 loadCloudReview 找不到 payload.lessons`).toBeGreaterThan(-1);
      expect(asked, `${b} 的 loadCloudReview 先用了 lessons 才檢查失敗`).toBeLessThan(used);
    }
  });

  it('⭐ 每個看板的 index.html 都在 app.js 之前載入共用檔', () => {
    for (const b of BOARDS) {
      const html = read(`${b}/index.html`);
      const shared = html.indexOf('qa-shared/qaCloudResponse.js');
      const app = html.indexOf('src="app.js"');
      expect(shared, `${b}/index.html 沒有載入共用檔`).toBeGreaterThan(-1);
      expect(app, `${b}/index.html 沒有載入 app.js`).toBeGreaterThan(-1);
      expect(shared, `${b}/index.html 把共用檔放在 app.js 之後 —— 執行時 window.qaCloud 還不存在`)
        .toBeLessThan(app);
    }
  });

  it('⭐ 呼叫端要把整個 body 傳進去，不是只傳 detail', () => {
    for (const b of BOARDS) {
      const src = read(`${b}/app.js`);
      expect(src, `${b} 只傳 detail，200+ok:false 就永遠檢查不到`).not.toContain('failureMessage(res.status, j && j.detail)');
      expect(src).not.toContain('failureMessage(res.status, payload && payload.detail)');
      expect(src).toContain('failureMessage(res.status, j)');
      expect(src).toContain('failureMessage(res.status, payload)');
    }
  });

  /**
   * ⚠️ 這條原本是「數 token」的斷言（呼叫次數 × 2 == 提及次數）。複審用突變證明它是假的：
   * 把守衛改成逗號運算子 `(window.qaCloud, window.qaCloud.failureMessage(res.status, j))`
   * 完全廢掉短路、共用檔沒載到時照樣丟 TypeError，而 token 數一模一樣 —— 19/19 全綠。
   * 交換三元運算子的兩個分支也一樣逃得掉。
   *
   * 根因是拿**語法**去量**語意**。所以改成：把出貨檔案裡那一行原文抽出來**真的執行**，
   * 一次有 window.qaCloud、一次沒有。結構怎麼改寫都好，行為不對就會紅。
   */
  const extractWhy = (board: string, bodyVar: 'j' | 'payload') => {
    const src = read(`${board}/app.js`);
    const at = src.indexOf(`const why = window.qaCloud`, bodyVar === 'payload' ? src.indexOf('async function loadCloudReview') : 0);
    expect(at, `${board}: 找不到 ${bodyVar} 那個呼叫點`).toBeGreaterThan(-1);
    const stop = src.indexOf('if (why)', at);
    expect(stop, `${board}: ${bodyVar} 呼叫點後面沒有 if (why)`).toBeGreaterThan(at);
    const stmt = src.slice(at, stop);
    expect(stmt, `${board}: 抽出來的不是完整敘述`).toContain(';');
    // eslint-disable-next-line no-new-func
    return new Function('res', bodyVar, `${stmt} return why;`) as (res: unknown, body: unknown) => string | null;
  };

  it('⭐ 共用檔沒載到時：成功的回應仍然是成功（跑出貨檔案裡的那一行，不是抄本）', () => {
    const saved = (window as unknown as { qaCloud?: unknown }).qaCloud;
    try {
      delete (window as unknown as { qaCloud?: unknown }).qaCloud;
      for (const [b, v] of [['keypoints-qa', 'j'], ['spotlight-qa', 'j'],
                            ['keypoints-qa', 'payload'], ['spotlight-qa', 'payload']] as const) {
        const why = extractWhy(b, v);
        expect(() => why({ status: 200, ok: true }, { ok: true, reviews: [] }),
          `${b}/${v}: 共用檔沒載到時，成功的回應丟了例外`).not.toThrow();
        expect(why({ status: 200, ok: true }, { ok: true, reviews: [] }),
          `${b}/${v}: 共用檔沒載到時把成功講成失敗`).toBeNull();
      }
    } finally {
      (window as unknown as { qaCloud?: unknown }).qaCloud = saved;
    }
  });

  it('⭐ 共用檔沒載到時：失敗仍然說得出是失敗，不可以講成沒有資料', () => {
    const saved = (window as unknown as { qaCloud?: unknown }).qaCloud;
    try {
      delete (window as unknown as { qaCloud?: unknown }).qaCloud;
      for (const [b, v] of [['keypoints-qa', 'j'], ['spotlight-qa', 'payload']] as const) {
        const m = extractWhy(b, v)({ status: 404, ok: false }, { detail: 'QA board is disabled' });
        expect(m, `${b}/${v}: 共用檔沒載到 + 404 → 沒有任何訊息`).toBeTruthy();
        expect(m).toContain('404');
        expect(m).not.toContain('沒有已存');
      }
    } finally {
      (window as unknown as { qaCloud?: unknown }).qaCloud = saved;
    }
  });

  it('⭐ 共用檔有載到時：呼叫點真的用它（拿掉 helper 的判斷就會紅）', () => {
    for (const [b, v] of [['keypoints-qa', 'j'], ['spotlight-qa', 'j']] as const) {
      const m = extractWhy(b, v)({ status: 200, ok: true }, { ok: false, reason: 'storage unavailable' });
      expect(m, `${b}: 200+ok:false 沒有被擋下 —— 呼叫點沒有走 helper`).toBeTruthy();
      expect(m).toContain('storage unavailable');
    }
  });

  it('index.html 的共用檔 script 要有 onerror（跟同檔上面三支 vendor 一致）', () => {
    for (const b of BOARDS) {
      expect(read(`${b}/index.html`)).toContain('qaCloudResponse.js" onerror=');
    }
  });

  it('⭐ 那句說謊的舊註解不可以再出現在任何一個看板裡', () => {
    for (const b of BOARDS) {
      expect(read(`${b}/app.js`), `${b}/app.js 還留著「backend stays open」—— 後端現在是 fail-closed`)
        .not.toContain('backend stays open');
    }
  });
});
