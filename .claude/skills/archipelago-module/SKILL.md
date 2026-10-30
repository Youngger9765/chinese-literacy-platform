---
name: archipelago-module
description: 喝采島「群島模組」的架構與擴充方式——怎麼新增主題皮膚（海島、天空島、海底、星際、異世界…）、新增分群方式、新增島上地標、新增傳送門樣式，而不動骨架。Use when 要加主題、換皮膚、加分群方式、改群島長相、新增島的造型、問「群島怎麼擴充」。
---

# 群島模組（archipelago module）

> 規格 SOT：`docs/prd/2026-10-30-archipelago-clusters-prd.md`（§8.5 主題皮膚）
> 3D 技術一律查高手寫好的 skill，不自己發明：見 §6

## 1. 三層，各管各的

```
┌──────────────────────────────────────────────────────────────┐
│ 資料層  data/      課程 + 進度 → 島（沿用 buildArchipelago）  │  不知道 3D 的存在
├──────────────────────────────────────────────────────────────┤
│ 骨架層  core/      分群 → 座標 → 狀態 → 點島/登島 → 傳送門    │  不知道長什麼樣子
├──────────────────────────────────────────────────────────────┤
│ 皮膚層  themes/    底面、島、門、連接物、色票、粒子、音樂     │  不知道資料與規則
└──────────────────────────────────────────────────────────────┘
        場景 createArchipelagoWorld(theme, layout) 把骨架的位置交給皮膚去畫
```

**鐵律**：場景程式裡不准出現任何主題字眼（海、雲、珊瑚、顏色常數）。要的東西一律從 `theme` 拿。

## 2. 擴充點（新增 = 加一個檔案 + 在登錄表加一行）

| 想加什麼 | 放哪 | 介面 | 登錄表 |
|---|---|---|---|
| 主題皮膚 | `themes/<id>.ts` | `ArchipelagoTheme` | `themes/index.ts` 的 `THEMES` |
| 分群方式 | `core/groupings/<id>.ts` | `GroupingStrategy` | `core/groupings/index.ts` 的 `GROUPINGS` |
| 島上地標造型 | 寫在主題的 `landmarks` | `LandmarkFactory` | 由主題自帶 |
| 傳送門樣式 | 寫在主題的 `portal` | `PortalFactory` | 由主題自帶 |

> **「搬不重寫」落地方式**（2026-10-30）：既有的分群/蜂巢座標純函式
> （`groupIntoClusters`／`clusterKeyFor`／`hexSpiralCoord`／`axialToCartesian`／
> `normalizeGenre`／`normalizeCategory` 等）整份**原封不動**搬進
> `core/archipelagoClusters.ts`（這是「骨架」層級的共用邏輯，不是某一種
> 分群方式專屬的）。`core/groupings/{grade,genre,category}.ts` 是**薄層**，
> 各自把這份共用邏輯包成 `GroupingStrategy` 的形狀（`clusterOf`/`clusters`），
> 給「未來想加一種全新分群方式」的人一個不用碰共用檔案的擴充點——不是
> 把共用邏輯拆成三份各寫一次。

### 2.1 `ArchipelagoTheme`（皮膚契約）

> ⚠️ **2026-10-30 實作後訂正**（team-lead 授權「介面不合理就直接改，回報改了什麼」）：
> 下面是實際落地的版本，跟最初草稿有三處不同，理由見各處行內註解。

```ts
interface ArchipelagoTheme {
  id: string;                 // 'ocean' | 'sky' | …（網址與 localStorage 用）
  name: string;               // 顯示名稱：海島、天空島…
  palette: { background: string; fog: string; accent: string; occupied: string; inProgress: string; unexplored: string };
  lighting: {
    sunColor: string; sunIntensity: number; ambient: number; sunDirection: [number, number, number];
    hemisphereSky: string; hemisphereGround: string; // 訂正①：半球光天空/地面色票，原草稿沒有——
    // 少了它們骨架就得自己掰一組「看起來中性」的顏色寫死在 createArchipelagoWorld.ts，
    // 違反§3契約測試④（骨架不准出現 hex 色碼），這兩個欄位讓骨架完全不用碰顏色常數。
  };
  ground: (ctx: SceneCtx) => THREE.Object3D;          // 底面：海、雲海、星空、深海
  island: (ctx: SceneCtx, cell: CellInfo) => THREE.Object3D; // 一座完整課程島（含地基＋地標，狀態另外疊）
  hub: (ctx: SceneCtx) => THREE.Object3D;             // 中央傳送門廣場
  portal: (ctx: SceneCtx, target: ClusterInfo) => THREE.Object3D;
  connector: (ctx: SceneCtx, a: { x: number; z: number }, b: { x: number; z: number }) => THREE.Object3D | null;
  // 訂正②：連接物只吃兩個端點座標，不吃完整 CellInfo——沒有任何連接物樣式
  // （棧橋/光束/海流）需要知道對面那座島的類別/狀態，硬塞完整物件只會讓廣場→
  // 第一座島這種「虛擬端點」要生一個假 CellInfo。
  landmarks: Record<string, LandmarkFactory> & { default: LandmarkFactory }; // 依課程類別換地標，default 必須有
  statusLook: Record<IslandStatus, (obj: THREE.Object3D, ctx: SceneCtx) => void>; // 已佔領/探索中/尚未探索怎麼改長相
  particles?: (ctx: SceneCtx) => THREE.Object3D;      // 泡泡、星塵、雲絮
  transition: { color: string; durationMs: number };  // 傳送過場
  music?: string;                                     // 背景音檔路徑
}
```

- `SceneCtx` 定義在 `core/sceneCtx.ts`（骨架，不是皮膚層自己定義），訂正③：**是鍵控快取**，
  不是原草稿寫的籠統「共用快取」——`ctx.geometry(key, factory)`／`ctx.material(key, factory)`，
  同一把 key 在同一次群載入期間回傳同一個物件，不同 key 才呼叫 `factory()` 新建。主題函式
  可以每次呼叫都直接 `ctx.material('science-roof', () => new THREE.MeshStandardMaterial(...))`，
  不用自己在模組層級手動管理「這個材質有沒有建過」；換群時 `createSceneCtx()` 整包丟棄
  （上一群的資源由既有 `disposeObjectTree` 在換群時一併釋放，不是 ctx 自己管 dispose）。
- **拿掉了 InstancedMesh**：原草稿假設地基是「同類造型用 InstancedMesh」，但 SKILL §2.1 的
  `island(ctx, cell): THREE.Object3D` 介面本身就要求主題回傳**整座島**（含地基），兩者衝突。
  實作選擇照介面走——主題自己決定整座島怎麼建，代價是拿掉了地基的 InstancedMesh。在目前
  規模（單群最多 71 座島）這不是效能問題；InstancedMesh 是給數百上千個實例才重要。若以後
  島數量級上升，要另外設計（例如讓主題只提供「地基幾何」而不是整座島）。
- 能用 InstancedMesh 的地方仍然優先用；做法查 `threejs-geometry`、`threejs-performance`

### 2.2 `GroupingStrategy`（分群契約）

```ts
interface GroupingStrategy {
  id: 'grade' | 'genre' | 'category' | string;
  label: string;                                   // 年級、文體、類別
  clusterOf: (story: ArchipelagoStory) => string;  // 一課屬於哪一群，必須唯一
  clusters: (stories: ArchipelagoStory[]) => ClusterInfo[]; // 群的順序、名稱
}
```

## 3. 契約測試（加新東西時一定要過，`__tests__/moduleContracts.test.ts`）

- 每個 `THEMES` 裡的主題：§2.1 每一項都有提供；`statusLook` 三種狀態都有；`landmarks.default` 一定有
- 每個主題都能在假的 `SceneCtx` 上建出一個群，且 `dispose` 之後登記的幾何與材質數回到 0
- 每個 `GROUPINGS` 分群方式：所有群加總 = 課程總數，每課剛好一群（用 `__tests__/fixtures/all-stories.json` 179 課）
- 場景程式原始碼裡不准出現主題字眼（掃 `createArchipelagoWorld.ts`，命中「ocean|sea|cloud|coral|0x[0-9a-f]{6}」就紅）

## 4. 新增一個主題的步驟（例：海底世界）

1. 複製 `themes/ocean.ts` 成 `themes/undersea.ts`，改 `id`、`name`、色票
2. 換 `ground`（深海 + 光柱）、`island`（珊瑚礁）、`portal`（漩渦）、`connector`（海流）、`particles`（泡泡）
3. 在 `themes/index.ts` 的 `THEMES` 加一行
4. 跑契約測試 → 綠
5. 預覽站 headless 截圖 1280 寬與 390 寬，逐張看過才算完成

## 5. 不准做的

- 為了某個主題在骨架加 `if (theme.id === 'sky')` —— 那代表介面缺一項，去補介面
- 用有著作權的世界觀（海賊王、寶可夢…）的名稱、地名、造型
- 換主題時重新打 API 或改變分群結果

## 6. 技術細節查這些（高手寫好的，不要自己發明）

| 問題 | 查 |
|---|---|
| 大量同造型島、樹、合併、批次 | `threejs-geometry`（CloudAI-X，MIT） |
| 點島、拖曳旋轉、鏡頭控制 | `threejs-interaction` |
| 卡、掉幀、記憶體 | `threejs-performance` |
| 光、陰影、環境光 | `threejs-lighting` |
| 景深、泛光、微縮模型感 | `threejs-postprocessing` |
| 材質、卡通風 | `threejs-materials` |
| 六角座標、多群排列、海岸線 | Felix Turner hex-map-wfc 原始碼 `~/project/refs/hex-map-wfc`（MIT）＋文章 <https://felixturner.github.io/hex-map-wfc/article/> |
| 地標設計（一眼認得） | `ref-zelda-landmark-design` |
| 3D 遊戲 QA | `threejs-game-qa` |

## 7. 變更紀錄

- **2026-10-30 建立**：骨架＋皮膚契約定義（Young 明令「先把框架建成模組」）。
- **2026-10-30 實作落地**：`core/archipelagoClusters.ts`（搬自舊版
  `archipelago/archipelagoClusters.ts`，邏輯不變）＋`core/groupings/`
  三個策略薄層＋`core/sceneCtx.ts`（鍵控快取，§2.1 訂正③）＋
  `themes/{ocean,sky}.ts` 兩個主題＋`__tests__/moduleContracts.test.ts`
  四條契約測試全綠。介面訂正見 §2.1 行內註解（lighting 補兩個色票欄位、
  connector 簡化成座標點、拿掉 InstancedMesh）。
  **附帶修掉一個在真預覽站驗到的嚴重 bug**（跟模組重構本身無關，是
  `StudentArchipelagoPage.tsx` 既有的）：3D 容器 `<div ref={containerRef}>`
  包在資料載入的早退判斷式之後，`useRef` 第一次 commit（資料還沒載入）
  時拿到 `null`，世界建立的 `useEffect` 依賴陣列不包含任何會在資料載入後
  改變的值，於是永遠不會重跑——**整個 3D 地圖從來沒有真的渲染過**（真
  預覽站截圖證實容器 `childElementCount === 0`，只有空白底色跟右側清單）。
  改用 `useState` 版 callback ref（`containerEl`）+ 一個 `worldVersion`
  訊號讓「世界剛建好」這件事能真正觸發下一個 effect 重跑。
