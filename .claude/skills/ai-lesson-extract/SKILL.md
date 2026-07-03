---
name: ai-lesson-extract
description: 讓 AI 直接讀「原始學習單」(從 GCS 下載 DOCX → 轉 PDF → 多模態閱讀),自己判斷「閱讀聚光燈」每一題的意義與呈現,產出一份「過契約驗證」的 lesson_content YAML。當需要「AI 擷取聚光燈 / AI 讀學習單產 lesson / ai-lesson-extract / 用 AI 產 lesson_content」時使用。
---

# ai-lesson-extract — AI 自判題意 + 受控呈現的「閱讀聚光燈」擷取

> 這是「拋棄確定性 regex 擷取、改由 AI 判斷」的路線(SPOTLIGHT_REFACTOR_PLAN 的 AI 版)。
> 你(Claude)**親自讀原始學習單**、判斷聚光燈每題的意義與呈現、產出一份 typed `Lesson` YAML。
> 核心紀律:**AI 決定「意義與呈現」,但答案必須鎖進可機器判分的結構化契約** —— 這正是
> 防止「好看但不能驗證 / overfit / 亂生」的護欄(Young 的 EDD 要求)。

## 範圍:只做「閱讀聚光燈」(重要)

**這輪只擷取「閱讀聚光燈」(reading strategy)這一個模組,以及它所依賴的課文段落/圖/表。**

- ✅ **擷取**:閱讀聚光燈的引導練習(通常是 `guided_steps` / `graphic_text_integration`)+ 它 anchor 到的 `paragraph` / `figure` / `table` / `parallel_passage`。
- ❌ **不擷取**(它們是**各自獨立的模組**,不在本 skill 範疇):
  - **文章重點表**(story-structure / keypoints_table)——獨立模組。
  - 語詞我最棒 / 語詞應用、閱讀理解選擇題、生字、朗讀計時、知識補給站…等非聚光燈練習。
  - 例外:若某題是聚光燈引導流程**內部**的一步(如 G7-L30 練習四的填空),那它算聚光燈,擷取。

### 哪些課「有閱讀聚光燈」值得做
只做聚光燈是**真正閱讀策略**的課,判斷方式:看
`backend/data/lessons/spotlight/{dev7,test15,catalog}/{CODE}.spotlight.yml` 是否存在,且其
`strategy_type` 屬閱讀策略(如 `summary_*` / `image_text` / `table_text` / `inference` /
`main_idea_inference` / `sel_character` / `trait_inference` …)。
- ⛔ `strategy_type: writing_technique`(句型練習,如「認識句型-條件複句」)**不算**閱讀聚光燈 → 略過。
- ⚠️ 命名差異:**catalog 用不補零碼**(`G4-L4`),**GCS URL 用補零碼**(`G4-L04`)。查檔用前者、下載用後者。

## 你唯一的產物

一份 `backend/data/lessons/_ai_lessons/{CODE}.lesson.yml`(CODE 用不補零碼,如 `G6-L22`),**必須通過**:

```bash
cd backend && .venv/bin/python ../scripts/eval_lesson_content.py ../backend/data/lessons/_ai_lessons/{CODE}.lesson.yml --markdown
```

→ 要印 `RESULT: PASS`(schema 合法 + 每題 answer_round_trip 綠)。沒過就改到過為止,**不可 fake**。

## 契約(唯讀,不可改)

`backend/app/schemas/lesson_content.py` 的 `Lesson`。範本看 `backend/tests/fixtures/lesson_content/G7-L30.lesson.yml`。

- `Lesson{ id, lesson_code, title?, blocks[] }`;`blocks` 是**有序** typed 序列:`paragraph / figure / table / parallel_passage / exercise`
- **答案不變量(鐵律,掛在每個 `exercise` 上,連 `custom` 都不豁免)**:
  - `answer_space` ∈ choice / multi_choice / text / order / free_text
  - `answer` = **可機器比對**的標準答案(索引 int、索引集 list[int]、字串、字串集、dict{blank_id: fill}…);**散文不算答案**
  - `grader` ∈ exact / set / ordered / rubric_ai / manual(且 space↔grader 要相容)
  - 判斷不出正解 → `answer` 可為 null **但**必須 `needs_review: true`(寧 🟡 不假 🟢)
  - 註:這些答案不只用來判分,也用於**進度恢復**——學生重整頁面後,渲染器會用 `select`/`multi_select` 的機器索引**重算並還原**每步判分,`free_text` 步驟則用 `reference_answer` 做離線近似。因此機器可判分步驟的 `answer` 必須**正確**,且 `free_text` 步驟務必附 `reference_answer`(否則重整後無法還原、也無範答可對)。

## 輸入(可插拔來源,優先序)

1. **主路徑=真實原始學習單**:
   ```bash
   CODE=G4-L04   # GCS 用補零碼(L 補零到 2 位)
   mkdir -p /tmp/lingoleap-worksheets
   curl -sS -o /tmp/lingoleap-worksheets/$CODE.docx \
     "https://storage.googleapis.com/lingoleap-assets/worksheets/$CODE.docx"
   /Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf \
     --outdir /tmp/lingoleap-worksheets /tmp/lingoleap-worksheets/$CODE.docx
   # 然後用 Read tool 讀 /tmp/lingoleap-worksheets/$CODE.pdf(多模態,看得到圖片位置與表格)
   ```
   (需本機裝 LibreOffice + poppler:`brew install --cask libreoffice && brew install poppler`)
2. **交叉校對**(補答案/驗證,非主來源):`backend/data/lessons/spotlight/*/{不補零CODE}.spotlight.yml`、
   `backend/data/lessons/_parsed_2026-05-01/{CODE}.yml`、既有手工 fixture `backend/tests/fixtures/lesson_content/{CODE}.lesson.yml`(若有)。
   > 注意:GCS 上多為**學生版**(答案空白)。答案從課文語意推導,或用交叉校對來源補;推不出的標 `needs_review`。

## 怎麼把聚光燈「判斷 + 呈現」成契約

### A. 題型對應(聚光燈內部會用到的)

| 你在聚光燈看到 | 對應 | 答案形狀 |
|---|---|---|
| 逐步引導練習(❶❷❸❹…)| `guided_steps`;引用圖/表時用 `graphic_text_integration` | 逐 step + 組裝 list |
| 打勾單選(□)/ 選分句 | step `type: select` | int 索引 |
| 可複選 | step `type: multi_select` | list[int] |
| 開放填答 / 畫線圈詞 | step `type: free_text`(`reference_answer` 放範答)| null(rubric) |
| 連連看 / 配對 | `guided_steps`,每個左項一個 `select` step(選右欄哪一項)| 每 step int |
| 聚光燈流程內的填空(如某練習的推論格)| step `free_text`,或 `fill_in_blank` 另一 exercise 綁同 anchors | — |
| 聚光燈用到的圖 | `figure` block(**記錄在第幾段旁邊**,`caption` 寫圖在講什麼)| 用 exercise `anchors` 綁 |
| 聚光燈用到的表 | `table` block(合併儲存格用 `grid`/`section_label_col`)| 用 `anchors` 綁 |
| 真的沒有對應結構 | `custom` + `needs_review: true`(`render_hint` 寫呈現說明,**答案仍要填**)| — |

**圖片位置與表格意義(使用者特別在意)**:讀 PDF 時明確記錄每張圖在**哪一段旁邊**、每個表的意義;用 block 順序 + `anchors` 忠實表達。

### B. 呈現結構:用 `section` 分區、範例自成一體、prompt 不重複(重要)

聚光燈常是「**範例 → 課文 → 小試身手**」這種多段引導。渲染器會**按 `section` 把步驟整併成一個區塊**,所以:

1. **每個 `GuidedStep` 加 `section`**(區段標題,如 `例一：烏鴉喝水` / `課文故事` / `小試身手一` / `小試身手二：大象有多重？`)。同一段的步驟用**相同** section 字串 → 渲染成同一區塊,標題只出現一次。
2. **區段層級的純呈現引導** → 放在該段**第一個 step 的 `context`**(渲染器在區塊頂只顯示一次)。這包含:範例/示範故事的短文(如烏鴉喝水),**以及**「祕訣」「我們可以這樣思考」思考框等區段引言。**不要**把範例短文塞進 `paragraph` 課文段落(會和真正課文混淆),也**不要**每步重複。(無範例故事的課,`context` 就放該區的祕訣/引言即可。)
3. **step 的 `prompt` 只寫問題本身**(如 `❶主角是誰？`),**不要**在每步重複區段名(「例一:烏鴉喝水…」「接下來,我們來看課文的故事…」)——那交給 `section`。
4. `context` / `section` / `render_hint` 都是**純呈現**,永遠**不放答案**。

### C. 版面模型:左=課文、右=作答區(擷取時的分類原則)

渲染器把 reading-strategy 頁分成**兩欄**:
- **左欄=閱讀材料**:所有非 exercise 的 block(`paragraph` / `figure` / `table` / `parallel_passage`),依原文順序。**本課課文自帶、供對照的圖/表放這裡**(學生邊看邊答)。
- **右欄=聚光燈作答區**:所有 `exercise` block(引導步驟 + 選項/輸入)。

擷取時據此分類:
- 課文段落、以及**課文的對照圖/表**(如 G7-L30 的圖一/表一/表二)→ 做成**頂層 `figure`/`table` block**(自動歸左),由聚光燈 exercise 的 `anchors` 指向它們。
- **若某聚光燈題目自帶、只服務該題的圖**(非課文對照材料)→ 應歸右欄、跟著題目。目前契約**沒有** per-question 圖片欄位,所以這種情況:在該 exercise 用 `custom` 的 `render_hint` 記錄該圖語意 + 標 `needs_review: true`(誠實標記待補),**不要**把它當成課文對照圖放頂層(否則會錯誤出現在左欄當閱讀材料)。這是已知限制,遇到就登缺口,別硬塞。

## 鐵律(違反 = 失敗)
1. 只做聚光燈 + 其 anchor 的段落/圖/表;不擷取重點表/語詞/閱讀理解等其他模組。課文對照圖表 → 頂層 block(渲染在左欄);題目專屬圖 → 依 §C 處理(勿當課文圖放左欄)。
2. 每個 exercise 必有 `answer_space` + 機器可比 `answer` + `grader`。散文不是答案。
3. `anchors.block_id` 必須指向存在的 paragraph/figure/table/parallel_passage block。
4. block `id` 唯一且穩定(如 p1/fig-1/table-1/ex-spotlight)。
5. 同段步驟用相同 `section`;範例短文放該段第一步的 `context`;prompt 不重複區段名。
6. 判不準 → `needs_review: true`,不要瞎填索引、不要把散文塞進 answer。
7. **禁止把特定課的逐字答案寫進本 SKILL / few-shot**(overfit lint 會掃)。few-shot 用與目標課不同的例子。
8. 逐題在對話/PR 說明判斷依據(reasoning **不寫進 YAML**,避免污染契約)。

## 收尾(自驗)
1. `eval_lesson_content.py {CODE}.lesson.yml --markdown` → `RESULT: PASS`。
2. coverage 紅綠燈:answer-verifiable 🟢;需人審的誠實 🟡(needs_review>0),不可假 🟢。
3. 人眼抽審:對照 PDF,聚光燈的題目/選項/答案/圖表有沒有漏或錯,以及**區段分組/範例呈現**是否直覺(範例自成一體、prompt 沒重複區段名)。
