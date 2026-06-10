# Issue #2205 — Eval Standard for DOCX → Schema Pipeline

**Purpose**: Define quantifiable, reproducible metrics for evaluating the DOCX-to-schema pipeline.
All validation reports MUST use these metric names.

---

## 1. Keypoints Eval Metrics

| Metric | Formula | Target |
|--------|---------|--------|
| `row_recall` | schema rows (incl. nested sub_rows) / DOCX table actual rows | 1.0 |
| `nesting_preserved` | bool: 解決下的子列未被攤平 | true |
| `blank_recall` | 抓到的【】數 / DOCX 內【】數 | 1.0 |
| `blank_answer_precision` | 答案正確的 blank / 抓到的 blank | ≥ 0.9 |
| `cell_integrity` | bool: 無合併格 value 串接錯亂 | true |
| `label_family_correct` | 判對 摘要/敘事人物/比較/研究 哪一族 | true |

**PASS criteria**: `row_recall == 1.0 AND blank_recall == 1.0 AND cell_integrity AND label_family_correct`

---

## 2. Spotlight Eval Metrics

| Metric | Formula | Target |
|--------|---------|--------|
| `block_order_match` | bool: block 順序與 docx 一致 | true |
| `guide_retained` | bool: guide block 數 > 0 when DOCX has 小祕訣/步驟 | true |
| `passage_recall` | passage blocks found / DOCX passage count | ≥ 0.8 |
| `passage_source_accuracy` | lesson_text vs supplementary 判對率| ≥ 0.8 |
| `answer_recall` | single/multi with non-null answer / total single/multi | 1.0 |
| `null_rate` | single/multi with null answer / total | 0.0 |
| `figure_asset_recall` | assets extracted / DOCX embedded images+tables | 1.0 |
| `figure_order_correct` | bool: sequential binding matches doc order | true |
| `bind_paragraph_correct` | figure bind_paragraph is non-empty | true |
| `mcq_leakage` | MCQ blocks in spotlight output | 0 |

**PASS criteria**: `answer_recall == 1.0 AND mcq_leakage == 0 AND guide_retained`

---

## 3. Router / Strategy Detection Metrics

| Metric | Formula | Target |
|--------|---------|--------|
| `family_accuracy` | 判對 family 課數 / 總課數 | ≥ 0.95 |
| `unknown_rate` | strategy=unknown 課數 / 總課數 | ≤ 0.05 |

---

## 4. No-Overfit Protocol (MANDATORY)

- **DEV set** = 教授七課 (G6-L22~25, G7-L28~30). May be used for rule development.
- **TEST set** = ≥15 held-out courses, cross grade (G4~G9 + classical), cross family. NOT to be seen during rule development.
- Reports MUST list DEV and TEST metrics separately.
- `generalization_gap = DEV_pass_rate − TEST_pass_rate`. If gap > 0.15: overfit warning.

### Overfit Lint Rule

Detectors MUST NOT contain lesson-id or course-name strings as matching criteria.
Run this lint as part of eval:

```bash
# Fail if detector code contains hardcoded lesson IDs or course names
grep -n "G[0-9]-L[0-9]\|孟嘗君\|白鯨\|八哥\|雞鳴狗盜" scripts/build_lesson_schema.py | \
  grep -v "LESSON_META\|#\|docstring\|\.py\"" && echo "OVERFIT_LINT_FAIL" || echo "OVERFIT_LINT_PASS"
```

---

## 5. Family Taxonomy (gold labels)

6 families for the router:

| Family | Strategy type codes | Detection signals |
|--------|--------------------|--------------------|
| `guided_steps` | summary_pse, summary_structure, summary_keysentence, summary, trait_inference, emotion_inference, motivation_inference, main_idea_inference, causal_inference, evidence_finding, scientific_inquiry, problem_solving, express_opinion, self_questioning, writing_technique, classical_grammar, perspective_taking, sel_character, emotion_management, inference | catch-all for guided question/fill exercises |
| `trait_match` | trait_inference (when has match table) | 2-col table with col0=線索/文中/事件/言行, col1=特質/情緒/推論 |
| `ordering` | ordering | 順敘/排序/時間序 in filename + ordering type questions |
| `image_table` | image_text, table_text | 圖文整合/圖文表 in filename + embedded images + section figures |
| `comparison_table` | comparison, info_organization, multiple_perspectives | 用表格整理/比較異同/比較多元 in filename + fill-table with comparison labels |
| `keypoints` | summary_pse, summary (when has fill-table) | fill-table with 問題/解決/結果 or 主角/主題/事例 labels |

Gold family reference file: `docs/issue-2205-gold-families.tsv`

---

## 6. Eval Script Usage

```bash
# Eval single lesson
python3 scripts/eval_lesson_schema.py <lesson_id> <docx_path> --schema-dir private/curriculum-source/_online-schema/

# Eval DEV set (7 lessons)
python3 scripts/eval_lesson_schema.py --dev

# Eval TEST set (held-out 15 lessons)
python3 scripts/eval_lesson_schema.py --test

# Full report with generalization gap
python3 scripts/eval_lesson_schema.py --report
```

Output format: per-lesson metrics table + DEV/TEST summary + generalization_gap + overfit_lint result.
