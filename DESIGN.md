# Design System — LingoLeap 國語文閱讀學習平台

> **Source of truth: this file reflects the actual code** (`frontend/tailwind.config.js` + `frontend/src/index.css`).
> Last synced: 2026-04-20. If code diverges from here, update this file.

## Product Context
- **What this is:** AI 朗讀教學工具，協助國小教師與學生提升閱讀流暢度
- **Who it's for:** 國小高年級～國中生（主要）、教師（管理）、家長（查看）
- **Space/industry:** 台灣 K-12 閱讀教育，對標 PRIORI/均一/品學堂
- **Project type:** Education SaaS web app（React 19 + Vite + Tailwind）
- **Brand personality:** 溫暖但堅定的蘇格拉底助教 — 鼓勵但不放水

## Aesthetic Direction
- **Direction:** "Tactile Scholar" — Material 3 adaptation，暖米色紙張質感 + 深紫品牌色 + 森林綠成功狀態 + 鼓勵橙修正回饋
- **Palette provenance:** Stitch "Tactile Scholar" preset，針對教育閱讀語境調色
- **Decoration level:** Intentional（微妙圓角和色彩層次，不過度裝飾）
- **Mood:** 像「質感兒童書店」— 有溫度但不幼稚，專業但不冰冷
- **Anti-patterns:** 不要卡通風、不要過多 emoji 裝飾、不要 generic AI dashboard 風格

## Typography

Four font stacks defined in `tailwind.config.js`:

| Tailwind class | Stack | Usage |
|---------------|-------|-------|
| `font-sans` | Noto Sans TC → system sans | 正文、表單、通用 UI |
| `font-ui` | cwTeXYen → Noto Sans TC | 注音相關 UI（短標題、tab labels）|
| `font-headline` | Plus Jakarta Sans → Noto Sans TC | Hero 標題、section 標題、強調數字 |
| `font-body` | Be Vietnam Pro → Noto Sans TC | 段落文字、AI 對話泡泡 |

**Zhuyin font:** BpmfZihiSans-Bold（全域 `[data-zhuyin-active]` 注入，取代 BpmfIansui）

**Type scale:**

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| xs | 12px | 400 | 輔助文字、標籤 |
| sm | 14px | 400 | 次要內容、表格 |
| base | 16px | 400 | 正文（教師端預設）|
| lg | 18px | 500 | 小標題 |
| xl | 20px | 500 | 區塊標題 |
| 2xl | 24px | 700 | 頁面標題 |
| 3xl | 30px | 700 | Hero 標題 |
| 4xl | 36px | 700 | Landing page |
| 5xl | 48px | 700 | 特大展示 |

### 學生端文字大小
學生可調整閱讀字體大小（小/中/大），預設為「中」(20px)。課文朗讀區域用較大字體 + 1.8 行高，確保注音不互相疊加

## Color

### Approach: Tactile Scholar — 暖米色系 + 深紫 + 語意色

All `accent` and `status` colors are defined as **CSS variables** in `index.css :root` and consumed by Tailwind's `rgb(var(...) / <alpha-value>)` pattern.

### Brand / Accent

| Token | Hex | CSS var | Usage |
|-------|-----|---------|-------|
| `accent` | `#564ABF` | `--color-accent: 86 74 191` | 主要 CTA、導航、品牌色（深紫 — 智慧、AI 感）|
| `accent-hover` | `#4A3CB2` | `--color-accent-hover: 74 60 178` | Hover 狀態 |
| `accent-light` | `#9D93FF` | `--color-accent-light: 157 147 255` | 高亮漸層終點、輕量強調 |
| `accent-bg` | `#EDEBF9` | `--color-accent-bg: 237 235 249` | 選中行背景、tag 底色 |
| `accent-bg-subtle` | `#E0DCF5` | `--color-accent-bg-subtle: 224 220 245` | 更淡的 hover 背景 |

### Status Colors

| Token | Hex | CSS var | Usage |
|-------|-----|---------|-------|
| `success` | `#006947` | `--color-success: 0 105 71` | 正確答案、達標、完成（森林綠）|
| `warning` | amber-500 | `--color-warning: 245 158 11` | 注意、接近達標 |
| `error` | red-500 | `--color-error: 239 68 68` | **系統錯誤專用**（非學習回饋）|

> **重要**: `error` 色（紅色）只用於系統/技術錯誤。學習回饋（讀錯字、需要重試）用 `tertiary`（鼓勵橙），不用紅色。

### Tertiary — Encouragement Orange

| Token | Hex | Usage |
|-------|-----|-------|
| `tertiary` | `#994100` | 鼓勵語氣的修正回饋、「再試一次」按鈕文字 |
| `tertiary-dim` | `#863800` | Hover 狀態 |
| `tertiary-container` | `#FF955A` | 鼓勵 badge 背景、warm highlight |
| `tertiary-fixed` | `#FF955A` | 固定顏色版（不跟隨主題）|
| `tertiary-fixed-dim` | `#FF7F2F` | 固定顏色 hover |

Button utilities: `.btn-encourage` (bg `#994100`) and `.btn-encourage:hover` (bg `#863800`)

### Surface System（5-step Material 3 容器）

全部定義在 `tailwind.config.js` `colors.surface`：

| Token | Hex | Usage |
|-------|-----|-------|
| `surface` / `surface-bright` | `#FBF6EE` | 頁面背景（主色調暖米色）|
| `surface-dim` | `#D9D4CA` | 停用狀態、overlay 背景 |
| `surface-container-lowest` | `#FFFFFF` | 卡片、Modal、最高層元素 |
| `surface-container-low` | `#F5F0E8` | 輕量卡片、hover 底色 |
| `surface-container` | `#ECE8DF` | 標準容器 |
| `surface-container-high` | `#E7E2D8` | 強調容器 |
| `surface-container-highest` | `#E1DCD2` | 最強調容器、sidebar 背景 |

### On-Surface（文字色）

| Token | Hex | Usage |
|-------|-----|-------|
| `on-surface` | `#302F2A` | 主要文字（暖黑，非純黑）|
| `on-surface-variant` | `#5E5B55` | 次要文字、placeholder |

### 朗讀差異比對色彩

| 類型 | 色碼 | 用途 |
|------|------|------|
| 正確 | `#006947` bg 10% | 讀對的字（淡森林綠底）|
| 讀錯 | `#FF955A` bg 15% | 讀錯的字（鼓勵橙底 + 橙字，非紅色）|
| 漏讀 | amber-500 bg 15% | 漏掉的字（淡橘底 + 橘字）|
| 多讀 | `#3B82F6` bg 10% | 多讀的字（淡藍底）|

### Dark Mode
暫不實作。Phase 6+ 考慮（#410）

## CSS Variable Convention (CRITICAL)

**`--color-*` 變數儲存的是 RGB triplet，不是完整的 `rgb()` 值。**

例如：
```css
--color-accent: 86 74 191;  /* NOT rgb(86, 74, 191) */
```

這是 Tailwind CSS alpha-value 慣例，讓 Tailwind 可以動態注入透明度：
```css
/* Tailwind 會這樣展開： */
background-color: rgb(var(--color-accent) / 0.5);  /* 50% 透明 */
```

### 使用規則

| 情況 | 正確寫法 | 錯誤寫法 |
|------|---------|---------|
| Tailwind class（最優先）| `bg-accent`, `from-accent`, `text-accent` | — |
| CSS-in-JS inline style | `rgb(var(--color-accent))` | `var(--color-accent)` |
| CSS property | `rgb(var(--color-accent))` | `var(--color-accent)` |

**NEVER use `var(--color-x)` directly in inline styles or CSS `background:` properties** — `86 74 191` is not valid CSS color syntax, the entire style declaration will be ignored by the browser.

### 反例（GamificationHero.tsx — 已修復）

```tsx
// BEFORE (broken): var(--color-accent) outputs "86 74 191" — invalid in gradient
style={{ background: 'linear-gradient(135deg, var(--color-accent, #5b7fff) 0%, #7c5cbf 100%)' }}

// AFTER (fixed): use Tailwind class only; inline style removed
className="bg-gradient-to-br from-accent to-accent/80"
```

瀏覽器遇到 `linear-gradient(135deg, 86 74 191 0%, ...)` 時，整條 `style` 宣告失效，fallback 到 `#5b7fff`（藍色），與設計意圖的深紫 `#564ABF` 不符，造成 hero banner 顯示錯誤色。

## Spacing
- **Base unit:** 4px
- **Density:**
  - 學生端: spacious（閱讀舒適、觸控友善）
  - 教師端: comfortable（資料密度適中）

| Token | Value | Usage |
|-------|-------|-------|
| `2xs` | 2px | 微距 |
| `xs` | 4px | 圖示間距 |
| `sm` | 8px | 元素內間距 |
| `md` | 16px | 區塊內間距 |
| `lg` | 24px | 區塊間距 |
| `xl` | 32px | Section 間距 |
| `2xl` | 48px | 大區塊間距 |
| `3xl` | 64px | Page section 間距 |

## Layout
- **Approach:** Hybrid — 學生端創意排版 + 教師端 grid-disciplined
- **Grid:**
  - Mobile (375px~767px): 1 column, 16px gutter
  - Tablet (768px~1023px): 2 columns, 24px gutter
  - Desktop (1024px+): sidebar(220px) + main content
- **Max content width:** 1280px (student dashboard: max-w-4xl = 896px for reading comfort)
- **Border radius:**

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | 4px | 小元素（badge、tag）|
| `md` | 8px | 按鈕、輸入框 |
| `lg` | 12px | 卡片 |
| `xl` | 16px | Modal、大卡片 |
| `2xl` | 24px | Hero 卡片（學生端 rounded-3xl）|
| `full` | 9999px | 頭像、圓形按鈕、pill badge |

**Custom shadows:**
- `shadow-card`: `0 0 32px rgba(136,152,170,0.12)` — 輕量卡片浮起感
- `shadow-editorial`: `0 12px 48px rgba(48,47,42,0.06)` — 內容區塊精緻陰影

## Motion
- **Approach:** Minimal-Functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:**

| Token | Value | Usage |
|-------|-------|-------|
| `micro` | 75ms | Hover 狀態 |
| `short` | 150ms | 按鈕回饋、tooltip |
| `medium` | 250ms | 頁面轉場、tab 切換 |
| `long` | 400ms | Modal 開關、sidebar 展開 |

- **Named animations** (defined in tailwind.config.js + index.css):
  - `animate-shake` (0.45s) — 輸入錯誤搖晃
  - `animate-pop` (0.35s spring) — XP 通知彈出
  - `animate-slide-up` / `animate-slide-up-fast` — 內容進場
  - `animate-card-in` — 卡片載入
  - `animate-fade-in` — 通用淡入
  - `animate-toast-in` — Toast 通知
  - `animate-confetti-drop-{1-3}` — 成就解鎖慶祝
  - `animate-star-burst` — 星星評分爆發

- **特殊動畫:**
  - 成就解鎖: 300ms 彈出 + confetti 粒子效果
  - 學習完成: 煙火/星星慶祝動畫（500ms）
  - 錄音中: 波形動畫（持續）
  - 不做：滾動視差、入場動畫、loading skeleton shimmer

## Component Patterns

### Button Hierarchy

Prefer the utility classes defined in `index.css @layer components`:

| Class | Usage | Style |
|-------|-------|-------|
| `.btn-primary` | 主要動作（開始朗讀、登入）| `bg-accent` 圓角 pill，白字 |
| `.btn-secondary` | 次要動作（取消、查看）| 白底灰框，灰字 |
| `.btn-immersive` | 沈浸模式主 CTA（56px min-height）| 線性漸層 `#564ABF → #4A3CB2`，pill |
| `.btn-encourage` | 鼓勵重試（非破壞性修正）| `#994100` 橙棕，白字 |

Ad-hoc Tailwind variants（未定義 class 時）:
1. **Primary:** `bg-accent text-white rounded-full px-6 py-2.5`
2. **Outline:** `border border-accent text-accent rounded-full`
3. **Ghost:** `text-accent hover:bg-accent/10 rounded-full`
4. **Danger:** `bg-error text-white rounded-full` — 破壞性動作（刪除）only

### Card Pattern
- `bg-surface-container-lowest rounded-3xl shadow-editorial` — 學生端 hero 卡
- `bg-surface-container-lowest rounded-2xl shadow-editorial` — 標準動作卡
- hover: `hover:scale-[0.99] active:scale-[0.98] transition-all` — 微縮互動回饋
- padding: `p-5` (mobile), `p-6` (desktop large card)

### Glassmorphism
`.glass` utility: `rgba(251,246,238,0.7)` + `backdrop-filter: blur(20px)` — 用於浮層、sticky header

### Empty State Pattern
- 居中 illustration（不用 generic icon）
- 溫暖的文案（「還沒有作業，等老師指派吧」而非「沒有資料」）
- 明確的 CTA（如果學生可以主動做什麼）

### Error State Pattern
- 友善語氣（「出了點問題」而非「Error 500」）
- 具體說明可以做什麼（重試按鈕）
- 錯誤 ID 顯示在底部小字（方便回報）

## Student vs Teacher Design Differences

| 面向 | 學生端 | 教師端 |
|------|--------|--------|
| 字體大小 | 可調整，預設較大（20px）| 固定 16px |
| 間距 | Spacious (p-5~p-6) | Comfortable (p-4) |
| 觸控目標 | 48px minimum | 44px minimum |
| 色彩使用 | 多用 accent + tertiary（鼓勵感）| 多用 accent（專業感）|
| 導航 | 底部 tab bar (mobile) + sidebar (desktop) | Sidebar |
| 資料密度 | 低（一次顯示少量資訊）| 高（表格、熱力圖）|
| 語氣 | 「太棒了！你進步了」| 「小明本週練習 3 次」|
| 卡片圓角 | rounded-3xl (24px) | rounded-xl (16px) |

## Accessibility
- **Contrast:** 所有文字 ≥ 4.5:1 (WCAG AA). `accent` (#564ABF) on white = 4.7:1 ✓
- **Touch targets:** ≥ 44px (教師), ≥ 48px (學生)
- **Focus visible:** `2px solid rgb(var(--color-accent))`, `outline-offset: 2px`, `border-radius: 4px` — defined in `index.css :focus-visible`
- **Keyboard:** 所有互動元素可 Tab 導航
- **Screen reader:** 所有圖示需 `aria-label` 或 `aria-hidden="true"` + sibling 文字
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` 停用所有動畫 — defined in `index.css`
- **Form inputs:** 強制 `text-gray-900 bg-white`（防止 Chrome Windows dark mode 導致透明文字）

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-18 | Initial design system | /design-consultation based on QA screenshots + product context |
| 2026-03-18 | 紫藍 Primary (#5B4FC4) | 區隔藍色教育 app（均一、PRIORI），暗示 AI 智慧 |
| 2026-03-18 | 琥珀 Secondary (#F59E42) | 「溫暖但堅定」品牌人格，鼓勵感像陽光而非考試通過 |
| 2026-03-18 | 暖米色背景 (#FDF8F0) | 對兒童眼睛友善，避免純白刺眼 |
| 2026-03-18 | Noto Sans TC | 繁體中文最佳支援，教育情境標準選擇 |
| 2026-03-18 | 學生/教師雙軌設計 | 不同用戶需要不同資訊密度和互動模式 |
| 2026-04-20 | DESIGN.md resync to match code | Code adopted Stitch Tactile Scholar palette since ~3/18 but docs lagged: accent shifted to #564ABF, secondary token removed, success became forest green #006947, tertiary orange #994100 added, surface upgraded to 5-step M3 system, font stack expanded to 4 families |
| 2026-04-20 | CSS Variable Convention section added | GamificationHero used `var(--color-accent)` in inline style → outputs RGB triplet "86 74 191" → invalid CSS gradient → browser ignored style → wrong color rendered. All inline color usage must wrap in `rgb()` or prefer Tailwind class |
| 2026-04-20 | 修正回饋色從 error 紅改為 tertiary 橙 | 「讀錯」不等於「系統錯誤」，鼓勵語氣要溫暖，不要嚇到學生 |
