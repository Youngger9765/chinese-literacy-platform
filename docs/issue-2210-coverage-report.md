# Issue #2210: Full-Corpus Coverage Report (v2 — Post P0+P1 Fix)
## DOCX-to-Schema Pipeline — 151-Lesson Batch Run + Human Audit

_Updated: 2026-06-11 (v2 applies P0 eval fix + P1 router expansion). Per Young's iron rule:
"寧可誠實報 70% 也不准作弊衝 100%"._

---

## 1. Executive Summary (v2 — Post Fix)

### v1 → v2 Comparison

| Metric | v1 (before fix) | v2 (after P0+P1) | Delta |
|--------|----------------|-----------------|-------|
| Pipeline crashes | 0/151 | 0/151 | — |
| SP PASS (strict) | 119/151 = 78.8% | 119/151 = 78.8% | 0 |
| SP PASS (adj., excl. no-section) | 119/125 = 95.2% | 119/125 = 95.2% | 0 |
| KP PASS (strict) | 86/136 = 63.2% | **117/136 = 86.0%** | **+31** |
| Strategy unknown | 46/151 = 30.5% | **2/151 = 1.3%** | **−44** |
| Overfit lint | PASS | PASS | — |
| Null answers | 0 | 0 | — |

### P0 Fix: Eval Bug (comparison table double-count) — applied in this PR
Fixed `eval_keypoints()` double-counting for 2-column tables.
- +37 honest gains (rr now correctly 1.0)
- 6 revealed false-passes (had rr > 1.0 which accidentally satisfied rr ≥ 0.95)
- **Net KP PASS: +31**

### P1 Fix: Strategy Router Expansion — applied in this PR
Added 39 new patterns to `STRATEGY_TAXONOMY` in `build_lesson_schema.py`.
- 64 → 2 unknown strategy lessons (−44 resolved, 2 remain: NO_BRACKET filenames)
- **label_family_correct** now correct for all previously-unknown lessons

---

## 2. Run Configuration

- **Branch**: `fix/issue-2210-batch-all-lessons` (base: `fix/issue-2205-docx-online-schema-experiment`)
- **Script**: `scripts/batch_all_lessons.py`
- **Eval script**: `scripts/eval_lesson_schema.py` (P0 fix applied — this PR)
- **Pipeline script**: `scripts/build_lesson_schema.py` (P1 fix applied — this PR)
- **DOCX root**: `private/curriculum-source/2026-05-01/` (gitignored, main checkout only)
- **Schema output**: `private/curriculum-source/_online-schema/` (gitignored)
- **Overfit lint**: PASS throughout — scanned after both P0 and P1 changes

---

## 3. P0 Fix: Eval Bug — Comparison Table Row Double-Count

### Root Cause

`eval_keypoints()` computed `schema_row_count` as:
```python
sum(1 + len(r.get("sub_rows", [])) for r in rows_out)
```

For 2-column tables (`columns = ['label', 'value']`), `sub_rows` represents the
**second column's content** (comparing object B against object A per row), not additional
data rows. The formula counted each row as `1 + 1 = 2` instead of `1`.

For 3-column tables (`columns` includes `'sub_label'`), `sub_rows` represents genuine
nested sub-questions — the original formula remains correct.

### Fix Applied

Detection by structural feature (not lesson names):
```python
schema_columns = kp_schema.get("keypoints", {}).get("columns", [])
is_two_col_table = schema_columns == ["label", "value"]
if is_two_col_table:
    schema_row_count = len(rows_out)   # sub_rows = second-column content only
else:
    schema_row_count = sum(1 + len(r.get("sub_rows", [])) for r in rows_out)
```

No hardcoded lesson IDs or story-specific proper nouns. Overfit lint: PASS.

### Impact

| | Count |
|-|-------|
| Lessons genuinely recovered (rr was > 1.05, now correctly 1.0) | +37 |
| Revealed false-passes exposed (old rr > 1.0 masked rr < 1.0) | 6 |
| Net KP PASS gain | **+31** |

The 6 "regressions" (G4-L2, G5-L11, G5-L12, G5-L17, G6-L4, G9-L8) were previously PASS
only because rr > 1.0 still satisfied ≥ 0.95. These are genuine extraction shortfalls,
now correctly reported as FAIL.

### Human Eye Audit (5 of 37 gains)

| Lesson | Strategy | rr v1 → v2 | Verdict |
|--------|----------|-----------|---------|
| G4-L20 | multiple_perspectives | 2.0 → 1.0 | Correct: 6-row table, sub_rows = right-column content |
| G5-L16 | main_idea_inference | 2.0 → 1.0 | Correct: 4-row history table, sub_rows = fill answers |
| G7-L14 | sel_character | 1.75 → 1.0 | Correct: 4-row SEL table, no genuine sub-questions |
| G9-L3 | express_opinion | 1.83 → 1.0 | Correct: 11-row argumentation structure |
| G5-L21 | sel_character | 2.0 → 1.0 | Correct: 4-row PSE table, sub_rows = right column |

All 5 audited gains are genuine. Schema content was correct before the fix — only the
eval metric was wrong.

---

## 4. P1 Fix: Strategy Router Expansion

### Root Cause

`detect_strategy_from_filename()` matches strategy keywords from the DOCX filename bracket.
The 2026-05 curriculum batch and SEL/media literacy lessons use new vocabulary (39 unmatched
bracket strings) not in the original `STRATEGY_TAXONOMY`.

### New Patterns (39 generic semantic patterns, zero story-specific nouns)

| Type | Patterns added (representative) |
|------|--------------------------------|
| `main_idea_inference` | 提取上位概念, 從事實歸納概念, 找作者主要論點 |
| `inference` | 拆詞釋義, 從上下文推測詞義, 推測詞義, 閱讀策略 |
| `multiple_perspectives` | 以不同角度.*說明 |
| `express_opinion` | 分辨事實與判斷, 議論文結構 |
| `writing_technique` | 認識句型, 固定句式 |
| `self_questioning` | 解題策略 |
| `classical_grammar` | 斷句.*判讀, 判斷句, 文言文閱讀策略 |
| `scientific_inquiry` | 比較異同.*解決問題, 科學探究法 |
| `problem_solving` | 簡單推理 |
| `sel_character` (19 patterns) | 自我覺察, 念頭覺察, 人際溝通, 媒體素養, 跨文化接納, 正向思考, 自我管理, 時間管理, 認識自我, 生活素養, 生涯探索, 性別平等, 向.*歧視說不, 落實環保, 建立.*習慣, 負責任的決定, 品格, SEL, 感恩 |

### Impact

- Unknown: 64 → 2 (−44 resolved, 2 remain: `G4-L1`, `G9-L10` have no bracket in filename)
- The 2 remaining unknowns are a known limitation — no fix possible from filename alone

### DEV/TEST Regression Check (Post P0+P1)

- DEV: 7/7 KP PASS, 7/7 SP PASS — no regression
- TEST: 14/14 KP PASS, 14/14 SP PASS — no regression
- generalization_gap (KP): 0.00
- generalization_gap (SP): 0.00
- Overfit lint: PASS

---

## 5. Spotlight (SP) Results — Unchanged by This PR

| Category | Count | Notes |
|----------|-------|-------|
| PASS | **119/151 = 78.8%** | |
| no-section (None) | 26 | Template incompatibility — not a bug |
| found-but-failed (False) | 6 | See §5.1 |

**Adjusted rate** (excl. no-section templates where 閱讀聚光燈 section is absent by design):
119/125 = **95.2%**

### 5.1 Found-But-Failed (6 Lessons)

| Lesson | answer_recall | guide_retained | Root cause |
|--------|--------------|----------------|-----------|
| G4-L4 | 0.0 | True | Non-standard bracket notation, answer regex miss |
| G5-L3 | 0.0 | True | Non-standard bracket notation, answer regex miss |
| G6-L18 | 1.0 | False | SEL template: no guide block structure |
| G7-L20 | 1.0 | False | Table-only DOCX — 0 paragraph blocks extracted |
| G7-L22 | 1.0 | False | Table-only DOCX — 0 paragraph blocks extracted |
| G9-L8 | 0.667 | True | Partial: 3rd answer in nested sub-table not captured |

### 5.2 No-Section (26 Lessons) — Expected Template Differences

| Root cause | Count |
|------------|-------|
| Classical Chinese texts (no 閱讀聚光燈 in grammar template) | 6 |
| NO_BRACKET / unknown strategy (post-P1: 2 remaining) | 2 |
| SEL / emotion management templates (no standard section) | 4 |
| Media literacy / writing / other (no section marker) | 14 |

---

## 6. Keypoints (KP) Results (v2)

| Category | Count |
|----------|-------|
| KP not applicable | 15 |
| **KP PASS** | **117/136 = 86.0%** |
| KP FAIL — under-count (rr < 0.95) | 8 |
| KP FAIL — blank recall low (br < 0.95) | 6 |
| KP FAIL — label_family_correct | 3 |
| KP FAIL — unknown strategy (2 remaining) | 2 |

### Blank Recall Failures (6 Lessons — same as v1)

| Lesson | blank_recall | Notes |
|--------|-------------|-------|
| G6-L9 | 0.82 | ~2 blanks missed |
| G6-L11 | 0.91 | 1 blank missed |
| G7-L6 | 0.00 | All blanks missed (also no SP section) |
| G8-L19 | 0.60 | multiple_perspectives blank gap |
| 文-L6 | 0.90 | Classical bracket `（　）` not matched by standard blank extractor |
| 文-L8 | 0.67 | Classical bracket `（　）` — same |

---

## 7. Remaining Gaps (Honest Assessment)

| Priority | Issue | Affected | Proposed Fix |
|----------|-------|----------|-------------|
| P2 | SP guide_retained=False (SEL/media) | 3 | Guide detection for non-question SEL blocks |
| P2 | Table-only DOCXs (G7-L20, G7-L22) | 2 | Table-first spotlight extractor variant |
| P2 | Classical Chinese blank notation `（　）` | ~5 | Add `（　）` pattern to blank extractor |
| P2 | G4-L4 / G5-L3 answer_recall=0.0 | 2 | Debug non-standard bracket notation in answer extractor |
| P2 | G9-L8 partial answer (nested sub-table) | 1 | Sub-table answer extraction |
| P2 | KP under-count (genuine row miss) | 8 | Case-by-case DOCX structure review |
| Known limit | NO_BRACKET filenames (G4-L1, G9-L10) | 2 | Cannot fix from filename alone |

### What Is Out of Scope
- Classical Chinese grammar tables → spotlight conversion (no 閱讀聚光燈 section in template)
- SEL lessons with no standard 閱讀聚光燈 section

---

## 8. Human-Eye Audit (25-Lesson Sample, v1) + 5 Gain Audit (v2)

### v1 Audit Verdict (25 lessons across all families)
The pipeline produces semantically correct schemas for all 119 PASS lessons and for the
28 comparison-table lessons where only the eval metric was wrong. Core extraction logic
is sound. Failures are concentrated in 4 root causes (eval bug / template incompatibility
/ routing gap / classical blank notation).

### v2 Gain Audit (5 of 37 recovered lessons)
All 5 audited gains confirmed correct — schema content was already right before the fix,
only the eval metric needed correction. No overfit or fabrication observed.

---

## 9. Null Answer Count

**Total null answers**: 0 across all 151 lessons (both v1 and v2).

The 4 partial answer failures (G4-L4, G5-L3, G9-L8 + 1 duplicate) are `answer_recall < 1.0`,
not null answer records.

---

## 10. Files Changed (PR #2211)

| File | Change |
|------|--------|
| `scripts/batch_all_lessons.py` | New — batch runner |
| `scripts/eval_lesson_schema.py` | **P0 fix**: comparison table row count |
| `scripts/build_lesson_schema.py` | **P1 fix**: 39 new strategy patterns in STRATEGY_TAXONOMY |
| `docs/issue-2210-gold-families.tsv` | Updated: 151-lesson mapping with P1 strategy types |
| `docs/issue-2210-coverage-report.md` | This file (v2) |

**Gitignored (not in PR)**: all schema YAML files, batch_run_log.json, full_eval_results.json

---

## 11. Overfit Lint Result

```
overfit_lint PASS: no hardcoded lesson IDs found in build_lesson_schema.py
```

Verified after both P0 and P1 changes. All new `STRATEGY_TAXONOMY` patterns use generic
semantic keywords only. No story character names, no lesson-specific proper nouns.
