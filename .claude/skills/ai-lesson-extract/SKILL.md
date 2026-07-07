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

- ✅ **擷取**:閱讀聚光燈的引導練習(通常是 `guided_steps` / `graphic_text_integration`)+ 課文左欄的**骨架**(段落/圖/表 block)+ 聚光燈題目自帶的補充短文(放 exercise `context`)。

  > **🔑 分工(重要,決定你要不要「分析課文」):課文左欄的「內容」由 loader 自動從權威來源 `_parsed_2026-05-01/{CODE}.yml` 灌入,你只負責「骨架 + 聚光燈題目」。** `lesson_content_loader._hydrate_reading_from_parsed` 在服務時會用 `_parsed` 覆蓋每個 `paragraph` 的 `text`(段落數一致時)與每個 `figure` 的 `asset`(依 `圖N` label / 順序)。所以:
  > - **`paragraph`**:放**與 `_parsed.paragraphs` 相同數量、相同順序**的段落 block(id `p1..pN`)。text 直接**從 `_parsed` 複製**即可(loader 會再灌一次)——**不要**逐字重打 PDF、也不要只放 anchor 到的那幾段(段數不符 loader 會跳過灌入 → 又回到你抄的版本)。
  > - **`figure`**:放與 `_parsed.images` 對應的 figure block,**標上 `圖N` 的 `label` + 正確交錯位置**;`asset` 直接抄 `_parsed.images[].filename`(loader 會依 label 確認/覆蓋成 GCS 正確檔)——**不必**自己去挑圖或核對圖檔(那是先前反覆出錯的地方,現在交給 loader)。
  > - **`table`**:loader **不灌**表,仍要你依 `_parsed.tables` 忠實轉成契約 `TableBlock`(headers/rows/`grid` 合併格),見 §A。
  > - 交錯順序(段落↔圖↔表)由你依 PDF 版面判斷(`_parsed` 沒存位置);`anchors` 指向這些 id。
- ❌ **不擷取**(它們是**各自獨立的模組**,不在本 skill 範疇):
  - **文章重點表**(story-structure)這個**練習模組的內容**——獨立模組,不擷取。(注:`keypoints_table` 這個**契約型別**可作為聚光燈內「答案承載表格」的機制使用,見 §A——此處指的是別去擷取「文章重點表」那個獨立練習,不是禁用該型別。)
  - 語詞我最棒 / 語詞應用、閱讀理解選擇題、生字、朗讀計時、知識補給站…等非聚光燈練習。
  - **主觀自評 / 後設反思清單**(如「◎自我檢核」「我學會找問題/解決/結果了嗎」「我覺得…」勾選)——**無客觀答案 → 依答案不變量根本不成題,不擷取**(與語詞/計時同屬範圍外,即使它印在聚光燈那一節的結尾)。判準:一個項目若沒有「能機器比對的正解」(它問的是學生的自我感受,勾幾項都不算錯)→ 就不是聚光燈作答題。
    - ⚠️ 這類清單**最容易讓 skill 不穩定**:硬給它標準答案(如「四項全勾」)=造假客觀性(錯);塞成 `custom`+manual grader=前端無法判分、卡住完成閘(也錯)。**唯一穩定解=不做它**(留給紙本/未來的自評模組)。
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

### A. 大原則:先判「答案是什麼形狀」,再選讓答案可驗證的契約機制

聚光燈每題 = 材料 + 一個要學生產出的答案。**擷取的核心判斷只有一個:這一題的答案是什麼形狀?** 依形狀選能讓答案「可機器比對」或「可對範答(rubric)」的機制。**不要用策略的名字(推論/摘要/圖文…)去對映題型——策略名 ≠ 呈現型別;同一種策略在不同學習單可能是填空、表格或申論。** 這張表是把「答案形狀」對應到機制,不是窮舉題型;沒見過的版面一樣先問「答案是什麼形狀」。

| 紙上的作答形狀 | 契約機制 | 答案 |
|---|---|---|
| 有給選項 / □ 勾選一個 | `guided_steps` 內 step `select` | int 索引 |
| □ 可複選 | step `multi_select` | list[int] |
| 單一確定填空(紙上**沒給**選項) | step `free_text` + `reference_answer` —— **不要自己捏造選項把它變成選擇題** | null(rubric) |
| 開放推論 / 申論(如「你覺得他是怎麼樣的人」,無唯一解) | step `free_text` + `reference_answer` —— rubric 判分**就是**它的機制,**不是** needs_review、也**不要**假造一個「標準答案」 | null(rubric) |
| 一格格要填、每格都是答案的**表格**(代號對應) | `keypoints_table`:每列 `label`=給定線索、`blank_ids`→`blanks`(代號);格子可 free-fill,或帶 `options` 的 □-choice | dict{代號: 值},exact |
| 逐步引導(❶❷❸…)、連連看 / 配對 | `guided_steps`(每個左項一個 `select`);題目要看圖/表作答時用 `graphic_text_integration` | 逐 step 組裝 list |
| 畫線 / 圈詞這類**紙本動作** | 改寫 `prompt` 成數位可作答(見下),型別 `free_text` + `reference_answer` | null(rubric) |
| 主觀自評 / 後設反思(◎自我檢核,勾幾項都不算錯) | **範圍外,不做**(無客觀答案 → 依答案不變量不成題) | — |
| 真的判不出任何可比對 / 可對範的形狀 | `custom` + `needs_review: true`(答案仍要填,或 null) | — |

> `keypoints_table` 是**機制**(答案承載表格),與範圍外的「文章重點表**模組**」是兩回事:聚光燈題目本身若是一個要填的表,就用這個機制;只是不要去擷取「文章重點表」那個獨立練習的內容。

**圖片位置與表格意義(使用者特別在意)**:讀 PDF 時明確記錄每張圖在**哪一段旁邊**、每個表的意義;用 block 順序 + `anchors` 忠實表達。

**紙本動作指示要改寫成數位可作答(重要)**:紙本常有「畫線 / 圈起來 / 畫記」這類動作,但數位版學生**無法在課文上畫線**。遇到這類 step,**改寫 `prompt`** 成可作答的指示 —— 例如「請把第X段中要你看圖的地方**畫線**」→「請找出第X段中要你看圖的**那句話,寫下來**」、「找出重點句並**畫線**」→「找出重點句並**寫下來**」。型別維持 `free_text`,並附 `reference_answer`(該畫線/該圈的正確內容)。不要保留學生做不到的「畫線/圈起來」字眼。

### B. 呈現結構:用 `section` 分區、範例自成一體、prompt 不重複(重要)

聚光燈常是「**範例 → 課文 → 小試身手**」這種多段引導。渲染器會**按 `section` 把步驟整併成一個區塊**,所以:

1. **每個 `GuidedStep` 加 `section`**(區段標題,如 `例一：烏鴉喝水` / `課文故事` / `小試身手一` / `小試身手二：大象有多重？`)。同一段的步驟用**相同** section 字串 → 渲染成同一區塊,標題只出現一次。
2. **呈現保真不變量(唯一原則,取代一長串「哪種段落放哪」的個案規則)**:

   > **學生作答任一題時,答那題所需的全部材料(情境短文、圖、表、指示語)都必須在畫面上可得;紙上出現一次的東西,數位版也只呈現一次。**

   這一句同時決定「context 放什麼、放哪、放幾次」。實務對應(以下是**例子,非窮舉**——遇到沒列到的版面,回到上面那句話判斷,不要硬套例子):
   - 作答某題需要一段短文/故事,而它**不在左欄課文裡** → 該短文必須進所屬 `section` 第一步的 `context`,否則那題無材料可答(最常漏、後果最重)。
   - 短文雖在課文裡、但學習單為該段另給了簡化版供作答 → 也放該段 `context`(忠實呈現,不逼學生翻全文)。
   - 「祕訣」「我們可以這樣想」思考框、開場教學說明 → 也是材料,不可因擷取消失:**共用**開場(不屬任一子流程)放 exercise `instruction`;**某段專屬**引言放該段 `context`。
   - **只放一處**:同一段文字不要同時進 `instruction` 和 `context`(會顯示兩次);開頭重疊即重複,擇一。
   - 這些純呈現文字**不要**塞進 `paragraph` 課文段落(會和真正課文混淆),也不要每步重複。

   **通則出口(這才是應付「沒見過的學習單」的機制,不是再加規則):** 遇到本 SKILL 未描述過的版面/題型,先用上面的不變量判斷;若判不出對應的契約結構、或無法確定材料歸屬 → **`needs_review: true` 並在回報說明**,絕不臆造、不硬塞。交給 eval + 人審接住。寧 🟡 不假 🟢。
3. **step 的 `prompt` 只寫問題本身**(如 `❶主角是誰？`),**不要**在每步重複區段名(「例一:烏鴉喝水…」「接下來,我們來看課文的故事…」)——那交給 `section`。
4. `context` / `section` / `render_hint` 都是**純呈現**,永遠**不放答案**。

### C. 大原則:材料放哪一欄 = 「它是共用閱讀材料,還是這一題專屬的東西」

渲染器兩欄:**左欄 = 學生『讀來作答的共用材料』**;**右欄 = 題目本身 + 這一題專屬的圖/表**。判斷原則(取代舊的「題目專屬圖只能 custom+needs_review」——契約已支援 `placement`):

- **共用閱讀材料**(課文段落;全課共用、跨題對照的圖/表,如 G7-L30 的圖一/表一/表二)→ 頂層 `paragraph`/`figure`/`table` block,**預設歸左**,exercise 用 `anchors` 指向。
- **某題專屬的圖/表**(只服務那一題、學生要看著它答那題)→ **歸右欄、跟題目一起**:
  - 圖 → `figure` block 加 `placement: exercise`(渲染在右欄作答區;`asset` 規則見鐵律9)。
  - 要作答的表(格子是答案) → 直接用 `keypoints_table`(它本身是 exercise,天生在右欄可填,見 §A)。
  - 純呈現、不作答的對照小表 → `table` block 加 `placement: exercise`。
- 讀 PDF 時明確記錄每張圖在哪一段旁、每個表的意義,用 block 順序 + `placement` + `anchors` 忠實表達。
- **呈現保真不變量(§B.2)不變**:不論放左放右,答某題所需材料都要在畫面上、紙上一次數位一次;判不出歸屬 → `needs_review`,別硬塞。

## 鐵律(違反 = 失敗)
1. 只做聚光燈 + 其 anchor 的段落/圖/表;不擷取重點表/語詞/閱讀理解等其他模組。分欄依 §C 的原則(共用材料→左欄 block;題目專屬圖/表→右欄,用 `placement: exercise` 或 `keypoints_table`),不再用「custom+needs_review 佔位」處理題目專屬圖。
2. 每個 exercise 必有 `answer_space` + 機器可比 `answer` + `grader`(開放申論用 `free_text`+`reference_answer` 交給 rubric,也算滿足)。散文不是答案。答案形狀決定 exercise 型別,見 §A;**不要為了湊「可機器比對」而捏造選項**。
3. `anchors.block_id` 必須指向存在的 paragraph/figure/table/parallel_passage block。
4. block `id` 唯一且穩定(如 p1/fig-1/table-1/ex-spotlight)。
5. **呈現保真不變量**(見 §B.2):答每題所需材料都要在畫面上可得(不在課文的補充短文必進該段 `context`)、紙上一次數位一次(不重複)、教學鷹架不因擷取消失;同段步驟用相同 `section`,prompt 不重複區段名。
6. 判不準 → `needs_review: true`,不要瞎填索引、不要把散文塞進 answer。
7. **禁止把特定課的逐字答案寫進本 SKILL / few-shot**(overfit lint 會掃)。few-shot 用與目標課不同的例子。
8. 逐題在對話/PR 說明判斷依據(reasoning **不寫進 YAML**,避免污染契約)。
9. **`figure` 的 `asset` 抄自 `_parsed.images[].filename`(= GCS 正確檔,前端 `buildImageSrc` 打 GCS),不要去挑本機 `backend/data/images/`**(那份編號與 GCS 不同,曾害人把對的值改成 404)。loader `_hydrate_reading_from_parsed` 會依 `圖N` label(**沒有 label 時退回位置對應** `images[i]`)覆蓋 asset。⚠**位置對應不可靠**:`_parsed.images` 可能夾雜非插圖(如 QR code)、且常無 `figure_label`——這時 `images[i]` 未必是你要的圖(G5-L8 就是 images=[凳子,QR,步驟圖,QR])。所以:**認圖看內容不看編號**——擷取聚光燈用到的圖時,先確認那個 `_parsed.images[].filename` 的內容真的是該圖(必要時開圖或 `curl` GCS 200 核對),對不上 / 判不出就 `needs_review`,別硬指一個編號。

## 收尾(自驗)
1. `eval_lesson_content.py {CODE}.lesson.yml --markdown` → `RESULT: PASS`。
2. coverage 紅綠燈:answer-verifiable 🟢;需人審的誠實 🟡(needs_review>0),不可假 🟢。
3. 人眼抽審:對照 PDF,聚光燈的題目/選項/答案/圖表有沒有漏或錯,以及**區段分組/範例呈現**是否直覺(範例自成一體、prompt 沒重複區段名)。
4. **呈現保真自問(逐題)**:「答這題需要的材料,學生在畫面上都拿得到嗎?」逐題掃過——引用的短文/圖/表/思考框有沒有漏掉(尤其不在課文的補充短文)、有沒有同段文字重複兩次。有漏→補;判不出→ `needs_review`。
5. **課文左欄內容(段落 text / 圖 asset)由 loader 從 `_parsed` 灌,你只驗骨架對齊**:
   - `paragraph` block 數量與順序要**等於 `_parsed.paragraphs`**(數量不符 loader 不灌,會退回你抄的版本 → 可能缺段)。核對:數 `_parsed.paragraphs` 幾段,YAML 就幾個 `p1..pN`。
   - 每個 `figure` block 的 `asset`/`label` 要對到 `_parsed.images` 裡**正確那張**(認內容,caption 對得上)。**別只信 loader hydration**:它沒 label 時是位置對應,而 `_parsed.images` 可能夾雜非插圖(QR)→ 位置對應會指錯(見鐵律9)。所以擷取聚光燈用到的圖時,必要時開圖 / `curl` GCS 200 核對內容,判不出就 `needs_review`。
   - `table` block loader **不灌**,仍要對照 `_parsed.tables` 逐格核對(含合併格)。
