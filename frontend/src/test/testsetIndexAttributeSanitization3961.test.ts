/**
 * #3961 回歸鎖：`public/testset-7f3a91c4/index.html` 的 `esc()` helper 只
 * 逃逸 `& < >`，沒有逃逸 `"` / `'`（CodeQL
 * `js/incomplete-html-attribute-sanitization` alert #55）。它被用在
 * `href="..."` 這個屬性情境裡；今天唯一會變動的部分 `s.id` 先經過
 * `encodeURIComponent()` 才到 `esc()`，剛好把字面 `"` 變成 `%22` 而沒
 * 事——所以**現有這個呼叫點**今天打不穿。但 `esc()` 本身是個通用
 * helper，也被同一支程式拿去逃逸純文字（`s.title`／錯誤訊息），而且
 * 命名與用途（"給 HTML 用的逃逸函式"）就是在邀請未來有人直接把它套在
 * 新的屬性情境、且不再先做 URI 編碼——"逃逸器本身沒逃逸它被用在的那個
 * 屬性會終止的字元" 是 esc() 這個函式自己的缺口，不是現有呼叫點的缺口。
 *
 * 測試分兩層：
 *   1. 直接測 esc() 函式本身（從真的靜態檔載入、取用它實際宣告的那個
 *      function，不是重寫一份），證明 `"` `'` 現在真的被逃逸
 *   2. 模擬「下一個人把 esc() 套進新屬性情境」會不會被咬：组一個
 *      `href="' + esc(payload) + '"` 字串，payload 本身**沒有**先經過
 *      encodeURIComponent（正是 esc() 自己扛起全部逃逸責任的情境），
 *      解析回 DOM，斷言屬性沒有被提早終止、注入的 onmouseover 從未真的
 *      變成一個屬性
 *   3. 正常課文（無特殊字元）仍然正確顯示——不讓這把鎖把合法內容也擋掉
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, it, expect } from 'vitest';

const HTML_PATH = join(__dirname, '..', '..', 'public', 'testset-7f3a91c4', 'index.html');

const openWindows: JSDOM[] = [];

function loadPage(stories: Array<{ id: string; title: string }>): JSDOM {
  const html = readFileSync(HTML_PATH, 'utf-8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(window) {
      // The page's own script calls fetch(...) unconditionally at the
      // bottom of its inline <script>, before any DOMContentLoaded gate --
      // the stub has to exist before that script runs, which is exactly
      // what beforeParse is for.
      (window as unknown as { fetch: typeof fetch }).fetch = (async () =>
        ({
          ok: true,
          json: async () => ({ stories }),
        }) as unknown as Response) as unknown as typeof fetch;
    },
  });
  openWindows.push(dom);
  return dom;
}

async function waitForLessonList(dom: JSDOM): Promise<HTMLElement> {
  const el = dom.window.document.getElementById('lessonList') as HTMLElement;
  for (let i = 0; i < 10 && el.textContent === '載入中…'; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  return el;
}

afterEach(() => {
  while (openWindows.length) {
    openWindows.pop()!.window.close();
  }
});

describe('#3961 testset index.html esc() attribute sanitization', () => {
  it("esc() (the function actually declared in the file) escapes \" and ' along with & < >", () => {
    const dom = loadPage([]);
    const esc = (dom.window as unknown as { esc: (s: string) => string }).esc;
    expect(typeof esc).toBe('function');

    const out = esc(`a"b<c>&d'e`);
    expect(out).toBe('a&quot;b&lt;c&gt;&amp;d&#39;e');
  });

  it('using esc() to build a new href attribute neutralizes an attribute-breakout payload', () => {
    // Simulates the exact danger the finding describes: esc() reused in a
    // NEW attribute context, on a value that has NOT been
    // encodeURIComponent'd upstream (unlike the current s.id call site).
    const dom = loadPage([]);
    const esc = (dom.window as unknown as { esc: (s: string) => string }).esc;

    const payload = '" onmouseover="window.__attr_breakout=true';
    const html = '<a id="probe" href="' + esc(payload) + '">link</a>';

    const container = dom.window.document.createElement('div');
    container.innerHTML = html;
    dom.window.document.body.appendChild(container);

    const probe = container.querySelector('#probe') as HTMLAnchorElement;
    expect(probe).toBeTruthy();
    // The payload must stay entirely inside the href value -- no sibling
    // onmouseover attribute should exist on the real element.
    expect(probe.getAttribute('onmouseover')).toBeNull();
    expect(probe.getAttribute('href')).toContain('onmouseover="window.__attr_breakout=true');

    // And even if a handler attribute DID somehow get attached, it should
    // never have fired (defense in depth -- confirms nothing executed).
    expect((dom.window as unknown as { __attr_breakout?: boolean }).__attr_breakout).toBeUndefined();
  });

  it('positive control: a normal story still renders its link and title correctly', async () => {
    const dom = loadPage([{ id: 'G6-L22', title: '孟嘗君' }]);
    const lessonList = await waitForLessonList(dom);

    const link = lessonList.querySelector('a.btn-main') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('./record.html?lesson=G6-L22');
    expect(link.textContent).toContain('孟嘗君');
    expect(link.querySelector('span')!.textContent).toBe('G6-L22');
  });

  it('positive control: a story title containing " still displays the literal quote as text', async () => {
    const dom = loadPage([{ id: 'G6-L23', title: '正常標題"引述"' }]);
    const lessonList = await waitForLessonList(dom);

    const link = lessonList.querySelector('a.btn-main') as HTMLAnchorElement;
    expect(link.textContent).toContain('正常標題"引述"');
  });
});
