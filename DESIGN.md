# Design System — LingoLeap 國語文閱讀學習平台

## Product Context
- **What this is:** AI 朗讀教學工具，協助國小教師與學生提升閱讀流暢度
- **Who it's for:** 國小高年級～國中生（主要）、教師（管理）、家長（查看）
- **Space/industry:** 台灣 K-12 閱讀教育，對標 PRIORI/均一/品學堂
- **Project type:** Education SaaS web app（React 19 + Vite + Tailwind）
- **Brand personality:** 溫暖但堅定的蘇格拉底助教 — 鼓勵但不放水

## Aesthetic Direction
- **Direction:** Warm Educational — Playful/Approachable + Industrial/Utilitarian 混合
- **Decoration level:** Intentional（微妙圓角和色彩層次，不過度裝飾）
- **Mood:** 像「好的兒童書店」— 有溫度但不幼稚，專業但不冰冷
- **Anti-patterns:** 不要卡通風、不要過多 emoji 裝飾、不要 generic AI dashboard 風格

## Typography
- **Display/Hero:** Noto Sans TC Bold — 繁體中文最佳支援，Google Fonts 原生
- **Body:** Noto Sans TC Regular — 閱讀舒適，中文排版最佳化
- **UI/Labels:** Noto Sans TC Medium
- **Data/Tables:** Noto Sans TC (font-feature-settings: 'tnum') — 數字對齊
- **Zhuyin/注音:** BpmfIansui（自訂字型，已整合）
- **Loading:** Google Fonts `<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap">`
- **Scale:**

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| xs | 12px | 400 | 輔助文字、標籤 |
| sm | 14px | 400 | 次要內容、表格 |
| base | 16px | 400 | 正文 |
| lg | 18px | 500 | 小標題 |
| xl | 20px | 500 | 區塊標題 |
| 2xl | 24px | 700 | 頁面標題 |
| 3xl | 30px | 700 | Hero 標題 |
| 4xl | 36px | 700 | Landing page |
| 5xl | 48px | 700 | 特大展示 |

### 學生端文字大小
學生可調整閱讀字體大小（小/中/大），預設為「中」(20px)。課文朗讀區域用較大字體 + 1.8 行高，確保注音不互相疊加

## Color

### Approach: Balanced — 溫暖色系

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | `#5B4FC4` | 主要 CTA、導航、品牌色（紫藍 — 智慧、AI 感）|
| `primary-light` | `#7C6FD9` | Primary hover |
| `primary-dark` | `#4A3FA3` | Primary active |
| `secondary` | `#F59E42` | 鼓勵、成就、XP、進步指標（琥珀 — 溫暖陽光）|
| `secondary-light` | `#F7B76B` | Secondary hover |
| `bg` | `#FDF8F0` | 頁面背景（暖米色，對眼睛友善）|
| `surface` | `#FFFFFF` | 卡片、Modal、表單區域 |
| `surface-alt` | `#F9F5ED` | 交替行、次要區塊 |
| `text-primary` | `#1A1A2E` | 主要文字（深藍黑，不用純黑）|
| `text-secondary` | `#6B7280` | 次要文字、placeholder |
| `text-muted` | `#9CA3AF` | 輔助提示 |
| `border` | `#E5E0D5` | 邊框（暖灰）|
| `success` | `#22C55E` | 達標、正確答案 |
| `warning` | `#F59E42` | 注意、接近達標（與 secondary 同色）|
| `error` | `#EF4444` | 錯誤、朗讀差異標記、未達標 |
| `info` | `#3B82F6` | 提示資訊 |

### 朗讀差異比對色彩
| 類型 | 色碼 | 用途 |
|------|------|------|
| 正確 | `#22C55E` bg 10% | 讀對的字（淡綠底）|
| 讀錯 | `#EF4444` bg 15% | 讀錯的字（淡紅底 + 紅字）|
| 漏讀 | `#F59E42` bg 15% | 漏掉的字（淡橘底 + 橘字）|
| 多讀 | `#3B82F6` bg 10% | 多讀的字（淡藍底）|

### Dark Mode
暫不實作。Phase 6+ 考慮（#410）

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
- **Max content width:** 1280px
- **Border radius:**

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | 4px | 小元素（badge、tag）|
| `md` | 8px | 按鈕、輸入框 |
| `lg` | 12px | 卡片 |
| `xl` | 16px | Modal、大卡片 |
| `full` | 9999px | 頭像、圓形按鈕 |

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

- **特殊動畫:**
  - 成就解鎖: 300ms 彈出 + 金色粒子效果
  - 學習完成: 煙火/星星慶祝動畫（500ms）
  - 錄音中: 波形動畫（持續）
  - 不做：滾動視差、入場動畫、loading skeleton shimmer

## Component Patterns

### Button Hierarchy
1. **Primary:** bg-primary text-white rounded-md px-6 py-3 — 主要動作（開始朗讀、登入）
2. **Secondary:** bg-secondary text-white rounded-md — 次要動作（查看報告）
3. **Outline:** border-primary text-primary rounded-md — 輔助動作
4. **Ghost:** text-primary hover:bg-primary/10 — 低權重動作（返回、取消）
5. **Danger:** bg-error text-white — 破壞性動作（刪除）

### Card Pattern
- bg-surface rounded-lg shadow-sm border border-border
- hover: shadow-md transition-shadow duration-short
- padding: md (16px) on mobile, lg (24px) on desktop

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
| 間距 | Spacious (lg padding) | Comfortable (md padding) |
| 觸控目標 | 48px minimum | 44px minimum |
| 色彩使用 | 多用 secondary（鼓勵色）| 多用 primary（專業色）|
| 導航 | 底部 tab bar (mobile) | Sidebar |
| 資料密度 | 低（一次顯示少量資訊）| 高（表格、熱力圖）|
| 語氣 | 「太棒了！你進步了」| 「小明本週練習 3 次」|

## Accessibility
- **Contrast:** 所有文字 ≥ 4.5:1 (WCAG AA)
- **Touch targets:** ≥ 44px (教師), ≥ 48px (學生)
- **Focus visible:** 2px solid primary, 2px offset
- **Keyboard:** 所有互動元素可 Tab 導航
- **Screen reader:** 所有圖示需 aria-label
- **Reduced motion:** @media (prefers-reduced-motion: reduce) 停用所有動畫

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-18 | Initial design system | /design-consultation based on QA screenshots + product context |
| 2026-03-18 | 紫藍 Primary (#5B4FC4) | 區隔藍色教育 app（均一、PRIORI），暗示 AI 智慧 |
| 2026-03-18 | 琥珀 Secondary (#F59E42) | 「溫暖但堅定」品牌人格，鼓勵感像陽光而非考試通過 |
| 2026-03-18 | 暖米色背景 (#FDF8F0) | 對兒童眼睛友善，避免純白刺眼 |
| 2026-03-18 | Noto Sans TC | 繁體中文最佳支援，教育情境標準選擇 |
| 2026-03-18 | 學生/教師雙軌設計 | 不同用戶需要不同資訊密度和互動模式 |
