import type { Locator, Page } from '@playwright/test';

/**
 * noPanelOverlap.ts — 防回歸：喝采島的 HUD 面板互相蓋住（#3780 G7）
 *
 * `noButtonOcclusion.ts` 檢查的是「這顆按鈕的中心點點不點得到自己」，
 * 對純資訊面板（標題卡、劇情說明卡、文字寶貝欄）沒意義——它們不是拿來
 * 點的，蓋住的問題是「字看不清楚」而不是「點不到」。這支檢查反過來：
 * 給一組「畫面上的 HUD 面板」，兩兩比對 boundingBox，不能互相交疊。
 *
 * 2026-10-26 team-lead 手機尺寸截圖抓到：右上角「第一幕」資訊卡疊在
 * 左上「喝采島」標題卡上，390px 寬放不下兩張並排的卡片——
 * `islandButtonOcclusion.spec.ts` 只檢查按鈕，沒檢查這種「兩張卡片重疊」
 * 的問題，所以沒抓到。
 */

export interface PanelOverlapViolation {
  a: string;
  b: string;
  /** 兩個 boundingBox 交集的面積（像素平方），方便判斷是輕微擦到還是整個疊住 */
  overlapArea: number;
}

export interface PanelOverlapResult {
  passed: boolean;
  violations: PanelOverlapViolation[];
}

interface NamedPanel {
  name: string;
  locator: Locator;
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return 0;
  return (right - left) * (bottom - top);
}

/**
 * 兩兩比對一組具名面板的 boundingBox。只檢查「目前真的有渲染且看得到」
 * 的面板——某個面板在這個尺寸/狀態下本來就不存在（例如搖桿只在手機
 * 出現），直接跳過不算違規。
 */
export async function findOverlappingPanels(_page: Page, panels: NamedPanel[]): Promise<PanelOverlapResult> {
  const boxes: Array<{ name: string; box: { x: number; y: number; width: number; height: number } }> = [];

  for (const panel of panels) {
    const count = await panel.locator.count();
    if (count === 0) continue;
    // 同一個名字可能同時命中「手機版」跟「桌機/iPad 版」兩個 DOM 節點
    // （用 Tailwind `hidden`/`md:hidden` 切換可見度，兩個都在 DOM 裡）。
    // `.first()` 不保證拿到真正看得到的那個——改成找第一個 boundingBox
    // 不是 null/零大小的，那才是目前實際顯示中的節點。
    let box: { x: number; y: number; width: number; height: number } | null = null;
    for (let i = 0; i < count; i++) {
      const candidate = await panel.locator.nth(i).boundingBox();
      if (candidate && candidate.width > 0 && candidate.height > 0) { box = candidate; break; }
    }
    if (!box) continue;
    boxes.push({ name: panel.name, box });
  }

  const violations: PanelOverlapViolation[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const overlapArea = rectsOverlap(boxes[i].box, boxes[j].box);
      if (overlapArea > 0) {
        violations.push({ a: boxes[i].name, b: boxes[j].name, overlapArea: Math.round(overlapArea) });
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

export function describePanelOverlaps(result: PanelOverlapResult): string {
  if (result.passed) return '(no overlaps)';
  return result.violations.map((v) => `「${v.a}」跟「${v.b}」疊在一起（交集 ${v.overlapArea}px²）`).join('\n');
}
