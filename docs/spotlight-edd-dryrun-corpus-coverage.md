# Spotlight→Lesson Adapter — Full-Corpus DRY-RUN Coverage

_Generated 2026-07-02 12:43 by `scripts/batch_corpus_dryrun.py` (`--with-keypoints`=on)._

**DRY-RUN**: nothing promoted into the catalog, `LESSON_RENDERER_V1` untouched, shipped `spotlight_to_lesson_content.py` / `eval_lesson_content.py` imported unmodified. Generated `*.lesson.yml` live in `backend/data/lessons/_lesson_content_dryrun/` (gitignored). Gaps ledger: `backend/data/curriculum_qa/content_known_gaps.adapter.dryrun.yaml`.

## Corpus coverage (honesty)

| set | files discovered | processed | skipped |
|---|---|---|---|
| dev7 | 7 | 7 | 0 |
| test15 | 14 | 14 | 0 |
| catalog | 113 | 113 | 0 |
| **TOTAL** | **134** | **134** | **0** |

Every discovered `*.spotlight.yml` was processed end-to-end (134/134); 0 files silently skipped or truncated.

## Totals — generalization verdict

| status | count | % of processed |
|---|---|---|
| GREEN | 65 | 48.5% |
| NEEDS_REVIEW | 67 | 50.0% |
| UNANCHORED | 0 | 0.0% |
| NO_EXERCISE | 2 | 1.5% |
| RT_FAIL | 0 | 0.0% |
| SCHEMA_FAIL | 0 | 0.0% |
| LOAD_FAIL | 0 | 0.0% |
| **processed** | **134** | 100% |

### Per-set breakdown

| set | GREEN | NEEDS_REVIEW | UNANCHORED | NO_EXERCISE | RT_FAIL | SCHEMA_FAIL | LOAD_FAIL | processed |
|---|---|---|---|---|---|---|---|---|
| dev7 | 4 | 3 | 0 | 0 | 0 | 0 | 0 | 7 |
| test15 | 7 | 6 | 0 | 1 | 0 | 0 | 0 | 14 |
| catalog | 54 | 58 | 0 | 1 | 0 | 0 | 0 | 113 |

**generalization_gap** (DEV green-rate − TEST green-rate) = 0.57 − 0.50 = **+0.07** (within #2205 §4 tolerance)

**Overall green rate:** 65/134 (48.5%) of processed lessons pass all lights.

## 4a (baseline) vs 4b (after fidelity fixes)

`4a` = shipped adapter **before** the three fixes (keypoints anchored to the last figure; exact-filename-only `_parsed` lookup; `match`/`fill_table` silently dropped). `4b` = this run. Same 134-lesson corpus, same `--with-keypoints`. The shift is UNANCHORED → GREEN (real passage/table anchors recovered) + UNANCHORED → NEEDS_REVIEW (honest: no in-document span, or approximate/merged source, or an unsupported `match` type) — **no lesson was faked green**.

| status | 4a (baseline) | 4b (now) | Δ |
|---|---|---|---|
| GREEN | 40 | 65 | +25 |
| NEEDS_REVIEW | 10 | 67 | +57 |
| UNANCHORED | 81 | 0 | -81 |
| NO_EXERCISE | 3 | 2 | -1 |
| RT_FAIL | 0 | 0 | +0 |
| SCHEMA_FAIL | 0 | 0 | +0 |
| LOAD_FAIL | 0 | 0 | +0 |
| **processed** | **134** | **134** | +0 |

**Fidelity wins this round:**

- **Gap 1 (keypoints recovered):** 5 lessons whose `story_structure_table` lived in a merged range file (4 × `keypoints_source_is_merged_range`) or a suffix-stripped base file (1 × `keypoints_source_suffix_resolved`) now emit a `keypoints_table` exercise (were `no_keypoints_source`). All flagged `needs_review` because the source is only approximate for a single lesson — recovered honestly, not faked.
- **Gap 2 (anchor semantics):** `keypoints_table` now anchors to the passage/table blocks it summarizes (figures only for pure-圖文 lessons), so UNANCHORED collapsed 81 → 0. Lessons whose source has NO presentation block are kept `anchors=[]` + `needs_review` + `no_anchorable_passage_in_source` (106 entries) → they land as 🟡 NEEDS_REVIEW, never a fake 🟢.
- **Gap 3 (no silent drop):** `match` blocks (answer-bearing) are emitted as a `custom` exercise (needs_review) preserving every left→right answer — 1 × `matching_type_unsupported` (matching 型別未支援, awaiting a future contract kind; the contract was NOT extended for it this round). `fill_table` blocks are bare `{type}` stubs whose real content is the `story_structure_table` (recovered as `ex-keypoints`); the empty stub yields no block but is logged 17 × `fill_table_stub_no_inline_content` so the skip is on the record. `guide` / `self_check` are intentionally NOT emitted as exercises — they are 教學鷹架 / 後設認知檢核 (non-graded scaffolding), not questions.

## Gap / failure reason distribution

| reason | count | blocks a green? |
|---|---|---|
| `no_anchorable_passage_in_source` | 106 | yes (→ needs_review / unanchored / no-exercise) |
| `strategy_type_unmapped` | 105 | cosmetic (→ DEFAULT_KIND, does not block) |
| `no_anchorable_block` | 53 | yes (→ needs_review / unanchored / no-exercise) |
| `fill_table_stub_no_inline_content` | 17 | no (empty stub; content recovered as ex-keypoints) |
| `multi_choice_incomplete_answer` | 16 | yes (→ needs_review / unanchored / no-exercise) |
| `no_keypoints_source` | 16 | yes (→ needs_review / unanchored / no-exercise) |
| `keypoints_source_is_merged_range` | 4 | yes (→ needs_review / unanchored / no-exercise) |
| `matching_type_unsupported` | 1 | yes (→ needs_review / unanchored / no-exercise) |
| `keypoints_source_suffix_resolved` | 1 | yes (→ needs_review / unanchored / no-exercise) |

<details><summary>unmapped strategy_type codes (all fall to DEFAULT_KIND=guided_steps, the #2205 catch-all — cosmetic)</summary>

| strategy_type | occurrences |
|---|---|
| `sel_character` | 21 |
| `main_idea_inference` | 14 |
| `inference` | 9 |
| `summary` | 8 |
| `writing_technique` | 7 |
| `emotion_inference` | 6 |
| `express_opinion` | 6 |
| `comparison` | 5 |
| `info_organization` | 5 |
| `trait_inference` | 4 |
| `scientific_inquiry` | 4 |
| `causal_inference` | 3 |
| `multiple_perspectives` | 3 |
| `summary_keysentence` | 3 |
| `self_questioning` | 2 |
| `problem_solving` | 2 |
| `perspective_taking` | 1 |
| `motivation_inference` | 1 |
| `classical_grammar` | 1 |

</details>

## Per-lesson red/green (紅綠燈)

`anchors` = every exercise has ≥1 anchor. `answer-verifiable` = 0 round-trip fails (exact/partial/rubric breakdown in parens). `reasons` = distinct gap reasons logged for that lesson.

| set | lesson_code | status | kind(s) | blocks | ex | steps | anchors | answer-verifiable | needs_review | reasons |
|---|---|---|---|---|---|---|---|---|---|---|
| dev7 | G6-L22 | 🟢 GREEN | guided_steps, keypoints_table | 11 | 2 | 16 | 🟢 | 🟢 (1e/1p/0r) | 0 | `fill_table_stub_no_inline_content` |
| dev7 | G6-L23 | 🟢 GREEN | guided_steps, keypoints_table | 12 | 2 | 15 | 🟢 | 🟢 (1e/1p/0r) | 0 | `fill_table_stub_no_inline_content` |
| dev7 | G6-L24 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 3 | 🟢 | 🟢 (1e/1p/0r) | 2 | `fill_table_stub_no_inline_content`, `no_anchorable_block`, `no_anchorable_passage_in_source` |
| dev7 | G6-L25 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 3 | 🟢 | 🟢 (1e/1p/0r) | 2 | `fill_table_stub_no_inline_content`, `no_anchorable_block`, `no_anchorable_passage_in_source` |
| dev7 | G7-L28 | 🟢 GREEN | graphic_text_integration, keypoints_table | 7 | 2 | 12 | 🟢 | 🟢 (1e/1p/0r) | 0 | `fill_table_stub_no_inline_content` |
| dev7 | G7-L29 | 🟢 GREEN | graphic_text_integration, keypoints_table | 7 | 2 | 30 | 🟢 | 🟢 (1e/1p/0r) | 0 | — |
| dev7 | G7-L30 | 🟡 NEEDS_REVIEW | graphic_text_integration, keypoints_table | 10 | 2 | 23 | 🟢 | 🟢 (1e/1p/0r) | 1 | `multi_choice_incomplete_answer` |
| test15 | G4-SL10 | 🟡 NEEDS_REVIEW | guided_steps | 5 | 1 | 12 | 🟢 | 🟢 (0e/1p/0r) | 1 | `multi_choice_incomplete_answer`, `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G4-SL13 | 🟢 GREEN | guided_steps | 6 | 1 | 3 | 🟢 | 🟢 (0e/0p/1r) | 0 | `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G5-SL10 | 🟡 NEEDS_REVIEW | guided_steps | 1 | 1 | 5 | 🟢 | 🟢 (0e/1p/0r) | 1 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G5-SL26 | 🟢 GREEN | guided_steps | 4 | 1 | 14 | 🟢 | 🟢 (0e/1p/0r) | 0 | `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G5-SL7 | 🟡 NEEDS_REVIEW | guided_steps | 1 | 1 | 5 | 🟢 | 🟢 (0e/1p/0r) | 1 | `multi_choice_incomplete_answer`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G6-SL14 | 🟢 GREEN | guided_steps | 2 | 1 | 2 | 🟢 | 🟢 (0e/0p/1r) | 0 | `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G6-SL3 | 🟢 GREEN | guided_steps | 2 | 1 | 4 | 🟢 | 🟢 (0e/1p/0r) | 0 | `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G6-SL8 | 🟡 NEEDS_REVIEW | guided_steps | 1 | 1 | 17 | 🟢 | 🟢 (0e/0p/1r) | 1 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `no_keypoints_source` |
| test15 | G7-SL17 | 🟡 NEEDS_REVIEW | guided_steps | 1 | 1 | 2 | 🟢 | 🟢 (0e/0p/1r) | 1 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G7-SL19 | ⚪ NO_EXERCISE | — | 1 | 0 | 0 | 🟢 | 🟢 (0e/0p/0r) | 0 | `no_keypoints_source` |
| test15 | G7-SL9 | 🟡 NEEDS_REVIEW | guided_steps | 1 | 1 | 2 | 🟢 | 🟢 (0e/0p/1r) | 1 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G8-SL4 | 🟢 GREEN | guided_steps | 3 | 1 | 4 | 🟢 | 🟢 (0e/1p/0r) | 0 | `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G8-SL8 | 🟢 GREEN | guided_steps | 4 | 1 | 5 | 🟢 | 🟢 (0e/0p/1r) | 0 | `no_keypoints_source`, `strategy_type_unmapped` |
| test15 | G9-SL9 | 🟢 GREEN | graphic_text_integration | 3 | 1 | 8 | 🟢 | 🟢 (0e/0p/1r) | 0 | `fill_table_stub_no_inline_content`, `no_keypoints_source` |
| catalog | G4-L10 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 6 | 2 | 12 | 🟢 | 🟢 (1e/1p/0r) | 1 | `multi_choice_incomplete_answer`, `strategy_type_unmapped` |
| catalog | G4-L11 | 🟢 GREEN | guided_steps, keypoints_table | 8 | 2 | 5 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L15 | 🟢 GREEN | keypoints_table | 4 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 0 | — |
| catalog | G4-L16 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 5 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L17 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 10 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L18 | 🟡 NEEDS_REVIEW | keypoints_table | 1 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 1 | `no_anchorable_passage_in_source` |
| catalog | G4-L19 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 14 | 🟢 | 🟢 (1e/1p/0r) | 2 | `fill_table_stub_no_inline_content`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G4-L2 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L20 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 5 | 🟢 | 🟢 (1e/1p/0r) | 2 | `keypoints_source_is_merged_range`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G4-L23 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G4-L24 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 13 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G4-L25 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L26 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L27 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L3 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 7 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L4 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 8 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L5 | 🟡 NEEDS_REVIEW | keypoints_table | 1 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 1 | `no_anchorable_passage_in_source` |
| catalog | G4-L6 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G4-L7 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 6 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G4-L8 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G4-L9 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 8 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L11 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L12 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 8 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L13 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L14 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 16 | 🟢 | 🟢 (1e/0p/1r) | 0 | `fill_table_stub_no_inline_content`, `strategy_type_unmapped` |
| catalog | G5-L15 | 🟢 GREEN | keypoints_table | 5 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 0 | — |
| catalog | G5-L16 | 🟡 NEEDS_REVIEW | keypoints_table | 1 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 1 | `fill_table_stub_no_inline_content`, `no_anchorable_passage_in_source` |
| catalog | G5-L17 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 10 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L18 | 🟢 GREEN | guided_steps, keypoints_table | 20 | 2 | 6 | 🟢 | 🟢 (1e/0p/1r) | 0 | `fill_table_stub_no_inline_content` |
| catalog | G5-L2 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 30 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L20 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 1 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L21 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L22 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 1 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L23 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L24 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 3 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 1 | `keypoints_source_is_merged_range`, `strategy_type_unmapped` |
| catalog | G5-L26 | 🟢 GREEN | guided_steps, keypoints_table | 5 | 2 | 14 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L27 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 7 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L3 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 35 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G5-L4 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 8 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L5 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 6 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L6 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 11 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L8 | 🟡 NEEDS_REVIEW | custom, guided_steps, keypoints_table | 3 | 3 | 3 | 🟢 | 🟢 (1e/0p/2r) | 3 | `matching_type_unsupported`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G5-L9 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G6-L10 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 6 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L11 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 18 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L12 | 🟢 GREEN | guided_steps, keypoints_table | 9 | 2 | 4 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G6-L13 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 6 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L15 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 12 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L17 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L18 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L2 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L20 | 🟢 GREEN | keypoints_table | 6 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 0 | — |
| catalog | G6-L3 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L4 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L5 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 6 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G6-L6 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 5 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G6-L7 | 🟢 GREEN | guided_steps, keypoints_table | 10 | 2 | 8 | 🟢 | 🟢 (1e/0p/1r) | 0 | `fill_table_stub_no_inline_content`, `strategy_type_unmapped` |
| catalog | G6-L9 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L1 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 11 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L10 | 🟢 GREEN | guided_steps, keypoints_table | 13 | 2 | 5 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G7-L11 | 🟢 GREEN | guided_steps, keypoints_table | 13 | 2 | 6 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G7-L12 | 🟢 GREEN | guided_steps, keypoints_table | 11 | 2 | 22 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G7-L13 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L14 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 5 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G7-L16 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 6 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L18 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 13 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L2 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 5 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L21 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L23 | 🟢 GREEN | guided_steps, keypoints_table | 7 | 2 | 22 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G7-L24 | 🟢 GREEN | guided_steps, keypoints_table | 5 | 2 | 30 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G7-L25 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 4 | 2 | 3 | 🟢 | 🟢 (1e/1p/0r) | 1 | `multi_choice_incomplete_answer` |
| catalog | G7-L26 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 13 | 🟢 | 🟢 (1e/1p/0r) | 2 | `multi_choice_incomplete_answer`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L3 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 5 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L31 | 🟢 GREEN | guided_steps, keypoints_table | 7 | 2 | 22 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G7-L4 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 5 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L5 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G7-L7 | 🟡 NEEDS_REVIEW | graphic_text_integration, keypoints_table | 2 | 2 | 13 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source` |
| catalog | G7-L8 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G8-L1 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 3 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G8-L11 | 🟢 GREEN | guided_steps, keypoints_table | 10 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 0 | `fill_table_stub_no_inline_content`, `strategy_type_unmapped` |
| catalog | G8-L12 | 🟢 GREEN | keypoints_table | 8 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 0 | — |
| catalog | G8-L13 | ⚪ NO_EXERCISE | — | 1 | 0 | 0 | 🟢 | 🟢 (0e/0p/0r) | 0 | `no_keypoints_source` |
| catalog | G8-L14 | 🟢 GREEN | guided_steps | 2 | 1 | 3 | 🟢 | 🟢 (0e/0p/1r) | 0 | `no_keypoints_source`, `strategy_type_unmapped` |
| catalog | G8-L15 | 🟢 GREEN | keypoints_table | 7 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 0 | — |
| catalog | G8-L16 | 🟢 GREEN | guided_steps, keypoints_table | 6 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G8-L17 | 🟢 GREEN | guided_steps, keypoints_table | 7 | 2 | 1 | 🟢 | 🟢 (1e/0p/1r) | 0 | `fill_table_stub_no_inline_content`, `strategy_type_unmapped` |
| catalog | G8-L18 | 🟢 GREEN | keypoints_table | 5 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 0 | `fill_table_stub_no_inline_content` |
| catalog | G8-L19 | 🟢 GREEN | guided_steps, keypoints_table | 7 | 2 | 2 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G8-L3 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 7 | 2 | 5 | 🟢 | 🟢 (1e/1p/0r) | 1 | `fill_table_stub_no_inline_content`, `multi_choice_incomplete_answer`, `strategy_type_unmapped` |
| catalog | G8-L4 | 🟢 GREEN | guided_steps, keypoints_table | 8 | 2 | 4 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G8-L5 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 9 | 🟢 | 🟢 (1e/1p/0r) | 0 | `strategy_type_unmapped` |
| catalog | G8-L6 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 8 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G8-L7 | 🟢 GREEN | guided_steps, keypoints_table | 8 | 2 | 11 | 🟢 | 🟢 (1e/0p/1r) | 0 | `fill_table_stub_no_inline_content`, `strategy_type_unmapped` |
| catalog | G8-L8 | 🟢 GREEN | guided_steps, keypoints_table | 6 | 2 | 5 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G8-L9 | 🟢 GREEN | keypoints_table | 2 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 0 | — |
| catalog | G8-L9a | 🟡 NEEDS_REVIEW | keypoints_table | 3 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 1 | `keypoints_source_suffix_resolved` |
| catalog | G9-L1 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 2 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L10 | 🟡 NEEDS_REVIEW | keypoints_table | 1 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 1 | `no_anchorable_passage_in_source` |
| catalog | G9-L11 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 9 | 2 | 10 | 🟢 | 🟢 (1e/1p/0r) | 1 | `fill_table_stub_no_inline_content`, `multi_choice_incomplete_answer`, `strategy_type_unmapped` |
| catalog | G9-L12 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 10 | 🟢 | 🟢 (1e/1p/0r) | 2 | `multi_choice_incomplete_answer`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L13 | 🟢 GREEN | guided_steps, keypoints_table | 4 | 2 | 6 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G9-L14 | 🟢 GREEN | guided_steps, keypoints_table | 8 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | G9-L15 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 2 | `keypoints_source_is_merged_range`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L17 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 2 | `keypoints_source_is_merged_range`, `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L2 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 13 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L3 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L4 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 4 | 🟢 | 🟢 (1e/1p/0r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L5 | 🟡 NEEDS_REVIEW | keypoints_table | 1 | 1 | 0 | 🟢 | 🟢 (1e/0p/0r) | 1 | `no_anchorable_passage_in_source` |
| catalog | G9-L6 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 2 | 2 | 5 | 🟢 | 🟢 (1e/0p/1r) | 2 | `no_anchorable_block`, `no_anchorable_passage_in_source`, `strategy_type_unmapped` |
| catalog | G9-L8 | 🟢 GREEN | graphic_text_integration, keypoints_table | 11 | 2 | 35 | 🟢 | 🟢 (1e/1p/0r) | 0 | — |
| catalog | G9-L9 | 🟢 GREEN | graphic_text_integration, keypoints_table | 4 | 2 | 8 | 🟢 | 🟢 (1e/0p/1r) | 0 | — |
| catalog | 文-L1 | 🟢 GREEN | guided_steps, keypoints_table | 3 | 2 | 3 | 🟢 | 🟢 (1e/0p/1r) | 0 | `strategy_type_unmapped` |
| catalog | 文-L2 | 🟡 NEEDS_REVIEW | guided_steps, keypoints_table | 6 | 2 | 7 | 🟢 | 🟢 (1e/1p/0r) | 1 | `multi_choice_incomplete_answer`, `strategy_type_unmapped` |

---
_Total gap entries this run: 319 (unified ledger written to `backend/data/curriculum_qa/content_known_gaps.adapter.dryrun.yaml`)._
