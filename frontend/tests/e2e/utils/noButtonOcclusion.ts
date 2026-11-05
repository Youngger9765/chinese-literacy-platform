import type { Locator, Page } from '@playwright/test';

/**
 * noButtonOcclusion.ts — 防回歸：喝采島左下角元素互相蓋住（#3780 G7）
 *
 * 2026-10-26 team-lead 手機尺寸截圖抓到兩個既有問題：冷開場旁白的「繼續」
 * 被持久顯示的「聲音：開」蓋住一部分；主畫面的「聲音：開」疊在虛擬搖桿的
 * 觸控範圍裡。根因是左下角幾個元素各自用 `bottom-*`/`z-*` 數字定位、沒有
 * 統一規劃，疊加出來的結果——逐一調數字會一直復發，所以改成一道通用檢查：
 * 給一組「這個畫面狀態下應該要能點到的東西」的 locator，對每一個取它的
 * 中心點，問瀏覽器 `document.elementFromPoint` 實際點到的是誰——不是自己
 * 或自己的子元素，就代表有別的東西蓋在上面。
 *
 * 不要掃全頁所有 `<button>`：寫這支測試時實測過，掃全頁會把「開場旁白的
 * 全螢幕遮罩（設計上就是要擋住背景的 PRD §6：開場鏡頭飛行期間不會觸發
 * 進入建築）蓋住『展開上帝視角』」也算成違規——那不是 bug，是故意的。
 * 所以由呼叫端依「這個畫面狀態下真正應該能點的東西」自己列 locator，
 * 檢查本身維持通用（不認按鈕名字、不管是哪一課），PRD 的 C（全課自動
 * 檢查）要重複使用時，一樣是呼叫端依畫面狀態列 locator、這支只管比對。
 */

export interface OcclusionViolation {
  label: string;
  occludedByTag: string;
  occludedByText: string;
}

export interface OcclusionResult {
  passed: boolean;
  violations: OcclusionViolation[];
}

/**
 * 檢查一組 locator：每一個如果「目前有渲染且看得到」，它的中心點是否真的
 * 點得到自己（或自己的子元素）。還沒渲染／目前不可見的 locator 直接跳過
 * 不算違規——例如開場旁白期間「清單模式」本來就不該存在。
 */
export async function findOccludedButtons(page: Page, targets: Locator[]): Promise<OcclusionResult> {
  const violations: OcclusionViolation[] = [];

  for (const target of targets) {
    if ((await target.count()) === 0) continue;
    const box = await target.boundingBox();
    if (!box || box.width === 0 || box.height === 0) continue; // 不可見

    const handle = await target.elementHandle();
    if (!handle) continue;

    const cx = Math.min(Math.max(box.x + box.width / 2, 0), (await page.evaluate(() => window.innerWidth)) - 1);
    const cy = Math.min(Math.max(box.y + box.height / 2, 0), (await page.evaluate(() => window.innerHeight)) - 1);

    const probe = await page.evaluate(
      ([el, x, y]) => {
        const hit = document.elementFromPoint(x as number, y as number);
        const node = el as Element;
        const ok = hit !== null && (hit === node || node.contains(hit));
        return {
          ok,
          label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 30),
          occludedByTag: hit ? hit.tagName : 'null（點不到任何東西，可能超出視窗）',
          occludedByText: hit ? (hit.textContent || '').trim().slice(0, 30) : '',
        };
      },
      [handle, cx, cy] as const,
    );

    if (!probe.ok) {
      violations.push({ label: probe.label || '(無標籤/文字)', occludedByTag: probe.occludedByTag, occludedByText: probe.occludedByText });
    }
  }

  return { passed: violations.length === 0, violations };
}

/** 把違規列表轉成人讀得懂的一段話，方便直接塞進 expect 的失敗訊息。 */
export function describeViolations(result: OcclusionResult): string {
  if (result.passed) return '(no violations)';
  return result.violations
    .map((v) => `「${v.label}」的中心點被 <${v.occludedByTag}>「${v.occludedByText}」蓋住`)
    .join('\n');
}
