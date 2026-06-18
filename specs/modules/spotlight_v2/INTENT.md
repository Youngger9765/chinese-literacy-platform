# spotlight_v2 — 聚光燈 block 序列契約

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
