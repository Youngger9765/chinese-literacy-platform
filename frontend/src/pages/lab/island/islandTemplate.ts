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
 * #3799（design.md §6「劇情模板」，2026-10-30 批次 2）：179 課每課都配一種
 * 劇情骨架，取代「每座島長得差不多」的通用開場白。五種劇情見 design.md
 * §6.1，本檔只做純資料＋模板，不碰 3D 場景造型（室內場館、劇情專屬裝飾
 * 是後面批次的事）。
 */
export type StoryType = 'repair' | 'boss' | 'treasure' | 'detective' | 'competition';

/**
 * 劇情指派規則（design.md §6.2，逐條對應，不要改順序——優先序本身是設計
 * 決定，不是巧合）：
 *   ① grade === '文言文'（12 課）→ 尋寶
 *   ② grade === '品格教育'（15 課）→ 修復
 *   ③ 其餘 152 課依 category：Science→偵探／Fable→魔王／History→比賽／
 *      Daily→尋寶／category 與 genre 皆空值（4 課）→ 比賽（fallback）
 * 回歸鎖（179 課全部覆蓋、分布數字跟 design.md 一致）在
 * `__tests__/islandTemplate.allLessons.story.test.ts`，用真實 179 課
 * fixture 跑，不是只測幾個手選案例。
 */
export function storyTypeForLesson(grade: string, category: string, genre: string): StoryType {
  if (grade === '文言文') return 'treasure';
  if (grade === '品格教育') return 'repair';
  if (category === 'Science') return 'detective';
  if (category === 'Fable') return 'boss';
  if (category === 'History') return 'competition';
  if (category === 'Daily') return 'treasure';
  // #3799：design.md 把這個 fallback 描述成「category 與 genre 皆空值」，
  // 但這裡刻意不額外檢查 genre、只以「category 不是上面任何已知值」為條件
  // ——179 課真實資料裡，category 空值的 4 課 genre 也剛好都是空值（已用
  // 真實 fixture 驗證過，見上面提到的回歸鎖），但往前看，fallback 的意圖
  // 本來就是「這課沒有已知的 category 可以歸類」，用 category 本身當判斷
  // 條件更直接，也不會因為某天 genre 開始有值、category 卻還是空值而漏接。
  return 'competition';
}

const STORY_OPENING_TEMPLATES: Record<StoryType, (title: string) => [string, string][]> = {
  repair: (title) => [
    ['旁白', `《${title}》這座島上，有一座鐘樓出現了裂痕，鐘聲變得又沙啞又微弱`],
    ['小翎', '好久沒有人把這篇課文裡的事，好好練習一遍了'],
    ['小翎', `照順序把《${title}》讀完，鐘樓才會一點一點修好`],
  ],
  boss: (title) => [
    ['旁白', `《${title}》這座島的深處，籠罩著一團看不清楚的迷霧巨影`],
    ['小翎', '它看起來有點嚇人，但其實只是還沒被看懂的東西'],
    ['小翎', `照順序把《${title}》讀完，巨影就會漸漸透出光、變得清楚`],
  ],
  treasure: (title) => [
    ['旁白', `《${title}》這座島上，藏著一捲古老卷軸，寫著「智慧藏在這座島上」`],
    ['小翎', '要湊齊勳章，才找得到完整的寶物'],
    ['小翎', `照順序把《${title}》讀完，一站一枚勳章，拼出藏寶的全貌`],
  ],
  detective: (title) => [
    ['旁白', `《${title}》這座島上發生了一樁怪案，需要你來查清楚`],
    ['小翎', '案情的線索，就藏在課文裡'],
    ['小翎', `照順序把《${title}》讀完，把線索一條一條釘上看板`],
  ],
  competition: (title) => [
    ['旁白', `《${title}》這座島今年要辦一場比賽，有人猶豫了很久，最後還是報名了`],
    ['小翎', '結果不是重點，全力以赴才是'],
    ['小翎', `照順序把《${title}》讀完，陪他一起走到賽場`],
  ],
};

/**
 * 從課名＋劇情類型決定性產生開場白——取代原本只帶課名、不分劇情的
 * `buildOpeningForTitle`（#3799 批次 2，design.md §6.4「擴充成
 * buildOpeningForStory」）。固定嚮導角色「小翎」跨課跨劇情一致（跟
 * 20011 同一個角色，對應 `/lab-island/sprites/xiaoling.png`）。
 */
export function buildOpeningForStory(title: string, storyType: StoryType): [string, string][] {
  return STORY_OPENING_TEMPLATES[storyType](title);
}

const STORY_PROGRESSION_TEMPLATES: Record<StoryType, (station: { name: string; line: string }) => string> = {
  repair: (s) => `完成了「${s.name}」，鐘樓的裂痕修補了一點——你剛剛練習的是：${s.line}`,
  boss: (s) => `完成了「${s.name}」，巨影又透出了一點光——你剛剛看懂的是：${s.line}`,
  treasure: (s) => `完成了「${s.name}」，拾獲一枚智慧勳章——你剛剛做到的是：${s.line}`,
  detective: (s) => `完成了「${s.name}」，案情看板多釘上一條線索——你剛剛找到的是：${s.line}`,
  competition: (s) => `完成了「${s.name}」，又累積了一枚訓練勳章——你剛剛練習的是：${s.line}`,
};

/**
 * 每完成一站的推進旁白——跟 `stops` 一一對應（`.map()` 保證長度恆等於站數，
 * 這是 design.md 批次 2 驗收「推進文字數量等於該課站數」這條的實作依據，
 * 不是巧合）。內容重用既有 `STEP_BUILDING_META`/`buildStopsFromSequence`
 * 已經算好的每站一句話說明（`stop.line`），不需要為 179 課另外手寫。
 */
export function buildStoryProgressionLines(
  storyType: StoryType,
  stops: ReadonlyArray<{ name: string; line: string }>,
): string[] {
  const template = STORY_PROGRESSION_TEMPLATES[storyType];
  return stops.map((stop) => template(stop));
}

const STORY_ENDING_TEMPLATES: Record<StoryType, (title: string) => string> = {
  repair: (title) => `鐘樓完全修好了，敲響的瞬間全島都聽到了——你讀完了《${title}》，也把這件事練好了`,
  boss: (title) => `迷霧散開了，巨影原來只是一個還沒被看懂的故事——你讀完了《${title}》，也看懂了它想告訴你的事`,
  treasure: (title) => `所有勳章拼成了完整的寶物，翻開第一頁——你讀完了《${title}》，也找到了藏在裡面的智慧`,
  detective: (title) => `案情看板串起了全部線索，真相大白——你讀完了《${title}》，當了一回很棒的偵探`,
  competition: (title) => `比賽結束了，結果不是重點——你讀完了《${title}》，全力以赴走到了終點`,
};

/** 全島亮完那一刻的結局句——課名＋劇情類型決定性產生，同樣不需要逐課手寫。 */
export function buildStoryEndingLine(title: string, storyType: StoryType): string {
  return STORY_ENDING_TEMPLATES[storyType](title);
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
