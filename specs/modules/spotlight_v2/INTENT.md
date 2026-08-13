---
spec_id: learning.spotlight_v2
module: spotlight-v2
title: 聚光燈 v2 — block 序列契約 + G6-L22 驗收
stability: active
canonical_source: backend/app/services/spotlight_block_model.py
owns_code:
  - backend/app/services/spotlight_block_model.py
  - backend/app/services/spotlight_contract.py
  - backend/app/services/spotlight_v2_loader.py
  - backend/app/services/spotlight_pse_parser.py
  - scripts/build_lesson_schema.py
  - frontend/src/components/reading-spotlight/
owns_data:
  - backend/data/lessons/spotlight/**
spec_tests:
  - backend/specs/test_spotlight_block_model_spec.py
  - backend/specs/test_spotlight_v2_spec.py
  - backend/specs/test_pse_mcq_parser_spec.py
related_issues: [2205]
source_meetings:
  - docs/professor-7-lessons-block-decomposition.md
last_reviewed: 2026-06-20
owner: young
---

# spotlight_v2 — 聚光燈 block 序列契約

> 通用 L-layer 框架：`docs/qa/layer-verification-framework.md`
> 量化指標：`docs/issue-2205-eval-standard.md` §2
> 機器契約：`backend/specs/test_spotlight_v2_spec.py`
> 人眼抽審：`.claude/skills/qa-spotlight/SKILL.md`

## L-layer 對照

| Gate | 驗什麼 | 工具 / 命令 | Merge 阻擋 |
|------|--------|-------------|-----------|
| **L1** | DOCX → `.spotlight.yml`（answer_recall、mcq_leakage、guide_retained） | `python3 scripts/eval_lesson_schema.py --dev` / `--test` | 改 parser 時必跑；fixture PR 可靠 batch 紀錄 |
| **L2** | checked-in YAML ↔ `gold_manifest.json` **結構指紋**（非全文 diff） | `python3 scripts/spotlight_contract.py --dev7` / `--test15` | **是** |
| **L3** | block 結構 + loader 在 story dict 暴露 `spotlight_v2`（含 Layer-1 課） | `cd backend && pytest specs/test_spotlight_v2_spec.py -q` | **是** |
| **L4** | staging/preview `GET /api/stories/{id}` 的 `spotlight_v2` = local loader | curl / preview API；catalog code 見 `TEST15_FIXTURE_TO_CATALOG` | merge 後必 spot-check |
| **L5** | `/learn/{id}/reading-strategy` 渲染 `BlockSequenceRenderer`（非 legacy StrategyExercise） | browse + 代表課；見下表 | merge 後必 spot-check |

**L2 gold 說明**：`backend/data/lessons/spotlight/{dev7,test15}/gold_manifest.json` 存 fingerprint（block 序列、計數、mcq_leakage 等），抓 parser 回歸；**不**保證 passage/answer 語意 — 靠 L1 + 人眼 checklist

### B4 決議（2026-08-14）：L1 門檻以 code 為準

`docs/issue-2205-eval-standard.md:38` 曾寫 `answer_recall == 1.0`；實測
`scripts/eval_lesson_schema.py:406-409`（`eval_spotlight`）：

```python
passed = (
    mcq_leakage == 0 and
    guide_retained and
    answer_recall >= 0.99
)
```

**裁決：code 是 SOT。** `answer_recall` 門檻是 `>= 0.99`，不是 `== 1.0`——與
`story-structure` module 的 `row_recall`/`blank_recall`（`== 1.0` 文件 vs
`>= 0.95` code）是同一種「文件寫死 1.0、code 實際留容錯」模式。文件已同步改正
（`docs/issue-2205-eval-standard.md` §2）。往後若要改門檻，先改
`eval_lesson_schema.py`，文件跟著改，不要反過來。

一鍵本地 gate：

```bash
bash scripts/run_spotlight_dev_gate.sh
```

## 代表課（L4/L5 冒煙）

| 課 | catalog / fixture | story_id（staging 約） | 驗什麼 |
|----|-------------------|------------------------|--------|
| G6-L22 | dev7 | 1076 | guide 保留 + passage 後 MCQ；`eval_g6_l22_acceptance` |
| G6-L23 | dev7 | 1077 | free_text AI 回饋 |
| G6-L24/L25 | dev7 | 1078/1079 | fill_table + self_check；頁內可無 passage（設計） |
| G7-L28~L30 | dev7 | 1108–1110 | figure + 圖文整合 |
| G6-L03 | test15 / G6-SL3 | 24 / 1057 | test15 loader + Layer-1 `spotlight_v2` 接線 |

**test15 全量 staging L4+L5（14 課）**：`.qa-screenshots/staging-test15-l5-qa-2026-06-20.md` · 重跑 `cd frontend && node ../.qa-screenshots/run-test15-l5-deep-staging.mjs`

**catalog bulk（104 課）**：`backend/data/lessons/spotlight/catalog/` · promote `python3 scripts/promote_spotlight_catalog.py` · **125/151 v2**（28 課無聚光燈區 → legacy，見 `catalog/no_spotlight_legacy.json`）

完整 dev7 staging QA 紀錄：`.qa-screenshots/spotlight-dev7-staging-qa-2026-06-19.md`

## 目的

聚光燈是高度客製化的教學模組：同一套 block 原語，不同課用不同 sequence。
契約要驗的是**教學意圖**（guide 不丟、passage 與 exercise 配對、互動不是靜態答案），不是只驗 fingerprint。

## 五軸（canonical）

| 軸 | 值域（精簡） |
|----|-------------|
| role | guide, section, bridge, passage, figure, exercise, meta |
| interaction | select_one, select_many, fill_blank, free_write, highlight, match, ordering, acknowledge, null |
| answer | kind + value + options |
| eval | exact, normalized, self_report, ai_rubric, none |
| layout | callout, reading_card, mcq_card, fill_inline, section_heading, … |

Legacy `type` 經 `normalize_block()` 映射；非法 role×interaction 由 `validate_canonical_block()` 拒絕。

## 垂直切片驗收：G6-L22 小兵立大功

教授 decomposition（`docs/professor-7-lessons-block-decomposition.md`）要求：

1. B-guide 開場（好故事、四重點框架）— 不得把 ❶❷❸❹ MCQ 壓成一段靜態 guide
2. 例一烏鴉：B0 passage + B2 練習
3. 孟嘗君（雞鳴）：bridge → B0 passage → 4 題（含 ❸ fill_blank）
4. 小試身手 → 第二則故事 passage + 4 題
5. 進階大象 passage + 練習
6. guide/section 內不得有 `□` 選項行（應在 exercise）
7. **每段 passage 後必有 ❶❷❸❹ 四題**（`eval_g6_l22_segments`）
8. **答案 gold**（`G6_L22_ANSWER_GOLD` + `eval_g6_l22_answers`）：烏鴉/函谷關/白狐裘/大象 四段答案語意正確

機器契約：`eval_g6_l22_acceptance()` + `backend/specs/test_spotlight_block_model_spec.py` + `backend/specs/test_pse_mcq_parser_spec.py`

## 批次

dev7 七課：`normalize_spotlight_blocks` + `validate_canonical_block` 全綠後，才擴到 TEST set（≥15 課）。

## 明確不在本模組

- 重點表 B4 nested 表格 UI（`fill_table` 仍為 meta bridge）
- 圖/表 asset 綁定（figure referent — 另 issue）
- 144 課全量 gold（僅 dev7 gold_manifest）

## owns_code

- backend/app/services/spotlight_block_model.py
- backend/app/services/spotlight_contract.py
- backend/app/services/spotlight_v2_loader.py
- scripts/build_lesson_schema.py
- frontend/src/components/reading-spotlight/

## spec_tests

- backend/specs/test_spotlight_block_model_spec.py
- backend/specs/test_spotlight_v2_spec.py
- backend/specs/test_pse_mcq_parser_spec.py
