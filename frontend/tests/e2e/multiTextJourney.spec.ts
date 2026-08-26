import { test, expect } from '@playwright/test';

/**
 * 一課多篇：從第 1 步逐步按完成標記走完，每一步都要是**那一篇**的內容（#2930）。
 *
 * ⚠️ 這條存在的理由：先前我全用 `?p=` 直接開網址驗，判準只看「三篇內容不同」。
 * 那既不是真實入口（app 不會產生那種進法），也不是正確性判準（不同 ≠ 正確）。
 * 擁有者實測找到的三類 bug 全落在我標綠的格子裡，其中「按完成標記直接跳到
 * 最後一步」只有走完整條路才會遇到。
 *
 * 判準三條，缺一不可：
 *   1. 每一步畫面上要有**該篇**的內容（拿後端 repeat_rounds 的真值比對）
 *   2. 按完成標記要走到**下一步**，不是跳到 report
 *   3. 兩邊字串用同一種正規化（只留中文）—— 一邊去標點一邊不去，會全部誤判
 */

const FE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
const BE = process.env.E2E_BACKEND_URL
  || 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';
// 五課多篇全跑（擁有者回報涵蓋 G6-L22 與 G5-L17，其餘一併鎖住）
const LESSONS: Array<[string, string]> = [
  ['20029', 'G5-L17（兩篇）'],
  ['20063', 'G6-L22（三篇）'],
  ['20111', 'G8-L13（兩篇）'],
  ['20137', 'G9-L16（兩篇）'],
  ['20144', 'G9-L23（三篇）'],
];

test.describe.configure({ timeout: 300_000 });

/** 只留中文 —— 兩邊都要用這一支，否則標點差異會讓每一步都誤判。 */
const zh = (s: string) => (s ?? '').replace(/[^一-龥]/g, '');

type Round = Record<string, unknown>;

/** 這一步該顯示什麼：挑**各篇真的不同**的欄位，不要挑三篇共用的題目說明。 */
function expectedFor(round: Round, module: string): string | null {
  const r = round as Record<string, never>;
  if (module === 'full-text-annotate') return (r.paragraphs as string[] | undefined)?.[0] ?? null;
  if (module === 'key-passage-reading') return (r.key_reading as { passage?: string } | undefined)?.passage ?? null;
  if (module === 'vocab-definition') {
    // 用「解釋」而不是「詞＋解釋」相連 —— 畫面上兩者不一定相鄰，
    // 而且第一筆不一定排在最前面。回整份，由呼叫端判斷「有沒有任一筆出現」。
    const items = (r.vocabulary as { word: string; definition: string }[] | undefined) ?? [];
    return items.length ? items.map((i) => i.definition).join('\u0001') : null;
  }
  if (module === 'vocab-application') {
    const it = ((r.fill_in_blank as { sentence?: string }[] | undefined) ?? [])[0];
    return it?.sentence ?? null;
  }
  if (module === 'keypoints-table') {
    const t = r.story_structure_table;
    return t ? JSON.stringify(t) : null;
  }
  return null;
}

for (const [LESSON, LABEL] of LESSONS) {
test(`從第 1 步逐步走完，每一步都是自己那一篇 — ${LABEL}`, async ({ page }) => {
  const detail = await (await fetch(`${BE}/api/stories/${LESSON}`)).json();
  const rounds: Record<string, Round> = detail.repeat_rounds ?? {};
  const seq: string[] = detail.step_sequence ?? [];
  expect(seq.length, '拿不到 step_sequence').toBeGreaterThan(3);   // 有的課只有 8 節
  expect(Object.keys(rounds).length, '這一課不是多篇？那這條測試該換課').toBeGreaterThanOrEqual(2);

  // 帳本：每一節屬於哪一篇
  const articleOf: Record<string, string | null> = {};
  for (const s of detail.manifest_sections ?? []) {
    const ref = s.text_ref;
    articleOf[s.slug] =
      typeof ref === 'string' && ref ? ref : s.module === 'full_text_annotate' ? s.slug : null;
  }

  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /小明/ }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.goto(`${FE}/learn/${LESSON}/lesson-intro`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /開始學習/ }).first().click();
  await page.waitForTimeout(3000);

  const wrong: string[] = [];
  let checked = 0;

  // B9：進度寫入的 key 要帶輪次，否則三篇的進度會互相覆蓋
  const activeOffsets: number[] = [];
  const progressKeys = new Set<string>();
  page.on('request', (r) => {
    if (!/\/api\/learning\/sessions\//.test(r.url())) return;
    try {
      const body = JSON.parse(r.postData() ?? '{}');
      Object.keys(body?.step_data ?? {}).forEach((k) => progressKeys.add(k));
      if (typeof body?.current_step === 'string') progressKeys.add(body.current_step);
    } catch { /* 不是 JSON 就略過 */ }
  });

  for (let i = 1; i < seq.length + 2; i++) {
    const path = page.url().split(`/learn/${LESSON}/`)[1] ?? '';
    const segment = path.split('?')[0];
    const slug = /[?&]p=([^&]+)/.exec(path)?.[1] ?? '';
    const article = articleOf[slug];

    if (article && rounds[article]) {
      const want = expectedFor(rounds[article], segment);
      if (want) {
        checked++;
        const body = zh(await page.locator('body').innerText());
        // 期待值可能是多個候選（\u0001 分隔）：任一出現就算這一步顯示了該篇的內容
        const candidates = want.split('\u0001').map((c) => zh(c).slice(0, 12)).filter(Boolean);
        const key = candidates[0] ?? '';
        if (candidates.length && !candidates.some((c) => body.includes(c))) {
          wrong.push(`第 ${i + 1} 步 ${segment}?p=${slug}：看不到篇 ${article} 的內容（期待「${key}」）`);
        }
      }
    }

    // B4：active 圓圈要跟著輪次走。序列裡第幾個，圓圈就該是第幾顆。
    if (slug) {
      const expectedIdx = seq.indexOf(`${segment}#${slug}`);
      const activeIdx = await page.evaluate(() => {
        const cur = document.querySelector('[aria-current="step"]');
        if (!cur) return -1;
        const row = cur.parentElement?.parentElement;
        return [...(row?.querySelectorAll('button') ?? [])].indexOf(
          (cur.closest('button') as HTMLButtonElement) ?? (cur as HTMLButtonElement),
        );
      });
      if (expectedIdx >= 0 && activeIdx >= 0) {
        // 圓圈列前面可能有非步驟鈕，所以比的是**相對位移一致**而非絕對值
        activeOffsets.push(activeIdx - expectedIdx);
      }
    }

    const finish = page.getByRole('button', { name: /完成標記|完成|下一步|下一關/ }).first();
    if ((await finish.count()) === 0) break;
    const before = page.url();
    await finish.click().catch(() => undefined);
    await page.waitForTimeout(4000);
    if (page.url() === before) break;
    if (page.url().includes('/report')) {
      // 走到最後一個學習步驟之後進報告頁是對的；**中途**跳過去才是那個 bug。
      const isNearEnd = i >= seq.length - 2;
      if (!isNearEnd) {
        wrong.push(`第 ${i + 1} 步按完成標記直接跳到 report（共 ${seq.length} 步）—— 應該走到下一步`);
      }
      break;
    }
  }

  // 正向對照：一步都沒比對到的話，上面的 0 不代表通過
  expect(checked, '一個步驟都沒比對到 —— 走查邏輯壞了，不是內容乾淨').toBeGreaterThanOrEqual(2);
  expect(wrong, `\n  ${wrong.join('\n  ')}\n`).toEqual([]);

  // B4：位移必須一致 —— 不一致代表某幾步的高亮沒跟著輪次跑
  if (activeOffsets.length >= 3) {
    expect(new Set(activeOffsets).size, `active 圓圈位移不一致：${activeOffsets}`).toBe(1);
  }

  // B9：多篇課的進度 key 至少要有一個帶輪次；全是裸 key 代表三篇會互相覆蓋
  const keys = [...progressKeys];
  if (keys.length) {
    expect(
      keys.some((k) => k.includes('#')),
      `進度 key 全是裸的，三篇會互相覆蓋：${keys.slice(0, 8)}`,
    ).toBe(true);
  }
});
}
