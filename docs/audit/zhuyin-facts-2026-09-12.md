# 注音問題 — 事實清單（2026-09-12）

> 這份**只放事實**，不放建議。每條標明是**實測**（跑過指令看到輸出）、**讀檔**
> （看過原始碼／資料但沒執行）、還是**推論**（沒有直接證據）。
>
> 決策請用這份當地基，不要用我的敘述。設計提案另見
> `docs/prd/zhuyin-single-source-of-truth.md`。

---

## A. 使用者回報

**A1（回報內容）** 課程 `20013`《正太與小豬：武僧的養成之路》重點朗讀頁
`lingoleap-prod.web.app/learn/20013/key-passage-reading`，兩個字注音錯：
「功夫**了**得」標 ㄌㄜ˙（應 ㄌㄧㄠˇ）、「有多**難**」標 ㄋㄢˋ（應 ㄋㄢˊ）。
— *來源：Young 轉的三張截圖*

**A2（兩個畫面不一致）** 使用者給的三張圖分屬兩個畫面：課文朗讀頁（圖 1、圖 3，
「了」與「難」被畫**圈**）與朗讀比對畫面（圖 2，同一個「難」被打**勾**）。
— *推論：圖 2 那個勾代表「這裡是對的」。理由是 D2 的實測顯示後端對「有多難」給出正確的
ㄋㄢˊ。⚠️ 我沒有直接向回報者確認勾的意思。*

---

## B. 系統盤點：有四份實作

**B1** 前端顯示引擎：`frontend/src/components/zhuyin/polyphonicProcessor.ts`（391 行）。
檔頭寫「Ported from learning-to-read-chinese/lib/views/polyphonic_processor.dart」。
資料來自 `fetch('/data/poyin_db.json')`。— *讀檔*

**B2** 後端比對注音：`backend/app/routes/learning/learning_reading.py:356 _build_zhuyin_map()`，
用 `pypinyin` 的 `lazy_pinyin(..., style=Style.BOPOMOFO)`。
`backend/requirements.txt` 列 `pypinyin>=0.51`。— *讀檔*

**B3** TTS 發音修正：`backend/app/services/tts/normalization.py:30 PHONEME_CORRECTIONS`，
手維護 4 筆（喝采／喝彩／打的漂亮／打得漂亮）＋ `_load_taiwan_corrections()` 從
`backend/data/tts/taiwan_pronunciation.json` 載入。用 `<sub alias="X">Y</sub>` 改寫。— *讀檔*

**B4** 稽核用的第三份邏輯：`backend/scripts/audit_polyphonic.py`，讀 B1 的
`poyin_db.json`，註解第 64 行寫 **「Replicates core logic of polyphonicProcessor.ts match()」**。
— *讀檔*

**B5（B4 沒接線）** 全庫搜 `audit_polyphonic`，除了它自己與 `graphify` 的分析快取，
只有 `docs/audit/polyphonic-audit-2026-05-01.md` 提到它。**沒有任何 workflow / skill /
腳本叫用它。** — *實測（全庫掃描）*

**B6（後端不碰前端的資料）** 後端 `app/` 底下零引用 `poyin_db`。全庫只有一份
`poyin_db.json`，在 `frontend/public/data/`。唯一讀它的後端檔是 B4 那支沒接線的稽核腳本。
— *實測（全庫掃描）*

---

## C. 前端資料表的內容

**C1** prod 線上的 `poyin_db.json`：`HTTP 200`、187124 bytes、頂層兩個 key
（`data` 3237 筆、`ruby` 1386 筆）。— *實測*

```
curl -s https://lingoleap-frontend-958347263320.asia-east1.run.app/data/poyin_db.json
```

**C2** 那兩個字的條目：— *實測（從 C1 下載的檔案讀出）*

```json
"了": {"s": 2, "v": ["", "*不起/*結/*解/受不*/*不得/知*/吃不*"]}
"難": {"s": 3, "v": ["困*/", "災*/問*/發*/海*/多*/大*/兵*/*民/*胞/國*/山*/患*/避*/救*/犯*/空*/臨*/苦*/遇*/落*/受*/非*/責*/危*/急*/劫*/排*/逃*/赴*/遭*/死*/殉*/母*/罹*/蒙*/靖*/駁*", "*然"]}
```

**C3** `了` 的變體清單裡**沒有 `*得`**。— *實測（字串比對）*

**C4** `難` 的第二個變體清單裡**有 `多*`**。— *實測（字串比對）*

**C5（未驗）** 「C3 導致『了得』讀成 ㄌㄜ˙、C4 導致『有多難』讀成 ㄋㄢˋ」
— **推論**。我**沒有執行過 `PolyphonicProcessor.process()`**。變體索引如何對應到
實際讀音、`s`/`d`/`v` 欄位的語意、`matchPolyphonicPattern` 的比對順序，我都只讀了部分原始碼。
**依 gate 0，這不算復現。**

---

## D. pypinyin 的實測結果

**D1** 用 `lazy_pinyin(text, style=Style.BOPOMOFO)` 跑 11 個案例，**7 對 4 錯**：— *實測*

| 句子 | 應為 | pypinyin | |
|---|---|---|---|
| 功夫**了**得 | ㄌㄧㄠˇ | ㄌㄧㄠˇ | ✓ |
| 根本感覺不出來有多**難** | ㄋㄢˊ | ㄋㄢˊ | ✓ |
| **多難**興邦 | ㄋㄢˋ | ㄋㄢˊ | ⛔ |
| **災難** | ㄋㄢˋ | ㄋㄢˊ | ⛔ |
| **患難**與共 | ㄋㄢˋ | ㄋㄢˊ | ⛔ |
| **難民** | ㄋㄢˋ | ㄋㄢˊ | ⛔ |
| 困**難** | ㄋㄢˊ | ㄋㄢˊ | ✓ |
| **難**得 | ㄋㄢˊ | ㄋㄢˊ | ✓ |
| **了**解 / **了**不起 | ㄌㄧㄠˇ | ㄌㄧㄠˇ | ✓ |
| 他走**了** | ㄌㄜ˙ | ㄌㄜ˙ | ✓ |

**D2** 四個錯的全部是同一個形狀：**pypinyin 在這些詞裡不產生 `難` 的 ㄋㄢˋ 讀音**。
— *實測（D1 的模式）*

**D3（樣本偏差）** 這 11 個案例是**我自己挑的**，集中在 `了` 與 `難`。
這不是隨機抽樣，不能拿來推論 pypinyin 的整體正確率。— *自述限制*

---

## E. 後端注音會不會到學生面前

**E1** `_build_zhuyin_map()` 的輸出經 `learning_reading.py:477-478` 掛上
`DiffToken.zhuyin`。— *讀檔*

**E2** 前端 `components/ui/DiffDisplay.tsx` 有五處把 `token.zhuyin` 傳給
`<CharWithZhuyin>`，檔頭註解寫「Displayed above each character via HTML
`<ruby>`/`<rt>` when token.zhuyin is present」。— *讀檔*

**E3** `DiffDisplay` 被三個畫面引用：`AssessmentDiffSection.tsx`（朗讀評分結果）、
`paragraph-reading/ParagraphFeedbackPanel.tsx`（逐段回饋）、
`pages/student/session-history/KeyPassageReadingRecord.tsx`（學習紀錄）。— *實測（全庫掃描）*

**E4（結論）** 後端 pypinyin 的注音**會**顯示給學生看。— *由 E1–E3 推得；
⚠️ 我沒有在真瀏覽器上看到那個 ruby 實際渲染出來。*

---

## F. 影響面掃描

**F1** 掃 `backend/data/lessons/` 底下 **2550 個課程檔**（`.yml`/`.yaml`/`.json`）：— *實測*

| 形狀 | 出現處數 | 出現的課（前幾個） |
|---|---|---|
| `了得` | 24 | L0130、L0107、`_extracted` |
| `多難`（排除 `多難興邦`） | 21 | L0130、L0107、`_extracted` |
| **`多難興邦`** | **0** | — |
| `災難` | 124 | L0009、L0027、L0028、L0046、L0048、L0051 |
| `難民` | 36 | L0096 |
| `苦難` | 27 | L0020、L0042、L0059、L0084、L0113、L0118 |
| `劫難` | 18 | L0127 |
| `受難` | 26 | L0027、L0035、L0103、L0140、L0142 |
| `危難` | 10 | L0063、L0142 |
| `空難` | 6 | L0027、L0051、L0058 |
| `逃難` | 4 | L0037、L0118 |
| （難類合計） | **251 處 / 30 課** | |

**F2（數字有灌水，不要拿去做決策）** F1 是**檔案層級**的計數。同一課有多個檔
（`v3/` 版本目錄、`_extracted` 中繼檔），同一句話會被重複計到。
**而且我完全沒有過濾「這個詞有沒有落在學生真的會朗讀的重點段裡」。**
真正到學生眼前的數量比 F1 少，少多少未知。— *自述限制*

**F3** `多難興邦` 在全庫 **0 處**。`難` 的 `多*` 規則（C4）要處理的情況，
在這個語料庫裡一次都沒出現過。— *實測*

---

## G. 這件事之前被看過

**G1** `docs/audit/polyphonic-audit-2026-05-01.md`，issue **#1353**
「破音字 AI 標注校正 audit + 校正 pipeline」。起因是教授指出「喝采」的
`喝` 應讀 ㄏㄜˋ。— *讀檔*

**G2** 那次稽核掃 57 課，找到 **5155 處**破音字、**4298 處**需人工確認、
**22 處**已在 TTS 修正。— *讀檔（該報告的數字）*

**G3** 報告建議 Phase 2–4：Gemini 批次標注 → lesson YAML 加 `phoneme_overrides`
欄位（前端讀它） → 老師確認 UI。— *讀檔*

**G4** **#1353 已 CLOSED**（label `ai-qa-passed`、`merged-to-staging`），
而報告末尾的四條 Next Steps **全部未打勾**。— *實測（`gh issue view`）*

**G5** 報告最後一條待辦至今未確認：「確認 `喝` 的**注音顯示**（不只 TTS）是不是也錯」。
— *讀檔*

**G6** `tts/normalization.py:60-77` 的 docstring 記錄了一個判斷：
手維護清單「不會收斂 —— 2026-05-01 的稽核找出 4298 項要複查、只有 22 項曾被修掉，
而 2026-08-09 回報的四個案例一個都不在表裡」。— *讀檔（原文為英文）*

**G7** `backend/data/tts/taiwan_pronunciation.json`：27708 bytes、**198 筆**，
欄位含 `_source`／`_method`／`_verified`／`_known_gaps`／`_excluded_reason`。
docstring 說它由「教育部《重編國語辭典修訂本》比對 pypinyin 的大陸讀音」推導而來，
且「增加涵蓋要重新產生檔案，不是再加一個 tuple」。— *實測（讀檔 ＋ 解析 JSON）*

**G8** `災難`、`難民`、`了得`、`多難`、`喝采` **都不在** G7 那 198 筆裡。— *實測*

---

## H. 我沒有查的

1. **沒跑過 `PolyphonicProcessor`**（見 C5）—— 前端根因仍是推論。
2. **沒在真瀏覽器確認** 後端注音的 ruby 實際渲染（見 E4）。
3. **三端逐字比對的不一致處數，完全沒量過。** G2 那個 4298 是「照抄前端規則的稽核器」
   量出來的，量的是前端自己，不是三端之間。
4. **`喝采` 的注音顯示現在是對是錯**（G5 那條待辦）。
5. **教育部辭典的授權與取得方式**、能覆蓋多少詞，沒查。
6. **pypinyin 的整體正確率**，沒有隨機抽樣量過（見 D3）。
