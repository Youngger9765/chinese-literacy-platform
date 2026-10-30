/**
 * islandShape.test.ts — 美術指導書 §3.1/§3.2（2026-10-31）不規則海岸線的
 * 幾何邏輯。這些是純 CPU 計算（`THREE.Shape`/`THREE.ExtrudeGeometry` 不需要
 * WebGL context 就能建構，真正需要 canvas 的是「畫出來」不是「算出來」），
 * 可以在 jsdom 下直接測，不用進真瀏覽器。
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { unionBoundary, jitterBoundary, scaleBoundaryToward, boundaryToShape, extrudeBoundary, type Point2D } from '../islandShape';
import { axialToCartesian, type AxialCoord } from '../../core/archipelagoClusters';

const HEX_DIRECTIONS: readonly AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const RADIUS = 2;

function cellCenter(axial: AxialCoord): Point2D {
  return axialToCartesian(axial, RADIUS);
}

function shoelaceArea(points: readonly Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

function hasDuplicatePoints(points: readonly Point2D[]): boolean {
  const seen = new Set<string>();
  for (const p of points) {
    const key = `${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

describe('unionBoundary — 單一格：直接回傳 6 個頂點', () => {
  it('單格回傳長度 6，面積等於正六邊形公式', () => {
    const boundary = unionBoundary([{ x: 0, z: 0 }], RADIUS);
    expect(boundary).toHaveLength(6);
    const expectedHexArea = (3 * Math.sqrt(3) / 2) * RADIUS * RADIUS;
    expect(shoelaceArea(boundary)).toBeCloseTo(expectedHexArea, 3);
  });
});

describe('unionBoundary — 兩格相鄰：聯集外框比兩個獨立六邊形的頂點數少（共用邊被抵銷）', () => {
  it('🔒 十邊形（6+6-2 個不重複頂點），不是兩個六邊形疊在一起的 12 個點', () => {
    const a = cellCenter({ q: 0, r: 0 });
    const b = cellCenter(HEX_DIRECTIONS[0]); // 正東方相鄰格
    const boundary = unionBoundary([a, b], RADIUS);
    expect(boundary).toHaveLength(10);
    expect(hasDuplicatePoints(boundary), '外框頂點不應該有重複點').toBe(false);
  });

  it('聯集面積明顯大於單格、明顯小於兩個完全不重疊六邊形的面積（證明真的共用了一條邊，不是兩塊各自獨立的洞）', () => {
    const singleArea = shoelaceArea(unionBoundary([{ x: 0, z: 0 }], RADIUS));
    const a = cellCenter({ q: 0, r: 0 });
    const b = cellCenter(HEX_DIRECTIONS[0]);
    const unionArea = shoelaceArea(unionBoundary([a, b], RADIUS));
    expect(unionArea).toBeGreaterThan(singleArea * 1.8);
    expect(unionArea).toBeLessThan(singleArea * 2.0);
  });

  it('決定性：同樣的格子中心算兩次，外框完全一樣', () => {
    const a = cellCenter({ q: 0, r: 0 });
    const b = cellCenter(HEX_DIRECTIONS[0]);
    const r1 = unionBoundary([a, b], RADIUS);
    const r2 = unionBoundary([a, b], RADIUS);
    expect(r1).toEqual(r2);
  });
});

describe('unionBoundary — 三格互相相鄰（三角形黏成一塊）：外框是封閉多邊形，面積約三格', () => {
  it('外框頂點數比三個獨立六邊形的 18 個少很多，且無重複點', () => {
    const centers = [{ q: 0, r: 0 }, HEX_DIRECTIONS[0], HEX_DIRECTIONS[1]].map(cellCenter);
    const boundary = unionBoundary(centers, RADIUS);
    expect(boundary.length).toBeLessThan(18);
    expect(boundary.length).toBeGreaterThanOrEqual(10);
    expect(hasDuplicatePoints(boundary)).toBe(false);
  });

  it('面積接近三格六邊形面積（減去內部共用邊不影響面積，應該非常接近 3 倍單格面積）', () => {
    const singleArea = shoelaceArea(unionBoundary([{ x: 0, z: 0 }], RADIUS));
    const centers = [{ q: 0, r: 0 }, HEX_DIRECTIONS[0], HEX_DIRECTIONS[1]].map(cellCenter);
    const unionArea = shoelaceArea(unionBoundary(centers, RADIUS));
    expect(unionArea).toBeCloseTo(singleArea * 3, 1);
  });
});

describe('jitterBoundary — 固定種子擾動頂點半徑，質心不變、點數不變', () => {
  const base = unionBoundary([{ x: 0, z: 0 }], RADIUS);

  it('決定性：同一個 seed 兩次擾動結果一樣', () => {
    const a = jitterBoundary(base, 'island-20011');
    const b = jitterBoundary(base, 'island-20011');
    expect(a).toEqual(b);
  });

  it('不同 seed 給不同的擾動結果（不是忽略 seed 參數）', () => {
    const a = jitterBoundary(base, 'island-20011');
    const b = jitterBoundary(base, 'island-20012');
    expect(a).not.toEqual(b);
  });

  it('🔒 每個頂點都有被真的移動過（不是原樣複製），但移動幅度在合理範圍內（相對質心的距離變化不超過 ±22%）', () => {
    const jittered = jitterBoundary(base, 'island-20011');
    expect(jittered).toHaveLength(base.length);
    let movedCount = 0;
    for (let i = 0; i < base.length; i++) {
      const dOrig = Math.hypot(base[i].x, base[i].z); // 質心是原點 (0,0)
      const dJit = Math.hypot(jittered[i].x, jittered[i].z);
      if (Math.abs(dOrig - dJit) > 1e-6) movedCount++;
      const ratio = dJit / dOrig;
      expect(ratio).toBeGreaterThanOrEqual(0.86 - 1e-6);
      expect(ratio).toBeLessThanOrEqual(0.86 + 0.22 + 1e-6);
    }
    expect(movedCount).toBeGreaterThan(0);
  });

  it('點數不變，輸出順序跟輸入順序一致（每個索引對應同一個原始頂點，不是打亂重排）', () => {
    const jittered = jitterBoundary(base, 'island-20011');
    expect(jittered).toHaveLength(base.length);
  });
});

describe('scaleBoundaryToward — 整體縮放邊界，質心不變', () => {
  it('縮小 0.85 倍：每個頂點到質心的距離變成原本的 0.85 倍', () => {
    const base = unionBoundary([{ x: 0, z: 0 }], RADIUS);
    const scaled = scaleBoundaryToward(base, 0.85);
    for (let i = 0; i < base.length; i++) {
      const dOrig = Math.hypot(base[i].x, base[i].z);
      const dScaled = Math.hypot(scaled[i].x, scaled[i].z);
      expect(dScaled / dOrig).toBeCloseTo(0.85, 5);
    }
  });
});

describe('extrudeBoundary — 真的能建出 three.js 幾何（不需要 WebGL，CPU 端建構）', () => {
  it('回傳的是 ExtrudeGeometry，有非零的頂點資料', () => {
    const base = unionBoundary([{ x: 0, z: 0 }], RADIUS);
    const geo = extrudeBoundary(base, 0.3);
    expect(geo).toBeInstanceOf(THREE.ExtrudeGeometry);
    expect(geo.attributes.position.count).toBeGreaterThan(0);
  });

  it('🔒 擠出後的高度範圍是 [0, depth]，不是 [-depth/2, depth/2] 或其他位移（呼叫端假設底面貼齊 y=0）', () => {
    const base = unionBoundary([{ x: 0, z: 0 }], RADIUS);
    const depth = 0.4;
    const geo = extrudeBoundary(base, depth);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 2);
    expect(box.max.y).toBeCloseTo(depth, 2);
  });

  it('🔒 擠出後的 x/z 範圍跟輸入邊界一致（沒有被 boundaryToShape 的座標轉換鏡像或偏移）', () => {
    const a = cellCenter({ q: 0, r: 0 });
    const b = cellCenter(HEX_DIRECTIONS[0]);
    const boundary = unionBoundary([a, b], RADIUS);
    const xs = boundary.map((p) => p.x);
    const zs = boundary.map((p) => p.z);
    const geo = extrudeBoundary(boundary, 0.3);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.x).toBeCloseTo(Math.min(...xs), 2);
    expect(box.max.x).toBeCloseTo(Math.max(...xs), 2);
    expect(box.min.z).toBeCloseTo(Math.min(...zs), 2);
    expect(box.max.z).toBeCloseTo(Math.max(...zs), 2);
  });
});

describe('boundaryToShape — 轉出的 Shape 面積跟原始邊界一致', () => {
  it('Shape.getPoints() 算出來的面積等於原始邊界的 shoelace 面積', () => {
    const boundary = unionBoundary([{ x: 0, z: 0 }], RADIUS);
    const shape = boundaryToShape(boundary);
    const shapePoints = shape.getPoints();
    const shapeArea = Math.abs(THREE.ShapeUtils.area(shapePoints));
    expect(shapeArea).toBeCloseTo(shoelaceArea(boundary), 2);
  });
});
