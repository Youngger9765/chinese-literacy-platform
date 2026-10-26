import { test, expect } from './fixtures/pageerror-fixture';
import { findOverlappingPanels, describePanelOverlaps } from './utils/noPanelOverlap';
import { findOccludedButtons, describeViolations } from './utils/noButtonOcclusion';

/**
 * islandFinaleCelebration.spec.ts — #3780 §3「全島亮完→結尾」防回歸
 *
 * 全島亮完才會出現的畫面（光柱／粒子、鐘響、收尾台詞、兩顆按鈕），真的從頭
 * 玩 10 站太慢，PRD §7 允許「可用模擬完成訊號」——這支測試在 sessionStorage
 * 種下 `visited` 清單跳過真的解題，只驗結尾畫面本身。
 *
 * `visited` 要種的是 `stepFor()` 解析後的「完整」step id（含 `#錨點`），不是
 * `STOPS_20011` 裡的原始型態字串——所以這裡直接查真正的 `/api/stories/{id}`，
 * 用跟元件一樣的「取前綴比對」邏輯自己算一次，不是照抄一份寫死的清單
 * （課文內容若改版，寫死的清單會悄悄過期但測試還是綠的）。
 *
 * ⚠️ 第一版是審查員二次審查退回的：結尾卡片沿用 `guide` 提示框的
 * `top-20` 置中位置常駐顯示，手機 390px 寬、20011、收合狀態下量到跟標題卡
 * 重疊 8315px²、跟工具列重疊 682px²——這支測試原本沒驗到，因為只驗了「卡片
 * 出現」沒驗「有沒有跟左欄疊住」。改成全螢幕慶祝層（遮罩＋置中卡片）之後，
 * 這支測試改驗：① 慶祝層本身在畫面內、兩顆按鈕都點得到 ② 關掉慶祝層之後，
 * HUD 的面板重疊檢查（收合＋展開兩種狀態）仍然要過——蓋住 HUD 是慶祝層
 * 刻意的設計，不算違規；但慶祝層自己的版面、跟關掉之後 HUD 恢復正常，
 * 都要驗過。20011（手刻內容）與 20012（全平台最長課名 26 字）都要跑。
 */

const FE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
const BE = process.env.E2E_BACKEND_URL || 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

// 跟 ReadingIslandLab.tsx 的 STOPS_20011 同一份型態清單（故意不 import 元件
// 內部模組——e2e 只打瀏覽器看得到的介面，不碰 React 內部）。範本模式課文
// （20012）用同一組型態，實際站數可能更少，`seedFullCompletion` 只種真的
// 解析得到的那幾個，不強求剛好 10 個。
const STOP_TYPES = [
  'lesson-intro', 'full-text-annotate', 'key-passage-reading', 'vocab-definition',
  'vocab-application', 'keypoints-table', 'comprehension', 'vocab-review',
  'knowledge-station', 'report',
];

test.describe.configure({ timeout: 300_000 });

async function loginAsStudent(page) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  const demo = page.getByRole('button', { name: /小明/ }).first();
  if (!(await demo.count())) test.skip(true, '環境不合格：登入頁沒有一鍵登入鈕（INVALID，非 FAIL）');
  await demo.click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 60_000 });
}

/** 種下「全部站都做完」的模擬訊號，回傳實際種了幾個 id 方便斷言。 */
async function seedFullCompletion(page, storyId: string): Promise<number> {
  const stepSequence: string[] = await page.evaluate(async ([backend, id]) => {
    const res = await fetch(`${backend}/api/stories/${id}`);
    const data = await res.json();
    return data.step_sequence ?? [];
  }, [BE, storyId]);

  const resolvedIds = STOP_TYPES.map((type) => stepSequence.find((id) => id.split('#')[0] === type)).filter(Boolean);
  expect(resolvedIds.length, `storyId=${storyId} 的 step_sequence 應該至少解析出一些站，實際 0 個——課文內容可能改版了`).toBeGreaterThan(0);

  const userId: number | string = await page.evaluate(async (backend) => {
    const token = localStorage.getItem('lingoleap_token');
    const res = await fetch(`${backend}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    return data.id;
  }, BE);

  await page.evaluate(
    ([key, ids]) => sessionStorage.setItem(key as string, JSON.stringify(ids)),
    [`reading-island-visited:${userId}:${storyId}`, resolvedIds],
  );

  return resolvedIds.length;
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

function panelsOf(page) {
  return [
    { name: '喝采島標題卡', locator: page.locator('header') },
    { name: '劇情說明卡/按鈕', locator: page.getByText(/第一幕|第二幕|第三幕/) },
    { name: '工具列（清單模式/聲音）', locator: page.getByLabel('工具列') },
  ];
}

for (const storyId of ['20011', '20012']) {
  test.describe(`喝采島全島亮完的結尾慶祝 — 手機 390x844（${storyId}，模擬完成訊號）`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('慶祝層出現、卡片在畫面內、兩顆按鈕都點得到；按「回遊戲區」導去 /game-hub', async ({ page }) => {
      await loginAsStudent(page);
      const seeded = await seedFullCompletion(page, storyId);
      await enterIslandMainView(page, storyId);

      const dialog = page.getByRole('dialog', { name: '結尾慶祝' });
      await expect(dialog, `種了 ${seeded} 個完成訊號後，結尾慶祝層應該要出現`).toBeVisible({ timeout: 10_000 });

      // 卡片要整個在畫面內（不是被裁到螢幕外），蓋住 HUD 是刻意設計，
      // 不用跟 HUD 兩兩比對——只驗自己的版面合不合理。
      const viewport = page.viewportSize();
      const box = await dialog.locator('> div').last().boundingBox();
      expect(box, '慶祝卡片應該有 boundingBox').toBeTruthy();
      if (box && viewport) {
        expect(box.x, '卡片左緣不該超出螢幕左邊').toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, '卡片右緣不該超出螢幕右邊').toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y, '卡片上緣不該超出螢幕上面').toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, '卡片下緣不該超出螢幕下面').toBeLessThanOrEqual(viewport.height + 1);
      }

      const backButton = page.getByRole('button', { name: '回遊戲區' });
      const stayButton = page.getByRole('button', { name: '留在島上看看' });
      await expect(backButton).toBeVisible();
      await expect(stayButton).toBeVisible();

      // 兩顆按鈕都點得到——沒有被光柱/粒子那層 `pointer-events-none` 以外
      // 的東西擋住（它自己理論上 pointer-events-none，但還是實測比猜可靠）。
      const occlusionResult = await findOccludedButtons(page, [backButton, stayButton]);
      expect(occlusionResult.passed, describeViolations(occlusionResult)).toBe(true);

      await backButton.click();
      await page.waitForURL(/\/game-hub/, { timeout: 15_000 });
    });

    test('按「留在島上看看」關掉慶祝層後，HUD 面板收合／展開兩種狀態都不互疊', async ({ page }) => {
      await loginAsStudent(page);
      await seedFullCompletion(page, storyId);
      await enterIslandMainView(page, storyId);

      const stayButton = page.getByRole('button', { name: '留在島上看看' });
      await expect(stayButton, '結尾慶祝層應該要出現才能關掉它').toBeVisible({ timeout: 10_000 });
      await stayButton.click();
      await expect(page.getByRole('dialog', { name: '結尾慶祝' })).toBeHidden();

      // 關掉之後 HUD 應該完全恢復正常——收合狀態先驗一次。
      const panels = panelsOf(page);
      const collapsedResult = await findOverlappingPanels(page, panels);
      expect(collapsedResult.passed, `收合狀態：\n${describePanelOverlaps(collapsedResult)}`).toBe(true);

      // 展開「第一幕」劇情說明卡再驗一次（這是上一輪 G7 修過的那個重疊，
      // 確認慶祝層的改動沒有把它弄回去）。
      const expandActInfo = page.getByRole('button', { name: '展開劇情說明' });
      if (await expandActInfo.count()) {
        await expandActInfo.click();
        await page.waitForTimeout(200);
        const expandedResult = await findOverlappingPanels(page, panels);
        expect(expandedResult.passed, `展開劇情說明後：\n${describePanelOverlaps(expandedResult)}`).toBe(true);
      }
    });
  });
}
