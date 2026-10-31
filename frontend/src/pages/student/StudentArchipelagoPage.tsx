/**
 * StudentArchipelagoPage — `/student/archipelago` (#3780 D3 → 群島模式，
 * docs/prd/2026-10-30-archipelago-clusters-prd.md).
 *
 * 179 課不全部互聯——依分群方式（年級／文體／類別）分成大群，一群一張
 * 3D 地圖（中央傳送門廣場＋課程島蜂巢螺旋排列），群與群之間用傳送門往來。
 * 清單模式（原本 D3 的卡片清單）保留成一個可切換的檢視，也是 WebGL 建不
 * 起來時的自動降級目標（PRD §6）。
 *
 * 這個頁面是在 `<AppShell>` 的 `<main>`（`flex-1 overflow-y-auto`，不是
 * 裸的整個瀏覽器視窗）裡渲染——根容器用 `h-full` 填滿那個 slot，不是
 * `h-[100dvh]`（那樣會比 AppShell 分配到的高度還高，在側欄旁邊擠出多一層
 * 捲動）。截圖對照：改動前 `before-archipelago-1280.png`/`-390.png`。
 *
 * 合併/篩選/分群/蜂巢座標的純函式邏輯都在 archipelagoDomain.ts／
 * archipelago/core/（骨架層公開介面見 `core/index.ts`，不要越過它直接
 * import `core/archipelagoClusters.ts`——見 `.claude/skills/
 * archipelago-module/SKILL.md`），這個檔案只負責 fetch API＋render＋串
 * 3D 世界（`createArchipelagoWorld.ts`）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchStories } from '../../services/api';
import { getStudentProgress } from '../../services/progressApi';
import { fetchMyWordBabies } from '../../services/wordBabyApi';
import { gradeLabel } from '../../utils/gradeLabel';
import {
  buildArchipelago,
  filterArchipelago,
  islandStatusLabel,
  storiesPageMismatchMessage,
  type ArchipelagoIsland,
} from './archipelagoDomain';
import {
  groupIntoClusters,
  portalsFor,
  defaultClusterKey,
  normalizeCategory,
  type ClusterMode,
  type Cluster,
  type RecentProgressEntry,
} from './archipelago/core';
import {
  createArchipelagoWorld,
  type ArchipelagoWorld,
  type ArchipelagoWorldIsland,
  type ArchipelagoWorldPortal,
} from './archipelago/createArchipelagoWorld';
import { THEMES, DEFAULT_THEME_ID } from './archipelago/themes';

/** 偏好存在哪個 localStorage key——PRD §8.5「記在學生偏好（前端
 *  localStorage，不加後端）」。 */
const THEME_STORAGE_KEY = 'archipelago-theme';

function readStoredThemeId(): string {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored && stored in THEMES ? stored : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID; // localStorage 在部分隱私模式下會拋錯，fail-closed 退回預設主題
  }
}

const STATUS_BADGE_CLASS: Record<ArchipelagoIsland['status'], string> = {
  occupied: 'bg-amber-100 text-amber-700 border-amber-300',
  in_progress: 'bg-sky-100 text-sky-700 border-sky-300',
  not_started: 'bg-gray-100 text-gray-500 border-gray-200',
};

const CLUSTER_MODE_LABEL: Record<ClusterMode, string> = {
  performance: '學習表現',
  content: '學習內容',
  competency: '核心素養',
  grade: '年級',
  genre: '文體',
  category: '類別',
};

/** HUD 切換按鈕的顯示順序——108 課綱三層（2026-10-31 新預設）排前面，
 *  年級／文體／類別保留在後面當可切換選項（Young 2026-10-31：「那你島嶼
 *  就要依照學習能力三層做分群」）。網址 `?group=` 合法值同一份清單。 */
const CLUSTER_MODES_IN_UI_ORDER: ClusterMode[] = ['performance', 'content', 'competency', 'grade', 'genre', 'category'];

/** `groupIntoClusters` 的 `ClusterStory` 約束用 `id` 當身分欄位（跟
 *  `ArchipelagoStory` 的命名對齊），`ArchipelagoIsland` 用的是
 *  `storySlug`——這個型別只是補一個 `id` 別名，分群純函式本身不需要為了
 *  兩種呼叫端改欄位名稱。 */
type ClusterIsland = ArchipelagoIsland & { id: string };

const IslandCard: React.FC<{ island: ArchipelagoIsland; onOpen: () => void }> = ({ island, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="group flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
  >
    <div className="flex items-start justify-between gap-2">
      <span className="text-base font-bold text-gray-900">{island.title}</span>
      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
        {gradeLabel(island.grade)}
      </span>
    </div>
    <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-bold ${STATUS_BADGE_CLASS[island.status]}`}>
      {islandStatusLabel(island)}
    </span>
  </button>
);

/** 群島右側面板（桌機固定側欄／手機底部抽屜共用這個內容）——HUD、搜尋、
 *  站點清單。PRD §3.4/§6。 */
const ArchipelagoSidePanel: React.FC<{
  cluster: Cluster<ClusterIsland>;
  occupiedInCluster: number;
  clusterMode: ClusterMode;
  onChangeMode: (mode: ClusterMode) => void;
  allClusters: Cluster<ClusterIsland>[];
  onJumpCluster: (key: string) => void;
  search: string;
  onSearch: (q: string) => void;
  onSelectIsland: (slug: string) => void;
  selectedSlug: string | null;
  hoveredSlug: string | null;
  onToggleListMode: () => void;
  babyCount: { owned: number; total: number } | null;
  onOpenWordBabies: () => void;
  themeId: string;
  onChangeTheme: (id: string) => void;
}> = ({
  cluster, occupiedInCluster, clusterMode, onChangeMode, allClusters, onJumpCluster,
  search, onSearch, onSelectIsland, selectedSlug, hoveredSlug, onToggleListMode, babyCount, onOpenWordBabies,
  themeId, onChangeTheme,
}) => {
  const visibleStories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cluster.stories;
    return cluster.stories.filter((s) => s.title.toLowerCase().includes(q));
  }, [cluster.stories, search]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div>
        <h2 className="text-lg font-black text-gray-900">{cluster.label}</h2>
        <p className="text-sm text-gray-500">已佔領 {occupiedInCluster} / {cluster.stories.length}</p>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="archipelago-group-select" className="text-xs font-semibold text-gray-400">群島導覽</label>
        <select
          id="archipelago-group-select"
          value={cluster.key}
          onChange={(e) => onJumpCluster(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
        >
          {allClusters.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* PRD §8.5：骨架不變、換長相——學生自己選皮膚，記在 localStorage。 */}
      <div className="flex items-center gap-2">
        <label htmlFor="archipelago-theme-select" className="text-xs font-semibold text-gray-400">主題皮膚</label>
        <select
          id="archipelago-theme-select"
          value={themeId}
          onChange={(e) => onChangeTheme(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
        >
          {Object.values(THEMES).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="分群方式">
        {CLUSTER_MODES_IN_UI_ORDER.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChangeMode(mode)}
            aria-pressed={clusterMode === mode}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
              clusterMode === mode ? 'bg-accent text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-accent'
            }`}
          >
            依{CLUSTER_MODE_LABEL[mode]}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleListMode}
          className="ml-auto rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-all hover:border-accent"
        >
          清單模式
        </button>
      </div>
      {/* 108 課綱三層（學習表現／學習內容／核心素養）是 AI 草稿，老師還沒
          審過——`.claude/skills/lesson-curriculum-mapping/SKILL.md` §紅線：
          「對外、給老師報告、進遊戲判定都要寫『草稿』」，不藏起來。 */}
      <p className="text-xs text-gray-400">課綱分類為草稿，待老師審核</p>

      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="搜尋課名…"
        aria-label="搜尋課名"
        className="w-full rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-accent focus:outline-none"
      />

      <ul className="flex flex-col gap-1.5" aria-label={`${cluster.label}站點清單`}>
        {visibleStories.map((island) => (
          <li key={island.storySlug}>
            <button
              type="button"
              onClick={() => onSelectIsland(island.storySlug)}
              aria-label={`${island.title}（${islandStatusLabel(island)}）`}
              // 2026-10-31 八次訂正：3D 畫面滑到島上要有看得到的回饋——
              // `selectedSlug` 已經有自己的強調樣式，`hoveredSlug` 另外用一個
              // 比較淡的樣式區分「滑過」跟「選取」，兩者不衝突（已選取的那筆
              // 滑過去時維持選取樣式優先，不會被 hover 樣式蓋掉）。
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all ${
                selectedSlug === island.storySlug
                  ? 'border-accent bg-accent/10'
                  : hoveredSlug === island.storySlug
                    ? 'border-accent/50 bg-accent/5'
                    : 'border-gray-100 bg-white hover:border-accent/50'
              }`}
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  island.status === 'occupied' ? 'bg-amber-500' : island.status === 'in_progress' ? 'bg-sky-500' : 'bg-gray-300'
                }`}
                aria-hidden="true"
              />
              <span className="flex-1 truncate font-medium text-gray-800">{island.title}</span>
            </button>
          </li>
        ))}
        {visibleStories.length === 0 && <li className="py-6 text-center text-sm text-gray-400">找不到符合的課</li>}
      </ul>

      <button
        type="button"
        onClick={onOpenWordBabies}
        className="mt-auto flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition-all hover:border-amber-400"
      >
        <span className="text-sm font-bold text-amber-800">
          {babyCount ? `文字寶貝 ${babyCount.owned}/${babyCount.total} 隻` : '文字寶貝載入中…'}
        </span>
        <span className="text-xs font-semibold text-amber-600 underline">看我的寶貝 →</span>
      </button>
    </div>
  );
};

const StudentArchipelagoPage: React.FC = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [islands, setIslands] = useState<ArchipelagoIsland[] | null>(null);
  const [recentProgress, setRecentProgress] = useState<RecentProgressEntry[]>([]);
  const [babyCount, setBabyCount] = useState<{ owned: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // code review 2026-10-30 blocker：`?group=` 原本從頭到尾沒被讀——寫死
  // 'grade' 會讓「回群島」帶回來的 `group=genre&cluster=說明文` 落在錯的群
  // （用 grade 模式分群，不會有一群的 key 剛好等於「說明文」，於是掉回
  // defaultClusterKey 的年級 fallback）。初始值要從網址讀，驗不是合法值
  // 之一就退回預設，不信任網址內容。
  // 2026-10-31：預設分群改成「學習表現」（108 課綱三層，Young：「那你島嶼
  // 就要依照學習能力三層做分群」）——年級／文體／類別仍是可切換選項，只是
  // 不再是預設落點。
  const [clusterMode, setClusterMode] = useState<ClusterMode>(() => {
    const fromUrl = searchParams.get('group');
    return (CLUSTER_MODES_IN_UI_ORDER as string[]).includes(fromUrl ?? '')
      ? (fromUrl as ClusterMode)
      : 'performance';
  });
  const [clusterKey, setClusterKey] = useState<string | null>(searchParams.get('cluster'));
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  // 2026-10-31 八次訂正：團隊長在預覽站 headless 實測「滑到島上完全沒有
  // 反應」——根因是這個頁面從來沒有把 `onHoverIsland` 傳給
  // `createArchipelagoWorld`，骨架那邊 `if (!events.onHoverIsland) return`
  // 直接把整段 hover 處理擋掉（已經在骨架那邊拆開，視覺回饋改成不依賴這個
  // 選填回呼也會生效；這裡仍然要傳，一是讓側欄清單也能同步 hover 高亮
  // ——見 `ArchipelagoSidePanel` 的 `hoveredSlug` prop，二是這樣「頁面接線
  // 這一層」才測得到：mock `createArchipelagoWorld` 斷言真的有傳這個回呼）。
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [listMode, setListMode] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  // PRD §8.5「學生可在 HUD 切換主題，記在學生偏好」——讀一次 localStorage
  // 當初始值，切換時寫回去（見下面 `changeTheme`）。
  const [themeId, setThemeId] = useState<string>(readStoredThemeId);

  // 舊版（D3）年級卡片清單篩選——清單模式切換過去時沿用。
  const [legacyGradeFilter, setLegacyGradeFilter] = useState<string | null>(null);
  const [legacySearch, setLegacySearch] = useState('');

  // 這裡故意不用 `useRef`——真的發生過的 bug（2026-10-30 模組重構時在真
  // 預覽站撞到，確認跟這次重構無關、本來就壞著）：這個容器 div 包在
  // `islands === null` 的載入早退裡，掛載時第一次 commit 一定是「載入中」
  // 那段文字，容器 div 根本還沒進 DOM；世界建立的 effect 依賴陣列是
  // `[listMode, webglFailed, themeId]`，資料載入完成後重新渲染出容器 div
  // 時，這三個值都沒變，React 判定依賴沒變就跳過重跑 effect——容器 div
  // 事後才出現，`createArchipelagoWorld` 卻永遠不會被用正確的容器呼叫
  // 第二次。結果是空的 3D 容器、沒有畫布、也不會走 WebGL 降級（因為
  // `webglFailed` 從沒被設成 true，根本沒跑到那段判斷）。真預覽站截圖
  // 證實：容器 `childElementCount === 0`。
  // 改用 state 版的 callback ref：容器 DOM 節點真的掛上去那一刻
  // `containerEl` 從 `null` 變成真的節點，這個變化本身就會讓依賴它的
  // effect 重新跑一次——不需要再去猜「資料載入完成」要不要算進依賴。
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const worldRef = useRef<ArchipelagoWorld | null>(null);
  // 見下面世界建立 effect 裡的說明——純粹當「世界剛被(重新)建立」的訊號，
  // 值本身沒有意義，只用來讓下一個 effect 知道要重新檢查 `worldRef.current`。
  const [worldVersion, setWorldVersion] = useState(0);

  useEffect(() => {
    if (!token || !user) return;
    let alive = true;
    (async () => {
      try {
        const [storiesRes, progressRes, babiesRes] = await Promise.all([
          fetchStories(token),
          getStudentProgress(token, user.id),
          fetchMyWordBabies(user.id, token),
        ]);
        if (!alive) return;
        const mismatch = storiesPageMismatchMessage(storiesRes.stories.length, storiesRes.total);
        if (mismatch) console.error(mismatch);
        const stories = storiesRes.stories.map((s) => ({
          id: s.id, title: s.title, grade: s.grade ?? '', genre: s.genre, category: s.category, lessonSeq: s.lessonSeq,
        }));
        setIslands(buildArchipelago(stories, progressRes.texts));
        setRecentProgress(progressRes.texts.map((t) => ({ storySlug: t.story_slug, hasSession: t.has_session, startedAt: t.started_at })));
        setBabyCount({ owned: babiesRes.babies_owned_count, total: babiesRes.babies_total_species });
      } catch {
        if (alive) setError('載入群島資料失敗，請重新整理再試一次');
      }
    })();
    return () => { alive = false; };
  }, [token, user]);

  const clusters = useMemo(
    () => (islands ? groupIntoClusters(islands.map((i) => ({ ...i, id: i.storySlug })), clusterMode) : []),
    [islands, clusterMode],
  );

  // PRD §5：網址 ?cluster= 有值以網址為準；沒有值時落在最近學過的那一課
  // 所在的群，完全沒有紀錄則第 4 級。只在「這次還沒決定過」時算一次，不要
  // 每次 clusters 重算（例如切換分群方式）就把使用者手動選的群蓋掉。
  const resolvedInitialKey = useRef(false);
  useEffect(() => {
    if (resolvedInitialKey.current || clusters.length === 0) return;
    const fromUrl = searchParams.get('cluster');
    const resolvedKey = fromUrl && clusters.some((c) => c.key === fromUrl)
      ? fromUrl
      : defaultClusterKey(recentProgress, clusters, clusterMode);
    setClusterKey(resolvedKey);
    // code review 2026-10-30 blocker 2 的另一半：落點解完也要寫回網址，
    // 不然切了分群方式重新整理、或分享網址給別人，`cluster=` 停在舊值
    // （甚至是舊分群方式底下的 key，在新分群方式裡查不到）。
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('cluster', resolvedKey);
      next.set('group', clusterMode);
      return next;
    }, { replace: true });
    resolvedInitialKey.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters]);

  const currentCluster = useMemo(
    () => clusters.find((c) => c.key === clusterKey) ?? clusters[0] ?? null,
    [clusters, clusterKey],
  );
  const portals = useMemo(
    () => (currentCluster ? portalsFor(clusters, currentCluster.key) : []),
    [clusters, currentCluster],
  );
  const occupiedInCluster = useMemo(
    () => currentCluster?.stories.filter((s) => s.status === 'occupied').length ?? 0,
    [currentCluster],
  );

  const jumpToCluster = useCallback((key: string) => {
    const target = clusters.find((c) => c.key === key);
    if (!target) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setSelectedSlug(null);
    const applyKey = () => {
      setClusterKey(key);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('cluster', key);
        next.set('group', clusterMode);
        return next;
      }, { replace: true });
    };
    if (reduceMotion) { applyKey(); return; }
    // 傳送過場：白光 0.6 秒（PRD §4）。
    setTransitioning(true);
    window.setTimeout(() => {
      applyKey();
      window.setTimeout(() => setTransitioning(false), 300);
    }, 300);
  }, [clusters, clusterMode, setSearchParams]);

  const changeMode = useCallback((mode: ClusterMode) => {
    setClusterMode(mode);
    setClusterKey(null); // 分群方式變了，舊 key 不一定存在於新分群——下面的 effect 會重新決定落點
    resolvedInitialKey.current = false;
    // code review 2026-10-30 blocker 2：切分群方式原本沒寫回網址，重新整理
    // 會跳回年級。先把 `group=` 寫回去；`cluster=` 等上面那個 effect 重新
    // 解完落點後會一併寫入（這裡先寫是讓「切完立刻重新整理」至少不會回到
    // 舊分群方式，不必等那個 effect 跑完）。
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('group', mode);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const changeTheme = useCallback((id: string) => {
    if (!(id in THEMES)) return;
    setThemeId(id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      // 部分隱私模式下 setItem 會拋錯——偏好記不住就算了，不影響當次切換
    }
  }, []);

  // ---------------------------------------------------------------------
  // 3D 世界：建立一次、換群或換主題時重建（模組重構 2026-10-30：主題在
  // `createArchipelagoWorld()` 建立時就定死，換皮膚目前走「整個世界重建」
  // 而不是「同一個世界熱替換皮膚」——跟 listMode/webglFailed 一樣觸發整個
  // effect 重跑）；WebGL 建不起來自動降級清單模式（PRD §6），不顯示錯誤頁。
  // `containerEl` 在依賴陣列裡——見上面 `useState<HTMLDivElement | null>`
  // 宣告處的說明，這是修一個真的發生過的 bug（容器掛載太晚，舊版用
  // `useRef` 永遠抓不到第二次掛載），不是多餘的依賴。
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (listMode || webglFailed) return;
    if (!containerEl) return;
    const world = createArchipelagoWorld(containerEl, {
      onSelectIsland: (slug) => setSelectedSlug(slug),
      onSelectPortal: (key) => jumpToCluster(key),
      onHoverIsland: (slug) => setHoveredSlug(slug),
    }, THEMES[themeId] ?? THEMES[DEFAULT_THEME_ID]);
    if (!world) { setWebglFailed(true); return; }
    worldRef.current = world;
    // `worldRef` 是純 ref，改它不會讓任何依賴它的 effect 重跑——下面那個
    // 「把當前群餵進世界」的 effect 依賴的是 `[currentCluster, portals,
    // themeId]`，完全不知道「世界剛剛才真的建好」這件事。用一個會觸發
    // 重新渲染的 state 當訊號，下面的 effect 把它加進依賴陣列，世界建好
    // 的當下才會真的去呼叫一次 `loadCluster()`（不然跟上面 `containerEl`
    // 同一種 bug：world 已經存在，卻永遠沒有任何東西載入進去）。
    setWorldVersion((v) => v + 1);
    return () => { world.dispose(); worldRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listMode, webglFailed, themeId, containerEl]);

  useEffect(() => {
    if (!worldRef.current || !currentCluster) return;
    // code review 2026-10-30 blocker：`s.category` 是 `/api/stories` 的原始
    // 類別碼（Science/Fable/History/Daily），主題（`themes/ocean.ts` 等）的
    // `landmarks` 登錄表比對的是正規化過的中文標籤——沒過這一層全部島都會
    // 掉進 `landmarks.default` 造型（長得一樣），必須在這裡正規化一次才
    // 送進 3D 世界。
    const worldIslands: ArchipelagoWorldIsland[] = currentCluster.stories.map((s) => ({
      storySlug: s.storySlug, title: s.title, category: normalizeCategory(s.category), status: s.status,
      stationsDone: s.stationsDone, stationsTotal: s.stationsTotal,
    }));
    const worldPortals: ArchipelagoWorldPortal[] = portals.map((p) => ({
      key: p.key, label: p.label,
      occupiedCount: p.stories.filter((s) => s.status === 'occupied').length,
      total: p.stories.length,
    }));
    worldRef.current.loadCluster(worldIslands, worldPortals);
    // `themeId`／`worldVersion` 都在 deps 裡：換主題或容器剛掛載時，上一個
    // effect 會整個重建 `worldRef.current`（新世界還沒載入任何群）——但
    // `worldRef` 是純 ref，光改它不會讓這支 effect 重跑，必須靠
    // `worldVersion` 這個 state 訊號才會真的重新檢查一次
    // `worldRef.current` 並呼叫 `loadCluster()`（2026-10-30 在真預覽站
    // 撞到的 bug：少了這個訊號，容器修好之後世界雖然建起來了，卻永遠
    // 沒有任何一群被載入，畫面還是空的——見 `containerEl` 那個 state
    // 修法旁的說明，這是同一類問題）。
  }, [currentCluster, portals, themeId, worldVersion]);

  const selectedIsland = useMemo(
    () => currentCluster?.stories.find((s) => s.storySlug === selectedSlug) ?? null,
    [currentCluster, selectedSlug],
  );

  const goToSingleIsland = useCallback((slug: string) => {
    if (!currentCluster) return;
    navigate(`/lab/island/${slug}?from=archipelago&group=${clusterMode}&cluster=${encodeURIComponent(currentCluster.key)}`);
  }, [navigate, currentCluster, clusterMode]);

  // ---------------------------------------------------------------------
  // 清單模式（D3 舊版卡片清單）——WebGL 降級／手動切換都走這條。
  // ---------------------------------------------------------------------
  const legacyFiltered = useMemo(
    () => (islands ? filterArchipelago(islands, { grade: legacyGradeFilter ?? undefined, search: legacySearch }) : []),
    [islands, legacyGradeFilter, legacySearch],
  );
  const legacyGrades = useMemo(() => [...new Set((islands ?? []).map((i) => i.grade))], [islands]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-lg bg-red-50 py-4 text-center text-red-600"><p>{error}</p></div>
      </div>
    );
  }

  if (islands === null || !currentCluster) {
    return <p className="py-16 text-center text-gray-400">載入中…</p>;
  }

  if (listMode || webglFailed) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black text-gray-900">我的群島</h1>
            <p className="text-sm text-gray-500">每一課都是一座島，讀完全部站點就能佔領它</p>
          </div>
          {!webglFailed && (
            <button type="button" onClick={() => setListMode(false)} className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-accent">
              回 3D 地圖
            </button>
          )}
        </header>
        {webglFailed && <p className="text-sm text-amber-600">這台裝置目前無法顯示 3D 地圖，已自動切換成清單模式</p>}

        <button
          type="button"
          onClick={() => navigate('/lab/word-babies')}
          className="flex w-full items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition-all hover:border-amber-400"
        >
          <span className="text-base font-bold text-amber-800">
            {babyCount ? `文字寶貝 ${babyCount.owned}/${babyCount.total} 隻` : '文字寶貝載入中…'}
          </span>
          <span className="text-sm font-semibold text-amber-600 underline">看我的寶貝 →</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setLegacyGradeFilter(null)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${legacyGradeFilter === null ? 'bg-accent text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-accent'}`}>全部年級</button>
          {legacyGrades.map((grade) => (
            <button key={grade} type="button" onClick={() => setLegacyGradeFilter(grade)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${legacyGradeFilter === grade ? 'bg-accent text-white' : 'border border-gray-200 bg-white text-gray-600 hover:border-accent'}`}>{gradeLabel(grade)}</button>
          ))}
        </div>
        <input type="text" value={legacySearch} onChange={(e) => setLegacySearch(e.target.value)} placeholder="搜尋課名…" className="w-full max-w-md rounded-lg border border-gray-200 px-4 py-2 text-sm focus:border-accent focus:outline-none" />

        {legacyFiltered.length === 0 ? (
          <p className="py-8 text-center text-gray-400">找不到符合的課，換個關鍵字或年級看看</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {legacyFiltered.map((island) => (
              <IslandCard key={island.storySlug} island={island} onOpen={() => navigate(`/lab/island/${island.storySlug}`)} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // team-lead 2026-10-31 三次訂正：天空穹頂整顆拿掉，3D canvas 改透明
  // （`createArchipelagoWorld.ts` 的 `alpha:true`／`setClearColor(0,0)`），
  // 背景改由這層 CSS 漸層負責——上緣 `skyTop`（淺天色）、下緣 `horizon`
  // （近岸海色／雲海色，跟 `scene.fog` 同一個顏色），這樣畫面最上緣一定
  // 有漸層，不用再管穹頂幾何有沒有剛好蓋到鏡頭看得到的角度。
  const currentTheme = THEMES[themeId] ?? THEMES[DEFAULT_THEME_ID];

  const sidePanel = (
    <ArchipelagoSidePanel
      cluster={currentCluster}
      occupiedInCluster={occupiedInCluster}
      clusterMode={clusterMode}
      onChangeMode={changeMode}
      allClusters={clusters}
      onJumpCluster={jumpToCluster}
      search={search}
      onSearch={setSearch}
      onSelectIsland={(slug) => { setSelectedSlug(slug); worldRef.current?.focusOnIsland(slug); }}
      selectedSlug={selectedSlug}
      hoveredSlug={hoveredSlug}
      onToggleListMode={() => setListMode(true)}
      babyCount={babyCount}
      onOpenWordBabies={() => navigate('/lab/word-babies')}
      themeId={themeId}
      onChangeTheme={changeTheme}
    />
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#bbd6dc]">
      {/* team-lead 2026-10-31 審查訂正：名牌卡片會蓋到右側固定面板上
          （`isRectOutOfBounds` 比對的是這個容器自己的 `getBoundingClientRect()`，
          原本這個容器是 `inset-0` 滿版，寬度涵蓋到側欄底下那塊，名牌投影
          落在那塊區域時「相對容器」沒有超出，但視覺上被側欄蓋住——根因
          不是名牌判斷邏輯錯，是容器本身的寬度量錯了。側欄 `w-80`（320px）
          只在 `sm:` 以上才顯示（`hidden sm:block`），所以容器也對齊同一個
          中斷點縮窄，手機版（側欄換底部抽屜）維持滿版不受影響；容器窄了
          之後，WebGL canvas／CSS2DRenderer 都靠 `container.clientWidth`
          自動跟著變窄（見 `createArchipelagoWorld.ts` 的 `resize()`），
          `isRectOutOfBounds` 比對的畫布邊界就真的是視覺上看得到的範圍，
          不需要骨架額外知道側欄的存在。 */}
      <div
        ref={setContainerEl}
        className="absolute inset-0 sm:right-80 [&_canvas]:h-full [&_canvas]:w-full"
        style={{ background: `linear-gradient(to bottom, ${currentTheme.palette.skyTop}, ${currentTheme.palette.horizon})` }}
        aria-label="群島 3D 地圖"
      />

      {/* 暈影（美術指導書 §2.4：「不要用 render pass，直接照單課島的做法疊
          CSS」——`ReadingIslandLab.tsx` 已經有這個零成本技巧，群島頁面原本
          完全沒有這一層。色值依主題調整：海島沿用單課島同一組青色系，
          天空島換成偏暖紫色系跟雲海主題呼應，不是兩個主題共用同一組色。 */}
      <div
        className={`pointer-events-none absolute inset-0 ${
          themeId === 'sky'
            ? 'bg-gradient-to-b from-[#e3d9f5]/30 via-transparent to-[#2a2140]/25'
            : 'bg-gradient-to-b from-[#d1e4e3]/30 via-transparent to-[#0e3440]/25'
        }`}
      />

      {transitioning && (
        <>
          <style>{'@keyframes archipelagoPortalFlash{0%{opacity:0}30%{opacity:1}100%{opacity:0}}'}</style>
          <div className="pointer-events-none absolute inset-0 z-40 animate-[archipelagoPortalFlash_0.6s_ease-in-out] bg-white" />
        </>
      )}

      {/* 桌機固定側欄；手機（<640）底部抽屜（PRD §6） */}
      <div className="absolute right-0 top-0 z-20 hidden h-full w-80 border-l border-white/40 bg-white/95 shadow-xl backdrop-blur sm:block">
        {sidePanel}
      </div>
      <details className="absolute bottom-0 left-0 right-0 z-20 block max-h-[70%] rounded-t-2xl border-t border-white/40 bg-white/95 shadow-xl backdrop-blur sm:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">{currentCluster.label}・已佔領 {occupiedInCluster}/{currentCluster.stories.length}（點展開選單）</summary>
        <div className="max-h-[55vh] overflow-y-auto">{sidePanel}</div>
      </details>

      {selectedIsland && (
        <div className="absolute left-4 top-4 z-30 w-72 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
          <button type="button" onClick={() => setSelectedSlug(null)} aria-label="關閉島卡" className="float-right text-gray-400 hover:text-gray-600">✕</button>
          <h3 className="text-base font-black text-gray-900">{selectedIsland.title}</h3>
          <p className="mt-1 text-xs text-gray-500">{gradeLabel(selectedIsland.grade)}・{selectedIsland.genre || '未分類'}</p>
          <span className={`mt-2 inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold ${STATUS_BADGE_CLASS[selectedIsland.status]}`}>
            {islandStatusLabel(selectedIsland)}
          </span>
          <button
            type="button"
            onClick={() => goToSingleIsland(selectedIsland.storySlug)}
            className="mt-3 w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white hover:bg-accent-hover"
          >
            登島
          </button>
        </div>
      )}
    </div>
  );
};

export default StudentArchipelagoPage;
