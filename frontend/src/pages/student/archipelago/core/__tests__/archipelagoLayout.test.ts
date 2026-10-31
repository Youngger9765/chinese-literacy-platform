/**
 * archipelagoLayout.test.ts — #3780 群島模式二次訂正（2026-10-31，
 * docs/prd/2026-10-30-archipelago-clusters-prd.md §3.2）：
 * 「做出不規則群島的感覺，相鄰的島有一點互通的機制，但隨意材料」。
 *
 * 這支鎖的是「版面邏輯」（Young 透過 team-lead 2026-10-31 明確授權先做這
 * 部分，顏色/材質/造型細節等美術指導書）：島的大小形狀、擺放位置、哪些
 * 島相鄰互通、連接物材料字串——不含任何渲染。
 *
 * TDD：`archipelagoLayout.ts` 還不存在時這支應該整個 import 失敗（紅）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  layoutArchipelago,
  blobMinDistance,
  DISTANCE_THRESHOLD,
  CONNECTOR_MATERIALS,
  MAX_CONNECTIONS_PER_ISLAND,
  segmentsIntersect,
  type HexCell,
} from '../archipelagoLayout';
import { groupIntoClusters, type ClusterStory } from '../archipelagoClusters';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, './fixtures/all-stories.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  total: number;
  stories: ClusterStory[];
};

function cellKey(c: HexCell): string {
  return `${c.q},${c.r}`;
}

describe('layoutArchipelago — 決定性：同樣輸入兩次呼叫結果逐欄位相等', () => {
  it('同一組 storyIds + 同一個 seed，兩次呼叫完全一樣（不是 Math.random，是可重現的種子）', () => {
    const ids = ['20001', '20002', '20003', '20004', '20005'];
    const a = layoutArchipelago(ids, 'grade:4');
    const b = layoutArchipelago(ids, 'grade:4');
    expect(a).toEqual(b);
  });

  it('不同 seed 給不同的佈局（不是忽略 seed 參數）', () => {
    const ids = ['20001', '20002', '20003', '20004', '20005'];
    const a = layoutArchipelago(ids, 'grade:4');
    const b = layoutArchipelago(ids, 'grade:5');
    expect(a).not.toEqual(b);
  });
});

describe('layoutArchipelago — 每座島是 1～3 格的連通 polyhex，互不重疊', () => {
  const ids = Array.from({ length: 30 }, (_, i) => `story-${i}`);
  const result = layoutArchipelago(ids, 'variety-check');

  it('30 座島跑出來，格數有 1、2、3 三種都出現（不是永遠只長 1 格）', () => {
    const sizes = new Set(result.islands.map((isl) => isl.cells.length));
    expect(sizes.has(1), '應該出現至少一座 1 格島').toBe(true);
    expect(sizes.has(2), '應該出現至少一座 2 格島').toBe(true);
    expect(sizes.has(3), '應該出現至少一座 3 格島').toBe(true);
  });

  it('每座島的格數落在 1~3 之間（含廣場）', () => {
    for (const blob of [result.plaza, ...result.islands]) {
      expect(blob.cells.length).toBeGreaterThanOrEqual(1);
      expect(blob.cells.length).toBeLessThanOrEqual(3);
    }
  });

  it('🔒 team-lead 2026-10-31 明令：≥50% 的課程島是 2～3 格的多格島（舊權重 [0.5,0.35,0.15] 理論期望值剛好 50%，但 growBlob 擁擠時會縮水，實測量到 35～60% 不等、群越大越低——權重已調整，這裡鎖住 4 種規模都要 ≥50%，不是只驗一種剛好過的規模）', () => {
    for (const n of [20, 30, 50, 71]) {
      const sampleIds = Array.from({ length: n }, (_, i) => `multi-cell-${n}-${i}`);
      const sample = layoutArchipelago(sampleIds, `multicell-lock-${n}`);
      const multiCellCount = sample.islands.filter((isl) => isl.cells.length >= 2).length;
      const ratio = multiCellCount / n;
      expect(ratio, `n=${n} 群多格島比例 ${(ratio * 100).toFixed(1)}% 低於 50%`).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('🔒 沒有任何兩座島共用同一個六角格（含廣場）——這是「互不重疊」的正式定義', () => {
    const seen = new Map<string, string>();
    for (const blob of [result.plaza, ...result.islands]) {
      for (const cell of blob.cells) {
        const key = cellKey(cell);
        expect(seen.has(key), `格子 ${key} 同時被 ${seen.get(key)} 跟 ${blob.id} 佔用`).toBe(false);
        seen.set(key, blob.id);
      }
    }
  });

  it('多格島的每一格都跟同一座島裡至少另一格緊鄰（連通，不是散落的格子湊數）', () => {
    for (const blob of [result.plaza, ...result.islands]) {
      if (blob.cells.length === 1) continue;
      for (const cell of blob.cells) {
        const hasNeighborInSameBlob = blob.cells.some((other) => {
          if (other === cell) return false;
          const dq = Math.abs(other.q - cell.q);
          const dr = Math.abs(other.r - cell.r);
          const dist = (Math.abs(other.q - cell.q) + Math.abs(other.q + other.r - cell.q - cell.r) + Math.abs(other.r - cell.r)) / 2;
          return dq + dr > 0 && dist === 1;
        });
        expect(hasNeighborInSameBlob, `島 ${blob.id} 的格子 ${cellKey(cell)} 沒有跟同島任何一格緊鄰`).toBe(true);
      }
    }
  });
});

describe('blobMinDistance — 兩塊 polyhex 之間最短格距（純數學，不含隨機）', () => {
  it('完全相同的格子距離是 0', () => {
    expect(blobMinDistance([{ q: 0, r: 0 }], [{ q: 0, r: 0 }])).toBe(0);
  });

  it('緊鄰的兩格距離是 1', () => {
    expect(blobMinDistance([{ q: 0, r: 0 }], [{ q: 1, r: 0 }])).toBe(1);
  });

  it('取兩塊之間「最近的一對」，不是取第一格或平均', () => {
    const a: HexCell[] = [{ q: 0, r: 0 }, { q: 5, r: 5 }];
    const b: HexCell[] = [{ q: 1, r: 0 }, { q: -5, r: -5 }];
    expect(blobMinDistance(a, b)).toBe(1); // (0,0)-(1,0) 是最近的一對
  });
});

describe('layoutArchipelago — 連接：度數受限的 MST 保證連通 + 少量門檻內額外連線（team-lead 2026-10-31 三次訂正）', () => {
  // 2026-10-31 訂正：舊版「每條連接都必須 ≤ 門檻」的假設已經不成立——
  // team-lead 的新設計是「先用 MST 保證整群連通，必要時允許極少數超過
  // 門檻的邊，再補門檻內的額外連線」，這是刻意的行為改變，不是退步
  // （改變理由：舊版「門檻內兩兩全連」在小群會長出一張交叉的網，好幾條
  // 橋橫越整個畫面還互相交叉）。這個 describe 底下驗的是新契約：
  // ①絕大多數連線仍在門檻內 ②MST 階段允許少量超過門檻的邊，但不能氾濫
  // ③最重要的目標達成——isolatedIds 應該是空的（MST 真的保證了連通）。
  const ids = Array.from({ length: 20 }, (_, i) => `story-${i}`);
  const result = layoutArchipelago(ids, 'threshold-check');
  const allBlobs = [result.plaza, ...result.islands];
  const blobById = new Map(allBlobs.map((b) => [b.id, b]));

  it('MST 真的保證整群連通：20 座島的群裡 isolatedIds 應該是空的', () => {
    expect(result.isolatedIds).toEqual([]);
  });

  it('絕大多數連線仍落在門檻內——只有 MST 為了連通性必要時才超過，不是氾濫', () => {
    const overThreshold = result.connections.filter(
      (conn) => blobMinDistance(blobById.get(conn.a)!.cells, blobById.get(conn.b)!.cells) > DISTANCE_THRESHOLD,
    );
    const ratio = overThreshold.length / result.connections.length;
    expect(ratio, `超過門檻的連線比例 ${ratio} 太高，MST 不該變成氾濫使用長邊`).toBeLessThan(0.5);
  });

  it('🔒 正向對照：確實存在超過門檻的連線（證明上一條測試不是因為「剛好沒有長邊」而通過，MST 真的有在用長邊保連通）', () => {
    const hasOverThreshold = result.connections.some(
      (conn) => blobMinDistance(blobById.get(conn.a)!.cells, blobById.get(conn.b)!.cells) > DISTANCE_THRESHOLD,
    );
    expect(hasOverThreshold, '20 座島的群應該至少有一條 MST 連通用的長邊，不然這條測試量不到東西').toBe(true);
  });
});

describe('layoutArchipelago — 每座島最多 MAX_CONNECTIONS_PER_ISLAND 條連線（team-lead 2026-10-31 明令）', () => {
  it('30 座島的群裡，沒有任何一座（含廣場）連線數超過上限', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `story-${i}`);
    const result = layoutArchipelago(ids, 'degree-cap-check');
    const allBlobs = [result.plaza, ...result.islands];
    const degree = new Map<string, number>(allBlobs.map((b) => [b.id, 0]));
    for (const conn of result.connections) {
      degree.set(conn.a, (degree.get(conn.a) ?? 0) + 1);
      degree.set(conn.b, (degree.get(conn.b) ?? 0) + 1);
    }
    for (const [id, count] of degree) {
      expect(count, `${id} 有 ${count} 條連線，超過上限 ${MAX_CONNECTIONS_PER_ISLAND}`).toBeLessThanOrEqual(MAX_CONNECTIONS_PER_ISLAND);
    }
  });

  it('🔒 正向對照：真的有島用滿 2 條名額（證明上限不是形同虛設，是真的常被用到）', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `story-${i}`);
    const result = layoutArchipelago(ids, 'degree-cap-check');
    const allBlobs = [result.plaza, ...result.islands];
    const degree = new Map<string, number>(allBlobs.map((b) => [b.id, 0]));
    for (const conn of result.connections) {
      degree.set(conn.a, (degree.get(conn.a) ?? 0) + 1);
      degree.set(conn.b, (degree.get(conn.b) ?? 0) + 1);
    }
    const anyAtCap = Array.from(degree.values()).some((c) => c === MAX_CONNECTIONS_PER_ISLAND);
    expect(anyAtCap, '30 座島的群應該至少有一座用滿 2 條連線名額').toBe(true);
  });
});

describe('layoutArchipelago — 連接物線段互不交叉（team-lead 2026-10-31 明令：橋不能互相交叉）', () => {
  it('50 座島的群裡，任兩條連接線段都不相交（共用端點不算交叉）', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `story-${i}`);
    const result = layoutArchipelago(ids, 'crossing-check');
    const allBlobs = [result.plaza, ...result.islands];
    const blobById = new Map(allBlobs.map((b) => [b.id, b]));
    const conns = result.connections;
    let crossingCount = 0;
    for (let i = 0; i < conns.length; i++) {
      for (let j = i + 1; j < conns.length; j++) {
        const a = blobById.get(conns[i].a)!.center;
        const b = blobById.get(conns[i].b)!.center;
        const c = blobById.get(conns[j].a)!.center;
        const d = blobById.get(conns[j].b)!.center;
        if (segmentsIntersect(a, b, c, d)) crossingCount++;
      }
    }
    expect(crossingCount, `找到 ${crossingCount} 組交叉的連接線段`).toBe(0);
  });
});

describe('segmentsIntersect — 純幾何函式，合成座標直接測', () => {
  it('明確交叉的兩條線段（一個 X 形）回傳 true', () => {
    const result = segmentsIntersect({ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 10, z: 0 });
    expect(result).toBe(true);
  });

  it('平行不相交的兩條線段回傳 false', () => {
    const result = segmentsIntersect({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 5 }, { x: 10, z: 5 });
    expect(result).toBe(false);
  });

  it('共用端點不算交叉（兩條連接物接在同一座島上是正常的）', () => {
    const shared = { x: 5, z: 5 };
    const result = segmentsIntersect(shared, { x: 0, z: 0 }, shared, { x: 10, z: 10 });
    expect(result).toBe(false);
  });
});

describe('layoutArchipelago — 連接材料隨機挑選，值必須落在合法集合內', () => {
  it('每一條連接的 material 都是 CONNECTOR_MATERIALS 其中一種', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `story-${i}`);
    const result = layoutArchipelago(ids, 'material-check');
    expect(result.connections.length).toBeGreaterThan(0);
    for (const conn of result.connections) {
      expect(CONNECTOR_MATERIALS as readonly string[]).toContain(conn.material);
    }
  });

  it('夠多連接時，材料種類不會永遠只選同一種（真的有「隨意挑」）', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `story-${i}`);
    const result = layoutArchipelago(ids, 'material-variety-check');
    const materials = new Set(result.connections.map((c) => c.material));
    expect(materials.size, '30 座島應該產生出不只一種連接材料').toBeGreaterThan(1);
  });
});

describe('layoutArchipelago — isolatedIds 明確標示零連接的島，不要求呼叫端自己反推', () => {
  it('isolatedIds 裡的每一個 id，在 connections 裡都真的找不到任何一條邊', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `story-${i}`);
    const result = layoutArchipelago(ids, 'isolated-check');
    const connectedIds = new Set(result.connections.flatMap((c) => [c.a, c.b]));
    for (const id of result.isolatedIds) {
      expect(connectedIds.has(id), `${id} 被列為孤島，但 connections 裡找得到它的邊`).toBe(false);
    }
  });

  it('不在 isolatedIds 裡的島，在 connections 裡至少有一條邊', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `story-${i}`);
    const result = layoutArchipelago(ids, 'isolated-check');
    const connectedIds = new Set(result.connections.flatMap((c) => [c.a, c.b]));
    const isolatedSet = new Set(result.isolatedIds);
    for (const island of result.islands) {
      if (!isolatedSet.has(island.id)) {
        expect(connectedIds.has(island.id), `${island.id} 沒被列為孤島，但 connections 裡找不到它`).toBe(true);
      }
    }
  });
});

describe('layoutArchipelago — 整合真實 179 課資料：每課只出現一次，加總等於 total', () => {
  it('依年級分成 8 群，各群分別跑 layoutArchipelago，islands 加總 = 179，課號不重複不遺漏', () => {
    const clusters = groupIntoClusters(fixture.stories, 'grade');
    const allIslandIds: string[] = [];
    for (const cluster of clusters) {
      const ids = cluster.stories.map((s) => s.id);
      const result = layoutArchipelago(ids, `grade:${cluster.key}`);
      expect(result.islands.length, `群 ${cluster.key} 的島數應該等於課數`).toBe(ids.length);
      allIslandIds.push(...result.islands.map((isl) => isl.id));
    }
    expect(allIslandIds.length).toBe(fixture.total);
    expect(new Set(allIslandIds).size, '179 課不應該有任何重複').toBe(fixture.total);
  });
});
