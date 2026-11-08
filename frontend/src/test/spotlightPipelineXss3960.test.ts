/**
 * #3960 回歸鎖：`public/presentation/spotlight-pipeline.html` 的課程 cell
 * popup（`.course-cell` click handler → `#modal-content` innerHTML）以前
 * 把 `data-lesson` / `data-blocks` 的 key/value 與 `LESSON_DATA` 欄位
 * 原封不動串進 innerHTML，沒有任何逃逸處理（CodeQL `js/xss-through-dom`
 * alert #60）。今天這些值全是這份靜態檔自己寫死的，沒有外部攻擊者能
 * 碰到，但這個模式本身危險——日後若被複製到一個資料來源改成 API/使用
 * 者輸入的頁面，就會立刻可被攻擊。
 *
 * 這支測試直接用真的 jsdom（非 vitest 預設的 DOM 環境，而是手動
 * `runScripts: "dangerously"`）把這個靜態檔案整份載入並執行它自己的
 * inline `<script>`，模擬攻擊者竄改 `data-lesson`/`data-blocks` 屬性後
 * 點擊 cell，斷言：
 *   1. 注入的 payload 不會被當成 markup 執行（`<img onerror=...>` 不會
 *      真的觸發 onerror）
 *   2. 注入的字樣以逃逸過的純文字出現在 `#modal-content`，不是原始標籤
 *   3. 正常課程資料（無攻擊字元）點開後視覺內容不變（避免這把鎖本身
 *      把合法內容也擋掉）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, it, expect } from 'vitest';

const HTML_PATH = join(__dirname, '..', '..', 'public', 'presentation', 'spotlight-pipeline.html');

const openWindows: JSDOM[] = [];

function loadPage(): JSDOM {
  const html = readFileSync(HTML_PATH, 'utf-8');
  // runScripts: "dangerously" is exactly what we need to prove here — this is
  // the file's own trusted inline script, not third-party content. No
  // networked resources are needed (the data-* attack happens entirely
  // client-side), so `resources` stays unset. `url` uses a plain http origin
  // rather than file:// — a file:// origin is opaque per spec and jsdom
  // throws on localStorage access for opaque origins the moment a broken
  // <img> (from an unescaped exploit payload) fires its error event; that's
  // an artifact of the test harness's origin choice, not a real security
  // distinction this test cares about.
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/' });
  openWindows.push(dom);
  return dom;
}

afterEach(() => {
  // The page's own typing-animation IIFE reschedules itself via setTimeout
  // forever; without closing each window, those timers keep firing (and
  // keep touching the DOM) across tests in this file.
  while (openWindows.length) {
    openWindows.pop()!.window.close();
  }
});

describe('#3960 spotlight-pipeline.html course-cell popup escaping', () => {
  it('a crafted data-lesson value renders as inert text, not executed markup', () => {
    const dom = loadPage();
    const { window } = dom;
    const doc = window.document;

    // `window.__xss_fired` only gets set if the injected markup actually
    // executes as an <img onerror=...> element rather than rendering as text.
    (window as unknown as { __xss_fired?: boolean }).__xss_fired = false;

    const cell = doc.querySelectorAll('.course-cell')[1] as HTMLElement;
    expect(cell).toBeTruthy();
    cell.setAttribute('data-lesson', '<img src=x onerror=window.__xss_fired=true>');
    cell.dispatchEvent(new window.Event('click', { bubbles: true }));

    expect((window as unknown as { __xss_fired?: boolean }).__xss_fired).toBe(false);

    const modalContent = doc.getElementById('modal-content')!;
    // The payload must show up as literal, escaped text in the rendered
    // HTML -- not as a real <img> element in the DOM.
    expect(modalContent.querySelector('img[onerror]')).toBeNull();
    expect(modalContent.textContent).toContain('<img src=x onerror=window.__xss_fired=true>');
  });

  it('a crafted data-blocks key/value (script tag) renders as inert text', () => {
    const dom = loadPage();
    const { window } = dom;
    const doc = window.document;

    const cell = doc.querySelectorAll('.course-cell')[2] as HTMLElement;
    cell.setAttribute(
      'data-blocks',
      JSON.stringify({ '<script>alert(1)</script>': 1, normal: '"><b>bold</b>' })
    );
    cell.dispatchEvent(new window.Event('click', { bubbles: true }));

    const modalContent = doc.getElementById('modal-content')!;
    expect(modalContent.querySelector('script')).toBeNull();
    // Only the two legit <b> tags baked into the template (完整範本課 /
    // 代表截圖) should exist -- not one injected via the "normal" key's value.
    expect(modalContent.querySelectorAll('b').length).toBeLessThanOrEqual(1);
    expect(modalContent.textContent).toContain('<script>alert(1)</script>');
    expect(modalContent.textContent).toContain('"><b>bold</b>');
  });

  it('positive control: a real lesson_id still renders its popup content correctly', () => {
    const dom = loadPage();
    const { window } = dom;
    const doc = window.document;

    const cell = doc.querySelector('.course-cell[data-lesson="G6-L22"]') as HTMLElement;
    expect(cell).toBeTruthy();
    cell.dispatchEvent(new window.Event('click', { bubbles: true }));

    const modalContent = doc.getElementById('modal-content')!;
    expect(modalContent.querySelector('h2')!.textContent).toBe('G6-L22');
    expect(modalContent.textContent).toContain('summary_pse');
    expect(modalContent.textContent).toContain('完整範本課');
    // block rows from data-blocks render as a real table, not escaped junk.
    expect(modalContent.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });
});
