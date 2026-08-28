# 20 支紅的回歸鎖 — 逐支盤點與處置（#2964 P0-b）

> 這 20 支是「檔名帶 issue 號的回歸鎖」裡當時是紅的那些。
> 為某個 bug 寫的鎖，紅著、而且**不在 CI 具名清單裡所以沒有人會看到**。
>
> ⛔ **不准為了讓它綠而改斷言** —— 那正是它存在要防的事。
> 每支三選一，且要寫理由：
> **① 真 regression** 修 code、鎖不動 ｜ **② 期望過時** 改鎖並說明什麼合法地變了 ｜ **③ 沒價值** 刪

## 結果

**34 條紅 → 0**。20 支全處理完，連同這輪新開的 4 支，
**24 支已插進 `.github/workflows/pytest.yml` 的具名清單**（該 step 70 → 94 支，全 workflow 113 → 137）。

重跑（照 CI 的順序，不是自己排的順序 —— 見下方「順序會改變結果」）：

```bash
cd backend && python3 - > /tmp/step_files.txt <<'PY'
L=open("../.github/workflows/pytest.yml").read().split("\n")
s=next(i for i,l in enumerate(L) if "Run regression locks (issue-numbered)" in l)
f=next(i for i in range(s,len(L)) if L[i].strip().startswith("tests/"))
last=f
while last+1<len(L) and L[last+1].strip().startswith("tests/"): last+=1
for i in range(f,last+1): print(L[i].strip().rstrip("\\").strip())
PY
DATABASE_URL=sqlite:// JWT_SECRET_KEY=ci-test-secret-key-not-for-production TTS_PROVIDER=google \
  python -m pytest -q $(tr '\n' ' ' < /tmp/step_files.txt)
# 2026-08-28 實跑：691 passed · 16 skipped · 0 failed · 1m52s
```

---

## 逐支處置

| # | 支 | 判 | 什麼壞了／什麼合法地變了 | commit |
|---|---|---|---|---|
| 1 | `test_course_intro_present_2736` | ① | **175 課的課程簡介整頁空白**。#2916 把檔名改成 `{模組}.{slug}.yml`，載入端跟著改成 `glob("*.*.yml")`（要兩個點），而**課級的 `metadata.yml` 只有一個點** → 從此配不到。`errata`（70 課）一起消失，只是沒人看得到 | `afb83e5d8` |
| 2 | `test_lesson_ordering_2736` | ① | 隨 1 一起好 —— 它讀的 `lesson_seq` 就在 `metadata.yml` 裡 | `afb83e5d8` |
| 3 | `test_every_module_has_a_named_guard_2872` | ② | 報「1623 種模組沒登記誰在守」，真正的類型只有二十幾種。`p.stem` 對 `comprehension.34pme.yml` 回的是 `comprehension.34pme`。登記表登記的是**類型**不是每一份檔 → 修掃描端，不動登記表 | `d6b50c624` |
| 4 | `test_every_module_has_a_skill_2843` | ② | 同 3 的病、同一個修法。兩支各加一條「掃出來的必須是類型不是檔」的防呆 | `d6b50c624` |
| 5 | `test_multi_text_and_followups_entry_2752` | ①＋② | ① `multi_text_parts.yml` 也是無 slug 的課級檔（4 課，**前端 9 處在讀**）② `L0063` 的 `questions[]` 形狀「移了層」是 #2930 刻意的（留頂層會讓第 2、3 篇看到「請依據第一篇文章」）→ 鎖改成兩層都找，鎖形狀不鎖位置 | `57a582dea` |
| 6 | `test_every_lesson_detail_validates_2725` | ① | **每一課的流暢率門檻整批沒送出去**（#2722 regress）→ 175 課全部退回年級預設值，而每張學習單印的是自己那張表 | `143944465` |
| 7 | `test_classrooms_dev_filter_1999` | ② | `module has no attribute 'is_admin'` —— #2470 把它拆成 `is_system_admin` + `resolve_user_org_ids` 了。改 monkeypatch 對象 | `143944465` |
| 8 | `test_perf_sql_aggregates` | ② | `assert 403 == 201`：建班級現在要**學校成員身分**，fixture 少建那一筆。不是效能問題 | `9084edad8` |
| 9 | `test_ai_generation_split_1888` | ① | **錯誤回饋把提示問句當成正解印給學生**（`hint` 蓋過 `value`）→ 改成 `value` 為空才退到 `hint` | `9084edad8` |
| 10 | `test_spotlight_table_content_2683` | ② | 鎖綁死舊詞彙／舊欄名，內容本身沒掉 | `2f71ced52` |
| 11 | `test_spotlight_ordering_items_2683` | ② | 同 10 | `2f71ced52` |
| 12 | `test_step_sequence_from_worksheet_2736` | ② | 與 13 是**互相矛盾的一對**：一支要求一般課不得長出 `step_sequence`，另一支要求文言文課要有。判準改成看課的型別，不是一刀切 | `508d747d7` |
| 13 | `test_classical_modules_entry_2752` | ② | 同 12 | `508d747d7` |
| 14 | `test_section_completeness_2876` | ① | **章節名對照表漏 25 種寫法**（學習單常帶副標：`閱讀聚光燈-自我提問策略1-讀出段落重點`）→ 改成先精確再最長前綴，補 7 個別名 | `508d747d7`／`f398365f3` |
| 15 | `test_story_structure_cell_parser_2776` | ② | 改成棘輪（`<=` 不是 `==`）—— 原本寫死集合，缺口**被補好**的那天反而會紅 | `f398365f3` |
| 16 | `test_sample_uids_survives_missing_spotlight_2751` | ① | `sample_uids()` 只 glob `spotlight.yml`（無 slug）→ **真實語料一課都取不到**。slug 第五處 | `f398365f3` |
| 17 | `test_docx_second_opinion_2868` | ① | 寫死無 slug 檔名。slug 第六處 | `340d20778` |
| 18 | `test_n1_queries_fix_1217` | ② | `Heatmap queries (8) exceeded student count (6)` —— **判準本身是錯的**：拿查詢數去比學生數，學生一少就必紅。改成比「有沒有隨學生數線性成長」 | `340d20778` |
| 19 | `test_keypoints_shape_gate_empty_claim_2736` | ② | 原本斷言 `--strict` **必須紅**（用來顯示 19 課的版面待辦）。那批待辦已清完，門回 0 → 斷言反了。改成棘輪：回 0 要印 `PASS`，回 1 要說出哪一課缺 layout。另加一條正向對照，斷言 gate 原始碼真的有 `--strict` 這條路 | 本輪 |
| 20 | `test_inline_choices_stay_in_the_sentence_2768` | ② | 原本斷言句子裡要有「第一個空格」「第二個空格」兩個**散文標記**。現在的結構更精確：`interactive_type: inline_choice` + `blanks: [{options:[…]}, …]`，每個空格自己帶選項。改成驗結構，**而且比原本嚴**（原本只要那四個字出現就算過；現在連兩組選項互換都擋得住） | 本輪 |

### 這輪新開的 4 支（原本沒有人守）

| 支 | 守什麼 |
|---|---|
| `test_course_level_modules_are_loaded_2964`（4 條） | 每一種**無 slug 的課級檔**都要登記，漏一種就紅 |
| `test_followup_never_vanishes_2964`（3 條） | 加碼題不准整節消失（見下） |
| `test_reading_benchmark_reaches_the_row_2964`（3 條） | 流暢率門檻要真的到得了 row 那一層 |
| `test_perf_1243_remaining_optimizations`（既有，本輪修好污染） | 見下方「順序會改變結果」 |

---

## 順帶抓到、不在這 20 支裡的真 bug

### A. L0144 的加碼題整節消失（我自己在 #2930 引入的 fail-open）

在磁碟上，載完之後**頂層沒有、三篇也都沒有**。放置判斷只認 `part_no`，
而 L0144 是「閱讀接力」形狀（只有 `text_ref`）→ 永遠對不上 → 每一篇都不放、頂層又被清掉。
修法：`text_ref` 是清單（跨篇）就留頂層 —— 跟前端 `roundScope.ts` 既有的規則同一條。

### B. 順序會改變結果：一支測試把另一支的登入弄成 500

`test_perf_1243_remaining_optimizations` **單跑 13 條全綠，批次跑 12 條全紅**。

根因是兩邊各有一半：

- `test_classrooms_dev_filter_1999` 收尾時呼叫 `app.dependency_overrides.clear()` ——
  清的是**全域**那一本，別的模組登記的東西一起消失，而它們沒有辦法知道
- `test_perf_1243_remaining_optimizations` 在 **import 時**（collection 期間）就登記 override，
  等真的輪到它跑，早被上面那支掃掉了 → 走到真的 `get_db` → 登入回 500

`get_db` 這把鑰匙是大家共用的，所以「只 pop 自己的」也不對 —— 要**先存後還**。
兩邊都修：兇手改成存/還自己動過的兩把鑰匙，受害者改在 fixture 裡重掛（不靠 import 順序）。

三個對照（mutation 本身先驗過有效：`diff | grep -c '^<'` > 0、`ast.parse` 通過）：

| 拿掉哪一半 | 結果 |
|---|---|
| 只修兇手 | 20 passed |
| 只修受害者 | 20 passed |
| **兩邊都不修** | **12 failed** ← 證明問題是真的，不是我在修一個不存在的東西 |

⚠️ 這種病**單跑永遠看不到**。插電進 CI 之前一定要**照 workflow 裡的順序**跑一次整個 step，
不能只確認「每一支自己是綠的」。

---

## 這一輪的模式

**20 支裡有 7 支的根因是同一件事**：#2916 改檔名之後，
「無 slug 的課級檔」與「帶 slug 的檔名」兩件事沒有被一起想過。

一個 glob 少一個點，三個模組（`metadata` 175 課、`errata` 70 課、`multi_text_parts` 4 課）
整批消失，而**沒有任何一道門會叫** —— 因為守它們的鎖不在 CI 清單裡。

第二個模式是**判準本身寫錯**（#18 拿查詢數比學生數、#19 斷言 gate 必須紅、#15 寫死集合）：
這種鎖不是在守東西，是在守「某一天的現況」，情況一改善它就紅。棘輪（`<=`）才是對的形狀。
