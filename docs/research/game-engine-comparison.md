# 2D/3D 引擎方案比較 — LingoLeap 學習路徑 UI

> 研究日期：2026-04-10
> 目的：評估 React 19 + Vite 環境下，各種渲染引擎的可行性

---

## 決策矩陣

| 方案 | 學習曲線 | Chromebook 效能 | React 整合 | Bundle Size | 資產管線 | 非設計師能做好看 | 總分 |
|------|:-------:|:--------------:|:----------:|:-----------:|:--------:|:---------------:|:----:|
| **CSS/SVG + Framer Motion** | 3/10 | 10 | 10 | 10 | 9 | 7 | **8.5** |
| **CSS/SVG + GSAP** | 4/10 | 10 | 8 | 10 | 9 | 7 | **8.2** |
| **Rive (動畫)** | 5/10 | 9 | 8 | 8 | 7 | 8 | **7.5** |
| **Konva + react-konva** | 4/10 | 7 | 9 | 8 | 7 | 6 | **6.8** |
| **PixiJS + @pixi/react** | 5/10 | 8 | 7 | 7 | 5 | 5 | **6.2** |
| **Lottie** | 3/10 | 6 | 8 | 6 | 6 | 8 | **6.2** |
| **R3F (Three.js)** | 7/10 | 4 | 9 | 5 | 3 | 4 | **4.8** |
| **Phaser** | 7/10 | 7 | 3 | 3 | 5 | 6 | **4.5** |
| **Babylon.js** | 8/10 | 5 | 3 | 2 | 3 | 4 | **3.5** |
| **Spline** | 2/10 | 1 | 7 | 1 | 9 | 9 | **3.5** |

> 權重：Chromebook 效能 25%, React 整合 20%, Bundle 15%, 學習曲線 15%, 資產管線 15%, 美觀 10%

---

## 各方案詳細評估

### A. 純 CSS/SVG + 動畫庫（推薦首選）

SVG `<path>` 畫學習路徑線，CSS transforms 做節點動畫，Framer Motion 或 GSAP 做編排互動。

**優點**：
- 團隊已經會 CSS/React，零學習成本
- 最好的無障礙支援（screen reader, keyboard nav）
- 最小 bundle（Framer Motion ~32KB gz / GSAP ~23KB gz）
- Chromebook 安全——不需 GPU
- 完整 React DevTools 除錯

**缺點**：
- 複雜粒子效果痛苦
- SVG 動畫超過 500 個元素效能下降
- 要做到「遊戲感」需要更多手工

**動畫庫選擇**：
- **Framer Motion**：~32KB gz，宣告式 React API，手勢支援。React 開發者 DX 最好
- **GSAP**：~23KB gz，最強大的 timeline/sequencing。商業授權需確認
- **React Spring**：~17KB gz，物理彈簧動畫，API 較不直覺

### B1. PixiJS + @pixi/react

2D WebGL 渲染器。v8 支援 tree-shaking。

- 10,000 sprites 47 FPS——效能餘裕很大
- WebGL + Canvas fallback
- ~120KB gz（完整），tree-shaking 可更少
- 需要維護兩套渲染（React DOM + PixiJS canvas）
- Canvas 對 screen reader 不透明

**適用場景**：需要可捲動的 2D 世界地圖 + 動態背景 + 角色動畫時考慮

### B2. Phaser

完整 2D 遊戲框架——物理、音效、輸入、場景管理。

- ~300KB gz——太重
- React 整合根本上尷尬（Phaser 要控制 DOM）
- **官方有 React 19 + Vite template**（phaserjs/template-react-ts）
- Grid Engine plugin 做 tile-based RPG 走路很完整
- 對學習路徑 UI 來說大砲打小鳥

### B3. Konva + react-konva

2D Canvas + React 宣告式 API。

- ~55KB gz
- 406K 週下載，最多人用的 React canvas library
- 適合互動圖表、節點地圖
- 不是為動畫/粒子設計——需要搭配動畫庫
- 效能在 500+ shapes 後下降

### B4. Rive（動畫補充）

Duolingo 用 Rive 做角色動畫。WASM runtime，60 FPS。

- ~50KB gz runtime
- Rive 檔案比 Lottie 小 10-15x（16KB vs 240KB 同等動畫）
- State machine 做互動動畫不需寫 code
- 適合做慶祝動畫、角色反應——**不適合做地圖結構**

### C1. Three.js + React Three Fiber (R3F)

3D WebGL，React 整合最好的 3D 方案。

- ~168KB gz（three.js）+ R3F + Drei
- **學校 Chromebook 會卡**——3D 是最吃 GPU 的
- 3D 素材建置需要 Blender，門檻高
- 除非真的要做 3D 世界探索，否則不需要

### C2-C4. Babylon.js / Spline / Model Viewer

- Babylon.js：~1.4MB，無 React wrapper，淘汰
- Spline：runtime 6.82MB，淘汰
- Model Viewer：只能展示單一 3D 模型，不適用

---

## 推薦方案：CSS/SVG + Framer Motion + Rive（混合）

| 層 | 工具 | 用途 |
|----|------|------|
| 結構佈局 | SVG + Tailwind CSS | 學習路徑線 + 節點定位 |
| 互動動畫 | Framer Motion (~32KB gz) | 節點進場、進度展開、手勢 |
| 慶祝動畫 | Rive (~50KB gz runtime) | XP 獲得、成就解鎖、角色反應 |

**總 bundle 增量：~82KB gz**（+ 按需載入的 .riv 動畫檔）

### 何時升級到 PixiJS

如果之後需要：
- 可捲動的 2D 世界地圖 + 地形 + 雲朵動畫背景
- 大量粒子效果（>100 同時）
- Sprite 角色沿路徑走動
- 即時多人視覺化

### 何時用 Phaser

如果要做**真正的 tile-based RPG 走路**（像寶可夢/Prodigy），Phaser + Grid Engine + 官方 React template 是正確選擇。

---

## 來源

- [JS Game Rendering Benchmark](https://github.com/Shirajuki/js-game-rendering-benchmark)
- [Phaser vs PixiJS](https://generalistprogrammer.com/comparisons/phaser-vs-pixijs)
- [Rive vs Lottie 2025](https://dev.to/uianimation/rive-vs-lottie-which-animation-tool-should-you-use-in-2025-p4m)
- [GSAP vs Motion](https://motion.dev/docs/gsap-vs-motion)
- [Three.js vs R3F vs Babylon.js](https://www.pkgpulse.com/blog/threejs-vs-react-three-fiber-vs-babylonjs-3d-webgl-2026)
- [PixiJS v8 Tree-Shaking](https://github.com/pixijs/pixijs/issues/10392)
- [Duolingo Server-Driven UI](https://blog.duolingo.com/server-driven-ui/)
