# 學習路徑遊戲化提案

> LingoLeap 國語文閱讀學習平台
> 2026-04-11 | Young + Claude Office Hours 產出

---

## 問題

方大哥觀察到學生在 10 步學習流程中缺乏動力，完成率不理想
目前的 StepperNav 是 todo list，不是冒險旅程

## 核心洞見

### 1. AI 時代不需要二選一

以前做一個 mode 要一個月，現在 4 個都做完只要一個下午
正確答案不是「選最好的那個」，是全都做、讓用戶選

### 2. 大部分 mode 其實是換皮

5 個現有 mode 的本質都是「怎麼排 10 個點」
WorldMap 和 RPG Adventure 結構幾乎一樣，只差 emoji vs SVG
真正的差異只有兩個維度：**佈局**和**互動機制**

### 3. 視覺新鮮感是表層刺激，互動機制才是持續驅動力

PM 觀點：主題化解決新鮮感，第二次看就習慣了
要讓學生「想繼續」，需要的是遊戲機制，不只是好看的畫面

---

## 架構：Layout × Theme × Mechanic

```
┌─────────────────────────────────���───────────────────┐
│                    學習路徑 UI                        │
│                                                      │
│   Layout（結構，真正不同的東西）                       │
│   ├── Linear    水平進度條                            │
│   ├── Grouped   三階段 accordion                      │
│   └── Path      蛇形路徑（Duolingo 風格）             │
│                                                      │
│   × Theme（皮膚，per-story 切換，便宜）               │
│     ├── 森林    綠色系 + 植物圖示                     │
│     ├── 太空    深藍 + 星球圖示                       │
│     ├── 城堡    琥珀 + 中世紀圖示                     │
│     ├── 運動    紅色 + 競賽圖示                       │
│     ├── 古典    墨色 + 書卷圖示                       │
│     └── 生活    暖色 + 日常圖示                       │
│                                                      │
│   × Mechanic（互動機制，真正的差異化）                 │
│     ├── 標準    點擊步驟 → 進入                       │
│     ├── 解鎖    完成前一步才能點下一步                 │
│     ├── 星等    每步可得 1-3 星，總星數解鎖獎勵        │
│     ├── 計時    挑戰模式，看多快完成                   │
│     └── 收集    每步掉落碎片，集滿拼出成就圖           │
│                                                      │
└──────────────────────────────────────────────���──────┘
```

### 為什麼分三層

| 層 | 改變什麼 | 成本 | 對學生的影響 |
|----|---------|------|-------------|
| Layout | 節點的空間排列方式 | 高（不同元件） | 認知模型不同 |
| Theme | 顏色、圖示、裝飾 | 低（CSS config） | 視覺新鮮感 |
| Mechanic | 互動規則、獎勵機制 | 中（業務邏輯） | 持續動力 |

### Theme 只需要改三樣東西

設計師結論：改這三樣就夠讓學生覺得「完全不同」

1. **背景底色 + 紋理**（一個 CSS variable）
2. **步驟圖示**（8-10 個 icon per theme）
3. **進度條顏色**

字體、間距、元件結構、導航行為全部不動

### CSS 三層 Token

```css
/* 品牌層 — 永遠不動 */
--brand-accent: #5B4FC4;
--brand-bg: #FDF8F0;

/* 主題層 — per-story 覆蓋 */
--theme-primary: var(--brand-accent);
--theme-bg: var(--brand-bg);
--theme-icon-set: "default";

/* 元件層 — 引用上兩層 */
--node-bg: var(--theme-primary);
--node-border: color-mix(in srgb, var(--theme-primary) 80%, black);
```

---

## 工程架構

### 現在：if/else → Factory + Hook 重構

```tsx
// hooks/useNavMode.ts — 統一邏輯
export function useNavMode(session, story) {
  return { steps, completedSteps, currentStepId, handleStepClick };
}

// components/nav/NavModeRenderer.tsx — factory
const NAV_COMPONENTS = {
  linear:  lazy(() => import('./StepperNav')),
  grouped: lazy(() => import('./LearningPhases')),
  path:    lazy(() => import('./LearningPathDuolingo')),
};

export function NavModeRenderer({ layout, theme, ...props }) {
  const Component = NAV_COMPONENTS[layout];
  return (
    <ThemeProvider theme={theme}>
      <Suspense fallback={<NavSkeleton />}>
        <Component {...props} />
      </Suspense>
    </ThemeProvider>
  );
}
```

### Per-Story 配置

```yaml
# backend/data/lessons/L30.yml（女性太空人登月）
nav_layout: path        # linear | grouped | path
nav_theme: space        # forest | space | castle | sports | classic | life
```

前端 fallback 邏輯：
```
story.nav_layout ?? inferFromGenre(story.genre) ?? globalDefault
```

自動推導規則（不配就用這個）：
```
記敘文 → path layout + 依內容推主題
說明文 → grouped layout + 依內容推主題
文言文 → grouped layout + classic theme
```

---

## 課文 × 主題對應（57 篇）

| 主題群 | 篇數 | Theme | 課文範例 |
|--------|------|-------|---------|
| 運動/體育 | ~12 | sports | 戴資穎、陳念琴、周天成、棒球夢 |
| 自然/動物 | ~10 | forest | 黑猩猩守護者、小藍鯨、昆蟲、植物獵人 |
| 科學/太空 | ~8 | space | 女性太空人、末日種子庫、運動科學 |
| 人物傳記 | ~8 | castle | 從童工到教授、兩千五百歲老師、奇蹟行動 |
| 文言文 | 4 | classic | 師說、木蘭詩 |
| 生活/健康 | ~8 | life | 祝你好眠、運動傷害、六塊肌六塊雞 |
| 其他 | ~7 | 預設 | 卡通票選、紅領帶 |

---

## 執行計畫

### Phase 0：現在（已完成）
- [x] 5 個 mode 合併到同一 branch
- [x] PR #1059 開好
- [x] 研究文件 ×3 完成

### Phase 1：上線收數據（本週）
- [ ] Default 改為 path layout（worldmap theme）
- [ ] 加 localStorage tracking（切換事件）
- [ ] Merge PR 到 staging
- [ ] Demo 給方大哥

### Phase 2：架構重構（1-2 天）
- [ ] 建 `useNavMode` hook
- [ ] 建 `NavModeRenderer` factory + lazy loading
- [ ] AppShell 從 if/else 切換到 factory
- [ ] 整理成 3 layout + 現有 theme

### Phase 3：基礎 Gamification（優先於主題化）
- [ ] XP 系統前端展示（backend 已有 gamification_service）
- [ ] 連續學習天數（streak）修正 #982
- [ ] 完成步驟的慶祝動畫
- [ ] 成就徽章頁面 #1014

### Phase 4：Theme 系統（Phase 3 之後）
- [ ] CSS token 三層架構
- [ ] 6 個 theme config（forest/space/castle/sports/classic/life）
- [ ] YAML 加 nav_theme 欄位
- [ ] Auto-infer fallback

### Phase 5：互動機制差異化（數據驗證後）
- [ ] 星等系統（per-step 1-3 星）
- [ ] 收集機制（碎片 → 成就圖）
- [ ] 計時挑戰模式
- [ ] 基於數據決定哪些機制有效

---

## 成本分析

| 項目 | 工程量 | 維護成本 |
|------|--------|---------|
| 3 Layout 元件 | 已完成 | 低（獨立元件） |
| 6 Theme config | 每個 ~20 行 JSON | 極低（只是配色+圖示） |
| useNavMode hook | 1 天 | 低（統一邏輯） |
| Factory 重構 | 半天 | 降低（消除重複） |
| 57 篇 YAML 標記 | 2 小時 | 零（一次性） |
| Gamification 前端 | 3-5 天 | 中（新功能） |
| 互動機制 | 每個 2-3 天 | 中（業務邏輯） |

## 技術選型

| 層 | 現在 | Phase 4+ |
|----|------|----------|
| 佈局 | CSS + Tailwind | 不變 |
| 動畫 | CSS keyframes | + Framer Motion (~32KB) |
| 慶祝效果 | CSS confetti | + Rive (~50KB) |
| 地圖互動 | 無 | 考慮 React Flow (~40KB) |

**Chromebook 安全線**：總新增 < 120KB gzipped

---

## 關鍵決策記錄

| 決策 | 選擇 | 原因 |
|------|------|------|
| Mode 數量 | 3 layout × N theme | 10 個獨立 mode 是假的，大部分是換皮 |
| Default | Path layout + worldmap theme | 最有趣的第一印象 |
| 優先順序 | Gamification > Theme > Mechanic | PM：基礎動力系統先行，視覺新鮮感後做 |
| Per-story 主題 | YAML config + auto-infer | 不需要 57 個手動配置 |
| 引擎 | CSS/SVG，不用遊戲引擎 | Chromebook 效能限制 + 小團隊維護能力 |

---

## 四角色共識摘要

- **CEO**：2x 不是 10x，但 MVP 值得做。護城河在數據綁定，不在換皮
- **工程師**：hook + factory + lazy loading，新增 theme 成本趨近零
- **設計師**：改三樣就夠（底色、圖示、進度條），結構不動就不混亂
- **PM**：先做 XP/streak/badges，再用最小實驗驗證主題化效果
