# 字體顏色 + 對比度研究（近視兒童閱讀友善設計）

**Refs**: #1358
**作者**: Young
**日期**: 2026-05-01
**狀態**: 研究階段（pre-implementation）— 待陳教授 / 方大哥 review 後再決定是否動 design token

---

## 0. TL;DR（給沒空看完整篇的人）

**三個關鍵發現**：

1. **平台主課文區（surface 系統）已經做對了** — `text-on-surface` `#302F2A` on `#FBF6EE`（cream）的設計遵循 British Dyslexia Association（BDA）「dark-not-black on light-not-white」原則，對比度 12.47:1，**通過 WCAG AAA**（門檻 7:1）。不要動。
2. **平台局部仍用 `text-gray-900` / `bg-white`** — `Intro.tsx`、`RadicalDecomposition.tsx`、`StrategyExercise.tsx`、`ComprehensionScoreCard.tsx` 等檔案繞過 design system 直接用 Tailwind 預設灰階 + 純白底，**對比度過高（17.7:1）**，違反 BDA 對近視/dyslexia 兒童的建議。這是真正要修的問題。
3. **注音 ruby 用 `text-on-surface-variant` `#5E5B55`，對比度 6.29:1，未過 AAA**（過 AA）。注音字體更小，依 WCAG SC 1.4.6 應該過 AAA 才夠。建議換 `#4A4641`（8.7:1）。

**推薦方案**：
- **主推（Candidate A）**：保留現有 `text-on-surface` `#302F2A` on `#FBF6EE` — 不改主課文區
- **要動的是「修補違規區塊」**：把 `Intro.tsx` 等檔案的 `text-gray-900`/`bg-white` 改成 design token
- **注音 ruby 微調**：`text-on-surface-variant` 從 `#5E5B55` → `#4A4641`
- **新增「難字標記色」**：建議 `#7C2D12`（深棕橘）on cream，對比 8.71:1，過 AAA

不需要重新設計整個色票，主要是「補洞 + 微調」。

---

## 1. Phase 1：學術 / 業界研究

### 1.1 WCAG 2.2 對比度官方規範

來源：[Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) · [WAI Understanding SC 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)

| Level | Normal text | Large text |
|-------|-------------|------------|
| **AA**（SC 1.4.3）| **4.5:1** | 3:1 |
| **AAA**（SC 1.4.6）| **7:1** | 4.5:1 |

**WCAG 對「Normal / Large」的定義**：Large = 18pt（24px）or 14pt bold（18.66px）以上，其餘為 Normal。

**為何選 4.5:1 / 7:1**：
- 4.5:1 補償約 20/40 視力的對比敏感度損失
- 7:1 補償約 20/80 視力的對比敏感度損失（AAA）

**對 LingoLeap 的意義**：
- 主課文區 18-24px 視為 Large text → AA 門檻只要 3:1
- 但學生 10-15 歲多有近視，按 BDA 建議 + AAA 安全邊際，**全平台目標應為 AAA（7:1）**
- 注音 ruby 約 11-13px → Normal text → 必須過 AAA

### 1.2 British Dyslexia Association (BDA) Style Guide 2023

來源：[BDA Dyslexia Style Guide 2023 (PDF)](https://cdn.bdadyslexia.org.uk/uploads/documents/Advice/style-guide/BDA-Style-Guide-2023.pdf) · [Dyslexia Scotland — what colours are best for accessibility](https://dyslexiascotland.org.uk/contrasting-advice-what-colours-are-best-for-accessibility/) · [Cardiff University — colour and contrast inclusively](https://blogs.cardiff.ac.uk/LTAcademy/not-just-pretty-colours-using-colour-and-contrast-inclusively/)

**BDA 三條核心建議**：

1. **避免純白背景**（"avoid white backgrounds for paper, computer and visual aids"）
   - 純白會「dazzling」（刺眼） → 用 cream 或柔和 pastel
   - 這對 dyslexia 兒童尤其重要（有 visual stress / Meares-Irlen syndrome 傾向時，純白 + 純黑會出現「字在跳動」感受）

2. **避免純黑文字**（"dark, but not black"）
   - 太強對比 → 瞳孔需要更頻繁調整 → 視覺疲勞
   - 建議深炭灰 / 深棕（dark gray / dark brown）

3. **個體差異存在** — 部分 dyslexia 學生有偏好色（如綠紙、藍紙、淺粉紙）
   - 平台層面提供 default cream 即可
   - 進階：未來可考慮 colour overlay 切換功能（low priority）

> 注意：BDA Style Guide 不給具體 hex 值（"cream" 是描述性的），但業界共識 cream ≈ `#FBF6EE` ~ `#FFF8DC` 範圍

### 1.3 對比度極性與近視（Contrast Polarity & Myopia）

來源：[Reading and Myopia: Contrast Polarity Matters (Nature Scientific Reports, 2018)](https://www.nature.com/articles/s41598-018-28904-x) · [PMC 全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC6052140/)

**這是最關鍵的兒童近視 + 閱讀色彩研究**。Aleman et al. 2018 發現：

- **黑字白底（positive polarity）**：閱讀 1 小時後脈絡膜（choroid）變薄約 **16 微米** → 與近視發展相關
- **白字黑底（negative polarity）**：脈絡膜增厚約 **10 微米** → 與近視抑制相關
- **機制**：黑字過度刺激視網膜 OFF pathways；白字過度刺激 ON pathways。長時間單向刺激 → 眼軸調整 → 近視風險

**對 LingoLeap 的意義（謹慎解讀）**：
- 研究**沒有**直接比較「黑底白字」vs「深灰底淺米字」vs「深字米底」
- 也**沒有**對兒童族群做流行病學驗證（作者明確說 "needs to be done in children in the future"）
- 但已可推論：**降低對比度極性的單向刺激**是合理的方向 → BDA 的「dark-not-black on cream-not-white」剛好降低極性
- **不建議**全平台改用「白字深底」(dark mode)：
  - 教育場景常需手寫筆記 / 紙本配合 → mode mismatch
  - 兒童端螢幕已偏久看，dark mode 對長文閱讀的反射光減少對眼睛幫助有限
  - 折衷：「深炭灰字 + cream 底」是現有最佳實務

### 1.4 視覺疲勞與螢幕色彩

來源：[Effect of Display Color Mode and Luminance Contrast on Visual Fatigue (ResearchGate)](https://www.researchgate.net/publication/349602864_Study_on_the_Effects_of_Display_Color_Mode_and_Luminance_Contrast_on_Visual_Fatigue) · [PMC: Effect of Ambient Illumination and Text Color on Visual Fatigue under Negative Polarity](https://pmc.ncbi.nlm.nih.gov/articles/PMC11175232/) · [PMC: A Study on the Design of Vision Protection Products for Children's Visual Fatigue under Online Learning](https://pmc.ncbi.nlm.nih.gov/articles/PMC9024956/)

**關鍵發現**：

- **低對比 ≠ 不疲勞**：對比度太低（< AA 4.5:1）反而讓瞳孔需要放大才看清楚 → 加劇疲勞
- **紅色字最累、黃色字最不累**（純色比較）；但實務中文字仍以深色為主流
- **環境光對 negative polarity（暗模式）影響大**：環境亮 + 暗模式 → 眼睛要適應反差，疲勞增加
- **兒童在線學習視覺疲勞**：建議降低螢幕色溫、避免極端對比、字體不可過小（與 #1351 字體研究互補）

**對 LingoLeap 的意義**：
- 不能為了「降對比」走偏 → AA 4.5:1 是底線
- 主課文 AAA（7:1）是甜蜜點：足夠清晰 + 不過度刺激
- 環境光：平台無法控制，但 cream 底比純白底「對環境光更寬容」（白底反光最強）

### 1.5 中文 / 漢字閱讀 + 兒童族群

來源：[Effects of Font Size, Stroke Width, and Character Complexity on Legibility of Chinese Characters (Wiley, 2016)](https://onlinelibrary.wiley.com/doi/abs/10.1002/hfm.20663) · [Perceptual expertise with Chinese characters predicts reading performance among Hong Kong children with dyslexia (PLOS One)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0243440) · [Research on legibility of Chinese display character sizes in virtual environments (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S0141938223002238)

**關鍵發現**：

- 漢字 legibility 主要受 **筆劃寬度（stroke width）+ 字體大小 + 字型** 影響，**色彩不是主要變因**
  - 言外之意：對中文兒童族群，色彩問題比西文 dyslexia 文獻可能更輕（西文是字母形狀混淆，中文是「糊在一起」）
  - 但 5/1 專家會議提的「黑體糊在一起」=「過粗 + 太黑」雙重作用 → 換非黑體 + 降對比應有疊加效果
- **沒有**找到專門研究「中文 dark gray vs pure black 對兒童近視 / dyslexia 閱讀疲勞」的論文
  - 這是 gap，無法直接引用
  - 折衷：以 BDA + Aleman 2018 的西文研究外推到中文，輔以「不增加風險」原則（cream 底 + dark-not-black 字本來就更保守）

### 1.6 教育平台先例

| 平台 | 主課文背景 | 主課文字色 | 來源 |
|------|----------|----------|------|
| Singapore Student Learning Space (SLS) | 預設白底 | 深灰字 | [Accessify SLS audit](https://accessify.com/m/learning.moe.edu.sg) — accessibility audit 指出 contrast 不足，反例 |
| Khan Academy | 白底 | 黑字 #21242C | 直接打開 khanacademy.org 觀察（無官方 design system 公開） |
| 均一教育平台 (Junyi) | 白底 | 黑字 | [均一官網](https://www.junyiacademy.org/) — 無公開 design system，視覺與 KA 接近 |
| BBC Bitesize | 淺米/灰底 | 深字 | BBC 官方 GEL design system（公開） |
| Reading Eggs (兒童閱讀 SaaS) | 米黃底 | 深棕字 | 直接觀察產品截圖 |

**結論**：
- 主流華文教育平台多沿用「白底黑字」這也是 SLS / Junyi 的問題所在
- 真正做 dyslexia/accessibility 嚴肅的平台（BBC Bitesize、Reading Eggs）都採用 cream/米色 + 深字
- **LingoLeap 採用 `#FBF6EE` cream 底 + `#302F2A` 深炭灰已是行業 best practice**，超越多數華文平台

### 1.7 文獻 gap 摘要

| 主題 | 是否有直接證據 | 處理方式 |
|------|--------------|---------|
| WCAG 對比度門檻（4.5/7）| ✅ 有 | 直接套用 |
| Cream + dark-not-black（西文）| ✅ BDA 2023 | 直接套用 |
| 黑字白底加重近視（西文兒童）| ✅ Aleman 2018 | 引用，但避免過度延伸到中文 |
| 中文 + 兒童 + 色彩 + 近視 | ❌ 無直接論文 | 標註 gap，採取「保守 + 不增風險」原則 |
| 注音 ruby 顏色 | ❌ 無研究 | 用 WCAG SC 1.4.6（小字 AAA）+ 視覺層級邏輯 |

---

## 2. Phase 2：平台現況 audit

### 2.1 Design system tokens（`frontend/tailwind.config.js` + `frontend/src/index.css`）

平台採用 Material Design 3 衍生的「surface tone」系統：

```js
// tailwind.config.js
colors: {
  surface: {
    DEFAULT: '#FBF6EE',          // cream 底（主要閱讀區）
    bright: '#FBF6EE',
    dim: '#D9D4CA',
    'container-lowest': '#FFFFFF',
    'container-low':    '#F5F0E8',
    'container':        '#ECE8DF',
    'container-high':   '#E7E2D8',
    'container-highest': '#E1DCD2',
  },
  'on-surface': {
    DEFAULT: '#302F2A',          // 深炭灰（主文字）
    variant: '#5E5B55',          // 中灰（次要文字）
  },
  tertiary: {
    DEFAULT: '#994100',          // 鼓勵橘（修正回饋用）
    dim: '#863800',
    container: '#FF955A',
  },
}
```

**評語**：surface system 設計很嚴謹，**完全符合 BDA 建議**。問題在於不是所有 component 都用 token。

### 2.2 對比度計算結果（用 WCAG relative luminance 公式實算）

公式：`(L_lighter + 0.05) / (L_darker + 0.05)`，其中 L = 0.2126·R + 0.7152·G + 0.0722·B（gamma corrected）

| 組合 | fg | bg | 對比 | AA (4.5) | AAA (7) | 評語 |
|------|----|----|------|----------|---------|------|
| **正確使用 design token（保留）** | | | | | | |
| `text-on-surface` on `surface` | `#302F2A` | `#FBF6EE` | **12.47** | ✅ | ✅ | 主課文，AAA |
| `text-on-surface-variant` on `surface` | `#5E5B55` | `#FBF6EE` | 6.29 | ✅ | ❌ | 次要文字，**未過 AAA** |
| **違規使用（待修）** | | | | | | |
| `text-gray-900` on `bg-white` | `#111827` | `#FFFFFF` | 17.74 | ✅ | ✅ | **過度刺激**，違反 BDA |
| `text-gray-900` on `surface` | `#111827` | `#FBF6EE` | 16.49 | ✅ | ✅ | 字色違規（純黑感） |
| `text-gray-800` on `surface` | `#1F2937` | `#FBF6EE` | 13.64 | ✅ | ✅ | 字色違規 |
| `text-gray-700` on `bg-white` | `#374151` | `#FFFFFF` | 10.31 | ✅ | ✅ | 雙重違規 |
| `text-gray-500` on `bg-white` | `#6B7280` | `#FFFFFF` | 4.83 | ✅ | ❌ | nav 按鈕，邊緣 |
| **基準** | | | | | | |
| 純黑 / 純白（BDA 反例）| `#000000` | `#FFFFFF` | 21.00 | ✅ | ✅ | 對比度滿分但**最不友善** |

### 2.3 違規清單（grep 出來的具體 file:line）

#### A. 主要違規 — 直接用 Tailwind gray + bg-white

`frontend/src/components/reading-steps/Intro.tsx`:
```
L77   text-gray-500 hover:text-gray-900     (nav button, marginal)
L109  text-2xl font-bold text-gray-900      (article title — VIOLATION, 應該 text-on-surface)
L159  text-gray-900 text-2xl                (article body — VIOLATION)
L185  border-gray-300 bg-transparent text-gray-800
L209  text-gray-500 hover:text-gray-900
```

`frontend/src/components/reading-steps/RadicalDecomposition.tsx`:
```
L94   text-2xl font-bold text-gray-800      (字元標籤)
L120  text-base font-bold text-gray-700
L123  text-4xl font-black text-gray-900     (大字 — VIOLATION)
L204  text-base font-bold text-gray-700
L213  text-3xl font-black text-gray-900     (VIOLATION)
L237  text-2xl font-bold text-gray-800
L268  text-lg font-bold text-gray-700
L298  bg-gray-50 ... text-gray-700          (相關字提示框)
L299  font-bold text-gray-900
```

`frontend/src/components/reading-steps/StrategyExercise.tsx`:
```
L141  bg-white border-gray-200 cursor-grab    (drag card — bg-white VIOLATION)
L147  text-sm text-gray-800
L239  text-sm font-semibold text-gray-700
L245  bg-white rounded-xl border-gray-200
L249  text-sm text-gray-800
L272  bg-white border-gray-200 text-gray-700
L284, L390, L410, L437  similar bg-white + text-gray-700/800 patterns
```

`frontend/src/components/reading-steps/ComprehensionScoreCard.tsx`:
```
L114  text-lg font-black text-gray-900       (分數顯示)
```

#### B. 正確使用 design token 的範例（這些不要動）

`frontend/src/components/reading-steps/ReadingAnnotation.tsx`:
```
L528  bg-surface-container-low text-on-surface-variant
L573  text-on-surface tracking-tight              (course title — correct)
L594  text-on-surface/90                           (article body — correct)
L640, L656, L657, L664  consistent token usage
```

`frontend/src/components/reading-steps/FullReading.tsx`:
```
L357  text-on-surface leading-relaxed
L389  text-on-surface-variant/40
L392  text-on-surface leading-[3rem]              (article body — correct)
```

`frontend/src/components/reading-steps/ComprehensionChat.tsx`：全檔幾乎完全用 design token，模範示範 ✅

### 2.4 audit 結論

| 區塊 | 狀態 | 動作 |
|------|------|------|
| Surface design token 系統 | ✅ 設計優良，符合 BDA | 不動 |
| `ReadingAnnotation.tsx` 主課文 | ✅ 使用 token | 不動 |
| `FullReading.tsx` 朗讀區 | ✅ 使用 token | 不動 |
| `ComprehensionChat.tsx` | ✅ 模範 | 不動 |
| `Intro.tsx` 課文簡介 | ❌ 直接 `text-gray-900` | **要改成 `text-on-surface`** |
| `RadicalDecomposition.tsx` 部件練習 | ❌ 整檔 `text-gray-700/800/900` | **整檔改成 token** |
| `StrategyExercise.tsx` 策略練習 | ❌ `bg-white` + `text-gray-*` | **整檔改成 token** |
| `ComprehensionScoreCard.tsx` 分數卡 | ❌ `text-gray-900` | **改 token** |
| `text-on-surface-variant` `#5E5B55` | ⚠️ AA 過、AAA 未過 | 主用文字 OK，注音 ruby 要再加深 |

> 真正的問題不是「整個平台太刺眼」，而是**「設計系統是好的，但有些檔案沒用」**。這是 design system adoption 問題，不是色票問題。

---

## 3. Phase 3：色彩候選方案

### 3.1 主課文區（article body）

| 候選 | fg | bg | 對比 | AAA | 評語 |
|------|----|----|------|-----|------|
| **A. 維持現狀（推薦）** | `#302F2A` | `#FBF6EE` | 12.47 | ✅ | 已是 best practice，不用改 |
| B. 加深一階 | `#1F1D1A` | `#FAF7F0` | 15.72 | ✅ | 對比偏高，違 BDA「dark-not-black」精神 |
| C. 淺一階 cream | `#3A3530` | `#FFFBF2` | 11.74 | ✅ | 太淺的 cream 接近白，失去 BDA cream 優勢 |
| D. 暖灰背景 | `#2D2A26` | `#F5F0E8` | 12.59 | ✅ | 偏向 surface-container-low，可作 secondary card |
| E. 經典 BDA cream + 深字 | `#1A1A1A` | `#FFF8DC` | 16.34 | ✅ | 對比過高 + cornsilk 黃太強，老氣 |

**推薦：A（不動）**

> 別動主課文，動了會破壞已經做好的東西。改 token = breaking change，要重 QA 整個 stepper。

### 3.2 修補違規區塊（把 `text-gray-900`/`bg-white` 換成 token）

不是「換顏色」，是「換成設計系統 token」。視覺結果：對比度從 17.7 降到 12.5，**仍過 AAA**，但符合 BDA cream 原則。

mapping：
```
Tailwind 違規        →  Design token
text-gray-900       →  text-on-surface           (#302F2A)
text-gray-800       →  text-on-surface           (or /90 if subtle)
text-gray-700       →  text-on-surface-variant   (#5E5B55)
text-gray-500       →  text-on-surface-variant/70
bg-white            →  bg-surface-container-lowest (#FFFFFF) — 視情況 or bg-surface-container-low (#F5F0E8)
bg-gray-50          →  bg-surface-container-low
border-gray-200     →  border-surface-container-high
border-gray-300     →  border-surface-dim
```

> 這就是 `frontend-design-pipeline` 階段 ➌ 的「shadcn-component-discovery / design tokens 優先於自寫」精神。

### 3.3 注音 ruby（小字，需要更高對比）

| 候選 | fg | bg | 對比 | AAA | 評語 |
|------|----|----|------|-----|------|
| 現況：`text-on-surface-variant` | `#5E5B55` | `#FBF6EE` | 6.29 | ❌ | 注音 11-13px = Normal text，AAA 7:1 沒過 |
| **推薦：加深變體** | `#4A4641` | `#FBF6EE` | **8.70** | ✅ | 過 AAA，仍比主文字淡（視覺層級保留）|
| 過深 | `#3D3A36` | `#FBF6EE` | 10.61 | ✅ | 跟主文字對比不足，視覺層級扁平 |
| 帶藍 | `#4A4858` | `#FBF6EE` | 8.30 | ✅ | 帶冷色 → 視覺更安靜，但跟系統 warm 色不一致 |

**推薦**：新增 `on-surface-variant-strong: #4A4641` 給 ruby / 注音 / caption 用。

> 不要直接加深 `on-surface-variant` 本身（會影響其他 UI），新增一個 variant token。

### 3.4 難字標記色（#1346 注音 toggle 模式 + 強調用）

需求：當「難字注音模式」開啟時，**只有難字**顯示注音 + 視覺強調。強調色不能用 `text-error` 紅色（紅 = 錯）。

| 候選 | fg | bg | 對比 | AAA | 評語 |
|------|----|----|------|-----|------|
| 現有 tertiary | `#994100` | `#FBF6EE` | 6.27 | ❌ | 不夠深，AAA 沒過 |
| 推薦 brown | `#7C2D12` | `#FBF6EE` | **8.71** | ✅ | 深棕橘，跟 tertiary 系列同色相 |
| 暗紫（accent dim）| `#3A3282` | `#FBF6EE` | 9.85 | ✅ | 跟 accent 同色相，但「紫色 = action button」混淆 |
| 深綠 | `#004D2C` | `#FBF6EE` | 9.42 | ✅ | success 色相，「綠 = 對」混淆 |

**推薦**：`#7C2D12` 深棕橘 — 暖色調與 cream 底相容，跟 success 綠 / error 紅 / accent 紫不衝突，AAA 過。

### 3.5 完整推薦色票

```
// 新增 / 確認的 design tokens
'on-surface': {
  DEFAULT: '#302F2A',           // 主文字（保留）
  variant: '#5E5B55',           // 次要文字（保留）
  'variant-strong': '#4A4641',  // 新增：注音 ruby、caption、small text
},
emphasis: {
  // 新增「強調但非錯誤」的暖色
  difficult: '#7C2D12',         // 難字標記、特殊強調
},
```

不動 surface 系列（已是 BDA-compliant best practice）。

---

## 4. 給陳教授 / 方大哥的決策題

### 4.1 三選一

| 選項 | 範圍 | 風險 | 工時估算 |
|------|------|------|---------|
| **小修（推薦）** | 只修違規檔（Intro / RadicalDecomp / Strategy / ScoreCard 改用 token）+ 新增 ruby variant + 難字色 | 低（純 className 替換）| 0.5d |
| 中修 | 小修 + 全平台 grep 補完 + 加 visual regression test | 中 | 1.5d |
| 大修 | 重新設計整個 surface 色票 | 高 | 5d+ |

### 4.2 不建議的事

- ❌ **不要**改 `surface` 預設值（`#FBF6EE` 已是 BDA 最佳實務）
- ❌ **不要**改 `on-surface` 預設值（`#302F2A` 已過 AAA 且符合 dark-not-black）
- ❌ **不要**全平台改 dark mode（教學場景搭配紙本，mode 切換成本高）
- ❌ **不要**用純黑（BDA 明確反對）
- ❌ **不要**用純白底（BDA 明確反對 + Aleman 2018 提示對近視不利）

### 4.3 5/1 會議遺留問題的對齊

| 5/1 提到 | 本研究結論 |
|---------|----------|
| 黑體（gothic）糊在一起 | 是字型 + 字重問題（#1351 處理），不是色彩問題 |
| 字距行距太寬 | 是 spacing 問題（#1338 處理），與本研究獨立 |
| 沒提到色彩 | 本研究確認：**主課文色彩已正確**，只需修補違規檔 |

---

## 5. 引用來源（完整列表）

### 標準與規範
- [Web Content Accessibility Guidelines (WCAG) 2.2 — W3C](https://www.w3.org/TR/WCAG22/)
- [Understanding Success Criterion 1.4.3: Contrast (Minimum) — W3C WAI](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)
- [WebAIM: Contrast and Color Accessibility](https://webaim.org/articles/contrast/)

### Dyslexia + 顏色準則
- [British Dyslexia Association Style Guide 2023 (PDF)](https://cdn.bdadyslexia.org.uk/uploads/documents/Advice/style-guide/BDA-Style-Guide-2023.pdf)
- [Dyslexia Scotland — Contrasting advice: what colours are best for accessibility](https://dyslexiascotland.org.uk/contrasting-advice-what-colours-are-best-for-accessibility/)
- [Cardiff University Learning & Teaching Academy — Using colour and contrast inclusively](https://blogs.cardiff.ac.uk/LTAcademy/not-just-pretty-colours-using-colour-and-contrast-inclusively/)

### 兒童近視 + 對比度
- [Aleman A. et al. (2018). Reading and Myopia: Contrast Polarity Matters. Scientific Reports 8, 10840.](https://www.nature.com/articles/s41598-018-28904-x)
- [PMC 全文版本](https://pmc.ncbi.nlm.nih.gov/articles/PMC6052140/)

### 視覺疲勞 + 顯示器色彩
- [Effect of Display Color Mode and Luminance Contrast on Visual Fatigue (ResearchGate, 2021)](https://www.researchgate.net/publication/349602864_Study_on_the_Effects_of_Display_Color_Mode_and_Luminance_Contrast_on_Visual_Fatigue)
- [The Effect of Ambient Illumination and Text Color on Visual Fatigue under Negative Polarity — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC11175232/)
- [A Study on the Design of Vision Protection Products Based on Children's Visual Fatigue under Online Learning Scenarios — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9024956/)
- [Altered eye movements during reading under degraded viewing conditions: Background luminance, text blur, and text contrast — PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9465940/)

### 中文 / 漢字 readability
- [Liu et al. (2016). Effects of Font Size, Stroke Width, and Character Complexity on the Legibility of Chinese Characters. Wiley Online Library.](https://onlinelibrary.wiley.com/doi/abs/10.1002/hfm.20663)
- [Perceptual expertise with Chinese characters predicts reading performance among Hong Kong Chinese children with developmental dyslexia — PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0243440)
- [Research on the legibility of Chinese display character sizes in virtual environments — ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0141938223002238)

### 平台先例
- [Singapore Student Learning Space — accessibility audit (Accessify)](https://accessify.com/m/learning.moe.edu.sg)
- [均一教育平台 (Junyi Academy)](https://www.junyiacademy.org/)

---

## 6. 附錄：對比度計算腳本

完整對比度比對由以下 Python 腳本算出（WCAG 2.2 公式）：

```python
def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def rel_luminance(rgb):
    def channel(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

def contrast(c1, c2):
    l1, l2 = rel_luminance(hex_to_rgb(c1)), rel_luminance(hex_to_rgb(c2))
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)
```

對比度數字可由 [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) 重新驗證。

---

## 7. 後續 issue 建議

跟 #1358 同類型的視覺優化軸：

- #1351 字體 audit（黑體 → 楷體 / 明體）
- #1338 字距行距優化（已部分 ship）
- #1337 注音切換功能
- 本 issue（#1358）顏色

建議 follow-up implementation issue：

- [ ] **新 issue**：「修補違規檔色彩 token（Intro / RadicalDecomp / Strategy / ScoreCard）」— 0.5d
- [ ] **新 issue**：「新增 `on-surface-variant-strong` token + 注音 ruby 套用」— 0.25d
- [ ] **新 issue**：「新增 `emphasis.difficult` 色 + 接 #1346 難字模式」— 0.25d
- [ ] （optional）「全平台 grep + ESLint rule 禁止 `text-gray-*` / `bg-white`」— 1d

每個 follow-up 都應該獨立 PR，避免 design system 改動 + bug fix 混雜。
