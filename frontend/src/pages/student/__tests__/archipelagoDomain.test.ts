/**
 * TDD tests for 我的群島頁 (#3780 D1/D3, PRD docs/prd/2026-10-26-reading-island-3d-prd.md
 * §5.6/§5.7/§6) 的純函式邏輯 — 把一課的「佔領狀態」、兩支 API 回應的合併、
 * 篩選/搜尋、文案都抽成不碰 DOM 的純函式，component 只負責 fetch + render。
 *
 * PRD §6 驗收條件逐條對應：
 * - 「尚未探索」：沒出現在 /progress texts[] 的課
 * - 「探索中 x/y 站」：x/y 要跟 is_occupied/stations_done/stations_total 同一套規則
 * - 「已佔領」：is_occupied === true
 */
import { describe, it, expect } from 'vitest';
import {
  islandStatus,
  buildArchipelago,
  filterArchipelago,
  islandStatusLabel,
  occupiedCount,
  occupiedCountFromProgress,
  splitGradeOptions,
  storiesPageMismatchMessage,
  type ArchipelagoProgress,
  type ArchipelagoStory,
} from '../archipelagoDomain';

describe('islandStatus', () => {
  it('no progress entry at all (課完全沒碰過) → not_started', () => {
    expect(islandStatus(undefined)).toBe('not_started');
  });

  it('has_session=false → not_started（理論上不會發生，但防呆）', () => {
    expect(islandStatus({ story_slug: 'x', is_occupied: false, has_session: false, stations_done: 0, stations_total: 9 })).toBe('not_started');
  });

  it('has_session=true, is_occupied=false → in_progress', () => {
    expect(islandStatus({ story_slug: 'x', is_occupied: false, has_session: true, stations_done: 3, stations_total: 9 })).toBe('in_progress');
  });

  it('is_occupied=true → occupied（不管 has_session，佔領已經蘊含 has_session）', () => {
    expect(islandStatus({ story_slug: 'x', is_occupied: true, has_session: true, stations_done: 9, stations_total: 9 })).toBe('occupied');
  });
});

describe('buildArchipelago — 合併 /api/stories 跟 /progress 兩支回應，只用 story_slug 比對', () => {
  const stories: ArchipelagoStory[] = [
    { id: '20011', title: '贏得喝采的輸家', grade: '4' },
    { id: '20082', title: '從〈螞蟻與蟋蟀〉看生命的多樣性', grade: '4' },
    { id: '20200', title: '某篇文言文', grade: '文言文' },
  ];

  it('課不在 /progress 的 texts[] 裡 → not_started，站數都是 0', () => {
    const result = buildArchipelago(stories, []);
    expect(result).toHaveLength(3);
    expect(result.find((i) => i.storySlug === '20200')).toMatchObject({
      status: 'not_started', stationsDone: 0, stationsTotal: 0,
    });
  });

  it('課在 /progress 裡，is_occupied=true → occupied，帶正確站數', () => {
    const progress: ArchipelagoProgress[] = [
      { story_slug: '20011', is_occupied: true, has_session: true, stations_done: 9, stations_total: 9 },
    ];
    const result = buildArchipelago(stories, progress);
    expect(result.find((i) => i.storySlug === '20011')).toMatchObject({
      status: 'occupied', stationsDone: 9, stationsTotal: 9,
    });
  });

  it('課在 /progress 裡但還沒佔領 → in_progress，帶目前站數', () => {
    const progress: ArchipelagoProgress[] = [
      { story_slug: '20082', is_occupied: false, has_session: true, stations_done: 4, stations_total: 10 },
    ];
    const result = buildArchipelago(stories, progress);
    expect(result.find((i) => i.storySlug === '20082')).toMatchObject({
      status: 'in_progress', stationsDone: 4, stationsTotal: 10,
    });
  });

  it('保留 stories 清單原本的順序跟全部筆數（不因為合併漏掉或新增課）', () => {
    const result = buildArchipelago(stories, []);
    expect(result.map((i) => i.storySlug)).toEqual(['20011', '20082', '20200']);
  });
});

describe('filterArchipelago — 年級篩選 + 課名搜尋', () => {
  const islands = buildArchipelago(
    [
      { id: '20011', title: '贏得喝采的輸家', grade: '4' },
      { id: '20082', title: '從〈螞蟻與蟋蟀〉看生命的多樣性', grade: '4' },
      { id: '20200', title: '某篇文言文故事', grade: '文言文' },
    ],
    [],
  );

  it('沒有篩選條件 → 回傳全部', () => {
    expect(filterArchipelago(islands, {})).toHaveLength(3);
  });

  it('只篩年級 → 只留該年級', () => {
    const result = filterArchipelago(islands, { grade: '文言文' });
    expect(result.map((i) => i.storySlug)).toEqual(['20200']);
  });

  it('只搜課名（不分大小寫、部分比對）→ 只留標題包含關鍵字的課', () => {
    const result = filterArchipelago(islands, { search: '螞蟻' });
    expect(result.map((i) => i.storySlug)).toEqual(['20082']);
  });

  it('年級+搜尋同時套用（交集）', () => {
    const result = filterArchipelago(islands, { grade: '4', search: '輸家' });
    expect(result.map((i) => i.storySlug)).toEqual(['20011']);
  });

  it('搜尋沒有任何課符合 → 回傳空陣列（不是錯誤或 undefined）', () => {
    expect(filterArchipelago(islands, { search: '不存在的課名關鍵字xyz' })).toEqual([]);
  });
});

describe('islandStatusLabel — 四年級看得懂的文案', () => {
  it('occupied → 已佔領', () => {
    expect(islandStatusLabel({ status: 'occupied', stationsDone: 9, stationsTotal: 9 } as never)).toBe('已佔領');
  });

  it('in_progress → 探索中 x/y 站（x/y 來自實際站數，不是寫死的）', () => {
    expect(islandStatusLabel({ status: 'in_progress', stationsDone: 3, stationsTotal: 10 } as never)).toBe('探索中 3/10 站');
  });

  it('not_started → 尚未探索', () => {
    expect(islandStatusLabel({ status: 'not_started', stationsDone: 0, stationsTotal: 0 } as never)).toBe('尚未探索');
  });
});

describe('occupiedCount — 遊戲區卡片跟群島頁都要用同一個算法，數字才會一致', () => {
  it('數出 status===occupied 的數量', () => {
    const islands = buildArchipelago(
      [
        { id: 'a', title: 'A', grade: '4' },
        { id: 'b', title: 'B', grade: '4' },
        { id: 'c', title: 'C', grade: '4' },
      ],
      [
        { story_slug: 'a', is_occupied: true, has_session: true, stations_done: 5, stations_total: 5 },
        { story_slug: 'b', is_occupied: false, has_session: true, stations_done: 2, stations_total: 5 },
      ],
    );
    expect(occupiedCount(islands)).toBe(1);
  });

  it('沒有任何一課佔領 → 0（不是 undefined 或 NaN）', () => {
    expect(occupiedCount(buildArchipelago([{ id: 'a', title: 'A', grade: '4' }], []))).toBe(0);
  });
});

/**
 * 遊戲區卡片（StudentGameHubPage）只打 /progress，沒有打 /api/stories，
 * 所以組不出完整的 ArchipelagoIsland[] 餵給 occupiedCount()。這支函式讓
 * 它直接對 /progress 的 texts[] 算，但底層仍然共用 islandStatus() 這同一套
 * 判定規則——不是另外寫一條「看起來一樣」的邏輯（team-lead code review
 * 2026-10-28 要求：兩個計算路徑要證明真的共用同一個函式，不是巧合一致）。
 */
describe('occupiedCountFromProgress — 遊戲區卡片用，不需要完整 story 清單也要跟 occupiedCount 同一套規則', () => {
  it('數出 is_occupied===true 的筆數，跟 occupiedCount 對同一份資料算出來的結果一致', () => {
    const progress: ArchipelagoProgress[] = [
      { story_slug: 'a', is_occupied: true, has_session: true, stations_done: 5, stations_total: 5 },
      { story_slug: 'b', is_occupied: false, has_session: true, stations_done: 2, stations_total: 5 },
      { story_slug: 'c', is_occupied: true, has_session: true, stations_done: 8, stations_total: 8 },
    ];
    expect(occupiedCountFromProgress(progress)).toBe(2);

    const islands = buildArchipelago(
      [{ id: 'a', title: 'A', grade: '4' }, { id: 'b', title: 'B', grade: '4' }, { id: 'c', title: 'C', grade: '4' }],
      progress,
    );
    expect(occupiedCountFromProgress(progress)).toBe(occupiedCount(islands));
  });

  it('空陣列 → 0', () => {
    expect(occupiedCountFromProgress([])).toBe(0);
  });

  it('has_session=false 但 is_occupied 誤填 true（不該發生，但防呆）→ 不算佔領，跟 islandStatus 的防呆規則一致', () => {
    expect(occupiedCountFromProgress([
      { story_slug: 'x', is_occupied: true, has_session: false, stations_done: 0, stations_total: 9 },
    ])).toBe(0);
  });
});

/**
 * team-lead code review 2026-10-28：篩選列把「品格教育」「文言文」跟年級
 * 混在同一排，四年級可能看不懂差別——前面放年級，這兩個用不同樣式或
 * 分組標「主題」。拆分邏輯抽成純函式，UI 只負責照兩組 render。
 */
describe('splitGradeOptions — 把年級跟特殊主題分兩組', () => {
  it('數字年級進 grades，非數字（文言文/品格教育）進 themes，各自保留原順序', () => {
    expect(splitGradeOptions(['4', '5', '6', '7', '8', '9', '品格教育', '文言文'])).toEqual({
      grades: ['4', '5', '6', '7', '8', '9'],
      themes: ['品格教育', '文言文'],
    });
  });

  it('順序打散也能正確分組（不依賴後端回傳順序）', () => {
    expect(splitGradeOptions(['文言文', '4', '品格教育', '6'])).toEqual({
      grades: ['4', '6'],
      themes: ['文言文', '品格教育'],
    });
  });

  it('沒有主題分類（全是數字年級）→ themes 是空陣列', () => {
    expect(splitGradeOptions(['4', '5'])).toEqual({ grades: ['4', '5'], themes: [] });
  });

  it('兩位數年級（如未來開放國中 10/11/12 年級）仍要歸進 grades，不是只認單一數字', () => {
    expect(splitGradeOptions(['9', '10', '文言文'])).toEqual({ grades: ['9', '10'], themes: ['文言文'] });
  });
});

/**
 * PRD §6（D1／D3 前端，§5.7）：「Given /api/stories?page_size=300 回來，
 * Then 斷言回傳 stories.length === total」——`page_size=300` 理論上一次
 * 拿滿全部課程，但如果哪天課程數衝過 300、或後端 total 算錯，分頁會
 * 悄悄漏課，畫面上看起來只是「島變少了」，不會有任何錯誤訊息。
 * （code review 2026-10-28：原本沒做這個檢查）
 */
describe('storiesPageMismatchMessage — /api/stories 分頁完整性檢查', () => {
  it('stories.length === total → null（沒有問題，不印警告）', () => {
    expect(storiesPageMismatchMessage(179, 179)).toBeNull();
  });

  it('stories.length < total → 回傳一則包含兩個數字的警告訊息（分頁漏課）', () => {
    const msg = storiesPageMismatchMessage(170, 179);
    expect(msg).not.toBeNull();
    expect(msg).toContain('170');
    expect(msg).toContain('179');
  });

  it('stories.length > total（理論上不該發生，但防呆）→ 一樣回傳警告，不是只防「少」的方向', () => {
    expect(storiesPageMismatchMessage(180, 179)).not.toBeNull();
  });

  it('空陣列 → 兩組都是空陣列', () => {
    expect(splitGradeOptions([])).toEqual({ grades: [], themes: [] });
  });
});
