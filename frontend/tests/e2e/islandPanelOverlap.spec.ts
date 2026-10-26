import { test, expect } from './fixtures/pageerror-fixture';
import { findOverlappingPanels, describePanelOverlaps } from './utils/noPanelOverlap';

/**
 * islandPanelOverlap.spec.ts — #3780 G7 防回歸
 *
 * team-lead 2026-10-26 看 `g7-after-2a75d50a/phone-main.png` 截圖抓到：手機
 * 390px 寬放不下左上「喝采島」標題卡跟右上「第一幕」劇情卡並排，兩張疊在
 * 一起，標題卡的「國語四上」那行跟右半邊被蓋住。`islandButtonOcclusion.
 * spec.ts` 只檢查按鈕點不點得到，沒檢查「兩張卡片疊住看不清楚文字」這種
 * 問題，所以沒抓到——這支測試補上這一類：兩兩比對 HUD 面板的 boundingBox，
 * 不能互相交疊。
 *
 * 桌機／iPad／手機三種尺寸都跑（對 20011）。選擇器刻意不只認這次修復才加
 * 的 aria-label（詳見 panels 清單旁的註解），讓同一支測試檔案可以直接對著
 * 修復前的部署跑：對著 `dd0f0484b`（修復前）跑過，手機尺寸真的紅在
 * 「喝采島標題卡」跟「劇情說明卡/按鈕」交疊（交集 1295px²），桌機/iPad
 * 本來就是綠的（兩張卡片橫向空間夠，不會疊到）。
 *
 * ⚠️ 這支測試後來自己又抓到第二個重疊（標題卡 vs 工具列），第一次修法是
 * 把工具列的 `top-32` 改成 `top-40`——team-lead 指出這是同一個壞習慣：
 * 猜一個像素數字，標題卡的高度會跟著課名長度變動，範本模式下任何一課都
 * 會長出自己的島，緩衝量多少都可能被更長的課名吃掉。改成讓工具列跟標題卡
 * 共用 flex-col 容器（見 ReadingIslandLab.tsx），不管標題卡多高都自動排在
 * 它下面，不靠猜的數字。為了證明這個修法真的不挑課名長度，另外加了
 * `20012`（全平台 179 課裡標題最長的一課，26 字）這個壓力測試案例。
 */

const FE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';

test.describe.configure({ timeout: 300_000 });

async function loginAsStudent(page) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  const demo = page.getByRole('button', { name: /小明/ }).first();
  if (!(await demo.count())) test.skip(true, '環境不合格：登入頁沒有一鍵登入鈕（INVALID，非 FAIL）');
  await demo.click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 60_000 });
}

/**
 * 選擇器刻意不只認這次修復才加的 aria-label：「喝采島標題卡」用 `header`
 * 標籤（修復前後都是這個標籤）、「劇情說明卡/按鈕」用文字內容「第一幕」
 * （修復前是常駐 div、修復後是收合按鈕或展開 div，三種情況文字都含
 * 「第一幕」）——這樣同一支測試檔案可以直接對著「修復前已部署的版本」跑出
 * 真紅，不用等部署完才能第一次執行。「工具列」那個容器修復前沒有獨立的
 * aria-label，用舊版本跑時會跳過不測（count=0），這是已知的覆蓋落差。
 */
function panelsOf(page) {
  return [
    { name: '喝采島標題卡', locator: page.locator('header') },
    { name: '劇情說明卡/按鈕', locator: page.getByText(/第一幕|第二幕|第三幕/) },
    { name: '文字寶貝欄', locator: page.getByLabel('文字寶寶') },
    { name: '工具列（清單模式/聲音）', locator: page.getByLabel('工具列') },
    { name: '虛擬搖桿', locator: page.getByRole('group', { name: /虛擬搖桿/ }) },
    { name: '跳', locator: page.getByRole('button', { name: /^跳$/ }) },
    { name: '展開上帝視角', locator: page.getByRole('button', { name: /展開上帝視角|回到第一人稱/ }) },
  ];
}

async function enterIslandMainView(page, storyId: string) {
  await page.goto(`${FE}/lab/island/${storyId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const coldOpenBtn = page.getByRole('button', { name: /點一下，進入喝采島/ });
  if (!(await coldOpenBtn.count())) test.skip(true, '環境不合格：冷開場畫面沒出現');
  await coldOpenBtn.click();
  await page.waitForTimeout(600);

  for (let i = 0; i < 10; i++) {
    const landBtn = page.getByRole('button', { name: /直接上岸走/ });
    if (await landBtn.count()) { await landBtn.click(); break; }
    const cont = page.getByRole('button', { name: /^繼續$/ });
    if (!(await cont.count())) break;
    await cont.click();
    await page.waitForTimeout(300);
  }

  await page.waitForTimeout(5500); // 世界建立＋開場鏡頭飛行穩定
}

/**
 * 手機版「第一幕」卡片修復後是收合的按鈕，點開才會有完整卡片——兩種狀態
 * （收合按鈕 vs 展開卡片）都要驗沒有疊到別的東西，分開斷言、分開報告，
 * 不能只報收合狀態（team-lead 2026-10-26 明令：審查員點出展開後的卡片
 * 共用同一個 `max-w` 限制，有可能展開才出事，收合是綠的不代表整個過）。
 */
async function checkCollapsedAndExpanded(page, vp: string) {
  const panels = panelsOf(page);

  const collapsedResult = await findOverlappingPanels(page, panels);
  expect(collapsedResult.passed, `收合狀態（${vp}）：\n${describePanelOverlaps(collapsedResult)}`).toBe(true);

  const expandActInfo = page.getByRole('button', { name: '展開劇情說明' });
  if (await expandActInfo.count()) {
    await expandActInfo.click();
    await page.waitForTimeout(200);
    const expandedResult = await findOverlappingPanels(page, panels);
    expect(expandedResult.passed, `展開劇情說明後（${vp}）：\n${describePanelOverlaps(expandedResult)}`).toBe(true);
  }
}

const VIEWPORTS = [
  { label: '桌機 1440x900', width: 1440, height: 900 },
  { label: 'iPad 820x1180', width: 820, height: 1180 },
  { label: '手機 390x844', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test.describe(`喝采島 HUD 面板不互相蓋住 — ${vp.label}（20011，手刻內容）`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('主畫面：標題卡／劇情說明／文字寶貝／工具列／搖桿／跳／上帝視角 兩兩不交疊（收合＋展開兩種狀態分開驗）', async ({ page }) => {
      await loginAsStudent(page);
      await enterIslandMainView(page, '20011');
      await checkCollapsedAndExpanded(page, vp.label);
    });
  });
}

// 壓力測試：全平台 179 課裡標題最長的一課（20012，26 字，範本模式產生的島，
// 不是手刻的 20011）。只在手機測——這個重疊問題本來就是窄螢幕才會發生，
// 桌機/iPad 橫向空間本來就夠。
test.describe('喝采島 HUD 面板不互相蓋住 — 手機 390x844（20012，全平台最長課名，壓力測試）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('最長課名（26 字）不會讓標題卡長高到跟工具列疊在一起', async ({ page }) => {
    await loginAsStudent(page);
    await enterIslandMainView(page, '20012');
    await checkCollapsedAndExpanded(page, '手機 390x844 / 20012 最長課名');
  });
});
