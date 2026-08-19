---
name: build-keypoints
description: 從一課的原始 DOCX 學習單，忠實抽取「文章重點表」並轉成保留層級/合併/填空/段落定位的 schema。當需要「建重點表」「重點表轉線上」「docx 轉重點表」「keypoints from docx」「story structure 轉 schema」時使用。實驗來源 issue #2205。
---

# build-keypoints — DOCX 文章重點表 → 結構化 schema

把一課手工排版的 DOCX 重點表（問題/解決/結果、主角/主題/事例、比較表…）忠實轉成 schema。**絕不**用 `backend/data/lessons/*.yml` 的 `story_structure`——它被 parser 弄爛（L01 7x3→flat 2行；L28 nested 的 value 整段錯亂）。一律從 raw DOCX 重抽。

## 何時用
- 把某課的文章重點表做成線上版
- 修復現行平台壓平/弄爛的重點表
- 教授七課的重點表線上化

## 重點表的真實結構維度（來自 151 課盤點）
- **層級**：flat（單層 label│value）/ nested（如 解決 下還有 問題1/解決1/結果1 = 三欄三層）
- **合併儲存格**：左欄 label 常跨多列合併（python-docx 同 `_tc` 重複出現）
- **填空**：cell 含 `【 】`（學生要填的），有些含預設答案（黃底字）
- **段落定位填空**：部分課要先填「問題在第幾段」（如 G6-L25：問題/(1.2)、解決/(3)、結果/(5.10)）
- **欄位語意**：常見 `元素│提示│重點` 或 `label│value` 或 `label│sub_label│value`

## Keypoints Table Detection (LABEL_FAMILIES)

`find_keypoints_table()` uses structural features, not lesson-specific strings. Detection requires:
1. Non-scaffold table, n_rows >= 2, n_cols >= 2
2. Must contain `【...】` blanks
3. Scored by label-family match in first column:

| Family | Labels covered |
|--------|---------------|
| PSE/summary | 問題, 解決, 迴響, 研究問題, 新說法, 假說 |
| Narrative/character | 主角, 主題, 特質, 事例, 家庭, 背景, 翻身, 體會, 心得, 起因, 經過 |
| Scientific inquiry | 實驗, 驗證, 研究影響, 案件, 前言, 案發, 辦案, 歷程, 真相 |
| Comparison/opinion | 危機, 因應, 挑戰, 作者反思, 總結, 目的, 原因, 影響, 方法 |
| Topic-based | 大主題, 小主題, 第N段, 段落, 細節 |
| Hint_value | 元素, 提示, 重點, 結果, 結論 |

**Excluded**: vocab-application tables (n_rows <= 3 AND n_cols >= 5).

**Important**: `hint_value` format (G6-L24/L25) has header row containing 提示/元素/重點. Detect this first before checking nested format.

## Nested Label Merge Rule

Use **text identity** (not vmerge) to detect merged labels:
- python-docx reports `vmerge=restart` for ALL rows in a merged group — unreliable.
- Instead: compare `cells[0]["text"]` across rows. When the text changes → flush the current nested group and start a new parent.
- This correctly handles the G6-L22 pattern where 「解決」spans 6 rows.

## 程序

### 1. 抽取 raw table（保留合併）
跑 `python3 scripts/build_lesson_schema.py <lesson_id> <docx_path>`。對重點表那張 table，輸出每 cell 的 `(row, col, text, gridspan, vmerge)`，**不要先攤平**。
重點表 = 含 label 族標籤（見 LABEL_FAMILIES 上表）、且帶 `【 】` 的那張（通常在聚光燈之後、MCQ 之前）。

### 2. 還原層級
- 左欄連續相同 label（合併）→ 該 label 是父節點，右側多列是 `sub_rows`。判斷用 text identity，不用 vmerge。
- 區分 `label`（固定印刷字）vs `value`（含 `【】` 的學生填空 / 預設答案）。
- 把 `【 內容 】` 拆成 `blanks: [{answer: "狗", hint: ""}]`，cell 其餘為 `template` 文字（用 `__` 標空格位置）。

### 3. 輸出 schema
```yaml
keypoints:
  lesson: G6-L22
  title: 小兵立大功：雞鳴狗盜的故事
  structure: nested            # flat | nested
  columns: [label, sub_label, value]   # 反映該課真實欄位
  rows:
    - label: 問題
      value: "秦昭王軟禁了孟嘗君而且想殺掉他，孟嘗君想要逃離秦國。"
      blanks: []
    - label: 解決
      sub_rows:
        - {sub_label: 問題1, template: "孟嘗君求幸姬幫忙，幸姬要求…", blanks: []}
        - {sub_label: 解決1, template: "食客中有一位會模仿【__】的樣子…", blanks: [{answer: "狗"}]}
        - {sub_label: 結果1, template: "幸姬得到了白狐裘，替孟嘗君求情…", blanks: []}
        - {sub_label: 問題2, template: "…到了函谷關，規定【__】才開門", blanks: [{answer: "天亮"}]}
        - {sub_label: 解決2, template: "食客中有一位會模仿【__】的人", blanks: [{answer: "公雞叫"}]}
        - {sub_label: 結果3, template: "城門【__】，孟嘗君順利逃離", blanks: [{answer: "終於打開／提前開啟"}]}
    - label: 結果
      value: "孟嘗君在食客們的幫助下成功逃離秦國。"
      blanks: []
  # 段落定位型（如 G6-L25）額外帶：
  # locate_paragraph: true  → 每 row 多一個 blank {kind: paragraph, answer: "1.2"}
```
寫到 `private/curriculum-source/_online-schema/<lesson>.keypoints.yml`。

### 4. 驗收（每課必跑）
- [ ] 列數 = DOCX 表格實際列數（不可像現行 parser 把 7 列壓成 2 列）
- [ ] nested 結構有還原（解決下的 問題1/解決1/結果1 不可攤平）
- [ ] 每個 `【】` 都變成一個 blank，答案有抓到
- [ ] 合併的 label 正確當父節點，沒有重複成多列（用 text identity，不用 vmerge）
- [ ] hint_value 格式（元素/提示/重點 header）有正確識別，not nested
- [ ] 段落定位型有標 `locate_paragraph`
- [ ] value 沒有像 L28 那樣多 cell 文字串在一起錯亂（逐 cell 對 raw 輸出檢查）

## Multi-text lessons (one DOCX → several slots) — CRITICAL

某些 DOCX 一檔含多篇（檔名如 `G4-L20-22…docx` / `G9-L15~16…docx`），parse 成 **compound YAML**（`G4-L20-22.yml`），UI 用 primary slot code（`G4-L20`）對外。踩過的雷（#2397）：

- `discover_lessons()` 取**第一個課號**當 lesson_id（`G4-L20-22…docx` → `G4-L20`），keypoints schema 也建在 `G4-L20.keypoints.yml`。
- 但單槽查找 `expected_parsed_yaml_path("G4-L20")` 回 **None**（檔案是 compound `G4-L20-22.yml`）→ `has_structure_table=False`。
- **教訓**：判斷「該不該跑 L1 重點表 gate」用 **keypoints 是否抽得出來**（`docx_keypoints_available`），**不是**單槽 parsed table 在不在磁碟。`classify_lesson` 已修成 `docx_keypoints_available is True` → `DOCX_KEYPOINTS`（gate 不會 silent skip）。改抽取器/分類器時別退回「要有單槽 structure table 才算 DOCX_KEYPOINTS」。
- GCS 圖檔目錄用 **parsed/compound code**（`G4-L20-22/`），非 catalog code。

## Courses Without Keypoints (expected — not bugs)

- `image_text` / `table_text` courses (G7-L28/29/30): no fill-table, figures carry the meaning
- Courses with paragraph-level fill-in exercises (e.g., G6-SL8 summary_structure): the blanks are in paragraphs, not a table. `keypoints.yml` not produced — correct behavior.

## Ship gate — 改完憑證據宣稱，不憑感覺（#2397）

改重點表內容 / 抽取器 / `keypoints_manifest.json` 後，**PR 前必過 content evidence gate（fail-closed）**：

```bash
python scripts/content_evidence_gate.py --run-id <id>          # 全 304 cell（staging）
bash   scripts/content_evidence_ship_gate.sh --run-id <id>     # 須印 CONTENT_EVIDENCE_GATE=PASS
```

- ⛔ 禁用「manifest 重建完 / API 200 / 看一下 render」當完成依據——只認 evidence 檔（`fail_cells=0` + `unknown_cells=0`）。
- 真內容缺口（某課 DOCX 沒重點表、多文本 secondary slot 無自身重點表）→ 登錄 `backend/data/curriculum_qa/content_known_gaps.yaml` 的 `story-structure:` 段（reason: `no_keypoints_source` / `multi_text_secondary`），標 `known_gap`（誠實，非 pass）。**禁把缺口 fake 成 pass。**
- 重建 manifest 後跑 `pytest backend/specs/test_keypoints_manifest_spec.py`（`test_manifest_matches_runtime` 確保 manifest = live runtime，無假綠）。

## 選項：五種寫法，只認一種就會靜靜壞掉（2026-08-19 全部踩過）

「這一格有選項」在語料裡有五種形狀。**消費端只認其中一兩種，其餘不會報錯 ——
只是那一題沒有選項可選，畫面上看不出異常。** 一天內 20 課 27 列都是這樣壞的。

| 形狀 | 長相 | 出現在 |
|---|---|---|
| list | `options: [贏了, 輸了]` | 早期抽取 |
| **dict** | `options: {1: 贏了, 2: 輸了}` | 多模態抽取（**最常見**） |
| **sub_items** | 母項一句話多個空格，各配一組 | L0011 |
| **inline_choices** | 同上，另一個欄名 | L0102 |
| option_bank | 整份共用一組，格子裡放答案代號 | L0016 配對題 |

抽取時**照學習單原樣寫**，不要為了下游好處理而統一 —— 但**要在這裡登記**，
下游才知道有這種寫法存在。加新形狀時同步更新這張表。

### 行內選擇：句子不可以被拆開

    結果，小戴（　）球賽，卻（　）全國人民的尊敬。
                ↑ 贏了/輸了      ↑ 贏得/失去

⛔ **不要展開成獨立子列**：

    結果    【________】        ← 空的填空
    結果-1  □贏了 □輸了          ← 對應哪個空格？
    結果-2  □贏得 □失去

那樣門會綠（每組選項都「有選項」了），而學生看到一個空填空加兩組孤兒選項，
**比原本什麼都不顯示更難懂**。Young 2026-08-19：「結果1 2 感覺你沒有認真做？
他是單選嗎？還是填充？」

✅ 句子留在同一列，每組選項標明對應第幾個空格。兩組選項常常長得幾乎一樣
（贏了/輸了 vs 贏得/失去），沒有標示學生分不出誰是誰。

⚠️ 標示會引入換行。`parse_checkbox_options` 的 chunk 範圍是「這個圈號到下一個圈號」，
會把下一行的標籤吃進選項（`'輸了\n第二個空格：'`）—— 切分要在換行處停。

## `【】` 裝兩種東西：空格 vs 作答指示

    【　　　】   學生要填的空格
    【 單選 】   作答指示（單選／多選／複選／勾選／打勾）

任何「數 `【】` 當題數」的地方都會把指示語算成一題。它渲染成標籤、學生填不了，
於是分母永遠到不了 —— 提交鈕永遠是灰的（2026-08-19 實測「已填 5 / 7」）。

⚠️ 抽取端不要把它挖成空白（那讓學生不知道要勾幾個），消費端要認得它不是空格。

## 答案代號：全形與多答案

| 陷阱 | 實例 | 後果 |
|---|---|---|
| 全形字母 | `answer: Ｂ` vs `option_bank: {A,B,C}` | 字面比對對不上 ⇒ **整課判不了分**，畫面無異常（L0056 九題） |
| 一題兩答案 | `answer: 'A/B'`，`answer_note: 原稿手寫，兩個都算對` | 整串當一個代號查 ⇒ 那題永遠不對（L0012） |

抽取照原稿寫（那就是紙上的樣子），**正規化在服務層做**，不要改資料檔。

## 反模式
- ❌ 用現行 `story_structure`（已壞）
- ❌ 把 nested 攤平成 flat
- ❌ 把 `【】` 內預設答案直接當題目顯示（那是答案，要藏起來當 blank）
- ❌ 把合併的父 label 重複寫成每列一次
- ❌ 用 vmerge 判斷合併（用 text identity）
- ❌ 把 hint_value 格式（G6-L24 元素/提示/重點）誤判成 nested
- ❌ **把行內選擇展開成「X-1」「X-2」獨立列**（句子被拆開，學生不知道選項填哪個空格）
- ❌ **只認 `options` 的一種寫法**（dict/list/sub_items/inline_choices/option_bank 全都要認）
- ❌ **把 `【單選】` 當成一個空格數進題數**（分母永遠填不滿，提交鈕永遠灰）
- ❌ 改資料檔來繞過全形答案代號（那是紙上的樣子，正規化在服務層做）
