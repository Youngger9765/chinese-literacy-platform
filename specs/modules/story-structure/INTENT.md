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
owns_data:
  - backend/data/lessons/_parsed_2026-05-01/**/*.yml
  - backend/data/curriculum_qa/keypoints_manifest.json
  - backend/data/curriculum_qa/snapshots/**/*
spec_tests:
  - backend/specs/test_story_structure_spec.py
  - backend/specs/test_keypoints_manifest_spec.py
  - backend/tests/test_yaml_first_structure.py
  - backend/tests/test_story_structure_qa_contract.py
related_issues: [2205, 2261, 2273]
last_reviewed: 2026-06-19
owner: young
---

# 文章重點表（Story Structure）

> 通用 L-layer 框架：`docs/qa/layer-verification-framework.md`
> 人讀 SOT（L1–L5 詳標）：`docs/qa/story-structure-verification-standard.md`
> 機器契約：`backend/specs/test_story_structure_spec.py`

## L-layer 對照

| Gate | 驗什麼 | 工具 / 命令 | Merge 阻擋 |
|------|--------|-------------|-----------|
| **L1** | DOCX ↔ keypoints.yml（row_recall、blank_recall、nesting） | `eval_lesson_schema.py`；`story_structure_qa.py --gates L1` | 改 parser 時必跑 |
| **L2** | keypoints.yml ↔ 上架 YAML `story_structure_table` + manifest sync | `keypoints_table_sync`；`keypoints_manifest_verify.py` | **是**（禁假綠 #2273） |
| **L3** | `interaction_profile` 與 rows 一致；fill_blank / checkbox 計數 | `story_structure_qa.py --gates L3`；`test_yaml_first_structure.py` | **是** |
| **L4** | staging `GET /structure` = local loader | `story_structure_qa.py --gates L4` | merge 後必 spot-check |
| **L5** | StoryStructureTable DOM + profile 驅動互動 | `story_structure_qa.py --gates L5` | merge 後必 spot-check |

**L2 gold 說明**：`backend/data/curriculum_qa/keypoints_manifest.json` + snapshots — 儀表板與 runtime 一致；非 DOCX 全文 gold

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

1. `python scripts/build_keypoints_qa_manifest.py --all`（需 private schema）
2. `python scripts/keypoints_manifest_verify.py` 全綠
3. CI `keypoints-manifest-gate.yml` 會擋 stale manifest

`keypoints_manifest.json` 的 `layout` / `snapshots/*/structure.json` 必須與 live loader + parser 的 `interaction_profile` 一致；`PARSER_GAP_LESSONS` 為空時 `known_gap_count` 必須為 0

