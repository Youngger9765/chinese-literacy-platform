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
owns_data:
  - backend/data/lessons/_parsed_2026-05-01/**/*.yml
spec_tests:
  - backend/specs/test_story_structure_spec.py
  - backend/tests/test_yaml_first_structure.py
  - backend/tests/test_story_structure_qa_contract.py
related_issues: [2205, 2261]
last_reviewed: 2026-06-17
owner: young
---

# 文章重點表（Story Structure）

> 人讀 SOT：`docs/qa/story-structure-verification-standard.md`
> 機器契約：`backend/specs/test_story_structure_spec.py`

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

## 代表課

見 `scripts/story_structure_qa_lib.py` → `REPRESENTATIVE_LESSONS`
