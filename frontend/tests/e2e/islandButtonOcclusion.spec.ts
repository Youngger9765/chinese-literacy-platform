import { test, expect } from './fixtures/pageerror-fixture';
import { findOccludedButtons, describeViolations } from './utils/noButtonOcclusion';

/**
 * islandButtonOcclusion.spec.ts — #3780 G7 防回歸
 *
 * team-lead 2026-10-26 手機截圖抓到：冷開場旁白的「繼續」被「聲音：開」蓋住，
 * 主畫面的「聲音：開」疊在虛擬搖桿裡。根因是左下角幾個元素各自調
 * `bottom-*`/`z-*` 數字、沒有統一規劃。這支測試在桌機／iPad／手機三種尺寸
 * 下，分別在「開場旁白進行中」與「主畫面」兩個狀態各檢查一次 team-lead
 * 點名的那幾顆：繼續／聽這句／直接上岸走／聲音（開場旁白）、
 * 清單模式／聲音／展開上帝視角／跳／搖桿（主畫面）。
 *
 * 只檢查這張名單、不掃全頁所有按鈕：寫這支測試時實測過，掃全頁會把「開場
 * 旁白的全螢幕遮罩擋住背景的展開上帝視角」也算成違規——但那是故意的
 * （PRD §6：開場鏡頭飛行期間不會觸發進入建築），不是 bug。
 *
 * 寫這支測試時在修復前的版本（599aa6a53，只修了清單模式/聲音互相重疊）
 * 上跑過，三種尺寸全部在「主畫面」那關紅：手機紅在「聲音：開」疊搖桿、
 * 「跳」與「展開上帝視角」被(當時)旁白全螢幕遮罩蓋住判定——改成只檢查
 * 畫面狀態真正該能點的名單後，桌機/iPad 綠、手機紅在聲音疊搖桿／聲音疊
 * 繼續，這才是 team-lead 真正要抓的那兩個問題，紅得乾淨。
 */

const FE = process.env.PLAYWRIGHT_BASE_URL || 'https://lingoleap-staging.web.app';
const STORY_ID = '20011';

test.describe.configure({ timeout: 300_000 });

/**
 * 點在元素右下角而不是正中央——只給「跳過開場旁白、趕去主畫面」這條導航
 * 路徑用，不是拿來驗證有沒有遮擋（那是 findOccludedButtons 的事）。理由：
 * 手機尺寸下「繼續」被「聲音：開」蓋住的那段區域剛好在左側，右下角這塊
 * 目前還沒被蓋到，用這個點導航才能可靠地走到主畫面，不受「開場旁白」測試
 * 本身要抓的那個 bug 影響——兩條測試要各自獨立，不要互相卡住。
 */
async function clickAwayFromOverlap(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('clickAwayFromOverlap：目標不可見，沒有 boundingBox');
  await locator.page().mouse.click(box.x + box.width - 6, box.y + box.height - 6);
}

async function loginAsStudent(page) {
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle' });
  const demo = page.getByRole('button', { name: /小明/ }).first();
  if (!(await demo.count())) test.skip(true, '環境不合格：登入頁沒有一鍵登入鈕（INVALID，非 FAIL）');
  await demo.click();
  await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 60_000 });
}

const VIEWPORTS = [
  { label: '桌機 1440x900', width: 1440, height: 900 },
  { label: 'iPad 820x1180', width: 820, height: 1180 },
  { label: '手機 390x844', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test.describe(`喝采島按鈕不互相蓋住 — ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('開場旁白：繼續／聽這句／直接上岸走／聲音 互不遮擋', async ({ page }) => {
      await loginAsStudent(page);
      await page.goto(`${FE}/lab/island/${STORY_ID}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      const coldOpenBtn = page.getByRole('button', { name: /點一下，進入喝采島/ });
      if (!(await coldOpenBtn.count())) test.skip(true, '環境不合格：冷開場畫面沒出現');
      await coldOpenBtn.click();
      await page.waitForTimeout(600);

      const openingTargets = [
        page.getByRole('button', { name: /^繼續$/ }),
        page.getByRole('button', { name: /聽這句/ }),
        page.getByRole('button', { name: /直接上岸走/ }),
        page.getByRole('button', { name: /聲音/ }),
      ];

      for (let i = 0; i < 10; i++) {
        const cont = page.getByRole('button', { name: /^繼續$/ });
        const landBtn = page.getByRole('button', { name: /直接上岸走/ });
        if (!(await cont.count()) && !(await landBtn.count())) break;

        await page.waitForTimeout(300); // 等 Ken Burns/進場動畫穩定，避免量到過渡中的座標
        const result = await findOccludedButtons(page, openingTargets);
        expect(result.passed, `開場旁白第 ${i + 1} 句（${vp.label}）：\n${describeViolations(result)}`).toBe(true);

        if (await landBtn.count()) {
          await clickAwayFromOverlap(landBtn);
          break;
        }
        await clickAwayFromOverlap(cont);
        await page.waitForTimeout(400);
      }
    });

    test('主畫面：清單模式／聲音／展開上帝視角／跳／搖桿 互不遮擋', async ({ page }) => {
      await loginAsStudent(page);
      await page.goto(`${FE}/lab/island/${STORY_ID}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      const coldOpenBtn = page.getByRole('button', { name: /點一下，進入喝采島/ });
      if (!(await coldOpenBtn.count())) test.skip(true, '環境不合格：冷開場畫面沒出現');
      await coldOpenBtn.click();
      await page.waitForTimeout(600);

      // 直接上岸走，快速跳過旁白進入主畫面（開場旁白本身的檢查是上一條測試的事）
      for (let i = 0; i < 10; i++) {
        const landBtn = page.getByRole('button', { name: /直接上岸走/ });
        if (await landBtn.count()) { await clickAwayFromOverlap(landBtn); break; }
        const cont = page.getByRole('button', { name: /^繼續$/ });
        if (!(await cont.count())) break;
        await clickAwayFromOverlap(cont);
        await page.waitForTimeout(300);
      }

      // 世界建立＋開場鏡頭飛行穩定後再量
      await page.waitForTimeout(5500);

      const mainTargets = [
        page.getByRole('button', { name: /切換清單模式/ }),
        page.getByRole('button', { name: /聲音/ }),
        page.getByRole('button', { name: /展開上帝視角|回到第一人稱/ }),
        page.getByRole('button', { name: /^跳$/ }),
        page.getByRole('group', { name: /虛擬搖桿/ }),
      ];
      const result = await findOccludedButtons(page, mainTargets);
      expect(result.passed, `主畫面（${vp.label}）：\n${describeViolations(result)}`).toBe(true);
    });
  });
}
