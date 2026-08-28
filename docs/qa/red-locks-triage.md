# 20 支紅的回歸鎖 — 逐支盤點與處置（#2964 P0-b）

> 這 20 支是「檔名帶 issue 號的回歸鎖」裡當時是紅的那些。
> 為某個 bug 寫的鎖，紅著、而且**不在 CI 具名清單裡所以沒有人會看到**。
>
> ⛔ **不准為了讓它綠而改斷言** —— 那正是它存在要防的事。
> 每支三選一，且要寫理由：
> **① 真 regression** 修 code、鎖不動 ｜ **② 期望過時** 改鎖並說明什麼合法地變了 ｜ **③ 沒價值** 刪
>
> 重跑：`cd backend && python -m pytest $(cat docs/qa/red-locks-triage.md | grep -oE 'tests/test_[a-z0-9_]+\.py' | sort -u | tr '\n' ' ') -q`

## 進度

**34 → 19 條紅**（20 支裡 **5 支已全綠**）

---

## ✅ 已處理（5 支）

### 1. `test_course_intro_present_2736` — ① 真 regression（已修）

**175 課的課程簡介整頁空白**，而 174 份 `metadata.yml` 的 intro 好好躺在磁碟上。

根因：#2916 把檔名改成 `{模組}.{slug}.yml`，載入端跟著改成 `glob("*.*.yml")`
（要兩個點），而**課級的 `metadata.yml` 只有一個點** —— 從此配不到。
`errata`（70 課）也一起消失，只是沒有人看得到。

修 `lesson_uid_loader`：新增 `COURSE_LEVEL_MODULES`，只對課級模組補回無 slug 的檔名。
鎖：`test_course_level_modules_are_loaded_2964.py`（4 條，含「每一種無 slug 的檔都要登記」）

### 2. `test_every_module_has_a_named_guard_2872` — ② 期望過時（已修）

報「1623 種模組沒登記誰在守」，而真正的類型只有二十幾種。
`p.stem` 對 `comprehension.34pme.yml` 回的是 `comprehension.34pme` —— 沒切掉 slug。
登記表登記的是**類型**，不是每一份檔。修掃描端，不動登記表。

### 3. `test_every_module_has_a_skill_2843` — ② 期望過時（已修）

同 2 的病，同一個修法。兩支各加一條「掃出來的必須是類型不是檔」的防呆。

### 4. `test_multi_text_and_followups_entry_2752` — ①＋② 混合（已修）

- `multi_text_parts missing` → **① 真 regression**：`multi_text_parts.yml` 也是無 slug 的課級檔（4 課，**前端有 9 處在讀**），同 1 的病。已登記。
- `L0063's questions[] shape lost` → **② 期望過時**：#2930 刻意把「第一篇專屬」的加碼題移進那一篇（留頂層會讓第 2、3 篇也看到「請依據第一篇文章的內容」）。改成兩層都找，鎖的是「形狀沒掉」不是「在哪一層」。

### 5. `test_lesson_ordering_2736` — 隨 1 一起好（已修）

原本 6 條紅，`metadata` 載回來之後全綠 —— 它讀的 `lesson_seq` 就在 metadata.yml 裡。

---

## 🔴 待處理（15 支 / 19 條）

| 支 | 條 | 錯誤 | 初判 |
|---|---|---|---|
| `test_perf_sql_aggregates` | 6 | `assert 403 == 201` | 待查 —— 403 像是權限，不是效能 |
| `test_ai_generation_split_1888` | 4 | `assert False is True`／`50 == 100`／`'戴資穎' in '參考答案：…'` | 待查 |
| `test_keypoints_shape_gate_empty_claim_2736` | 2 | `strict 也綠 = 那批欠的東西從此沒人看得到` | 待查 —— 可能是真的門失效 |
| `test_story_structure_cell_parser_2776` | 1 | — | 待查 |
| `test_step_sequence_from_worksheet_2736` | 1 | — | 待查 |
| `test_spotlight_table_content_2683` | 1 | — | 待查 |
| `test_spotlight_ordering_items_2683` | 1 | — | 待查 |
| `test_section_completeness_2876` | 1 | — | 待查 |
| `test_sample_uids_survives_missing_spotlight_2751` | 1 | — | 待查 |
| `test_n1_queries_fix_1217` | 1 | `Heatmap queries (8) exceeded student count (6)` | 待查 —— N+1 可能真的回來了 |
| `test_inline_choices_stay_in_the_sentence_2768` | 1 | `沒有標明哪組對應哪個空格` | 待查 |
| `test_every_lesson_detail_validates_2725` | 1 | `only 0 lessons keep a fluency target without a passage` | 待查 —— #2722 可能 regress |
| `test_docx_second_opinion_2868` | 1 | — | 待查 |
| `test_classrooms_dev_filter_1999` | 1 | `module has no attribute 'is_admin'` | ② 期望過時（refactor 搬走了）|
| `test_classical_modules_entry_2752` | 1 | `regular lesson should not get an invented step_sequence` | 待查 |

---

## 順帶抓到、不在這 20 支裡的真 bug

**`test_followup_never_vanishes_2964`（我這輪新開的鎖）**

L0144 的加碼題在磁碟上，載完之後**頂層沒有、三篇也都沒有** —— 整個大題消失。
根因是我自己在 #2930 引入的 fail-open：放置判斷只認 `part_no`，
而 L0144 是「閱讀接力」形狀（只有 `text_ref`）→ 永遠對不上 → 每一篇都不放、頂層又被清掉。

修法：`text_ref` 是清單（跨篇）就留頂層 —— 跟前端 `roundScope.ts` 既有的規則同一條
（「挑其中一篇會讓『綜合』變成『其中一篇』」）。

## 這一輪的模式

**15 條紅裡有 9 條的根因是同一件事**：#2916 改檔名之後，
「無 slug 的課級檔」與「帶 slug 的檔名」兩件事沒有被一起想過。
一個 glob 少一個點，三個模組（`metadata` 175 課、`errata` 70 課、`multi_text_parts` 4 課）
整批消失，而**沒有任何一道門會叫** —— 因為守它們的鎖不在 CI 清單裡。
