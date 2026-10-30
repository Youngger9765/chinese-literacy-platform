/**
 * Island template engine — #3780 part A.
 *
 * 20011（贏得喝采的輸家）是手刻的 STOPS/OPENING/BABIES，風格跟內容綁死。
 * 這支負責把「其他任何一課」的 step_sequence / title / vocabulary 決定性地
 * 轉成同一套資料形狀：不呼叫 LLM、同一課每次重算都一模一樣。
 *
 * 15 種 step id 是全平台 179 課掃過一輪的真實上限（2026-10-26 全量
 * step_sequence 調查），其中 10 種沿用 20011 已經做好的建築造型，
 * 另外 5 種（spotlight + 4 個文言文專屬 step）是本次新增的站點類型，
 * 造型在 createIslandWorld.ts 的建築造型分支裡實作（見 Task 2）。
 */

export interface IslandStop {
  name: string;
  step: string;
  x: number;
  z: number;
  zone: number;
  line: string;
}

export interface IslandBaby {
  name: string;
  art: string;
  x: number;
  z: number;
}

export const STEP_BUILDING_META: Record<string, { name: string; line: string }> = {
  'lesson-intro': { name: '港口燈塔', line: '燈要亮，先聽完這篇在說什麼' },
  'full-text-annotate': { name: '書卷長廊', line: '把不懂或重要的詞語做記號，沿路都看一遍' },
  'key-passage-reading': { name: '回音劇場', line: '把指定的那一段，念到順順為止' },
  'vocab-definition': { name: '字源館', line: '一個字拆開，裡面藏著它的意思' },
  'vocab-application': { name: '工匠作坊', line: '把學到的詞語用進句子裡' },
  spotlight: { name: '聚光閣', line: '這篇文章的小技巧，藏在這裡' },
  'keypoints-table': { name: '地圖塔', line: '把課文的重點，整理成一張地圖' },
  comprehension: { name: '謎題神殿', line: '答案不在題目裡，在課文裡' },
  'vocab-review': { name: '精靈牧場', line: '找回來的字寶寶在這裡休息' },
  'knowledge-station': { name: '樹屋補給站', line: '休息一下，看看跟這篇有關的延伸知識' },
  report: { name: '星空瞭望台', line: '最後一題，用你自己的話回答' },
  'classical-text': { name: '原文閣', line: '先讀讀看，古人是怎麼說這件事的' },
  'classical-sentence-matching': { name: '對句碑林', line: '找出每一句古文，對應的白話是哪一句' },
  'classical-word-matching': { name: '字牌亭', line: '方框裡的字，換成現在的說法是什麼' },
  'classical-self-challenge': { name: '挑戰擂台', line: '選做：再讀一段古文，試試看自己行不行' },
};

/** 把 N 個站分成三區，比例跟 20011 手刻的 3/3/4 一致（見 __tests__）。 */
export function zoneForIndex(index: number, total: number): number {
  const b1 = Math.floor(total / 3);
  const b2 = Math.floor((2 * total) / 3);
  if (index < b1) return 0;
  if (index < b2) return 1;
  return 2;
}

/**
 * 三條沿路曲線的控制點，跟 createIslandWorld.ts 畫路徑用的是同一份座標。
 * 跟 createIslandWorld.ts 刻意各自維護一份常數、不共用 import：這裡要維持
 * 零依賴（不 import three.js）才能在純 node 環境快速跑單元測試；
 * createIslandWorld.ts 那份要留在 three.js 環境組 CatmullRomCurve3（視覺
 * 用的平滑曲線）。改地形座標時兩邊要一起改。
 *
 * #3794 二次訂正（team-lead 2026-10-30 退件：角色要沿石板路走，不是鏡頭
 * 飛過去）：`spawnPoint.ts` 的 `walkAlongPathPosition`／`projectOntoPath`
 * 匯入這份常數算「角色沿路走到門口」——那邊同樣是三.js-free 的純函式，
 * 跟這裡同一種環境限制，不是另開一份複製；只有 createIslandWorld.ts 的
 * three.js 渲染那份才獨立維護。
 */
export const ZONE_PATHS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-3, 12], [-5, 9], [-9, 5], [-5, 1], [0, 0], [3, 2]],
  [[3, 2], [4, -2], [7, -3], [12, -4], [8, -7], [5, -10], [10, -13], [17, -12]],
  [[17, -12], [20, -16], [23, -20], [18, -22], [14, -24], [9, -23], [2, -22], [12, -29], [22, -32]],
];

function pointOnPolyline(points: ReadonlyArray<readonly [number, number]>, t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  const segments = points.length - 1;
  const pos = clamped * segments;
  const i = Math.min(segments - 1, Math.floor(pos));
  const localT = pos - i;
  const [x0, z0] = points[i];
  const [x1, z1] = points[i + 1];
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  return { x: x0 + dx * localT, z: z0 + dz * localT, tx: dx / len, tz: dz / len };
}

/**
 * 從後端 step_sequence（可能帶 `#roundSlug`）決定性產生站點清單。
 * 一課多篇（同個 base step 出現多次）收斂成一站，取第一次出現的順序；
 * 註冊表沒有的 id 直接跳過（不讓未來新 step type 靜默炸掉整座島，
 * 也不會憑空生造型）。
 */
export function buildStopsFromSequence(sequence: string[]): IslandStop[] {
  const bases: string[] = [];
  for (const raw of sequence) {
    const base = raw.split('#')[0];
    if (STEP_BUILDING_META[base] && !bases.includes(base)) bases.push(base);
  }
  const total = bases.length;
  const zoneOfIndex = bases.map((_, i) => zoneForIndex(i, total));
  const countPerZone = [0, 0, 0];
  zoneOfIndex.forEach((z) => { countPerZone[z] += 1; });
  const seenInZone = [0, 0, 0];
  return bases.map((step, index) => {
    const zone = zoneOfIndex[index];
    const k = seenInZone[zone]++;
    const n = Math.max(1, countPerZone[zone]);
    const t = (k + 0.5) / n;
    const { x, z, tx, tz } = pointOnPolyline(ZONE_PATHS[zone], t);
    const side = k % 2 === 0 ? 1 : -1;
    const offset = 3 + (k % 3) * 0.6;
    const meta = STEP_BUILDING_META[step];
    return { name: meta.name, step, x: x + -tz * side * offset, z: z + tx * side * offset, zone, line: meta.line };
  });
}

/**
 * 從課名決定性產生開場白。固定嚮導角色「小翎」跨課一致（跟 20011 同一個角色，
 * 對應 `/lab-island/sprites/xiaoling.png`），內容只帶課名、不帶劇情細節
 * （劇情細節只有 20011 的手工覆寫才有）。
 */
export function buildOpeningForTitle(title: string): [string, string][] {
  return [
    ['旁白', `這座島，收著《${title}》這篇課文裡的字`],
    ['小翎', '你……會讀字嗎？'],
    ['小翎', '它們是字變的，可是忘了自己是誰'],
    ['小翎', `照順序走過去，把《${title}》讀完，燈就會一個一個亮起來`],
  ];
}

/**
 * 玩家出生點，要跟 createIslandWorld.ts 的 `player.position.set(-2, 1.5, 16.5)`
 * 同一個 x/z（y 是高度，跟風景排除無關）。兩邊各自維護一份常數（跟 ZONE_PATHS
 * 同樣理由：這份要零依賴 three.js 才能快速跑單元測試）。
 */
export const PLAYER_SPAWN = { x: -2, z: 16.5 };

/**
 * 程序生成的風景物件（目前是樹）要不要被排除：離任何站點太近，或離玩家出生點
 * 太近都要排除。後者是 2026-10-26 G7 抓到的真缺陷——出生點附近的樹沒被排除，
 * 近到幾乎貼在玩家臉上，擋住進島第一眼該看清楚的港口燈塔跟路。
 */
export function isSceneryExcluded(
  x: number,
  z: number,
  stops: ReadonlyArray<{ x: number; z: number }>,
  spawn: { x: number; z: number } = PLAYER_SPAWN,
  stopRadius = 2.7,
  spawnRadius = 4,
): boolean {
  if (stops.some((stop) => Math.hypot(stop.x - x, stop.z - z) < stopRadius)) return true;
  if (Math.hypot(spawn.x - x, spawn.z - z) < spawnRadius) return true;
  return false;
}

const BABY_SPRITES = ['dragon-tiger.png', 'scale.png', 'owl.png', 'stone.png', 'orbs.png', 'yarn.png'] as const;

/**
 * 從生詞表決定性產生最多 6 隻文字寶寶。MVP 還沒有逐字生成的專屬美術，
 * 沿用 20011 那 6 張通用佔位圖循環套用（已知限制，不是遺漏）；
 * 沒有生詞表時回空陣列，不炸掉。
 */
export function buildBabiesForVocabulary(vocabulary?: Array<{ word: string }>): IslandBaby[] {
  const words = (vocabulary ?? []).map((v) => v.word).filter(Boolean).slice(0, 6);
  return words.map((word, i) => {
    const zonePath = ZONE_PATHS[i < 3 ? 0 : 1];
    const t = ((i % 3) + 0.5) / 3;
    const { x, z, tx, tz } = pointOnPolyline(zonePath, t);
    const side = i % 2 === 0 ? -1 : 1;
    const offset = 4.2;
    return { name: word, art: BABY_SPRITES[i % BABY_SPRITES.length], x: x + -tz * side * offset, z: z + tx * side * offset };
  });
}

const ACT_NAMES = ['第一幕', '第二幕', '第三幕'];

/**
 * 右上角「第一幕」資訊卡的內容——之前這張卡片不管解鎖到哪一區，文字永遠
 * 釘死在 zone 0（team-lead 2026-10-26 截圖抓到：全島亮完還是顯示「第一幕」）。
 * 傳目前解鎖到的 `unlockedZone`，回傳對應的幕次名稱跟那一區的站名清單。
 */
export function actInfoForZone(
  unlockedZone: number,
  stops: ReadonlyArray<{ name: string; zone: number }>,
): { actName: string; stationNames: string } {
  return {
    actName: ACT_NAMES[unlockedZone] ?? ACT_NAMES[ACT_NAMES.length - 1],
    stationNames: stops.filter((s) => s.zone === unlockedZone).map((s) => s.name).join('、'),
  };
}

/**
 * #3780 D（PRD §5.6）：`step_sequence[index]` 這一站算不算完成——跟後端
 * `learning_progress.py` 的 `_is_island_occupied` 共用同一套規則，兩邊都
 * 讀 `fixtures/island-station-completion.json` 鎖同一組案例，數字不能對
 * 不起來。
 *
 * `lesson-intro` 看 `hasSession`（平台設計上永遠不會寫進 `stepsCompleted`，
 * §5.2）。其餘站先比對 `step_sequence` 裡那個完整字串（含錨點，例如
 * `full-text-annotate#dcavv`）是否整個出現在 `stepsCompleted`——命中就算
 * 完成。沒命中時，**只有這個型態在整份 `stepSequence` 裡只出現一次**，才
 * 退而接受 `stepsCompleted` 裡出現「不帶錨點的型態字串」也算完成（真實
 * preview 資料截到的情況：`knowledge-station#uxwy3` 這站，伺服器卻存成
 * 沒帶錨點的 `knowledge-station`）。這個退讓只有在沒有「哪一輪」疑慮時
 * 才安全——多篇課文同型態出現兩次以上（例如兩輪各自的
 * `full-text-annotate#A`／`full-text-annotate#B`）不能套用，否則會把
 * A 輪完成誤判成 B 輪也完成。
 */
export function isStationDone(
  stepSequence: ReadonlyArray<string>,
  index: number,
  stepsCompleted: ReadonlyArray<string>,
  hasSession: boolean,
): boolean {
  const entry = stepSequence[index];
  if (!entry) return false;
  const type = entry.split('#')[0];
  if (type === 'lesson-intro') return hasSession;
  if (stepsCompleted.includes(entry)) return true;
  const occurrences = stepSequence.filter((s) => s.split('#')[0] === type).length;
  return occurrences === 1 && stepsCompleted.includes(type);
}

/** 整份 `stepSequence` 裡完成了幾站——我的群島頁「探索中 x/y 站」的 x。 */
export function countStationsDone(
  stepSequence: ReadonlyArray<string>,
  stepsCompleted: ReadonlyArray<string>,
  hasSession: boolean,
): number {
  return stepSequence.reduce(
    (count, _entry, index) => count + (isStationDone(stepSequence, index, stepsCompleted, hasSession) ? 1 : 0),
    0,
  );
}
