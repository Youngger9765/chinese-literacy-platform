# 教育部國語文學習資源清單

> 整理所有可用的教育部官方資源、Open Data、API

---

## 📚 官方學習平台

### 1. 教育部因材網 (AdaptiveLearning)

**網址**：https://adl.edu.tw/

**功能**：
- AI 個人化學習診斷
- 國語文、數學、英語、自然、社會全科目
- 線上測驗與練習
- 學習歷程追蹤

**目標用戶**：國小到高中學生、教師

**技術特色**：AI 診斷學習弱點、自動推薦學習內容

**授權**：政府平台，免費使用

---

### 2. 臺北酷課雲 (Cool English)

**網址**：https://cooc.tp.edu.tw/

**功能**：
- 線上課程影片
- 國語文教材與練習
- 教師可建立班級與作業

**目標用戶**：臺北市學生、教師

**限制**：主要服務臺北市，外縣市需申請帳號

---

### 3. 教育雲數位學習入口

**網址**：https://cloud.edu.tw/

**功能**：
- 整合各縣市教育平台
- 單一帳號登入（教育雲端帳號）
- 連結各類數位學習資源

---

### 4. 均一教育平台

**網址**：https://www.junyiacademy.org/

**功能**：
- 50,000+ 教學影片與練習題
- 國語文、數學、自然全科目

**授權**：非營利組織，免費使用

---

## 🔤 國語文專業資源

### 5. 教育部語文成果入口網

**網址**：https://language.moe.gov.tw/

**功能**：
- 整合所有教育部語文資源
- 辭典、字典、成語典
- 筆順學習、閩南語、客語資源

**重要子網站**：
- 國語辭典
- 筆順學習網
- 閩南語辭典
- 客家語辭典
- 原住民族語言學習

---

### 6. 教育部重編國語辭典修訂本

**網址**：https://dict.revised.moe.edu.tw/

**功能**：
- 收錄 16 萬詞條
- 字詞解釋、例句
- 發音、部首、筆畫查詢

**API 限制**：❌ 目前不提供 API，不允許 App 直接查詢或網頁解析

**Open Data**：
- ✅ 資料已釋出（創用 CC 姓名標示-禁止改作 3.0）
- 📦 可下載：[g0v/moedict-data](https://github.com/g0v/moedict-data)（民間整理）

---

### 7. 教育部國語小字典

**網址**：https://dict.concised.moe.edu.tw/

**功能**：
- 收錄 4,307 個常用字
- 適合國小學生
- 簡化版解釋、注音

**Open Data**：
- ✅ 資料已釋出（創用 CC 姓名標示-禁止改作 3.0）

---

### 8. 教育部《國字標準字體筆順學習網》⭐

**網址**：https://stroke-order.learningweb.moe.edu.tw/

**功能**：
- 6,063 個國字筆順動畫
- 筆順基本原則說明
- 標準楷書字型

**Open Data 下載**：✅ 可下載

1. **教育部常用字**（4,808 個）
2. **全字筆順 SVG 檔案**（6,063 個）
3. **筆順基本法則 PDF**
4. **標準楷書字型檔**

**授權**：創用 CC 姓名標示-非商業性-禁止改作 3.0
- ⚠️ **限制**：非商業性、禁止改作
- ✅ **可用方式**：下載 SVG 後自行實作動畫（不算改作原網站）

**重要**：
- 114 年版包含小一到小六所有生字
- 資料格式：SVG（可程式化處理）

---

### 9. 教育部異體字字典

**網址**：https://dict.variants.moe.edu.tw/

**功能**：
- 收錄異體字、正字、俗字
- 字形演變歷史
- 古籍用字查詢

---

### 10. 教育部成語典

**網址**：https://dict.idioms.moe.edu.tw/

**功能**：
- 收錄 4 萬多則成語
- 解釋、出處、例句
- 典故故事

**Open Data**：
- ✅ 資料已釋出（創用 CC 姓名標示-禁止改作 3.0）

---

## 🎤 閱讀與朗讀資源

### 11. PIRLS 國際閱讀素養研究（台灣）

**網址**：https://tilsm.naer.edu.tw/

**功能**：
- PIRLS 測驗題庫
- 閱讀素養評量標準
- 國際比較數據

**用途**：參考閱讀評量設計

---

### 12. 品學堂（商業平台，學校訂閱）

**網址**：https://www.wisdomhall.com.tw/

**功能**：
- PISA 閱讀素養題庫
- 文章理解測驗
- 教師班級管理

**商業模式**：學校訂閱制（非教育部官方）

---

## 📂 Open Data 資源總結

### 可直接使用的 Open Data

| 資源 | 數量 | 授權 | 商業使用 | 下載方式 |
|------|------|------|---------|---------|
| **方大哥筆順 JSON（最推薦）** ⭐ | 9,606 字 | 待確認 | 待確認 | [GitHub](https://github.com/Shinjou/learning-to-read-chinese/tree/1.8.10%2B10-unreleased/lib/assets/svg) |
| **教育部常用字** | 4,808 字 | CC BY-NC-ND 3.0 | ❌ | [筆順學習網](https://stroke-order.learningweb.moe.edu.tw/) |
| **教育部筆順 SVG** | 6,063 字 | CC BY-NC-ND 3.0 | ❌ | [筆順學習網](https://stroke-order.learningweb.moe.edu.tw/) |
| **Hanzi Writer 資料** | 6,000+ 字 | MIT / Arphic | ✅ | [GitHub](https://github.com/chanind/hanzi-writer) |
| **國語辭典資料** | 16 萬詞 | CC BY-ND 3.0 | ❌ | [g0v/moedict-data](https://github.com/g0v/moedict-data) |
| **成語典資料** | 4 萬+ 則 | CC BY-ND 3.0 | ❌ | [教育部成語典](https://dict.idioms.moe.edu.tw/) |

**重要限制**：
- **BY（姓名標示）**：必須標示「中華民國教育部」
- **ND（禁止改作）**：不能修改原始資料
- **NC（非商業性）**：部分資源不可商業使用

---

### 商業使用的替代方案

**問題**：教育部資料多為「非商業性-禁止改作」授權

**解決方案**：

1. **使用開源專案**：
   - [Hanzi Writer](https://github.com/chanind/hanzi-writer)（MIT 授權，完全可商業使用）
   - 資料來源：Make Me A Hanzi（Arphic Public License）

2. **自行建立資料**：
   - 參考教育部筆順原則
   - 自行繪製 SVG（不算改作）
   - 或使用 Hanzi Writer 的開源資料

3. **教育用途豁免**：
   - 若平台定位為「教育工具」（非營利性質）
   - 可使用教育部資料（需標示來源）
   - **但方大哥不希望談商業，所以這方案可行**

---

## 🚀 建議使用策略

### 筆順功能

#### **方案 A（最推薦）：方大哥 Flutter App 筆順資料** ⭐

**來源**：[learning-to-read-chinese](https://github.com/Shinjou/learning-to-read-chinese/tree/1.8.10%2B10-unreleased/lib/assets/svg)

**核心優勢**：
- ✅ **9,606 個中文字筆順 JSON**（比教育部 6,063 個多 3,543 個）
- ✅ **方大哥自己的專案**，授權無虞
- ✅ **JSON 格式**，直接可用於 Web（Canvas/SVG 渲染）
- ✅ **包含 medians（中心線）**，可用於手寫辨識比對
- ✅ **涵蓋注音符號**（ㄅㄆㄇㄈ...）

**資料格式**：
```json
{
  "strokes": ["M 483 736 Q 504 715 ...", "M 474 477 Q ..."],  // SVG 路徑
  "medians": [[483,736,504,715,...], [474,477,...]]           // 中心線座標
}
```

**實作方式**：
1. 從 GitHub 下載需要的字的 JSON（如：`人.json`、`清.json`）
2. 使用 Canvas 或 SVG 渲染筆順動畫
3. 使用 medians 資料進行手寫辨識比對

**教學流程參考**（方大哥已驗證）：
- **Look** → **Listen** → **Write** → **Use** → **Speak**
- 符合曾世杰教授教學理念
- 可直接套用到我們的 PRD

**注意事項**：
- ⚠️ 需與方大哥確認授權方式
- ⚠️ 資料量大（9,606 個檔案），需評估載入策略（按需載入 vs. 全部預載）

---

#### **方案 B（備案）：Hanzi Writer**（開源、MIT 授權）

**GitHub**: https://github.com/chanind/hanzi-writer

**優勢**：
- ✅ 完全可商業使用
- ✅ 支援繁簡體
- ✅ 活躍維護（58 個版本）
- ✅ 開箱即用（NPM 套件）

**資料來源**：
- Make Me A Hanzi 專案（6,000+ 繁體字筆順資料）
- Arphic Public License（友善授權）

**實作方式**：
```javascript
import HanziWriter from 'hanzi-writer'

const writer = HanziWriter.create('character-target-div', '清', {
  width: 200,
  height: 200,
  padding: 5
})

writer.animateCharacter()  // 播放筆順動畫
writer.quiz()  // 手寫測驗
```

**使用時機**：
- 方大哥資料授權有問題時
- 需要開箱即用的套件時
- 6,000+ 字已足夠時（國小常用字約 4,808 個）

---

### 字典/辭典功能

**推薦方案**：g0v 萌典資料（民間整理）
- GitHub: https://github.com/g0v/moedict-data
- 已整理成 JSON 格式
- 開放授權

**注意**：
- 需標示「資料來源：中華民國教育部」
- 若方大哥定位為教育工具（非營利），可直接使用

---

### 課文資源

**推薦方案**：
1. 曾世杰/陳淑麗教授授權教材（已授權）
2. 教師自行上傳課文（符合著作權）
3. 公共領域文章（國語日報 60 年以上）

**不建議**：
- 直接使用教科書課文（著作權問題）

---

## 📞 聯絡資訊

**教育部語文成果入口網**：
- Email: （可在網站「聯絡我們」查詢）
- 若需商業授權，可直接聯繫教育部國教署

---

## 參考連結

### 官方資源
- [教育部語文成果入口網](https://language.moe.gov.tw/)
- [教育部因材網](https://adl.edu.tw/)
- [教育雲數位學習入口](https://cloud.edu.tw/)
- [國字標準字體筆順學習網](https://stroke-order.learningweb.moe.edu.tw/)
- [教育部重編國語辭典](https://dict.revised.moe.edu.tw/)

### 開源專案
- [方大哥 learning-to-read-chinese - 9,606 字筆順 JSON](https://github.com/Shinjou/learning-to-read-chinese) ⭐ **最推薦**
- [Hanzi Writer - 筆順動畫庫](https://github.com/chanind/hanzi-writer)
- [g0v 萌典資料](https://github.com/g0v/moedict-data)
- [Make Me A Hanzi - 筆順資料](https://github.com/skishore/makemeahanzi)

---

**建立日期**：2026-02-13
**維護者**：Young Tsai
**最後更新**：2026-02-13

**核心理念**：善用政府開放資源，結合開源技術與方大哥已驗證的教學模組，打造教育工具。

**重要發現**：方大哥的 Flutter App 已包含 9,606 個中文字筆順 JSON 資料，且經過實際教學驗證（Look → Listen → Write → Use → Speak 流程），建議優先使用。
