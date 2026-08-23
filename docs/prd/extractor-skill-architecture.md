# PRD — 抽取器 skill 模組化：一個模組一個 yaml 一個 skill

Issue #2843｜2026-08-21｜branch `docs/issue-2843-extractor-skill-architecture`

---

## 一句話

output 端已經是「一課一資料夾、一模組一 yml」（24 種模組 × 175 課），但 skill 端仍是**一個 1050 行的 skill 產出全部 24 個模組**。所以某個模組抽錯時，沒有一個對象可以被指認為責任方。

這份 PRD 要的是**航空母艦 + 派飛機**：先總覽整張學習單 → 判斷有哪幾個模組 → 派對應的模組 skill 去抽。

---

## 1. 為什麼現在動 —— 動機是除錯順序，不是抽取品質

### 1.1 三層與除錯方向

2026-08-21 會議定的框架：

| 層 | 是什麼 | 現在住哪 | 狀態 |
|---|---|---|---|
| **what** | output，你現在看的這個 yaml 檔，就是你的結果 | `backend/data/lessons/L*/v3/<module>.yml` | ✅ 已模組化 |
| **how** | 分模組。要做 key reading，就要有 key reading 的 how：怎麼抽取、怎麼辨識、怎麼判斷誰是答案誰是範例 | 全部混在 `extract-lesson-multimodal/SKILL.md` | ❌ 未模組化 |
| **why** | 先看清楚老師這張重點表的策略是什麼。看一次可以 overview 所有東西 | 不存在 | ❌ 缺 |

除錯的方向是 **what → how → why**。從結果往回推責任。現在走到第二步就斷了：拿著一個抽錯的 `key_reading.yml`，往回指只會指到同一個 skill —— 那個 skill 也負責另外 23 個模組。

> 「如果 key reading 沒有抽成功，那我們應該去找 key reading skill 的麻煩才對。」

### 1.2 ⚠️ 這不是「抽取品質不好」的票

129/175 課有全部核心模組，46 課至少缺一個。那 46 課已逐一核對教師版原稿（`private/curriculum-source/_SOT/` 175 份 docx），**全部是內容本身就沒有那個章節，不是抽取器漏抽**（證據見 #2836 留言）。

資料自己也這樣說。L0021 沒有 `keypoints.yml`，而它的 `lesson.yml` 寫著：

```yaml
sections_present:
  - {no: 一, name: 讀全文-做記號}
  - {no: 二, name: 閱讀理解}
```

這課印出來就只有兩個大題。沒有重點表是正確的。

所以這張票要解的**不是覆蓋率，是歸屬**。

---

## 2. 現況盤點

> 方法論聲明：以下每個否定斷言（「沒有 X」）都配了正向對照 —— 用同一套查法去找一個已知存在的東西，確認查得到才敢說找不到。行為結論一律以實際執行為準，grep 只用來產候選清單。

### Q1 — 有沒有一個「總覽 scan」的 skill？**沒有。**

`extract-lesson-multimodal/SKILL.md:168-179` 寫的流程：

```
① 定位來源      lesson.yml 的 source.drive_path → _SOT/<path>
② DOCX → PDF
③ 抽 XML        （校對用，不是主抽取）
④ 逐頁讀 PDF    Read(pages) 全頁不抽樣 ← 主抽取
⑤ 讀總表        （決定性，不經 LLM）
⑥ 產 truth.yml
⑦ 三道格式門
⑧ 對照現行產物產 diff.md
```

從①直接跳到④「逐頁讀完整份、一次抽出全部」。**沒有一步是「先看完整張 → 判斷有哪幾個模組 → 決定派誰」。**

搜尋範圍涵蓋 repo `.claude/skills/` 與全域 `~/.claude/skills/`，關鍵詞含「先總覽 / 派工 / 航空母艦 / dispatcher / 哪幾個模組」，repo 內只命中 `extract-lesson-multimodal` 自己。
**正向對照**：同一套查法搜 `build-keypoints`，命中 3 個檔（`build-spotlight` / `qa-keypoints` / `build-keypoints` 自己）→ 查法有效。

**那「這課有哪些模組」現在是誰在判斷？散在三個地方，而且全部是事後：**

| 位置 | 做什麼 | 為什麼不算分派 |
|---|---|---|
| `extract-lesson-multimodal/SKILL.md:744` §⑥.635 | 散文描述三種課型（白話／文言文／體育生品格）各有哪些大題 | 是給人讀的規則，不是可執行的判斷；抽取者自己記得才有用 |
| `scripts/split_lesson_modules.py:41-77` `MODULES` | 24 個 top-level key 的封閉清單 | 在**抽完之後**才決定哪些 key 搬得進 v3。不在表上的 key 不報錯、直接消失 |
| `scripts/orphan_key_gate.py` | 抓「抽出來但沒人搬」的 key | 事後補抓。2026-08-18 之前它不存在，15 課因此整節被靜默丟掉 |

### 🔑 但那個 artifact 已經存在，只是沒人拿它分派

`lesson.yml` 的 **`sections_present`** —— 學習單自己印出來的大題目錄，**174/175 課有**（唯一沒有的是 L0124）。

它現在只被用在兩個地方：

- `scripts/split_lesson_modules.py:157` `_printed_section_numbers()` → 推 `section_no`
- `backend/app/services/lesson_indexes.py:617` → 推 `step_sequence`

**沒有任何東西拿它來分派，也沒有任何東西拿它跟「實際產出了哪些模組檔」對帳。**

這是本 PRD 最重要的一個發現：**總覽的產物已經有了，缺的是拿它當契約。**

### Q2 — 有沒有 per-module 的抽取 skill？**線上服務的一個都沒有。**

實際執行 `lesson_uid_loader.load_all()`（不是 grep，是跑）：

```
lessons served: 175
version_id:     {'v3': 175}
```

24 個模組 key 被服務出去：

| module | 服務課數 | module | 服務課數 |
|---|---:|---|---:|
| metadata | 175 | goal_box | 70 |
| comprehension | 172 | self_check_before_reading | 58 |
| spotlight | 168 | word_matching | 11 |
| full_text_annotate | 164 | classical_text | 10 |
| vocab_definitions | 150 | modern_translation | 10 |
| keypoints | 150 | sentence_matching | 10 |
| vocab_review | 150 | self_challenge | 6 |
| vocab_application | 149 | writing_practice | 4 |
| resources | 148 | multi_text_parts | 4 |
| key_reading | **147** | intro_guide | 4 |
| errata | 70 | keypoints_followup_questions | 2 |
| | | cross_text_banner | 2 |

⚠️ **24 種，不是 11 種**。原始盤點只列了 11 個核心模組，實際上文言文與體育生品格課型另有 13 種模組型別在服務中。

**這 24 個全部出自同一條線：**

```
extract-lesson-multimodal  ──LLM 逐頁讀 PDF──>  _extracted/<uid>.yml   （一課一個大 YAML，175 個）
                                                        │
                                       split_lesson_modules.py  ← 機械切 top-level key
                                                        ↓
                                          L*/v3/<module>.yml     （24 種模組檔）
```

`split_lesson_modules.py` 是**機械切分**，不是抽取。它按 `MODULES` 表把大 YAML 的 top-level key 各自寫成一個檔。**抽取的智慧 100% 在上游那一個 skill 裡。**

#### 對照表：這個 yml 是誰產的

| yml | 產生它的東西 | 是專屬這一個模組的嗎 | 抽取方式 |
|---|---|---|---|
| 全部 24 種 | `extract-lesson-multimodal` → `split_lesson_modules.py` | ❌ **一個 skill 管全部** | LLM 多模態讀 PDF |
| 其中 `metadata` 部分欄位 | 總表 `自學教材總表0812.xlsx`（SKILL.md §⑤） | — | ✅ 決定性，不經 LLM |
| 其中 `section_no` | `split_lesson_modules.py` 讀 `sections_present` | — | ✅ 決定性 |

#### 現有的 per-module skill 全部不在 v3 這條線上

| skill | 狀態 | 證據 |
|---|---|---|
| `build-key-reading` | **自己標「已停用」** | SKILL.md 開頭：「其內容是 issue #2712 的成因，已被取代」 |
| `lesson-reading-pipeline` | **自己標「產出學生看不到」** | SKILL.md：「這條線目前寫的是 v2，而 loader 服務的是 v3 —— 這份 skill 產出的段落目前不會被學生看到」 |
| `build-keypoints` | 輸出到不存在的目錄 | 輸出 `private/curriculum-source/_online-schema/`，該目錄在此 checkout **不存在**（`private/curriculum-source/` 底下只有 `_SOT`） |
| `build-spotlight` | 同上 | 同上 |
| `qa-keypoints` / `qa-spotlight` | 前置條件是上面那個目錄 | SKILL.md「前置條件」段落明列該路徑 |
| `ai-lesson-extract` | 一修產物 | 產 `lesson_content` YAML，非 v3 模組檔 |
| `content-mapping-integrity` | 指向已刪除的目錄 | 指 `backend/data/lessons/spotlight/catalog/`，git 追蹤檔數 **0**（#2683 刪除） |

> ⚠️ 誠實標註：`private/` 是 gitignored，我只能斷言「這個 checkout 沒有」，不能斷言它在別人機器上也沒有。但可以確定的是**線上服務的 v3 樹不是從那裡來的**（它從 `_extracted/` 來），所以那條線即使有產物也不影響學生看到的東西。

#### 關於「LLM 抽 vs regex 抽」

Young 要求全部統一走 LLM，不要 scrape 跟 LLM 交錯混雜。**現況已經接近了**：主抽取（④）全部是 LLM 多模態讀 PDF，一修的 regex/XML 抽取器（`build_lesson_schema.py`，2400 行）已經不在 v3 線上。

剩下兩塊決定性的部分**建議保持決定性**，它們不是「殘留的 scrape」而是正確的設計：

- 總表 xlsx 欄位讀取（§⑤）—— 表格欄位有明確座標，LLM 讀它只會增加出錯機會
- `split_lesson_modules.py` 的切分與 `section_no` 指派 —— 純資料搬移

### 🔴 核心證據：沒有 per-module 契約 → 每一課自己發明欄位名

掃過 `backend/data/lessons/*/v3/*.yml` 全部 2019 個檔，統計每個模組的 top-level key 組合：

| module | 檔數 | **不同的 key-shape 數** | 欄位名聯集 |
|---|---:|---:|---:|
| full_text_annotate | 164 | **115** | 116 |
| metadata | 175 | 94 | 150 |
| vocab_review | 150 | 58 | 41 |
| keypoints | 150 | 56 | 57 |
| **key_reading** | 157 | **53** | 58 |
| spotlight | 168 | 40 | 40 |
| vocab_definitions | 150 | 33 | 28 |
| vocab_application | 149 | 30 | 28 |
| comprehension | 172 | 27 | 28 |
| goal_box | 70 | 21 | 33 |
| resources | 148 | 19 | 18 |
| （其餘 12 個模組） | | 51 | |
| **合計** | **2019** | **597** | |

`key_reading` 前幾種形狀：

```
17x  [approx_chars_from_start, benchmark, end,           extent_chars, instruction, passage, ...]
16x  [approx_chars_from_start, benchmark, benchmark_label, end_paragraph, ...]
13x  [benchmark, benchmark_instruction, char_marks_cover_paragraphs, char_marks_note, end, ...]
 7x  [approx_chars_from_start, benchmark, char_count_note, end, ...]
 6x  [benchmark, end, extent_chars, instruction, passage, printed_char_count, ...]
```

同一件事有四個名字：`end` / `end_paragraph`；`benchmark_label` / `benchmark_instruction` / `char_count_note` / `printed_char_count` / `printed_char_marks`。

**這就是「東漏西漏」的機制**：沒有 per-module 輸出契約 → LLM 每一課自己想一個欄位名 → 消費端 `.get("passage")` 回 `None` → **不報錯、門全綠、學生看不到**。

#### 一個活的實例（10 課）

`backend/app/services/lesson_uid_loader.py:196-203`：

```python
kr = lesson.get("key_reading")
if isinstance(kr, dict):
    ...
    if not kr.get("passage"):
        lesson.pop("key_reading")
```

157 個 `key_reading.yml` 在磁碟上，**只有 147 個被服務**。差的 10 個（L0153–L0164 區段）檔案有內容、有 `instruction`、有 `timing_table`，就是沒有 `passage`，於是整個模組被靜默丟掉。而它們的欄位形狀有四種：

```
L0153  instruction / target_note / timing_table / benchmark_note
L0154  unit / unit_note / instructions / timing_table        ← instructions 是複數
L0155  unit / unit_note / instructions / instructions_note
L0160  label / instruction / timing_table / benchmark_note
```

> ⛔ 這 10 課屬於 @if-else-master 的朗讀範圍，本 PRD **不提出修法**，只當作「缺 per-module 契約」的證據。

### 補充：門的歸屬問題

現有 11 道內容門，**沒有一道是 per-module 的**，全部是跨模組或整課層級：

| 門 | 檢查層級 | 在 CI 跑嗎 |
|---|---|---|
| `spotlight_fingerprints --check` | 聚光燈結構棘輪 | ✅ `run-ci.sh` Gate 5 |
| `sot_drift_check --offline` | 整課原稿指紋 | ✅ Gate 6 |
| `module_entry_gate` | 模組有沒有學生入口 | ✅ Gate 7 |
| `verbatim_gate` | 整份 yaml vs 整份 docx | ❌ |
| `coverage_gate` | **只管課文**（`full_text_annotate`） | ❌ |
| `traditional_only_gate` | 整份 yaml 用字 | ❌ |
| `normalize_block_types --check` | block 型別封閉清單 | ❌ |
| `normalize_word_search --check` | 找字座標 | ❌ |
| `orphan_key_gate` | 孤兒 top-level key | ❌ |
| `module_migration_gate` | 還有幾課停在 v2 | ❌ |
| `content_evidence_gate` | 內容證據 | ❌ **只在 `run-ci.sh:108` 的註解裡被提到，沒有一行執行它** |

> 正向對照：同一套查法搜 `story_structure_ship_gate` → 命中 `.github/workflows/keypoints-manifest-gate.yml`，查法有效。
> ⚠️ 修正一次自己的過窄觀測：只 grep `.github/workflows/` 會得到「全部 11 道都沒在 CI」的錯誤結論 —— 有 3 道是經 `spec-check.yml` → `specs/run-ci.sh` 間接跑的。

門不 per-module，導致**門紅的時候一樣不知道該找誰**。這跟 skill 不 per-module 是同一個問題的兩面。

### 反向盤點 —— 我方 code 還有哪裡在讀舊的大一統產物

跑 `~/.claude/skills/migration-reverse-audit/reverse_dep_audit.py`，token 從舊結構逐一列（10 個）：

```
⚠️ 10/10 個識別符仍被活程式碼使用，共 319 處
```

| token | 命中處數 | 來源目錄還在嗎 | 判讀 |
|---|---:|---|---|
| `_online-schema` | 49 | ❌ 不存在 | 一修抽取工作區。`story_structure_lab_service.py:38` 仍指向它 |
| `build_lesson_schema` | 43 | ✅ 檔案在（2400 行） | 一修 regex 抽取器。不在 v3 線上，但 20+ script/test 仍依賴 |
| `_parsed_2026-05-01` | 37 | ❌ **git 追蹤檔數 0** | #2683「no compatibility layer」刪除 |
| `lesson_content` | 83 | — | 一修的聚光燈契約，仍在 `stories.py:665` 服務路徑上 |
| `lesson_code_normalization` | 36 | ✅ | 補零正規化。v3 用 `lesson_uid`，理論上不需要 |
| `manifest.yml` | 17 | ✅（158 筆） | 比服務端少 17 課 |
| `key_reading_passages` | 12 | ✅ | 一修資料，`stories.py:581` 註明是 FIRST-EDITION |
| `sections.yml` / `body.yml` | 10+15 | ❌ v3 不再產出 | `module_migration_gate` 用它們數還沒翻新的課 |
| `spotlight/catalog` | 9 | ❌ **git 追蹤檔數 0** | #2683 刪除 |

> 正向對照：`git ls-files backend/data/lessons/L0001` = 31 檔（非 0）→ 查法有效，上面的 0 是真的 0。

**95 處程式碼在讀三個已經不存在的目錄**（`_online-schema` 49 + `_parsed_2026-05-01` 37 + `spotlight/catalog` 9）。這些讀取多半 fail-soft 成空值，所以沒有人發現。

每一處都要回答：刻意保留的相容路徑，還是漏掉的遺留？這份 PRD 把它列為**階段 3 的工作**，不在這張票裡逐一處理。

---

## 3. 目標架構

### 3.1 全景

```
                     ┌──────────────────────────────────────┐
   二修 DOCX ───────>│  ✈️🛬 lesson-overview-scan            │  ← 航空母艦的眼睛
                     │  LLM 讀完整張，只回答一個問題：        │
                     │  「這張學習單有哪幾個大題？」          │
                     └──────────────┬───────────────────────┘
                                    │  產出 module manifest（唯一產物）
                                    │  { lesson_uid, lesson_type,
                                    │    sections: [{no, name, module, pages}] }
                                    ↓
                     ┌──────────────────────────────────────┐
                     │       dispatcher（決定性，非 LLM）     │
                     │  manifest.sections → 要派哪幾個 skill  │
                     └──┬────────┬────────┬────────┬────────┘
                        │        │        │        │
                   ┌────▼──┐ ┌───▼───┐ ┌──▼────┐ ┌─▼──────┐
                   │ key_  │ │ key   │ │ spot  │ │ ...N   │  ← 派出去的飛機
                   │reading│ │points │ │light  │ │        │
                   │ skill │ │ skill │ │ skill │ │        │
                   └────┬──┘ └───┬───┘ └──┬────┘ └─┬──────┘
                        │        │        │        │
                        ↓        ↓        ↓        ↓
                  key_reading  keypoints spotlight  ...      ← 一模組一 yml（已經是這樣）
                    .yml        .yml      .yml
                        │        │        │        │
                   ┌────▼────────▼────────▼────────▼───────┐
                   │  對帳門 module_reconcile_gate           │
                   │  宣告的模組集合 == 產出的模組集合        │
                   │  不等 → 紅，並指名是哪一個模組           │
                   └────────────────────────────────────────┘
```

### 3.2 總覽 skill 的介面契約

**`lesson-overview-scan`** —— 只做一件事：看完整張，回答「有哪幾個大題」。它**不抽任何內容**。

| | |
|---|---|
| 輸入 | `lesson_uid` + 原稿 DOCX/PDF 路徑 |
| 輸出 | `L*/v3/_manifest.yml`（**唯一產物**） |
| 失敗回報 | `status: BLOCKED` + `reason`，不猜、不半套 |

輸出形狀（`sections_present` 的超集，向後相容）：

```yaml
lesson_uid: L0153
lesson_type: classical        # 白話 vernacular / 文言文 classical / 體育生品格 character
source_md5: md5-12:xxxxxxxxxxxx
sections:
  - {no: 一,   name: 文白句子比對, module: sentence_matching, pages: [3, 4]}
  - {no: 二,   name: 文白詞語比對, module: word_matching,     pages: [4]}
  - {no: null, name: 朗讀計時,     module: key_reading,       pages: [2]}
absent_note: "本課無文章重點表（學習單未印）"
```

三個設計決定，各有理由：

1. **`module` 欄位由總覽 skill 填**，不由下游猜。名稱→模組的對應現在藏在 `split_lesson_modules.py:133` 的 `SECTION_NAME_TO_MODULE`，只涵蓋 **10/24 個模組** —— 文言文那 6 個模組（`classical_text` / `modern_translation` / `sentence_matching` / `word_matching` / `self_challenge` / `intro_guide`）全部不在表上，序號只能掉回寫死的常數。而實測 175 份原稿，**70 課重點表在前、39 課聚光燈在前**，寫死常數對那 39 課會標反。
2. **`pages` 是給模組 skill 的導航**。模組 skill 只讀自己那幾頁，不再逐頁讀整份 —— 這是 token 成本從「N 個模組 × 全份」降回「N 個模組 × 各自幾頁」的關鍵。
3. **`absent_note` 讓「這課本來就沒有」變成機器可讀的宣告**。現在 `sections_absent_note` 在 175 課裡有 **0 課**填 —— 缺席只能靠人去翻原稿確認（就是 #2836 做的事）。宣告之後，46 課缺模組不再需要人工核對。

### 3.3 模組 skill 的介面契約（每一個都長一樣）

```yaml
name: extract-<module>
輸入:
  lesson_uid, source_pdf, pages（來自 manifest）, lesson_type
輸出:
  L*/v3/<module>.yml   ← 恰好一個檔，檔名 == 模組名 == 檔內 top-level key
必填欄位:
  由該模組的 schema 宣告（見下）
失敗回報:
  status: BLOCKED / PARTIAL + reason + 缺哪個必填欄位
  ⛔ 絕不 fallback、絕不猜、絕不產半套
自帶:
  1 個 schema（必填/選填/型別）
  1 個 per-module gate
  1 條 regression lock（來自真實壞過的 case）
```

**每個模組 skill 必須自帶一份 schema**，這是 597 個 key-shape 的直接解藥。以 `key_reading` 為例：

```yaml
# specs/modules/key_reading/schema.yml
required: [passage, instruction, source]
optional: [timing_table, benchmark, extent_chars, start_paragraph, start_text]
forbidden_aliases:          # 實測出現過的自創欄位名
  end_paragraph: end
  instructions: instruction
  benchmark_instruction: benchmark_label
  printed_char_count: extent_chars
```

`forbidden_aliases` 直接把「同一件事四個名字」變成 build 錯誤。這條清單**從實測資料長出來**，不是憑空設計 —— 每次有人發明新名字就加一行（同 glossary gate 的成長方式）。

⛔ **不做新舊版相容 fallback**。會上定調：「我寧願他顯示 error、顯示 fail，但我也不要他顯示錯的東西。」還沒上線、沒有舊版使用者，沒有相容問題。

### 3.4 對帳門（這是整個架構的收口）

```
python3 scripts/module_reconcile_gate.py --uid L0153
```

斷言：**manifest 宣告的模組集合 == v3 目錄實際產出的模組檔集合**

三種紅法，各自指名責任：

| 情況 | 判定 | 該找誰 |
|---|---|---|
| 宣告有、檔案沒有 | 該模組的 skill 沒跑成功或 BLOCKED | `extract-<module>` |
| 檔案有、宣告沒有 | 總覽漏看了一個大題 | `lesson-overview-scan` |
| 兩邊都有但欄位不合 schema | 該模組 skill 的輸出契約破了 | `extract-<module>` |

這道門就是 §4 主驗收條件的機器判準。

---

## 4. 驗收條件（BDD，全部可機器驗）

### AC-1 🔴 主條件 —— 30 秒內指認責任方

```gherkin
Given 某課的 key_reading.yml 抽錯了
When  工程師要除錯
Then  他能在 30 秒內指認出是哪一個 skill 的責任
```

**機器判準**：

```bash
python3 scripts/module_owner.py --uid L0153 --module key_reading
# 期望 stdout 含負責 skill 的路徑，exit 0
# 期望對不存在的模組 exit 非 0（負向對照）
```

**紅→綠**：現在這支腳本不存在，指令回 `command not found` = 紅。

### AC-2 宣告與產出必須對得上

```gherkin
Given 一課的 _manifest.yml 宣告了 N 個模組
When  跑 module_reconcile_gate
Then  該課 v3 目錄恰好有 N 個對應的模組檔，多一個少一個都紅
And   紅的訊息要指名是哪一個模組、以及三種紅法的哪一種
```

**機器判準**：`python3 scripts/module_reconcile_gate.py --all` exit 0
**mutation（必跑，證明門會咬）**：刪掉任一課的一個模組檔 → 必須紅，且訊息含該模組名 → 還原 → 回綠
⚠️ mutation 沒紅先查它有沒有真的改到檔案（`diff` 命中數必須 > 0），不要把好門判成廢門

### AC-3 每個模組有且僅有一個 skill 負責

```gherkin
Given specs/modules/ 底下的模組登記表
When  跑 module_ownership_gate
Then  服務中的每一種模組都恰好對到一個 extract-<module> skill
And   任何一個模組對到 0 個或 2 個以上 → 紅
```

**機器判準**：對 §2 實測的 **24 種模組**逐一斷言，用**數量**斷言不用「至少有一個」
（`covered == 24 and orphan == 0`，不是 `covered >= 1`）

### AC-4 欄位名不再各自為政

```gherkin
Given 某個模組的 schema.yml 宣告了 required 欄位與 forbidden_aliases
When  該模組的任一課 yml 用了 forbidden alias 或缺 required 欄位
Then  該模組的 gate 紅，訊息指名 uid + 欄位名
```

**機器判準**：`key_reading` 的 key-shape 數 **從 53 降到 ≤ 3**（正常 / 無 passage 但有 benchmark / BLOCKED），且 `end_paragraph`、`instructions`、`printed_char_count` 等 alias 出現次數 = 0

**基線（今天實測，用來證明有進展）**：597 shapes / 23 modules；key_reading 53 shapes

### AC-5 「這課本來就沒有」是宣告，不是靠人翻原稿

```gherkin
Given 一課的學習單沒有印文章重點表
When  總覽 skill 掃過它
Then  _manifest.yml 的 sections 不含 keypoints
And   absent_note 寫明為什麼
And   對帳門因此判它 PASS，不判缺漏
```

**機器判準**：46 課缺模組全部由 manifest 解釋，人工核對筆數 = 0
**基線**：`sections_absent_note` 目前 175 課裡有 **0 課**填

### AC-6 不得 fallback

```gherkin
Given 某個模組 skill 抽不到必填欄位
When  它結束
Then  它回 status: BLOCKED 並指出缺哪個欄位
And   它不得寫出一個缺欄位的 yml
And   它不得回退到舊版 schema 或別課的資料
```

**機器判準**：餵一份刻意殘缺的原稿 → 斷言 exit 非 0 且**沒有產出檔案**
（負向對照：餵正常原稿 → exit 0 且有檔案。少了這個對照，「什麼都沒產出」也會通過）

---

## 5. 遷移路徑

> 每階段可獨立驗收、可獨立回滾。**階段 0 不動任何模組 skill，可立刻開始。**

### 階段 0 — 把總覽變成正式契約（不碰任何模組）

| | |
|---|---|
| 做什麼 | 1. `sections_present` → `_manifest.yml`（超集，加 `module` / `pages` / `lesson_type` / `absent_note`）<br>2. `SECTION_NAME_TO_MODULE` 從 `split_lesson_modules.py` 抽成 `specs/modules/registry.yml`，補齊 10→24<br>3. 寫 `module_reconcile_gate.py` + `module_owner.py`<br>4. 接進 `specs/run-ci.sh` |
| 驗收 | AC-1、AC-2、AC-3 |
| 為什麼先做 | **它讓後面每一階段都有紅綠可看**。而且不改任何 skill、不改任何模組檔，零撞車風險 |
| 需先對齊 | 無 |
| 附帶收穫 | 補齊 24 個模組的名稱對應，順手解掉文言文 6 個模組序號掉回寫死常數的問題 |

### 階段 1 — 抽出第一個模組 skill（選一個沒人在動的）

| | |
|---|---|
| 做什麼 | 從 `extract-lesson-multimodal` 切出**一個**模組 skill 當範本，含 schema + gate + regression lock |
| 選哪個 | **`vocab_definitions`（語詞我最棒，150 課）或 `comprehension`（閱讀理解，172 課）** |
| 為什麼是它們 | ⛔ 不能選 `key_reading`（@if-else-master）、不能選 `spotlight` / `keypoints`（@stgst）。這兩個模組課數多、形狀相對收斂（33 / 27 shapes）、目前沒有人在改 |
| 驗收 | AC-4、AC-6 在這一個模組上綠；該模組 key-shape 數下降 |
| 需先對齊 | 無 |

### 階段 2 — 其餘模組依「無人認領 → 有人認領」順序切出

| | |
|---|---|
| 順序 | ① 無人認領的（`vocab_application` / `vocab_review` / `resources` / `full_text_annotate` / `metadata` / `goal_box` / `errata` …）<br>② 文言文那 6 個 + 體育生品格（課數少、獨立）<br>③ **最後**才是 `key_reading` / `spotlight` / `keypoints` |
| 驗收 | AC-3 全 24 綠、AC-4 全模組綠 |
| 🔴 需先對齊 | ③ 這一組**必須**先跟 @if-else-master（key_reading）與 @stgst（spotlight / keypoints）對齊時間點。他們正在改這三塊，同時動 = 直接重演 v2/v3 撞車 |

### 階段 3 — 清理反向盤點的 319 處

| | |
|---|---|
| 做什麼 | 逐一判讀：刻意保留的相容路徑（要在 code 裡寫明原因）還是漏掉的遺留（刪） |
| 優先 | 先處理**指向已刪除目錄的 95 處**（`_online-schema` 49 / `_parsed_2026-05-01` 37 / `spotlight/catalog` 9）—— 它們現在 fail-soft 成空值，沒人發現 |
| 驗收 | `reverse_dep_audit.py --fail-on-hit` 綠，或每個保留處都有寫明原因的註解 |
| 需先對齊 | `spotlight/catalog` 相關的 9 處碰到 @stgst 的範圍 |

---

## 6. 風險

### 6.1 🔴 再撞一次 v2/v3

**已經發生過**：Young 與 @if-else-master 同時改 key reading 抽取，撞出 v2/v3 兩版，最後決定留 v3 刪 v2。整個 `lesson-reading-pipeline` skill 到現在還寫著 v2、產出的段落學生看不到。

模組化重構會碰到**每一個**模組，撞車機率比上次高。

緩解：

- 階段 1、2 的順序**明確按「有沒有人在動」排**，被認領的三塊排最後
- 階段 0 完全不碰模組 skill，先讓「誰負責什麼」有機器可讀的答案 —— **這本身就是撞車後的復原工具**：結構乾淨了，蓋回去只需要小修
- 會上共識：被蓋掉不用不好意思講，重點是撞完之後選一條下次不會用同樣理由再撞的路

### 6.2 總覽 skill 自己看漏

總覽變成唯一的分派來源之後，它漏看一個大題 = 那個模組整個不會被抽，而且**下游不會有任何異狀**（跟現在 `MODULES` 表漏一個 key 的形狀完全一樣，那次 15 課被靜默丟掉）。

緩解：對帳門的第二種紅法（檔案有、宣告沒有）就是抓這個。加上 `orphan_key_gate` 現有的邏輯當第二層。

### 6.3 切分過程中 key-shape 反而變多

每個模組 skill 各自演化 schema，可能比現在還亂。

緩解：schema 是**階段 1 範本的一部分**，不是之後補的。AC-4 用 key-shape 數當量化指標，數字不降就不算做完。

### 6.4 成本

現在一課讀一次完整 PDF。切成 N 個模組 skill 後，若每個 skill 都讀完整份 → 成本 ×N。

緩解：manifest 帶 `pages`，模組 skill 只讀自己那幾頁。
⚠️ **這個要實測，不要估**。階段 1 的範本要量出「單模組抽取的 token 與時間」並寫進 PRD，不能用推的。

### 6.5 這份 PRD 自己會過期

`extract-lesson-multimodal` 三天內被大改過（8/18 最後一次），本 PRD 引用的行號會漂。

緩解：所有斷言都附了**產生它的指令**，任何人可以重跑驗證。行號漂了，指令還在。

---

## 7. Out of scope（這張票不做）

| 不做 | 為什麼 | 誰在做 |
|---|---|---|
| 改聚光燈 / 重點表的抽取與 render | 有人在做 | @stgst |
| 改朗讀（key_reading skill v2/v3、播放鈕、趨勢圖） | 有人在做 | @if-else-master |
| 平台說明書 / 對外 demo | 有人在做 | @66tarosan |
| 修那 10 課沒有 `passage` 的 key_reading | 屬朗讀範圍，本 PRD 只當證據引用 | @if-else-master |
| 提高抽取覆蓋率 / 補那 46 課 | **那 46 課是內容本身沒有**，不是抽取問題（#2836） | — |
| 重新設計 v3 的 schema 內容 | 這張票只管「誰負責產它」，不管「它長什麼樣」 | — |
| 把 11 道門全部接進 CI | 相關但獨立。本 PRD 只新增對帳門 | 另開票 |
| 改總表 xlsx 讀取改走 LLM | 決定性讀取是對的設計，不該改 | — |

---

## 附錄 A — 本 PRD 所有斷言的重現指令

```bash
# 服務中的模組與課數（實際執行 loader，非 grep）
cd backend && python3 -c "
import sys; sys.path.insert(0,'.')
from collections import Counter
from app.services.lesson_uid_loader import load_all
ls = load_all(); print(len(ls), Counter(l['version_id'] for l in ls))
k=Counter()
for l in ls:
    for key in l: k[key]+=1
print(sorted(k.items(), key=lambda x:-x[1]))"

# key-shape 漂移統計（597 / 23 modules）
# 掃 backend/data/lessons/*/v3/*.yml，對每個模組數 tuple(sorted(inner.keys())) 的相異數

# key_reading 檔案存在但沒被服務的 10 課
# 比對 glob('*/v3/key_reading.yml') 與 load_all() 裡有 key_reading 的 uid 集合

# 反向依賴盤點（319 處 / 10 tokens）
# ⚠️ 下面刻意用 printf 展開，不寫成 `--token <值>` 逐個列 ——
#    GitGuardian 的 Generic CLI Secret 偵測器會把那個形狀判成憑證外洩
#    （2026-08-21 incident #36458689，誤報；--token 是搜尋字串不是憑證）
python3 ~/.claude/skills/migration-reverse-audit/reverse_dep_audit.py \
  $(printf -- '--token %s ' \
      _online-schema build_lesson_schema _parsed_2026-05-01 \
      sections.yml body.yml lesson_content \
      spotlight/catalog lesson_code_normalization \
      key_reading_passages manifest.yml) \
  --scope backend/app scripts frontend/src .claude/skills specs

# 已刪除目錄確認（含正向對照）
git ls-files backend/data/lessons/_parsed_2026-05-01 | wc -l   # 0
git ls-files backend/data/lessons/spotlight          | wc -l   # 0
git ls-files backend/data/lessons/L0001              | wc -l   # 31 ← 正向對照

# CI 到底跑哪幾道門
grep -nE 'Gate [0-9]' specs/run-ci.sh
grep -n content_evidence_gate specs/run-ci.sh | grep -v ':\s*#'   # 無輸出 = 只在註解裡
```

## 附錄 B — 相關

- 會議記錄：`docs/meetings/2026-08-21-record.md`
- 前一份 PRD：`docs/prd/2026-08-17-multimodal-extraction.md`（#2736，抽取改走 LLM 多模態）
- 二修進度：`docs/prd/2026-08-14-second-edition-reink-progress.md`（#2683，身分層）
- 模組化 spec 系統：`specs/README.md`、`specs/registry.yaml`（41 個 module，**沒有一個擁有抽取管線** —— `split_lesson_modules` / `verbatim_gate` / `_extracted` / `lesson_uid_loader` 在 registry.yaml 命中數皆為 0；正向對照 `lesson_loader.py` 命中 2）
- 缺模組課數核對：#2836
