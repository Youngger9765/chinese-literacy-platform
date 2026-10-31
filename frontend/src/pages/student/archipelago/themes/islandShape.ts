/**
 * themes/islandShape.ts — 不規則海岸線（美術指導書 §3.1/§3.2，
 * 2026-10-31）：島是 1~3 格六角格黏成的 polyhex，海岸線要畫這個 polyhex
 * 的**聯集外框**（不是繼續畫一個正六邊形假裝不規則），外框頂點再依固定
 * 種子做半徑擾動，讓邊界不是幾何完美的正多邊形。
 *
 * 做法（美術指導書推論，綜合 redblobgames 六角座標數學＋`ref-zelda-landmark-design`
 * 引用的 Townscaper「材質交界處」原則）：
 * 1. 每一格算出 6 個頂點（flat-top 六角形，跟 `core/archipelagoClusters.ts`
 *    的 `axialToCartesian` 同一個方向慣例）
 * 2. 聯集外框＝**邊抵銷法**：同一條邊被兩格各走一次、方向相反（因為相鄰
 *    六角格共用邊時繞行方向天生相反）就是內部邊，抵銷掉；留下來的是外框
 * 3. 把抵銷後剩下的邊串成一圈有序的路徑
 * 4. 每個頂點依「這座島的種子＋頂點序號」做半徑擾動，相對這塊 polyhex 的
 *    質心內外推一點
 *
 * `shared with both themes`：這是視覺幾何，不是骨架邏輯，兩個主題
 * （ocean/sky）都呼叫同一份，不是各自重寫一次聯集演算法。
 */
import * as THREE from 'three';
import { seededValue } from './seededRandom';

export interface Point2D {
  x: number;
  z: number;
}

/** flat-top 六角形的 6 個頂點（跟 `axialToCartesian` 的 flat-top 慣例一致：
 *  頂點角度 = 60°×i，i=0..5，不做 30° pointy-top 偏移）。 */
function hexCorners(center: Point2D, radius: number): Point2D[] {
  const corners: Point2D[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * 60 * i;
    corners.push({ x: center.x + radius * Math.cos(angle), z: center.z + radius * Math.sin(angle) });
  }
  return corners;
}

function pointKey(p: Point2D): string {
  // 四捨五入到 1e-4 精度——同一條邊從兩格算出來理論上完全相等，但浮點數
  // 運算（三角函數）可能有極小誤差，不量化會讓邊抵銷法抓不到該抵銷的對。
  return `${Math.round(p.x * 10000)},${Math.round(p.z * 10000)}`;
}

/**
 * 1~3 格六角格的聯集外框——邊抵銷法：同一條邊被相鄰兩格各走一次、方向
 * 相反（六角格鋪磚的本質：共用邊的兩格繞行方向天生相反），抵銷後剩下的
 * 邊就是外框。只有 1 格時直接回傳那一格的 6 個頂點（沒有邊可抵銷）。
 */
export function unionBoundary(cellCenters: readonly Point2D[], cellRadius: number): Point2D[] {
  if (cellCenters.length === 1) return hexCorners(cellCenters[0], cellRadius);

  // key(p1->p2) -> 邊本身；如果 key(p2->p1) 已經存在就是內部邊，互相抵銷
  const edges = new Map<string, { p1: Point2D; p2: Point2D }>();
  for (const center of cellCenters) {
    const corners = hexCorners(center, cellRadius);
    for (let i = 0; i < 6; i++) {
      const p1 = corners[i];
      const p2 = corners[(i + 1) % 6];
      const forwardKey = `${pointKey(p1)}|${pointKey(p2)}`;
      const reverseKey = `${pointKey(p2)}|${pointKey(p1)}`;
      if (edges.has(reverseKey)) {
        edges.delete(reverseKey);
      } else {
        edges.set(forwardKey, { p1, p2 });
      }
    }
  }

  // 把剩下的外框邊串成一個有序迴圈：從任一條開始，找 p1 跟目前終點相同
  // 的下一條邊，直到繞回起點。邊數有限（最多 3 格 × 6 邊 = 18 條，通常
  // 聯集後更少），用線性搜尋即可，不需要空間索引。
  const remaining = [...edges.values()];
  if (remaining.length === 0) return hexCorners(cellCenters[0], cellRadius); // 不應發生，fail-safe
  const loop: Point2D[] = [remaining[0].p1, remaining[0].p2];
  const used = new Set([remaining[0]]);
  while (used.size < remaining.length) {
    const tail = loop[loop.length - 1];
    const next = remaining.find((e) => !used.has(e) && pointKey(e.p1) === pointKey(tail));
    if (!next) break; // 理論上不該發生（外框一定是封閉迴圈），fail-safe 提早結束
    used.add(next);
    loop.push(next.p2);
  }
  loop.pop(); // 最後一點等於起點，Shape 會自己 closePath()
  return loop;
}

function centroidOf(points: readonly Point2D[]): Point2D {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

/**
 * 把每條邊切成 `segmentsPerEdge` 段，在中間插入等距分點（team-lead
 * 2026-10-31 三次退回重做：「多格島比例到了，但擾動感不夠」）——根因是
 * `jitterBoundary()` 只會動聯集外框原本的角（單格 6 個、多格聯集後最多
 * 十幾個），角與角之間還是直線相連；不管每個角怎麼獨立亂數偏移，一個只有
 * 6~18 個頂點的多邊形終究讀起來像「一個不規則的六邊形」，不像海岸線。
 * 先在原始角之間插點把頂點數變多，`jitterBoundary()` 才有足夠多的獨立
 * 頂點可以蜿蜒，讀起來才會像真的有凹凸的海岸線，不是角被挪動過的正多邊形。
 *
 * 在**還沒擾動**的聯集外框上插點（不是擾動後），這樣插入的點一開始精確
 * 落在原始邊上，交給後面的 `jitterBoundary()` 統一做獨立亂數偏移——插點
 * 跟擾動是兩個獨立步驟，各自只做一件事。
 */
export function subdivideBoundary(points: readonly Point2D[], segmentsPerEdge = 3): Point2D[] {
  if (segmentsPerEdge <= 1 || points.length < 3) return [...points];
  const result: Point2D[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    result.push(p1);
    for (let s = 1; s < segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      result.push({ x: p1.x + (p2.x - p1.x) * t, z: p1.z + (p2.z - p1.z) * t });
    }
  }
  return result;
}

/**
 * 外框頂點依固定種子做半徑擾動（美術指導書 §3.1 原值
 * `cornerRadius = ISLAND_RADIUS × (0.86 + seededRandom(slug, cornerIndex) × 0.22)`，
 * 即 factor∈[0.86,1.08]——相對 1.0 的偏移量只有 -14%～+8%，兩邊都不到
 * team-lead 2026-10-31 要求的「擾動幅度 ≥ 六角半徑的 15%」，難怪輪廓看
 * 起來還是很像正六邊形。改成 factor∈[0.85,1.15]，相對 1.0 對稱地各偏移
 * 15%，兩個方向都踩到門檻，不是只有其中一邊）——相對這塊 polyhex 自己的
 * 質心內外推，不是相對世界原點，這樣島的輪廓擾動不會因為島在群島裡的
 * 位置不同而跑掉。
 */
export function jitterBoundary(points: readonly Point2D[], seed: string, jitterRange = 0.5, jitterBase = 0.75): Point2D[] {
  const centroid = centroidOf(points);
  return points.map((p, i) => {
    const factor = jitterBase + seededValue(`${seed}:coastline:${i}`) * jitterRange;
    return {
      x: centroid.x + (p.x - centroid.x) * factor,
      z: centroid.z + (p.z - centroid.z) * factor,
    };
  });
}

/**
 * 相鄰點加權平均（closed loop，頭尾相接）——team-lead 2026-10-31 五次
 * 訂正：「海岸線擾動要做到 ≥15%，而且要看得出來」，光是加大 `jitterRange`
 * 還不夠：`subdivideBoundary` 插出來的點彼此距離很近，每個點各自獨立亂數
 * 偏移時，相鄰兩點很容易一個往外推一個往內縮，疊出高頻鋸齒——鋸齒在
 * 遠距離總覽鏡頭下會被反鋸齒/取樣抹掉，看起來還是接近原本的直邊。平滑
 * 一輪之後，相鄰點的偏移方向有連續性，會變成幾個清楚的「海灣／岬角」
 * 大彎折，而不是一堆抵銷掉的小鋸齒——這才是遠看也看得出來的不規則。
 * 平滑會小幅壓低擾動的尖峰值，所以 `jitterRange` 要先加大，兩個改動要
 * 一起看才抵達「≥15% 且看得出來」。
 */
export function smoothBoundaryLoop(points: readonly Point2D[], passes = 1): Point2D[] {
  let current = [...points];
  const n = current.length;
  if (n < 3) return current;
  for (let pass = 0; pass < passes; pass++) {
    current = current.map((p, i) => {
      const prev = current[(i - 1 + n) % n];
      const next = current[(i + 1) % n];
      return {
        x: p.x * 0.5 + prev.x * 0.25 + next.x * 0.25,
        z: p.z * 0.5 + prev.z * 0.25 + next.z * 0.25,
      };
    });
  }
  return current;
}

/** 把一組（已擾動的）邊界頂點縮放到自己的質心——用來算側壁底層岩石的
 *  「底部略收窄」（美術指導書 §3.2：底部收窄 15%，暗示漂浮/紮根海中的
 *  體積感），不用重新算一次聯集跟擾動，只是把同一個外框往內縮。 */
export function scaleBoundaryToward(points: readonly Point2D[], scale: number): Point2D[] {
  const centroid = centroidOf(points);
  return points.map((p) => ({
    x: centroid.x + (p.x - centroid.x) * scale,
    z: centroid.z + (p.z - centroid.z) * scale,
  }));
}

/** 把一組 2D 邊界頂點轉成 `THREE.Shape`（XZ 平面上的點當 Shape 的 x/y，
 *  擠出時再整顆繞 X 軸轉 -90° 讓擠出方向變成世界的 Y 高度——跟這個 repo
 *  既有「用旋轉過的 PlaneGeometry 當地面」同一個慣例，不是另外發明座標
 *  系統）。 */
export function boundaryToShape(points: readonly Point2D[]): THREE.Shape {
  const shape = new THREE.Shape();
  // Shape 的第二個座標軸故意存 `-p.z`：`extrudeBoundary()` 擠出後要繞 X
  // 軸轉 -90° 把擠出方向（Shape 局部 +Z）變成世界 +Y，這個旋轉會同時把
  // Shape 的局部 y 軸變成世界 -Z；這裡先把 z 存成負的，兩次負負得正，
  // 轉完之後世界座標的 x/z 才會跟傳進來的 `points` 完全對應，不是鏡像。
  points.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  });
  shape.closePath();
  return shape;
}

/** 由聯集外框直接生出一塊擠出幾何（島的側壁三層都呼叫這個，只是
 *  `depth`／外框縮放／Y 位置不同）——擠出後統一轉正（擠出方向原本是
 *  Shape 的 +Z，轉成世界的 +Y，底面對齊 y=0 而不是對齊擠出中心）。 */
export function extrudeBoundary(points: readonly Point2D[], depth: number): THREE.ExtrudeGeometry {
  const shape = boundaryToShape(points);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  // ExtrudeGeometry 沿 Shape 局部 +Z 擠出（範圍 0→depth）；`rotateX(-90°)`
  // 把這個方向轉成世界 +Y，擠出範圍直接變成 y∈[0, depth]（驗過：不需要
  // 額外平移——曾經多加一行 `translate(0, depth, 0)` 把它搬到
  // [depth, 2*depth]，被這支的單元測試抓到，見 git history）。
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}
