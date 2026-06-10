---
name: build-spotlight
description: 從一課的原始 DOCX 學習單，抽取「閱讀聚光燈」段落並拆解成 block schema（教授要的線上版藍圖）。當需要「建聚光燈」「把聚光燈轉線上」「docx 轉聚光燈」「spotlight from docx」「閱讀策略練習轉 schema」時使用。實驗來源 issue #2205。
---

# build-spotlight — DOCX 閱讀聚光燈 → block schema

把一課手工排版的 DOCX 聚光燈段落，忠實拆成「block 序列」schema。**不要**用 `backend/data/lessons/*.yml`（那是 parser 壓平過的，9x3 nested 被壓成 flat、合併格 value 弄爛）。一律從 raw DOCX 重抽。

## 何時用
- 要把某課的閱讀聚光燈做成線上版
- 驗證 block palette 是否罩得住某課
- 教授七課（G6-L22~25 / G7-L28~30）的線上化

## Block palette（聚光燈用，來自 7 課實證拆解 `docs/professor-7-lessons-block-decomposition.md`）

| block type | 說明 | DOCX 偵測線索 |
|-----------|------|--------------|
| `guide` | 教學脈絡敘述（小祕訣 / 步驟 / 「我們可以這樣思考」） | 段落以 `◎`/`步驟`/`小祕訣`/`※`/`一、二、` 開頭，非題目 |
| `passage` | 插入小文本（**補充資料，不一定是本課課文**：孟嘗君、大象、課文某段引用） | `List Paragraph` 連續敘事段，或「讓我們來看另一個故事」「課文第N段：」後的整段 |
| `single` | 單選 | `❶❷`/`(N)` + 多個 `□`/`①②` 選項，其中一個無 □（正解）或標代號 |
| `multi` | 複選 | 題幹含「複選」「N選M」「（多選）」 |
| `fill_table` | 結構表格填空（=可同時是重點表，見 build-keypoints） | docx table，cell 含 `【 】`，標籤如 問題/解決/結果/元素/段落 |
| `free_text` | 自由作答 | 「請用一句話」「寫下你的想法」，題後無選項 |
| `highlight` | 畫線/標記 | 「請把…畫線」「用螢光筆標記」「圈起來」 |
| `self_check` | 自我檢核 | `◎自我檢核` 後一串 `□1. □2.` |
| `figure` | 圖/表 referent，**綁定段落** | 「請看圖N」「如圖N」「表一」「對照圖/表」；referent 可為 image 或 data-table |

> 閱讀理解 5 題 MCQ（聚光燈後的固定區）**不屬**聚光燈，交給既有 multiple_choice，不放進 spotlight schema。

## 程序

### 1. 抽取 raw ordered body
跑 `scripts/extract_docx_blocks.py <docx路徑>`（本 skill 附）。它用 python-docx 依文件順序吐出 paragraphs + tables（含 cell、合併偵測、圖片數），並自動標掉固定 scaffold（標頭/計時/我的表現/詞語解釋表/影片）。

### 2. 框定聚光燈段落
聚光燈 = 詞語應用練習**之後**、閱讀理解 5 題 MCQ（`（ X ）1.`）**之前**的所有 block。圖文整合課的聚光燈常從「步驟❶」或「練習一」開始。

### 3. 逐 block 分類
對段落區間每個元素，依上表線索標 type。重點：
- `passage` 要記 `source`: `lesson_text`（本課課文段落）或 `supplementary`（自備小文本，如孟嘗君/大象）+ 全文。
- `single`/`multi` 要抓 `prompt` / `options` / `answer(s)`（DOCX 正解=沒有 □ 的那個，或標楷/標色；抓不到標 `answer: null` 待人工）。
- `figure` 要記 `referent`: `image` 或 `table`，以及 `bind_paragraph`（對應第幾段）。
- `fill_table` 交給 build-keypoints 同款抽取，這裡只放引用。

### 4. 輸出 schema
```yaml
spotlight:
  lesson: G7-L29
  strategy_name: 圖文整合閱讀策略        # 取自 DOCX 檔名括號 / 標題
  strategy_type: image_text             # guided_steps | trait_inference | ordering | image_text | table_text | summary_pse
  blocks:
    - {type: guide, text: "前一課我們已經學過圖文整合…"}
    - {type: passage, source: lesson_text, paragraphs: [1]}
    - {type: highlight, instruction: "把第一段要看圖的地方畫線", bind_paragraph: 1}
    - {type: guide, text: "小祕訣：文字會告訴我們哪些地方要看圖…"}
    - {type: single, prompt: "這段要你看圖一的什麼？",
       options: ["1850年以來地球平均氣溫的變化趨勢","…最高溫度"], answer: 0}
    - {type: figure, referent: image, asset: "G7-L29-fig1", bind_paragraph: 1}
    - {type: free_text, prompt: "請用一句話，說明第三段和圖三的意思"}
    - {type: self_check, items: ["我會找出文章裡要看圖的地方", "…"]}
```
寫到 `private/curriculum-source/_online-schema/<lesson>.spotlight.yml`（gitignored 區，實驗產物）。

### 5. 驗收（每課必跑）
- [ ] block 數量、順序與 DOCX 一致（人工對照 `extract_docx_blocks.py` 原始輸出）
- [ ] 教學脈絡（guide）有保留，沒被當垃圾丟掉
- [ ] 補充小文本（passage source=supplementary）有抓到（這是現行平台最常漏的）
- [ ] 圖/表 referent 有標 `bind_paragraph`
- [ ] 每個 single/multi 有 answer；抓不到的標 null 並列出清單給人工補
- [ ] 不夾帶閱讀理解 5 題 MCQ

## 反模式
- ❌ 從 `backend/data/lessons/*.yml` 反推（已被 parser 壓平，失真）
- ❌ 把 guide 教學脈絡省略（教授最在意的就是這段）
- ❌ 把補充小文本當成本課課文（孟嘗君/大象不是課文，是聚光燈自備教材）
- ❌ 猜 answer；抓不到就標 null，寧缺勿錯
