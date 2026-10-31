import { test, expect } from './fixtures/pageerror-fixture';
import { findOverlappingPanels, describePanelOverlaps } from './utils/noPanelOverlap';
import { findOccludedButtons, describeViolations } from './utils/noButtonOcclusion';

/**
 * islandFinaleCelebration.spec.ts — #3780 §3「全島亮完→結尾」防回歸
 *
 * 全島亮完才會出現的畫面（光柱／粒子、鐘響、收尾台詞、兩顆按鈕），真的從頭
 * 玩 10 站太慢，PRD §7 允許「可用模擬完成訊號」。
 *
 * ⚠️ 第一版（全部種好再進島）在「結尾只在這次 session 剛完成才觸發」那個
 * 修復上線後整個打不開——不是部署壞了，是測試的前提跟修好的行為互斥：
 * 把全部站都種進 `sessionStorage` 再進島，`visited` 在 `opening` 都還沒走完
 * 就已經是滿的，`prevDone.current` 在使用者看到任何東西之前就被悄悄設成
 * 滿額，之後 `opening` 變 -1 時已經沒有「從沒滿變滿」這個可觀察的瞬間——
 * 這正是修復本身要的效果（重進一座早就全亮的島不該重播），但也代表「全部
 * 種好」這招量不到結尾慶祝了。改成種「少一站」，進島後用清單模式直接打開
 * 最後一站（不用真的解題、也不用在 3D 世界裡走過去），再用
 * `window.postMessage({type:'island-step-done', ...})` 模擬那一站回報完成
 * ——這跟 `ReadingIslandLab.finaleReplay.test.tsx` 的正向對照是同一招，
 * 真的製造出「這次 session 看著它從 9/10 變 10/10」那個時刻。
 *
 * `visited` 要種的是「完整」step id（含 `#錨點`，例如 `full-text-annotate#dcavv`）
 * ——這裡直接查真正的 `/api/stories/{id}` 拿 `step_sequence` 原始陣列，
 * 元素本身就是元件要的那個完整 id，不需要（也不應該）再轉換成「型態」
 * 字串比對。
 *
 * ⚠️ 第三個坑（這支測試的第二版曾經踩到）：`step_sequence` 的型態組合跟
 * 順序因課而異——20012 實際是
 * `['lesson-intro','full-text-annotate#…','key-passage-reading#…',
 *   'vocab-definition#…','vocab-application#…','keypoints-table#…',
 *   'spotlight#…','comprehension#…','vocab-review#…',
 *   'knowledge-station#…','report']`（11 項，多了 20011 沒有的
 * `spotlight`）。曾經寫一份「已知型態」清單去跟 `step_sequence` 逐一比對
 * 配對、藉此拿到完整 id，這樣做在 20012 上會把 `spotlight` 直接漏掉、
 * 導致算出來的清單筆數跟順序都跟 `buildStopsFromSequence()` 真正產生的
 * 清單（跟畫面上清單模式的 `<li>` 順序）對不起來，點第 N 個 `<li>` 點到
 * 完全不同的站。`step_sequence` 本身就已經是「元件要用的那份完整清單、
 * 順序就是畫面順序」（PRD §5.1「站點＝該課 step_sequence 裡的步驟，順序
 * 照平台」），不需要也不能再用一份可能不完整的型態清單去重新篩選它。
 *
 * ⚠️ 第二個坑：demo 學生帳號是這整個任務全程共用的，20011/20012 在這個
 * 帳號上已經累積了真實的伺服器端完成紀錄（例如 20011 的「report」這一站
 * 早就是 server-side 真完成——來自更早的某次 e2e 跑動），跟我這次種的
 * sessionStorage 無關，`completed ∪ visited` 還是會亮到 10/10。固定挑
 * 「清單最後一項」當目標站會剛好挑到這個已經被污染過的站，一樣會在開場
 * 旁白跑到一半前就先跳出慶祝層（擋住「繼續」按鈕，整個卡住）。改成動態
 * 判斷：先查這個學生在這個 story 真正的伺服器完成清單，找出**還沒被
 * 伺服器標記完成**的那一站當目標（而不是死挑最後一項），其餘全部種進
 * sessionStorage，這樣目標站保證在測試開始時真的是「還沒做完」。
 *
 * 結尾卡片本身：改成全螢幕慶祝層（遮罩＋置中卡片，§3）——蓋住 HUD 是刻意
 * 設計，不算重疊。這支測試驗：① 慶祝層本身在畫面內、兩顆按鈕都點得到
 * ② 關掉慶祝層之後，HUD 的面板重疊檢查（收合＋展開兩種狀態）仍然要過。
 * 20011（手刻內容）與 20012（全平台最長課名 26 字）都要跑。
 */

const FE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
const BE = process.env.E2E_BACKEND_URL || 'https://lingoleap-backend-staging-958347263320.asia-east1.run.app';

test.describe.configure({ timeout: 300_000 });

async function loginAsStudent(page) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  const demo = page.getByRole('button', { name: /小明/ }).first();
  if (!(await demo.count())) test.skip(true, '環境不合格：登入頁沒有一鍵登入鈕（INVALID，非 FAIL）');
  await demo.click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 60_000 });
}

/**
 * 種下「除了一站，其他都做完」的模擬訊號。那一站是**動態挑出來**的——先查
 * 這個學生在伺服器上對這個 story 真正的完成紀錄，挑一個伺服器還沒標記
 * 完成的站當目標（見上面檔頭註解的污染問題），不是死挑清單最後一項。
 * 回傳目標站在清單裡的 index（拿去用清單模式打開）、完整 step id（拿去
 * 模擬回報完成用）、種了幾站（方便斷言訊息）。
 */
async function seedAlmostFullCompletion(page, storyId: string): Promise<{ seeded: number; targetIndex: number; targetStepId: string }> {
  // `step_sequence` 本身就是元件要的那份完整清單，順序就是畫面清單模式的
  // `<li>` 順序——不要再篩選／轉換，見上面檔頭註解的第三個坑。
  const resolvedIds: string[] = await page.evaluate(async ([backend, id]) => {
    const res = await fetch(`${backend}/api/stories/${id}`);
    const data = await res.json();
    return data.step_sequence ?? [];
  }, [BE, storyId]);
  expect(resolvedIds.length, `storyId=${storyId} 的 step_sequence 應該至少有 2 站才能測「完成最後一站」，實際 ${resolvedIds.length} 個`).toBeGreaterThan(1);

  const userId: number | string = await page.evaluate(async (backend) => {
    const token = localStorage.getItem('lingoleap_token');
    const res = await fetch(`${backend}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    return data.id;
  }, BE);

  // 查這個學生對這個 story 伺服器端真正的完成清單（可能是空的，代表這個
  // story 這個學生從沒碰過——那是最乾淨的情況）。
  const serverCompleted: string[] = await page.evaluate(async ([backend, uid, slug]) => {
    const token = localStorage.getItem('lingoleap_token');
    const progressRes = await fetch(`${backend}/api/learning/students/${uid}/progress`, { headers: { Authorization: `Bearer ${token}` } });
    const progress = await progressRes.json();
    const text = progress.texts.find((t: { story_slug: string }) => t.story_slug === slug);
    if (!text) return [];
    const sessionRes = await fetch(`${backend}/api/learning/sessions/${text.latest_session_id}/progress`, { headers: { Authorization: `Bearer ${token}` } });
    const session = await sessionRes.json();
    return session.step_progress?.steps_completed ?? [];
  }, [BE, userId, storyId]);

  // 從後面往前找第一個「伺服器還沒標記完成」的站——這站才保證測試開始時
  // 真的是未完成，拿來當目標。都被標記完成的極端情況就退回清單最後一項
  // （該測試會在斷言階段清楚失敗，不會默默誤判成功）。
  let targetIndex = resolvedIds.length - 1;
  for (let i = resolvedIds.length - 1; i >= 0; i--) {
    if (!serverCompleted.includes(resolvedIds[i])) { targetIndex = i; break; }
  }
  const targetStepId = resolvedIds[targetIndex];
  const almostDone = resolvedIds.filter((_, i) => i !== targetIndex);

  await page.evaluate(
    ([key, ids]) => sessionStorage.setItem(key as string, JSON.stringify(ids)),
    [`reading-island-visited:${userId}:${storyId}`, almostDone],
  );

  return { seeded: almostDone.length, targetIndex, targetStepId };
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
 * 用清單模式直接打開清單裡第 `index` 個項目——不用在 3D 世界裡真的走過去，
 * 也不用知道那一站叫什麼名字（範本模式每課站名都不同）。清單順序跟
 * `step_sequence` 一致，`index` 就是 `seedAlmostFullCompletion` 動態選出
 * 、刻意沒種進去的那一站。
 */
async function openStationViaListMode(page, index: number) {
  await page.getByRole('button', { name: '切換清單模式' }).click();
  await page.waitForTimeout(200);
  const enterButton = page.locator('ul > li').nth(index).getByRole('button', { name: /^進入/ });
  await expect(enterButton, `第 ${index} 站應該已經解鎖（前面的站都種好了，不該還卡在霧裡）`).toBeVisible();
  await enterButton.click();
  await page.waitForTimeout(2500); // 開門動畫（1700ms 開 iframe）+ 緩衝
}

/** 模擬學習頁回報「這一站做完了」——跟 ReadingIslandLab 的 message listener 同一個訊息格式。 */
async function reportStepDone(page, stepId: string) {
  await page.evaluate((step) => {
    window.postMessage({ type: 'island-step-done', step }, window.location.origin);
  }, stepId);
  await page.waitForTimeout(1200); // returnToIsland() 的 refreshProgress() 等非同步跑完
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

    test('完成最後一站觸發慶祝層；卡片在畫面內、兩顆按鈕都點得到；按「回遊戲區」導去 /game-hub', async ({ page }) => {
      await loginAsStudent(page);
      const { seeded, targetIndex, targetStepId } = await seedAlmostFullCompletion(page, storyId);
      await enterIslandMainView(page, storyId);
      await openStationViaListMode(page, targetIndex);
      await reportStepDone(page, targetStepId);

      const dialog = page.getByRole('dialog', { name: '結尾慶祝' });
      await expect(dialog, `種了 ${seeded} 站、回報完成第 ${targetIndex} 站後，結尾慶祝層應該要出現`).toBeVisible({ timeout: 10_000 });

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
      const { targetIndex, targetStepId } = await seedAlmostFullCompletion(page, storyId);
      await enterIslandMainView(page, storyId);
      await openStationViaListMode(page, targetIndex);
      await reportStepDone(page, targetStepId);

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
