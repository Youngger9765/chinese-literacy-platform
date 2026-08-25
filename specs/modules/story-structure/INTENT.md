---
spec_id: content.story_structure
module: story-structure
title: 文章重點表 — YAML-first structure + interaction_profile 契約
stability: active
canonical_source: backend/app/routes/stories.py
owns_code:
  - backend/app/routes/stories.py
  - backend/app/services/story_structure_cell_parser.py
  - backend/app/services/story_structure_lab_service.py
  - scripts/keypoints_table_sync.py
  - scripts/story_structure_qa_lib.py
  - scripts/story_structure_qa.py
  - scripts/build_keypoints_qa_manifest.py
  - scripts/keypoints_manifest_verify.py
  - backend/app/services/keypoints_to_structure.py
owns_data:
  - backend/data/lessons/*/v3/keypoints.*.yml
  - backend/data/curriculum_qa/keypoints_manifest.json
  - backend/data/curriculum_qa/snapshots/**/*
spec_tests:
  - backend/specs/test_story_structure_spec.py
  - backend/specs/test_keypoints_manifest_spec.py
  - backend/tests/test_yaml_first_structure.py
  - backend/tests/test_story_structure_qa_contract.py
legacy_tests:
  - backend/tests/test_yaml_first_structure.py
  - backend/tests/test_story_structure_qa_contract.py
  - backend/tests/test_keypoints_to_structure.py
  - backend/tests/test_keypoints_subitem_label_2736.py
  - backend/tests/test_keypoints_prompt_stem_2736.py
related_issues: [2205, 2261, 2273, 2736]
last_reviewed: 2026-06-19
owner: young
---

# 文章重點表（Story Structure）

> 通用 L-layer 框架：`docs/qa/layer-verification-framework.md`
> 人讀 SOT（L1–L5 詳標）：`docs/qa/story-structure-verification-standard.md`
> 機器契約：`backend/specs/test_story_structure_spec.py`

## 這個 module 為什麼要認領 `keypoints_to_structure.py`（2026-08-18 / #2736）

`backend/app/services/keypoints_to_structure.py` 是 `keypoints.yml` → `story_structure_table`
的橋，`lesson_indexes.py` 靠它供給 150 課的重點表。但在此之前它**不屬於任何 module**，
而 `.github/workflows/pytest.yml` 是點名清單、`run-ci.sh` Gate 3 只跑 `legacy_tests` 聯集
—— 於是 `backend/tests/test_keypoints_to_structure.py` 存在、卻沒有任何門會執行它
（GHA 0 / run-ci 0 / registry 0，以 `test_rate_limiting`、`test_verify_qr_manifest` 當正向對照）。

代價是兩個靜默流失的 bug 在服務端活了很久，兩個都不報錯、九道門全綠：

| bug | 影響 | 為什麼門看不到 |
|---|---|---|
| 子項標題只讀 `sub_label`/`index`，不讀規格叫大家寫的 `label` | **63 課 / 365 個標題**渲染成空字串 | 形狀門只要求「每列至少一格非空」，其他格空掉照樣過 |
| 全檔沒讀過 `prompt`（題幹） | **3 課 / 5 句**題幹消失，其中 L0012 整格空白 | 同上；逐字門也過，因為 YAML 裡的字沒被改 |

所以 `legacy_tests` 這一欄現在把這條橋的鎖釘進 `run-ci.sh`。
**沒有人跑的鎖是裝飾品** —— 加鎖的同時要確認它真的會被執行。

## L-layer 對照

| Gate | 驗什麼 | 工具 / 命令 | Merge 阻擋 |
|------|--------|-------------|-----------|
| **L1** | DOCX ↔ keypoints.yml（row_recall、blank_recall、nesting） | `eval_lesson_schema.py`；`story_structure_qa.py --gates L1` | 改 parser 時必跑 |
| **L2** | keypoints.yml ↔ 上架 YAML `story_structure_table` + manifest sync | `keypoints_table_sync`；`keypoints_manifest_verify.py` | **是**（禁假綠 #2273） |
| **L3** | `interaction_profile` 與 rows 一致；fill_blank / checkbox 計數 | `story_structure_qa.py --gates L3`；`test_yaml_first_structure.py` | **是** |
| **L4** | staging `GET /structure` = local loader | `story_structure_qa.py --gates L4` | merge 後必 spot-check |
| **L5** | StoryStructureTable DOM + profile 驅動互動 | `story_structure_qa.py --gates L5` | merge 後必 spot-check |

**L2 gold 說明**：`backend/data/curriculum_qa/keypoints_manifest.json` + snapshots — 儀表板與 runtime 一致；非 DOCX 全文 gold

### B4 決議（2026-08-14）：L1 門檻以 code 為準

`docs/issue-2205-eval-standard.md:19`（`row_recall == 1.0 AND blank_recall ==
1.0 AND cell_integrity AND label_family_correct`）與
`docs/qa/story-structure-verification-standard.md:70-75`（`>= 0.95`，且
`label_family_correct` 只 warn）兩份互相矛盾。實測 `scripts/eval_lesson_schema.py:345-350`：

```python
passed = (
    row_recall >= 0.95 and
    blank_recall >= 0.95 and
    nesting_preserved and
    label_family_correct
)
```

**裁決：code 是 SOT。** 門檻是 `>= 0.95`（不是 `== 1.0`），且
`label_family_correct` **是**硬 gate（不是 warn-only）。兩份文件已同步改正
（`docs/issue-2205-eval-standard.md` §1、`docs/qa/story-structure-verification-standard.md`
L1 表）。往後若要改門檻，先改 `eval_lesson_schema.py`，文件跟著改，不要反過來。

一鍵本地：

```bash
bash scripts/story_structure_ship_gate.sh          # verify only（CI）
bash scripts/story_structure_ship_gate.sh --rebuild  # 有 private schema 時
```

代表課：見 `scripts/story_structure_qa_lib.py` → `REPRESENTATIVE_LESSONS`

## 不變式

### I-1: `story_structure_table` 優先於 AI rows

Loader 有 `story_structure_table` 時，`GET /api/stories/{id}/structure` 不得呼叫 Gemini

### I-2: `interaction_profile` 與 rows 一致

`sanitize` 後的 structure 必須附 `interaction_profile`，且 `mode` / `fill_blank_count` / `checkbox_count` 與 rows 計數一致

### I-3: 答案不得洩漏給 client

client structure 的 `value` / `label`（含 `blank_in_label`）不得含 `【答案】`，僅允許 `【　　　】`

### I-4: label_blanks 必須進 YAML

keypoints.yml 的 `label_blanks` 經 `keypoints_table_sync.py` 轉成 `【 answer 】` 出現在 `story_structure_table`

### I-5: □ 選項轉 checkbox

含 `□` + 圈號選項的 cell 必須產出 `interactive_type: checkbox` 與 `options` / `correct_options`

### I-6: Admin 重點表 manifest 必須跟 runtime 同步（禁假綠）

改 `owns_code` 或 lesson `story_structure_table` 時，**同一 PR** 必須：

1. `python scripts/build_keypoints_qa_manifest.py --all`
2. `python scripts/keypoints_manifest_verify.py` 全綠
3. CI `keypoints-manifest-gate.yml` 會擋 stale manifest

`keypoints_manifest.json` 的 `layout` / `snapshots/*/structure.json` 必須與 live loader + parser 的 `interaction_profile` 一致；`PARSER_GAP_LESSONS` 為空時 `known_gap_count` 必須為 0

**基準來源**（#2749 改）：builder 讀的是**平台真的在服務的那份**——
`backend/data/lessons/<uid>/<version>/keypoints.yml` → `get_all_lessons()` →
`story_structure_table` → route 自己的 formatter。二修把一修的
`private/curriculum-source/_online-schema` 跟 `_parsed_2026-05-01` 都刪了，
builder 卻還指著那兩個目錄，所以 `--all` 直接 exit 1、基準重建不了，
這道門在每個 PR 紅了五天。**門不能刪**：2026-08-17 欄位式重點表整張掉成
五列空的 display、學生不能作答，逐字門／拆模組／聚光燈 render 全綠，
只有這裡的 `interaction_profile` 比對叫出來。

⚠️ **重建 manifest = 重設 ratchet**，也是把 regression 洗白進基準最容易的一條路。
所以 `keypoints_manifest_verify.DISPLAY_ONLY_LESSONS` 是一張具名清單：
任何一課渲染成 `display_only`（= 學生看到答案、沒有東西可作答）都必須具名 + 寫理由
才放行；修好了就要把那行刪掉，留著也會紅。人工判讀（`overall_pass` /
`known_data_gap`）**按 lesson_uid 沿用、永不重生**——用被 QA 的產物生 QA 判讀，
等於讓門同意它被餵的任何東西。

