# React RPG 遊戲框架研究 — LingoLeap 學習路徑 UI

> 研究日期：2026-04-10
> 目的：評估 React 生態系中 RPG 風格 UI 的可用工具

---

## 核心發現

**沒有單一「React RPG 框架」能直接用。** 生態系由以下組成：
- (A) 有 React adapter 的遊戲引擎（Phaser, RPGJS, PixiJS）
- (B) React 原生遊戲元件庫（大多已停維）
- (C) 個別 UI 元件庫（技能樹、對話框、進度條）
- (D) 可改造的通用 React 庫（React Flow 做節點地圖）

---

## 1. React RPG 開源專案

### react-rpg.com（ASteinheiser）
- ⭐ 360 | React + Redux + Vite | 活躍（826 commits）
- 像素風地牢探索遊戲，完整 D&D 5e 機制
- **價值**：架構參考（Redux 管遊戲狀態 + React 管渲染）
- **可用性**：LOW（是完整遊戲，不是 library）

### react-game-kit（Formidable Labs）
- ⭐ 4,600 | **已 Archive**（2024-02）
- 提供 Loop, Stage, World, Sprite, TileMap 元件
- **價值**：API 設計參考
- **可用性**：LOW（已死）

### react-game-engine（bberak）
- ⭐ 463 | 2019 最後更新
- 提供 60fps game loop + entity 系統
- **可用性**：LOW（太底層、已停維）

### r3f-game-demo（coldi）
- ⭐ 655 | TypeScript 97.6% | react-three-fiber
- 2D tile-based RPG，Unity 風格 GameObject 系統
- **價值**：R3F 做 2D RPG 的最佳參考
- **可用性**：MEDIUM 參考，LOW 依賴（Three.js ~500KB 太重）

---

## 2. 遊戲引擎 + React 整合

### Phaser 3 + 官方 React Template
- ⭐ 37,000+ | [phaserjs/template-react-ts](https://github.com/phaserjs/template-react-ts)
- **React 19 + Vite 6 + TypeScript** — 跟 LingoLeap 完全吻合
- EventBus 模式：React 管 UI，Phaser 管遊戲畫面
- Grid Engine plugin（270⭐）：tile 走路、碰撞、尋路
- ~300KB gz bundle
- **適用**：如果要做真正的 tile-map RPG 走路

### RPGJS
- ⭐ 1,600 | PixiJS 渲染 | React hooks 整合
- 完整 RPG/MMORPG 框架（地圖編輯器、戰鬥、NPC、多人）
- **太重**——我們不需要 MMORPG

### PixiJS + pixi-react
- ⭐ 44,000+ | 官方 React binding
- 純 2D WebGL 渲染器，1000+ 元素 60fps
- ~200KB gz
- **適用**：需要大量動畫精靈、粒子效果時

### Pixi'VN（視覺小說引擎）
- PixiJS + React | 對話、角色、場景轉換
- **未來參考**：LingoLeap 的蘇格拉底對話可能用得上

---

## 3. RPG UI 元件庫

### React Flow ⭐ 31,779（推薦）
- 847K 週下載 | ~40KB gz | **非常活躍**
- 節點式 UI 庫——自訂節點渲染可做成 RPG 地標
- Zoom/pan、minimap、虛擬化
- **最適合做 Duolingo 風格學習路徑地圖**

### beautiful-skill-tree ⭐ 388
- React 技能樹元件，自訂主題
- **5 年沒更新**——建議 fork 自維護
- 概念完美對應詞彙精熟度、閱讀理解等級

### RPGUI ⭐
- 純 CSS RPG 風格 UI（25KB CSS + 1.35MB 圖片）
- 容器/按鈕/進度條/滑桿全都有 RPG 皮膚
- 零依賴，跟 Tailwind 共存
- **建議**：挑選 CSS 模式，不載入全部圖片

### react-game-dialogue
- 打字機效果、角色頭像、分支選擇
- 11 commits，太早期——僅作參考

---

## 4. 教育 RPG 產品分析

### Classcraft（已關閉 2024-06）
- 被 HMH 收購後砍掉遊戲化，教師大反彈
- **教訓**：RPG 遊戲化是核心功能，不是可拆的附加件

### Prodigy Math
- Unity WebGL——視覺強但載入慢、bundle 巨大
- Chromebook 可用但體驗不佳
- **教訓**：不能用 Unity 路線

### Habitica（開源）
- **Vue.js + CSS + SVG 像素風**——不用遊戲引擎
- 證明標準 web 技術 + RPG 視覺可以很好
- **最相關的架構參考**

### DragonBox
- 網頁用簡單 web tech，遊戲走 native app
- 參考性低

---

## 5. 推薦架構

| 層 | 工具 | 理由 |
|----|------|------|
| 學習路徑地圖 | **React Flow**（自訂節點 + 邊） | 847K 下載、zoom/pan、虛擬化 |
| 技能樹 | **Fork beautiful-skill-tree** 或自建 | RPG 主題重新設計 |
| RPG 視覺主題 | **Tailwind + SVG + RPGUI 參考** | 控制 bundle，不依賴圖片 |
| 對話框 | **自建 + react-spring** | 打字機效果、角色頭像 |
| 進度條 | **自建 Tailwind** | XP/HP bar 用 div+gradient 就夠 |
| 動畫 | **Framer Motion** | 已在 React 生態，輕量 |
| 像素風素材 | **itch.io 素材包**（MIT/CC） | 現成 tileset、UI、角色 |

### Bundle 影響估算

| 新增項 | Gzipped |
|--------|---------|
| React Flow | ~40KB |
| Framer Motion | ~30KB |
| 自訂 RPG CSS/SVG | ~15KB |
| 像素風素材（最佳化） | ~200KB |
| **總計** | **~285KB** |

vs. Phaser ~300KB + Grid Engine + 素材 = 500KB+

---

## 來源

- [react-rpg.com](https://github.com/ASteinheiser/react-rpg.com)
- [react-game-kit](https://github.com/FormidableLabs/react-game-kit)（Archived）
- [Phaser React Template](https://github.com/phaserjs/template-react-ts)
- [RPGJS](https://github.com/RSamaium/RPG-JS)
- [React Flow](https://reactflow.dev/)
- [beautiful-skill-tree](https://github.com/andrico1234/beautiful-skill-tree)
- [RPGUI](https://github.com/RonenNess/RPGUI)
- [Habitica](https://github.com/HabitRPG/habitica)
- [Grid Engine](https://github.com/Annoraaq/grid-engine)
- [r3f-game-demo](https://github.com/coldi/r3f-game-demo)
- [itch.io RPG tilesets](https://itch.io/game-assets/free/genre-rpg/tag-tilemap)
