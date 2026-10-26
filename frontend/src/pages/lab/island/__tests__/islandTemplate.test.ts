/**
 * Island template engine — #3780 part A.
 *
 * 20011 一直是手刻的 STOPS/OPENING/BABIES。這支測試鎖住「其他 179 課」要怎麼
 * 從後端 step_sequence / title / vocabulary 決定性產生同樣三樣東西：不呼叫
 * LLM、同一課每次重算都要一模一樣、而且要撐得住真實分佈裡最短 3 站到最長
 * 11 站的課（見 scratchpad island-template-all-stepseq.json 的統計）。
 */
import { describe, it, expect } from 'vitest';
import {
  buildStopsFromSequence,
  buildOpeningForTitle,
  buildBabiesForVocabulary,
  zoneForIndex,
  STEP_BUILDING_META,
  PLAYER_SPAWN,
  isSceneryExcluded,
  actInfoForZone,
} from '../islandTemplate';

describe('zoneForIndex — 把 N 個站分成三區，跟 20011 手刻的 3/3/4 比例一致', () => {
  it('10 站時重現 20011 現有的 3/3/4 分法', () => {
    const zones = Array.from({ length: 10 }, (_, i) => zoneForIndex(i, 10));
    expect(zones).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 2]);
  });

  it('3 站的最短課：每一區都至少開到一座，不會全部擠在第一區', () => {
    const zones = Array.from({ length: 3 }, (_, i) => zoneForIndex(i, 3));
    expect(new Set(zones).size).toBe(3);
  });

  it('11 站（最常見的長度）：遞增且涵蓋三區', () => {
    const zones = Array.from({ length: 11 }, (_, i) => zoneForIndex(i, 11));
    expect(zones).toEqual([...zones].sort((a, b) => a - b));
    expect(new Set(zones)).toEqual(new Set([0, 1, 2]));
  });
});

describe('buildStopsFromSequence — 從後端 step_sequence 產生站點清單', () => {
  const sequence20011 = [
    'lesson-intro',
    'full-text-annotate#dcavv',
    'key-passage-reading#arfe7',
    'vocab-definition#jryea',
    'vocab-application#jp34n',
    'keypoints-table#wtm6h',
    'comprehension#4axkq',
    'vocab-review#rdcd7',
    'knowledge-station#uxwy3',
    'report',
  ];

  it('把帶 round slug 的 id 收斂成 base step（一課多篇不重複出站）', () => {
    const stops = buildStopsFromSequence(sequence20011);
    expect(stops.map((s) => s.step)).toEqual([
      'lesson-intro', 'full-text-annotate', 'key-passage-reading', 'vocab-definition',
      'vocab-application', 'keypoints-table', 'comprehension', 'vocab-review',
      'knowledge-station', 'report',
    ]);
  });

  it('每一站都有站名跟引導詞，而且不是空字串', () => {
    const stops = buildStopsFromSequence(sequence20011);
    stops.forEach((stop) => {
      expect(stop.name.length).toBeGreaterThan(0);
      expect(stop.line.length).toBeGreaterThan(0);
    });
  });

  it('座標彼此不重疊（不同站不會疊在同一點上）', () => {
    const stops = buildStopsFromSequence(sequence20011);
    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const d = Math.hypot(stops[i].x - stops[j].x, stops[i].z - stops[j].z);
        expect(d).toBeGreaterThan(2.7);
      }
    }
  });

  it('決定性：同一個 sequence 重算兩次結果完全一樣（不呼叫 LLM，不是隨機）', () => {
    const a = buildStopsFromSequence(sequence20011);
    const b = buildStopsFromSequence(sequence20011);
    expect(a).toEqual(b);
  });

  it('最短 3 站的課（文言文/說明文常見）也能正常產生', () => {
    const shortSeq = ['lesson-intro', 'comprehension', 'report'];
    const stops = buildStopsFromSequence(shortSeq);
    expect(stops).toHaveLength(3);
    expect(stops.map((s) => s.zone)).toEqual([0, 1, 2]);
  });

  it('文言文專屬 step id（classical-*）都查得到站點 meta，不會被靜默丟掉', () => {
    const classicalSeq = [
      'lesson-intro', 'classical-text', 'key-passage-reading',
      'classical-sentence-matching', 'classical-word-matching', 'keypoints-table',
      'spotlight', 'comprehension', 'classical-self-challenge', 'report',
    ];
    const stops = buildStopsFromSequence(classicalSeq);
    expect(stops).toHaveLength(classicalSeq.length);
  });

  it('遇到註冊表沒有的未知 step id 不會炸掉，直接跳過那一站', () => {
    const seq = ['lesson-intro', 'some-future-step-nobody-registered', 'report'];
    const stops = buildStopsFromSequence(seq);
    expect(stops.map((s) => s.step)).toEqual(['lesson-intro', 'report']);
  });

  it('11 站（最常見）全部來自真實 15 種 step id 都查得到 meta', () => {
    const allKnownIds = Object.keys(STEP_BUILDING_META);
    const stops = buildStopsFromSequence(allKnownIds);
    expect(stops).toHaveLength(allKnownIds.length);
  });
});

describe('buildOpeningForTitle — 從課名產生開場白（不帶這課的劇情細節）', () => {
  it('每一行都有說話者跟台詞，且台詞提到課名', () => {
    const lines = buildOpeningForTitle('不量田');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    lines.forEach(([speaker, line]) => {
      expect(speaker.length).toBeGreaterThan(0);
      expect(line.length).toBeGreaterThan(0);
    });
    expect(lines.some(([, line]) => line.includes('不量田'))).toBe(true);
  });

  it('決定性：同一個標題兩次產生結果一樣', () => {
    expect(buildOpeningForTitle('陸公買硯')).toEqual(buildOpeningForTitle('陸公買硯'));
  });

  it('固定嚮導角色「小翎」要出現（跨課一致的角色，不是每課重新發明）', () => {
    const lines = buildOpeningForTitle('不量田');
    expect(lines.some(([speaker]) => speaker === '小翎')).toBe(true);
  });
});

describe('buildBabiesForVocabulary — 從生詞表產生文字寶寶（無生詞時要有安全網）', () => {
  const vocab = [
    { word: '不動聲色' }, { word: '一絲不苟' }, { word: '錙銖必較' },
    { word: '斤斤計較' }, { word: '了然於心' }, { word: '恍然大悟' }, { word: '多出來的第七個' },
  ];

  it('最多取 6 個，不會把整張生詞表塞進去', () => {
    expect(buildBabiesForVocabulary(vocab)).toHaveLength(6);
  });

  it('每隻寶寶都指到既有的通用素材檔（沒有新美術前只能用這 6 張佔位圖）', () => {
    const allowed = new Set(['dragon-tiger.png', 'scale.png', 'owl.png', 'stone.png', 'orbs.png', 'yarn.png']);
    buildBabiesForVocabulary(vocab).forEach((baby) => expect(allowed.has(baby.art)).toBe(true));
  });

  it('沒有生詞表（undefined/空陣列）時回傳空陣列，不炸掉', () => {
    expect(buildBabiesForVocabulary(undefined)).toEqual([]);
    expect(buildBabiesForVocabulary([])).toEqual([]);
  });

  it('決定性：同一份生詞表兩次結果一樣', () => {
    expect(buildBabiesForVocabulary(vocab)).toEqual(buildBabiesForVocabulary(vocab));
  });
});

/**
 * G7 截圖審查抓到的真實缺陷（2026-10-26，team-lead 轉述 Young）：出生點的
 * 第一人稱畫面右邊約三分之一被一棵前景大樹擋住，學生進島第一眼看不清楚
 * 港口燈塔和路。程序生樹的 105 棵樹只排除了「離站點太近」（< 2.7），完全
 * 沒考慮「離出生點太近」——用 20011 真實座標驗過，21 號樹離出生點只有
 * 1.79 單位，幾乎貼在玩家臉上。
 */
describe('isSceneryExcluded — 風景物件（樹）不該擋住出生點視野', () => {
  it('離出生點 1.79 單位的樹（真實觸發 G7 那棵，index 21）要被排除', () => {
    expect(isSceneryExcluded(-0.84, 15.13, [], PLAYER_SPAWN)).toBe(true);
  });

  it('離出生點夠遠（>= 排除半徑）的樹不受影響', () => {
    expect(isSceneryExcluded(20, -30, [], PLAYER_SPAWN)).toBe(false);
  });

  it('仍然保留原本「離站點太近」的排除規則（不是用出生點規則取代它）', () => {
    const stops = [{ x: 10, z: 10 }];
    expect(isSceneryExcluded(10.5, 10.5, stops, { x: -50, z: -50 })).toBe(true);
  });

  it('出生點座標本身要跟 createIslandWorld.ts 實際 player.position.set() 的值一致', () => {
    // 這條測試存在的理由：如果有人改了 createIslandWorld.ts 的出生點數字卻忘了
    // 同步這裡，isSceneryExcluded 排除的就不是真正的出生點——這條鎖不住 three.js
    // 那邊的改動，但至少讓這個常數的值被明確寫下來、有一個會被看到的地方。
    expect(PLAYER_SPAWN).toEqual({ x: -2, z: 16.5 });
  });
});

describe('actInfoForZone — 右上角「第一幕」資訊卡要跟著解鎖的區更新（team-lead 2026-10-26）', () => {
  // 原本這張卡片不管進度到哪裡，文字永遠釘死在 zone 0——這支測試鎖的就是
  //「傳進去的 zone 真的會改變回傳的幕次跟站名清單」，不是給一個固定值。
  const stops = [
    { name: '港口燈塔', step: 'lesson-intro', x: 0, z: 0, zone: 0, line: '' },
    { name: '書卷長廊', step: 'full-text-annotate', x: 0, z: 0, zone: 0, line: '' },
    { name: '字源館', step: 'vocab-definition', x: 0, z: 0, zone: 1, line: '' },
    { name: '謎題神殿', step: 'comprehension', x: 0, z: 0, zone: 2, line: '' },
  ];

  it('zone 0 →「第一幕」，站名只列 zone 0 的站', () => {
    expect(actInfoForZone(0, stops)).toEqual({ actName: '第一幕', stationNames: '港口燈塔、書卷長廊' });
  });

  it('zone 1 →「第二幕」，站名只列 zone 1 的站（不是還停在 zone 0）', () => {
    expect(actInfoForZone(1, stops)).toEqual({ actName: '第二幕', stationNames: '字源館' });
  });

  it('zone 2 →「第三幕」，站名只列 zone 2 的站', () => {
    expect(actInfoForZone(2, stops)).toEqual({ actName: '第三幕', stationNames: '謎題神殿' });
  });
});
