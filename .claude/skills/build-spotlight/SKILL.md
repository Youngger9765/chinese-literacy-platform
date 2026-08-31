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
- 其他 151 課任一課的聚光燈自動化（通用流程）

## Strategy Detection（strategy_type 先決定，影響後續分類）

從 DOCX 檔名最後一組括號提取策略名，對應到 strategy_type：

| strategy_type | 典型括號關鍵字 | 代表課 |
|--------------|--------------|--------|
| `summary_pse` | 問題.解決.結果 | G6-L22~25 |
| `summary_structure` | 從結構找小主題 | G6-SL8 |
| `image_text` | 圖文整合 / 圖表繪製 | G7-L28~29 |
| `table_text` | 圖文表整合 | G7-L30 |
| `trait_inference` | 從言行推論人物特質 | G5-SL10 |
| `emotion_inference` | 推論情緒和感受 | G4-SL10 |
| `main_idea_inference` | 推論觀點/主旨 | G8-SL4 |
| `causal_inference` | 找出一連串因果 | G8-SL8 |
| `evidence_finding` | 觀點找支持理由 | G5-SL7 |
| `scientific_inquiry` | 科學探究/以實驗 | G7-SL17 |
| `problem_solving` | 解決問題 | G6-SL3 |
| `express_opinion` | 表達看法/4F思考 | G7-SL9 |
| `self_questioning` | 自我提問/詰問作者 | G7-SL19 |
| `comparison` | 比較異同 | G5-SL26 |
| `classical_grammar` | 人稱代詞/一字多義 | 文-SL5 |
| `perspective_taking` | 換位思考/想法感受 | G4-SL13 |

**Key rule**: Use the **last** bracket in the filename (some files have two, e.g. `(後篇)（推論策略-XXX）`). The strategy is always last.

## Block palette（聚光燈用，來自 7 課實證拆解 `docs/professor-7-lessons-block-decomposition.md`）

| block type | 說明 | DOCX 偵測線索 |
|-----------|------|--------------|
| `guide` | 教學脈絡敘述（小祕訣 / 步驟 / 「我們可以這樣思考」） | 段落以 `◎`/`步驟`/`小祕訣`/`※`/`一、二、` 開頭，非題目 |
| `passage` | 插入小文本（**補充資料，不一定是本課課文**：孟嘗君、大象、課文某段引用） | `List Paragraph` 連續敘事段；或 Normal 樣式 + len>40 + 無選項標記（見 `is_substantive_narrative()`）；或「讓我們來看另一個故事」「課文第N段：」後的整段 |
| `single` | 單選 | `❶❷`/`(N)` + 多個 `□`/`①②` 選項，其中一個無 □（正解）或標代號 |
| `multi` | 複選 | 題幹含「複選」「N選M」「（多選）」 |
| `fill_table` | 結構表格填空（=可同時是重點表，見 build-keypoints） | docx table，cell 含 `【 】`，標籤如 問題/解決/結果/元素/段落 |
| `free_text` | 自由作答 | 「請用一句話」「寫下你的想法」，題後無選項 |
| `highlight` | 畫線/標記 | 「請把…畫線」「用螢光筆標記」「圈起來」 |
| `self_check` | 自我檢核 | `◎自我檢核` 後一串 `□1. □2.` |
| `figure` | 圖/表 referent，**綁定段落** | 「請看圖N」「如圖N」「表一」「對照圖/表」；referent 可為 image 或 data-table |
| `match` | 配對題（B5 trait-inference） | 2-col table，header 含 `線索/文中/事件/言行` 和 `特質/情緒/推論` |

> 閱讀理解 5 題 MCQ（聚光燈後的固定區）**不屬**聚光燈，交給既有 multiple_choice，不放進 spotlight schema。

## Asset Extraction（圖片/表格資產）

1. Images are embedded in DOCX as `word/media/imageN.{png,jpeg}`.
2. Extract via zipfile + lxml blip scan (`{drawingml}blip r:embed`), in document order.
3. Map rId → media filename via `word/_rels/document.xml.rels`.
4. For `image_text`/`table_text` lessons: only include images from T#1 (main course content table, doc_order==4) + section marker images. Filter out: Level badge, scaffold tables (影片連結), MCQ decorations.
5. For G7-L30-style table_text: also extract nested tables (表一/表二 inside T#1 cell[2,1]) as structured JSON files.
6. Save assets to `private/curriculum-source/_online-schema/assets/<lesson>/fig1.png ...`
7. Bind extracted filenames to `figure` blocks sequentially (image assets → `referent=image`, table assets → `referent=table`).

## Spotlight Range Detection

1. **End**: first paragraph matching `（X）N.` MCQ pattern.
2. **Start** (in priority order):
   - Paragraph starting with `◎小試身手` / `◎閱讀聚光燈` / `◎前一課` / `◎許多文章` / `◎這篇故事` / `步驟❶`
   - Non-scaffold 1x1 table with text containing `步驟|主角|問題|故事|聚光燈|圖文|閱讀|大主題|小主題|說明文|主旨`

**Notes**:
- Classical Chinese courses (strategy_type=`classical_grammar`) typically have NO spotlight section.
- Summary-structure courses (e.g., G6-SL8) may have the guide box with `大主題/小主題` as the start marker.

## Answer Extraction Rules（single/multi answer）

Answer = the option WITHOUT a □ prefix. Three patterns in priority order:

1. **Inline mixed** (same paragraph): `①answer  □②distractor` — no-□ circled item = answer.
2. **Same-line □-split**: First segment before first □ (after stripping question) = answer; after □ segments = distractors. Full-width spaces (　) within a segment separate sub-tokens (first = distractor, remaining = answer).
3. **Multi-line**: Lines after prompt without □/◎/步驟 = answer candidates; lines starting with □ = distractors. Also handles `1.text` (answer) vs `□2.text` (distractor) numbered format.

**Key fix**: For format `❶主角是誰？ □秦昭王　孟嘗君　□幸姬`, extract inline at classification time (`_classify_question_para`) — don't defer to post-process. Split at □ first, then at full-width space 　 to get sub-tokens.

## Passage Source Detection

- `source: supplementary`: guide block immediately before passage contains `孟嘗君|白狐裘|曹沖|大象|讓我們來看|課文另一個|進階挑戰|以下是一篇`
- `source: lesson_text`: passage text appears as substring of lesson YAML `story_text`
- `source: unknown`: fallback

**Normal-style passages** (e.g., 大象故事 in G6-L22): detected by `is_substantive_narrative()`:
- len > 40 chars, no □/①②③ prefix, no numeric question, no guide markers, no MCQ pattern.

## 程序

### 1. 抽取 raw ordered body
跑 `python3 scripts/build_lesson_schema.py <lesson_id> <docx_path>`。它用 python-docx 依文件順序吐出 paragraphs + tables（含 cell、合併偵測、圖片數），並自動標掉固定 scaffold（標頭/計時/我的表現/詞語解釋表/影片）。

### 2. 框定聚光燈段落
聚光燈 = 詞語應用練習**之後**、閱讀理解 5 題 MCQ（`（ X ）1.`）**之前**的所有 block。圖文整合課的聚光燈常從「步驟❶」或「練習一」開始。

### 3. 逐 block 分類
對段落區間每個元素，依上表線索標 type。重點：
- `passage` 要記 `source`: `lesson_text`（本課課文段落）或 `supplementary`（自備小文本，如孟嘗君/大象）+ 全文。
- `single`/`multi` 要抓 `prompt` / `options` / `answer(s)`（DOCX 正解=沒有 □ 的那個，或標楷/標色；抓不到標 `answer: null` 待人工）。
- `figure` 要記 `referent`: `image` 或 `table`，以及 `bind_paragraph`（對應第幾段）。
- `fill_table` 交給 build-keypoints 同款抽取，這裡只放引用。
- `match` (B5 trait-inference): 2-col table where header col0 contains 線索/文中/事件/言行, col1 contains 特質/情緒/推論 — output rows as `{left, right}` pairs.

### 4. 輸出 schema
```yaml
spotlight:
  lesson: G7-L29
  strategy_name: 圖文整合閱讀策略
  strategy_type: image_text
  blocks:
    - {type: guide, text: "前一課我們已經學過圖文整合…"}
    - {type: passage, source: lesson_text, paragraphs: [1]}
    - {type: highlight, instruction: "把第一段要看圖的地方畫線", bind_paragraph: 1}
    - {type: guide, text: "小祕訣：文字會告訴我們哪些地方要看圖…"}
    - {type: single, prompt: "這段要你看圖一的什麼？",
       options: ["1850年以來地球平均氣溫的變化趨勢","…最高溫度"], answer: "1850年以來…"}
    - {type: figure, referent: image, asset: "fig1.png", bind_paragraph: 1}
    - {type: free_text, prompt: "請用一句話，說明第三段和圖三的意思"}
    - {type: match, match_type: trait_inference, col_left: "文中線索", col_right: "人物特質",
       rows: [{left: "他把食物全分給了老人", right: "慷慨大方"}]}
    - {type: self_check, items: ["我會找出文章裡要看圖的地方", "…"]}
```
寫到 `private/curriculum-source/_online-schema/<lesson>.spotlight.yml`（gitignored 區，實驗產物）。

### 5. 驗收（每課必跑）
- [ ] block 數量、順序與 DOCX 一致（人工對照原始輸出）
- [ ] 教學脈絡（guide）有保留，沒被當垃圾丟掉
- [ ] 補充小文本（passage source=supplementary）有抓到（這是現行平台最常漏的）
- [ ] Normal 樣式補充段落（is_substantive_narrative）有被識別為 passage，非 free_text
- [ ] 圖/表 referent 有標 `bind_paragraph`；figure block 有 asset 路徑（不是 null）
- [ ] 每個 single/multi 有 answer；抓不到的標 null 並列出清單給人工補
- [ ] match 表格有正確識別（不是 free_text）
- [ ] 不夾帶閱讀理解 5 題 MCQ

## Multi-text / figure-asset 路徑（#2397 踩過的雷）

- 多文本課（`G4-L20-22…docx` 一檔多篇）的 **GCS 圖檔目錄用 parsed/compound code**（`G4-L20-22/`、`G8-L13/`），不是 catalog code（`G4-L20`、`G8-L10`）。圖檔名也帶 parsed 前綴（`G8-L13-13.jpg`）。算 figure 路徑要走 `catalog_to_parsed_code`，不能只 strip padding。
- `文-L*`（文言文）路徑含中文字，URL 要 **percent-encode**（`urllib.parse.quote`），否則 `'ascii' codec` 直接 crash 報假 fetch-error。
- story 引用合成 `figN.png` 但 GCS 只有真實 per-page 檔（`G7-L28-08.jpg`）→ figure 404。真解是修 story 的 figure reference 指真實檔名，**不要**自己造一張假圖蒙混。

## Ship gate — 改完憑證據宣稱，不憑感覺（#2397）

改聚光燈內容 / 抽取器 / 綁圖後，**PR 前必過 content evidence gate（fail-closed）**：

⚠️ **2026-08-31（#2730）：`content_evidence_gate.py` 目前不是可過的門** —— 它的 golden 凍結在 2026-07-03，早於 #2736 的多模態重抽，`golden_match` 對現行內容恆紅；而且它不在任何 workflow 裡。真正在跑、而且會擋的是 `bash specs/run-ci.sh` 的十道門（內容相關：Gate 5 結構棘輪 175 課、Gate 8 對**原稿 DOCX** 的忠實度證明）。要重立基準還是移除，見 #2730。

```bash
python scripts/content_evidence_gate.py --run-id <id>          # 全 304 cell（staging）
bash   scripts/content_evidence_ship_gate.sh --run-id <id>     # 須印 CONTENT_EVIDENCE_GATE=PASS
```

- ⛔ 禁用「API 200 / 看一下 render / 我覺得對了」當完成依據——只認 evidence 檔（`fail_cells=0` + `unknown_cells=0`，`figure_blacklist_hits=0`）。
- 真內容缺口（DOCX 無聚光燈段落、文言課型無此步驟、合成 figN 未上傳）→ 登錄 `backend/data/curriculum_qa/content_known_gaps.yaml`（`reading-strategy:` / `figure:` 段，reason 用 enum：`no_spotlight_source` / `classical_no_step` / `built_pending_deploy` / `figure_asset_not_uploaded`），標 `known_gap`（誠實，非 pass）。**禁把缺口 fake 成 pass。**
- `FIGURE_BLACKLIST_HIT`（placeholder 假圖被當真圖上線）是**真缺陷，永遠不可 gap-allow**，必補真圖。

## 反模式
- ❌ 從 `backend/data/lessons/*.yml` 反推（已被 parser 壓平，失真）
- ❌ 把 guide 教學脈絡省略（教授最在意的就是這段）
- ❌ 把補充小文本當成本課課文（孟嘗君/大象不是課文，是聚光燈自備教材）
- ❌ 猜 answer；抓不到就標 null，寧缺勿錯
- ❌ 用 FIRST bracket in filename for strategy — always use the LAST bracket
- ❌ 把 trait-inference match table 分類成 free_text（要用 match block）
- ❌ 忘記抽取 image/table assets（figure blocks must have asset path, not null）
- ❌ 多文本課用 catalog code 算圖檔目錄（要 parsed code）；文言課 URL 不 encode
- ❌ 憑 API 200 / render 一瞥宣稱完成（要過 content evidence ship-gate）
- ❌ 把真內容缺口 fake 成 pass（要登 content_known_gaps.yaml 標 known_gap）
