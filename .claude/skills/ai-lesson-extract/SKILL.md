---
name: ai-lesson-extract
description: 讓 AI 直接讀「原始學習單」(從 GCS 下載 DOCX → 轉 PDF → 多模態閱讀),自己判斷每一題的意義與呈現,產出一份「過契約驗證」的 lesson_content YAML。當需要「AI 擷取課文 / AI 讀學習單產 lesson / ai-lesson-extract / 用 AI 產 lesson_content」時使用。
---

# ai-lesson-extract — AI 自判題意 + 受控呈現的課文擷取

> 這是「拋棄確定性 regex 擷取、改由 AI 判斷」的路線(SPOTLIGHT_REFACTOR_PLAN 的 AI 版)。
> 你(Claude)**親自讀原始學習單**、判斷每題意義與呈現、產出一份 typed `Lesson` YAML。
> 核心紀律:**AI 決定「意義與呈現」,但答案必須鎖進可機器判分的結構化契約** —— 這正是
> 防止「好看但不能驗證 / overfit / 亂生」的護欄(Young 的 EDD 要求)。

## 你唯一的產物

一份 `backend/data/lessons/_ai_lessons/{CODE}.lesson.yml`,**必須通過**:

```bash
cd backend && .venv/bin/python ../scripts/eval_lesson_content.py ../backend/data/lessons/_ai_lessons/{CODE}.lesson.yml --markdown
```

→ 要印 `RESULT: PASS`(schema 合法 + 每題 answer_round_trip 綠)。沒過就改到過為止,**不可 fake**。

## 契約(唯讀,不可改)

`backend/app/schemas/lesson_content.py` 的 `Lesson`。範本看 `backend/tests/fixtures/lesson_content/G7-L30.lesson.yml`(圖文表整合,含 keypoints_table + graphic_text_integration + multiple_choice + 合併儲存格 table)。

- `Lesson{ id, lesson_code, title?, blocks[] }`
- `blocks` 是**有序** typed 序列:`paragraph / figure / table / parallel_passage / exercise`
- **答案不變量(鐵律,掛在每個 `exercise` 上,連 `custom` 都不豁免)**:
  - `answer_space` ∈ choice / multi_choice / text / order / free_text
  - `answer` = **可機器比對**的標準答案(索引 int、索引集 list[int]、字串、字串集、dict{blank_id: fill}…);**散文不算答案**
  - `grader` ∈ exact / set / ordered / rubric_ai / manual(且 space↔grader 要相容)
  - 判斷不出正解 → `answer` 可為 null **但**必須 `needs_review: true`(寧 🟡 不假 🟢)

## 輸入(可插拔來源,優先序)

1. **主路徑=真實原始學習單**:
   ```bash
   CODE=G4-L04   # lesson code,L 補零到 2 位
   mkdir -p /tmp/lingoleap-worksheets
   curl -sS -o /tmp/lingoleap-worksheets/$CODE.docx \
     "https://storage.googleapis.com/lingoleap-assets/worksheets/$CODE.docx"
   /Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to pdf \
     --outdir /tmp/lingoleap-worksheets /tmp/lingoleap-worksheets/$CODE.docx
   # 然後用 Read tool 讀 /tmp/lingoleap-worksheets/$CODE.pdf(多模態,看得到圖片位置與表格)
   ```
   (需本機裝 LibreOffice + poppler:`brew install --cask libreoffice && brew install poppler`)
2. **交叉校對**(補答案/驗證,非主來源):`backend/data/lessons/_parsed_2026-05-01/{CODE}.yml`(story_structure_table / strategy_exercise / vocab_bank / fill_in_blank)、`backend/data/lessons/_reparsed_2026-05-02/spotlight_structured/{CODE}.json`。
   > 注意:GCS 上多為**學生版**(答案空白)。答案要從課文語意推導,或用交叉校對來源補;推不出的標 `needs_review`。

## 怎麼「判斷題意」→ 對應題型(決策樹)

| 你在學習單看到 | 對應 | 答案形狀 |
|---|---|---|
| 課文段落 | `paragraph` block | — |
| 插圖 / 圖 N(**記錄它在第幾段旁邊**)| `figure` block(`label`,`caption` 寫圖在講什麼)| 用 exercise 的 `anchors` 綁到它所解說的段落/表格 |
| 純資料表(呈現用)| `table` block(合併儲存格用 `grid`/`section_label_col`)| — |
| 文言↔白話雙欄對照 | `parallel_passage` block | 判分交給錨定它的 fill_in_blank |
| 單選題 | `multiple_choice` | answer=int 索引 |
| 可複選 | guided_steps 內 `multi_select` step | answer=list[int] |
| 語詞填空 / 語詞應用(選代號)| `fill_in_blank`(選代號用 `vocab_bank`;多格用 `slots`)| str / list[str] / dict |
| 排順序 | `ordering` | answer=list |
| 人物特質推論 | `trait_inference` | answer=index |
| 文章重點表(【 】填空)| `keypoints_table`(□ 選擇填 `KeypointBlank.options`)| answer=dict{blank_id: fill} |
| 連連看 / 配對 | 用 `guided_steps`,每個左項當一個 `select` step(選右欄哪一項)| 每 step answer=int |
| 閱讀聚光燈(逐步引導)| `guided_steps` / `graphic_text_integration`(steps 引用圖表時綁 anchors)| 逐 step + 組裝 list |
| 真的沒有對應結構 | `custom` + `needs_review: true`(`render_hint` 寫呈現說明,**答案仍要填**)| — |

**圖片位置與表格意義(使用者特別指定)**:讀 PDF 時明確記錄每張圖出現在**哪一段旁邊**、每個表是「呈現/重點填空/圖文整合」哪一種;把這關係用 block 順序 + `anchors` 忠實表達。

## 鐵律(違反 = 失敗)
1. 每個 exercise 必有 `answer_space` + 機器可比 `answer` + `grader`。散文不是答案。
2. `anchors.block_id` 必須指向存在的 paragraph/figure/table/parallel_passage block。
3. block `id` 唯一且穩定(如 p1/fig-1/table-1/ex-vocab)。
4. 判不準 → `needs_review: true`,不要瞎填索引、不要把散文塞進 answer。
5. **禁止把特定課的逐字答案寫進本 SKILL / few-shot**(overfit lint 會掃)。few-shot 用與目標課不同的例子。
6. 逐題在對話/PR 說明你的判斷依據(reasoning **不寫進 YAML**,避免污染契約)。

## 收尾(自驗)
1. `eval_lesson_content.py {CODE}.lesson.yml --markdown` → `RESULT: PASS`。
2. 檢查 coverage 紅綠燈:answer-verifiable 🟢;需人審的誠實 🟡(needs_review>0),不可假 🟢。
3. 人眼抽審:對照 PDF,題目/選項/答案/圖表有沒有漏或錯 —— 漏的補、錯的改、拿不準的標 review。
