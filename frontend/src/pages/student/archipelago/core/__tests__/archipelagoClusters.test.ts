/**
 * archipelagoClusters.test.ts — #3780 群島模式（docs/prd/2026-10-30-archipelago-clusters-prd.md）
 *
 * TDD：先寫這支測試，`archipelagoClusters.ts` 還不存在時這支應該整個 import
 * 失敗（紅），寫完實作才會變綠。
 *
 * `fixtures/all-stories.json` 是真實 `/api/stories?page_size=300`（preview，
 * 2026-10-30）擷取的 179 課，不是虛構樣本——§8.5/§8.8 的「三種分群方式
 * 加總 = total 且每課只出現一次」要用真實資料的原始 genre/category 字串
 * 驗，虛構樣本測不出真實資料裡的髒值（例如 5 課 genre/category 是空字串、
 * 「論說文」「記敘說理文」這類沒有直接對到 PRD §2.2 表格的原始值）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  normalizeGenre,
  normalizeCategory,
  clusterKeyFor,
  clusterLabel,
  groupIntoClusters,
  portalsFor,
  hexSpiralCoord,
  axialToCartesian,
  defaultClusterKey,
  type ClusterStory,
} from '../archipelagoClusters';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, './fixtures/all-stories.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
  total: number;
  grades: string[];
  stories: ClusterStory[];
};

describe('fixture sanity', () => {
  it('真的讀到 179 筆真實課程資料，不是空的或漏抓的', () => {
    expect(fixture.stories.length).toBe(179);
    expect(fixture.total).toBe(179);
  });
});

describe('normalizeGenre — PRD §2.2 文體正規化（含真實髒值）', () => {
  it.each([
    ['說明文', '說明文'],
    ['記敘文', '記敘文'],
    ['議論文', '議論文'],
    ['文言文', '文言文'],
    ['抒情文', '抒情文'],
    ['應用文', '應用文'],
    ['論說文', '議論文'], // PRD：議論文（含論說文）
    ['記敘說理文', '記敘文'], // PRD：記敘文（含記敘說理／記敘抒情／科學故事）
    ['記敘抒情文', '記敘文'],
    ['記敘文/科學故事', '記敘文'],
    ['', '其他'],
    [undefined, '其他'],
    ['完全沒看過的型態', '其他'], // 未知值 fail-closed 歸「其他」，不炸錯
  ])('%s → %s', (raw, expected) => {
    expect(normalizeGenre(raw)).toBe(expected);
  });
});

describe('normalizeCategory — PRD §2.2 類別正規化', () => {
  it.each([
    ['Science', '自然科學'],
    ['Fable', '寓言故事'],
    ['History', '歷史人文'],
    ['Daily', '生活'],
    ['', '其他'],
    [undefined, '其他'],
    ['Unknown', '其他'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });
});

describe('groupIntoClusters — §8.5/§8.8：三種分群方式加總 = total，每課只出現一次', () => {
  it.each(['grade', 'genre', 'category'] as const)('分群方式=%s', (mode) => {
    const clusters = groupIntoClusters(fixture.stories, mode);
    const totalInClusters = clusters.reduce((sum, c) => sum + c.stories.length, 0);
    expect(totalInClusters, `分群方式 ${mode} 加總應該等於 total`).toBe(fixture.total);

    const seen = new Set<string>();
    for (const cluster of clusters) {
      for (const story of cluster.stories) {
        expect(seen.has(story.id), `課 ${story.id} 在分群方式 ${mode} 下出現了超過一次`).toBe(false);
        seen.add(story.id);
      }
    }
    expect(seen.size, `分群方式 ${mode} 下每課應該剛好出現一次`).toBe(fixture.total);
  });

  it('依年級分群：8 群，課數跟 PRD §2.1 表格一致（真實 API 擷取值）', () => {
    const clusters = groupIntoClusters(fixture.stories, 'grade');
    const byKey = new Map(clusters.map((c) => [c.key, c.stories.length]));
    expect(byKey.get('4')).toBe(20);
    expect(byKey.get('5')).toBe(28);
    expect(byKey.get('6')).toBe(28);
    expect(byKey.get('7')).toBe(30);
    expect(byKey.get('8')).toBe(23);
    expect(byKey.get('9')).toBe(23);
    expect(byKey.get('品格教育')).toBe(15);
    expect(byKey.get('文言文')).toBe(12);
    expect(clusters.length).toBe(8);
  });

  it('依文體分群：7 群，正規化後課數跟真實資料手算一致', () => {
    const clusters = groupIntoClusters(fixture.stories, 'genre');
    const byKey = new Map(clusters.map((c) => [c.key, c.stories.length]));
    // 71 說明文；記敘文 49+2(記敘說理文)+1(記敘抒情文)+1(記敘文/科學故事)=53；
    // 議論文 23+2(論說文)=25；文言文 11；抒情文 9；應用文 5；其他（空字串）5
    expect(byKey.get('說明文')).toBe(71);
    expect(byKey.get('記敘文')).toBe(53);
    expect(byKey.get('議論文')).toBe(25);
    expect(byKey.get('文言文')).toBe(11);
    expect(byKey.get('抒情文')).toBe(9);
    expect(byKey.get('應用文')).toBe(5);
    expect(byKey.get('其他')).toBe(5);
    expect(clusters.length).toBe(7);
  });

  it('依類別分群：5 群，正規化後課數跟真實資料手算一致', () => {
    const clusters = groupIntoClusters(fixture.stories, 'category');
    const byKey = new Map(clusters.map((c) => [c.key, c.stories.length]));
    expect(byKey.get('自然科學')).toBe(71);
    expect(byKey.get('寓言故事')).toBe(62);
    expect(byKey.get('歷史人文')).toBe(36);
    expect(byKey.get('生活')).toBe(5);
    expect(byKey.get('其他')).toBe(5);
    expect(clusters.length).toBe(5);
  });

  it('群內課程依 lessonSeq 排序（決定性蜂巢順序的輸入），不是原始陣列順序', () => {
    const clusters = groupIntoClusters(fixture.stories, 'grade');
    for (const cluster of clusters) {
      const seqs = cluster.stories.map((s) => s.lessonSeq ?? Number(s.id));
      const sorted = [...seqs].sort((a, b) => a - b);
      expect(seqs, `${cluster.key} 群內順序沒有照 lessonSeq 排`).toEqual(sorted);
    }
  });

  it('決定性：同一份資料算兩次，分群結果完全一樣（不是隨機 Map 順序造成的巧合）', () => {
    const a = groupIntoClusters(fixture.stories, 'grade').map((c) => ({ key: c.key, ids: c.stories.map((s) => s.id) }));
    const b = groupIntoClusters(fixture.stories, 'grade').map((c) => ({ key: c.key, ids: c.stories.map((s) => s.id) }));
    expect(a).toEqual(b);
  });

  it('clusterLabel 給年級正確的群島名稱', () => {
    expect(clusterLabel('4', 'grade')).toBe('第 4 級群島');
    expect(clusterLabel('品格教育', 'grade')).toBe('品格群島');
    expect(clusterLabel('文言文', 'grade')).toBe('古文群島');
    expect(clusterLabel('說明文', 'genre')).toBe('說明文群島');
    expect(clusterLabel('自然科學', 'category')).toBe('自然科學群島');
  });
});

describe('portalsFor — 傳送門清單：當前分群方式的其他每一群各一座門', () => {
  it('年級模式下，在第 5 級群島會看到另外 7 座門（不含自己）', () => {
    const clusters = groupIntoClusters(fixture.stories, 'grade');
    const portals = portalsFor(clusters, '5');
    expect(portals.length).toBe(7);
    expect(portals.some((p) => p.key === '5')).toBe(false);
  });

  it('🔒 正向對照：7 座門 + 自己這 1 群 = 總群數 8（防止「過濾條件寫反，結果剛好還是對的」這種巧合）', () => {
    const clusters = groupIntoClusters(fixture.stories, 'grade');
    const portals = portalsFor(clusters, '5');
    expect(portals.length + 1).toBe(clusters.length);
  });
});

describe('hexSpiralCoord — 蜂巢螺旋座標：決定性、由內而外', () => {
  it('index 0 永遠是中心（傳送門廣場的位置）', () => {
    expect(hexSpiralCoord(0)).toEqual({ q: 0, r: 0 });
  });

  it('index 1~6 是第一環（6 格），不等於中心', () => {
    for (let i = 1; i <= 6; i++) {
      const c = hexSpiralCoord(i);
      expect(c).not.toEqual({ q: 0, r: 0 });
    }
  });

  it('決定性：同一個 index 算兩次結果一樣', () => {
    for (const i of [0, 1, 5, 6, 7, 18, 19, 30]) {
      expect(hexSpiralCoord(i)).toEqual(hexSpiralCoord(i));
    }
  });

  it('🔒 每個環內各格座標互不重複（mutation 會咬到的案例：複製貼上時忘記累加方向）', () => {
    for (let index = 0; index < 37; index++) {
      const seen = new Set<string>();
      for (let i = 0; i <= index; i++) {
        const c = hexSpiralCoord(i);
        const key = `${c.q},${c.r}`;
        expect(seen.has(key), `index ${i}（累積到 ${index}）重複了座標 ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('第 k 環的格數剛好是 6k（環 1 有 6 格、環 2 有 12 格）——累積到環界的 index 數要對得上', () => {
    // index 0 = 中心(1格)，1~6 = 環1(6格)，7~18 = 環2(12格)
    expect(hexSpiralCoord(6)).not.toEqual(hexSpiralCoord(7));
    const ring1 = [1, 2, 3, 4, 5, 6].map(hexSpiralCoord);
    const ring2 = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(hexSpiralCoord);
    const toKey = (c: { q: number; r: number }) => `${c.q},${c.r}`;
    const ring1Keys = new Set(ring1.map(toKey));
    const ring2Keys = new Set(ring2.map(toKey));
    expect(ring1Keys.size).toBe(6);
    expect(ring2Keys.size).toBe(12);
    // 兩環之間沒有重疊
    for (const k of ring1Keys) expect(ring2Keys.has(k)).toBe(false);
  });

  it('axialToCartesian：同一個 q,r 兩次算出相同座標；不同 q,r 給不同座標（不是回傳常數）', () => {
    const a = axialToCartesian({ q: 1, r: 0 }, 2);
    const b = axialToCartesian({ q: 1, r: 0 }, 2);
    expect(a).toEqual(b);
    const c = axialToCartesian({ q: 2, r: 0 }, 2);
    expect(c).not.toEqual(a);
  });

  it('axialToCartesian：中心 (0,0) 永遠落在原點，不受 size 影響', () => {
    expect(axialToCartesian({ q: 0, r: 0 }, 2)).toEqual({ x: 0, z: 0 });
    expect(axialToCartesian({ q: 0, r: 0 }, 10)).toEqual({ x: 0, z: 0 });
  });
});

describe('defaultClusterKey — PRD §5：預設落點＝最近一次學習的那一課所在的群，無紀錄則落第 4 級', () => {
  const clusters = groupIntoClusters(fixture.stories, 'grade');

  it('有學習紀錄：落在最近一次 startedAt 那一課所在的群', () => {
    const key = defaultClusterKey(
      [
        { storySlug: '20011', hasSession: true, startedAt: '2026-10-01T00:00:00Z' }, // grade 4
        { storySlug: fixture.stories.find((s) => s.grade === '9')!.id, hasSession: true, startedAt: '2026-10-29T00:00:00Z' }, // 最近
      ],
      clusters,
      'grade',
    );
    expect(key).toBe('9');
  });

  it('沒有任何學習紀錄：fallback 落在第 4 級', () => {
    const key = defaultClusterKey([], clusters, 'grade');
    expect(key).toBe('4');
  });

  it('有紀錄但 hasSession 全部是 false（例如只是點進去看過封面沒真的學）：視同沒有紀錄，fallback 第 4 級', () => {
    const key = defaultClusterKey(
      [{ storySlug: '20011', hasSession: false, startedAt: '2026-10-29T00:00:00Z' }],
      clusters,
      'grade',
    );
    expect(key).toBe('4');
  });

  it('查無對照課程（storySlug 不在 clusters 裡）：不炸錯，fallback 第 4 級', () => {
    const key = defaultClusterKey(
      [{ storySlug: '99999999', hasSession: true, startedAt: '2026-10-29T00:00:00Z' }],
      clusters,
      'grade',
    );
    expect(key).toBe('4');
  });
});
