# 數位讀寫網 UI/UX 設計分析 — LingoLeap 改善參考

> 研究日期：2026-04-02
> 目的：記錄數位讀寫網的視覺設計細節，找出 LingoLeap 可以學習改善的方向

---

## 一、數位讀寫網設計系統（從 CSS 實測提取）

### 1.1 字體

| 用途 | 字體 | 特色 |
|------|------|------|
| 主字體 | **cwTeXYen**（粗圓體） | 台灣在地開源字體，圓潤可愛，兒童友善 |
| 備援 | Roboto → Helvetica → Noto Sans TC → sans-serif | 多平台覆蓋 |
| 輔助 | Open Sans（英文內容） | 易讀的無襯線英文字體 |

**重點**：他們用「粗圓體」當主字體，不是標準的黑體或明體。這讓整個平台看起來**溫暖、親切、不像考試**

### 1.2 字級

| 用途 | 大小 | 說明 |
|------|------|------|
| body | 16px | 基本字級 |
| h2 | 18px | 標題，但不會太大 |
| 副標題/強調 | 20px | |
| 大標題 | 30px | 區塊標題 |
| Hero 標題 | 36px | 首頁主視覺 |
| 小字/說明 | 14px | 日期、輔助文字 |
| 按鈕 | 14px (0.875rem) | 按鈕文字偏小但 bold |
| 行高 | 1.6 (25.6px) | 比我們的更大，閱讀更舒服 |

### 1.3 色彩系統

| 角色 | 色碼 | 用途 |
|------|------|------|
| 背景（主） | `#FCF9F3` (rgb 252,249,243) | **米色暖底**，不是純白。眼睛舒服 |
| 背景（灰區） | `#EEEEEE` | 區塊分隔 |
| 品牌色 | `#46A1A3` (rgb 70,161,163) | **青綠色** — footer、重點連結 |
| 文字（主） | `#2D2D2D` | 深灰不是純黑，閱讀更柔和 |
| 文字（連結） | `#1D1D1F` | |
| 文字（次） | `#67748E` | 按鈕預設文字色，灰藍 |
| 文字（輔助） | `#A1A1A1` | 日期等低優先資訊 |
| 強調 | `#D13521` | 紅色，極少量使用 |
| 卡片背景 | `#FFFFFF` | 白卡 |

**三區配色（PP/DP/EP Banner）**：
- PP 基礎讀寫：**橘色系**放射狀背景
- DP 深度讀寫：**綠色系**放射狀背景
- EP 線上探究：**藍色系**放射狀背景

每個模組有自己的主題色，視覺識別度很高

### 1.4 圓角與陰影

| 元素 | 圓角 | 陰影 |
|------|------|------|
| 卡片 | **16px (1rem)** | `0 0 32px rgba(136,152,170,0.15)` — 非常淡的大範圍陰影 |
| 按鈕 | **30px (1.875rem)** | 全圓角膠囊型 |
| navbar | 0px | 底部 `0 2px 12px rgba(0,0,0,0.16)` 微陰影 |

**重點**：卡片陰影非常淡（opacity 0.15），模糊範圍大（32px），看起來像「漂浮」而不是「貼邊」

### 1.5 間距與排版

- Navbar 高度：90px，上下 padding 16px
- 卡片內部：無 padding（圖片滿版），底部 card-body 有 padding
- 按鈕：padding `10px 20px`（小而精緻）
- 全域行高：1.6 倍（body line-height: 25.6px on 16px base）
- 卡片之間 gap：Bootstrap grid gutter（~24px）

### 1.6 互動

- 圖片 hover zoom：`transform: scale(1.5)` + `transition: 0.3s ease-in-out`
- 按鈕：`transition: all 0.15s ease-in`（快速反應）
- cursor: pointer 的元素有明確的互動提示

---

## 二、LingoLeap vs 數位讀寫網 — UI 差異對比

### 2.1 字體

| | LingoLeap | 數位讀寫網 | 差距 |
|--|-----------|-----------|------|
| 中文主字體 | Iansui（手寫風） | cwTeXYen（粗圓體） | 我們的字體在課文閱讀場景適合，但 UI 元素用手寫字體偏隨性 |
| 英文字體 | Noto Sans TC fallback | Open Sans / Roboto | 差不多 |
| 行高 | 多處 leading-relaxed（1.625）| 1.6 | 接近，但我們有些地方行高不統一 |
| 字重 | 大量使用 font-black（900） | font-weight: 700 居多 | 我們太多 900 weight，視覺太重 |

### 2.2 色彩

| | LingoLeap | 數位讀寫網 | 差距 |
|--|-----------|-----------|------|
| 背景 | `bg-amber-50` (#FFFBEB) | `#FCF9F3` | 兩者都是暖底，但我們偏黃，他們偏米 |
| 品牌色 | accent (紫色系 #4A3FA3) | 青綠色 #46A1A3 | 我們的紫色偏「科技感」，他們偏「自然溫暖」 |
| 文字 | `text-gray-800` (#1F2937) | `#2D2D2D` | 接近 |
| 按鈕 | 全色填充按鈕居多 | outline 按鈕 + 膠囊圓角 | 我們按鈕太多，太重 |

### 2.3 元件風格

| 元素 | LingoLeap | 數位讀寫網 | 建議 |
|------|-----------|-----------|------|
| 卡片圓角 | rounded-2xl (16px) | 16px (1rem) | **一樣**，OK |
| 卡片陰影 | border + shadow-sm | 32px 超淡陰影 | **他們更輕盈**，我們 border 太明顯 |
| 按鈕圓角 | rounded-xl (12px) | **30px 全圓** | 他們膠囊按鈕更活潑 |
| 按鈕字級 | text-base (16px) | 14px + bold | 我們按鈕文字太大 |
| Navbar | h-9 (36px) 偏矮 | 90px 高，寬敞 | 他們的 navbar 更有呼吸空間 |

### 2.4 最關鍵的差異：「溫度感」

數位讀寫網做到的：
1. **字體選擇**：cwTeXYen 粗圓體天生就「可愛」，適合小學生
2. **色彩溫度**：米色底 + 青綠色品牌，像在看紙本繪本
3. **模組識別**：PP/DP/EP 三個大色塊卡片，放射狀背景圖案像漫畫風格
4. **視覺密度低**：首頁就三張卡 + 三則新聞 + footer，不擁擠
5. **陰影極淡**：卡片「漂浮」在背景上，不是被框住

LingoLeap 的問題：
1. **太多 UI 元素同時在螢幕上** — IDE 風格左右分割面板，視覺壓迫
2. **font-black (900) 過度使用** — 每個標題、每個按鈕都很粗，缺乏層次
3. **按鈕太多太重** — 很多全色填充按鈕，視覺噪音
4. **缺乏插圖/圖案** — 純文字 + 色塊，沒有手繪風或趣味元素
5. **色彩轉換太硬** — accent 紫色直接跳到 emerald 綠，沒有過渡

---

## 三、具體改善建議

### 3.1 立即可做（不改架構）

| 改動 | 做法 | 影響 |
|------|------|------|
| 降低 font-weight | 標題用 700 (bold) 取代 900 (black)，只保留 KPI 數字用 900 | 減少視覺壓力 |
| 按鈕改膠囊 | `rounded-full` 取代 `rounded-xl` | 更活潑 |
| 減淡卡片邊框 | 用 `shadow-md` 取代 `border + shadow-sm` | 更輕盈 |
| 行高統一 | 全域確認 body line-height: 1.6 | 閱讀舒適 |
| 按鈕字級 | 從 text-base (16px) 降到 text-sm (14px) + font-bold | 精緻感 |

### 3.2 中期改善（需設計思考）

| 改動 | 做法 | 影響 |
|------|------|------|
| 加入 UI 字體 | 課文用 Iansui 不變，UI 元素（navbar、按鈕、label）改用 Noto Sans TC 或類似的圓體 | UI 更專業但不失親和 |
| 模組色彩識別 | 每個學習步驟（朗讀、理解、生字）有自己的主題色區塊 | 類似 PP/DP/EP 的視覺識別 |
| 趣味插圖 | 加入手繪風 SVG 插圖在關鍵頁面（課文選擇、報告頁） | 學生端更有「想用」的感覺 |
| 首頁重設計 | 減少首頁資訊量，用大色塊卡片導向主要功能 | 降低認知負擔 |

### 3.3 設計原則提煉

從數位讀寫網學到的兒童教育平台設計原則：

1. **字體要圓** — 圓角字體降低「考試感」，提升「遊戲感」
2. **背景不要純白** — 米色/奶油色底減少螢幕刺激
3. **陰影要淡要大** — 0.15 opacity + 32px blur，飄浮感
4. **按鈕要圓** — 膠囊型按鈕 (border-radius: 30px) 比方角按鈕更親近
5. **每屏資訊量少** — 首頁就三個大入口，不要塞 10 個功能
6. **模組有自己的色彩** — 讓學生一眼認出自己在做什麼
7. **font-weight 層次分明** — 不是所有東西都要最粗，700 和 400 交替使用
8. **留白就是設計** — navbar 90px 高，卡片之間 24px gap，不要塞滿

---

## 四、截圖記錄

| 頁面 | 檔案 | 說明 |
|------|------|------|
| 首頁 | `/tmp/eliteracy-home-wide.png` | 1440px 寬首頁全覽 |
| 首頁（清理版） | `/tmp/eliteracy-full.png` | 移除 cookie banner 等干擾 |
| PP/DP 內頁 | 空白（需登入） | SPA 登入牆後才有內容 |

---

## 五、CSS 設計 Token 完整列表

```css
/* 數位讀寫網 Design Tokens (實測提取) */

/* Typography */
--font-primary: cwTeXYen, Roboto, Helvetica, "Noto Sans TC", sans-serif;
--font-secondary: "Open Sans", sans-serif;
--font-size-base: 16px;
--font-size-sm: 14px;
--font-size-lg: 18px;
--font-size-xl: 20px;
--font-size-2xl: 30px;
--font-size-3xl: 36px;
--line-height-base: 1.6;
--font-weight-normal: 400;
--font-weight-bold: 700;

/* Colors */
--color-bg-primary: #FCF9F3;      /* 米色暖底 */
--color-bg-secondary: #EEEEEE;    /* 灰區 */
--color-bg-card: #FFFFFF;
--color-brand: #46A1A3;           /* 青綠色 */
--color-text-primary: #2D2D2D;
--color-text-secondary: #67748E;
--color-text-muted: #A1A1A1;
--color-text-link: #1D1D1F;
--color-accent-red: #D13521;
--color-btn-outline: #8392AB;

/* Spacing */
--navbar-height: 90px;
--navbar-padding: 16px;
--btn-padding: 10px 20px;
--card-gap: 24px;

/* Radius */
--radius-card: 16px;
--radius-btn: 30px;
--radius-sm: 8px;

/* Shadows */
--shadow-card: 0 0 32px rgba(136, 152, 170, 0.15);
--shadow-navbar: 0 2px 12px rgba(0, 0, 0, 0.16);

/* Transitions */
--transition-btn: all 0.15s ease-in;
--transition-zoom: transform 0.3s ease-in-out;

/* Module Theme Colors (Banner) */
--color-pp: #E8773A;  /* 橘色系 - 基礎讀寫 */
--color-dp: #3A8B5C;  /* 綠色系 - 深度讀寫 */
--color-ep: #3A6B9B;  /* 藍色系 - 線上探究 */
```
