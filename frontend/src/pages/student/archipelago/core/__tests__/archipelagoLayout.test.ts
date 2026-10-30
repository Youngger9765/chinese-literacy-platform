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

describe('layoutArchipelago — 連接只出現在距離門檻內（相鄰才互通）', () => {
  const ids = Array.from({ length: 20 }, (_, i) => `story-${i}`);
  const result = layoutArchipelago(ids, 'threshold-check');
  const allBlobs = [result.plaza, ...result.islands];
  const blobById = new Map(allBlobs.map((b) => [b.id, b]));

  it('每一條連接的兩端，blobMinDistance 都 ≤ DISTANCE_THRESHOLD', () => {
    for (const conn of result.connections) {
      const dist = blobMinDistance(blobById.get(conn.a)!.cells, blobById.get(conn.b)!.cells);
      expect(dist, `連接 ${conn.a}-${conn.b} 距離 ${dist} 超過門檻 ${DISTANCE_THRESHOLD}`).toBeLessThanOrEqual(DISTANCE_THRESHOLD);
    }
  });

  it('🔒 正向對照：真的存在距離 > 門檻、而且沒有被連接的島對（證明門檻真的有在擋，不是全部都連）', () => {
    const connectedPairKeys = new Set(result.connections.map((c) => [c.a, c.b].sort().join('|')));
    let foundFarUnconnectedPair = false;
    for (let i = 0; i < allBlobs.length && !foundFarUnconnectedPair; i++) {
      for (let j = i + 1; j < allBlobs.length; j++) {
        const dist = blobMinDistance(allBlobs[i].cells, allBlobs[j].cells);
        const key = [allBlobs[i].id, allBlobs[j].id].sort().join('|');
        if (dist > DISTANCE_THRESHOLD && !connectedPairKeys.has(key)) {
          foundFarUnconnectedPair = true;
          break;
        }
      }
    }
    expect(foundFarUnconnectedPair, '20 座島的群裡應該要有距離很遠、沒被連接的島對，不然門檻形同虛設').toBe(true);
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
