# Block-based Lesson Content Contract — EDD Foundation (Phase 0 + Phase 1)

This directory + the files listed below implement **Phase 0 (EDD 安全網)** and **Phase 1
(內容契約骨幹)** of `SPOTLIGHT_REFACTOR_PLAN.md`. It is **additive scaffolding** — it does
not modify or replace any existing renderer (`ComprehensionLayout.tsx`,
`StrategyExercise.tsx`, `PairedReading`), `ingest_curriculum.py`, or the running `#2205`
spotlight/keypoints pipeline. Existing lessons and behaviour are untouched.

## What this is (plan → files)

| Plan item | Deliverable | Path |
|---|---|---|
| §4 contract spine (pydantic) | Block-based `Lesson` pydantic contract | `backend/app/schemas/lesson_content.py` |
| §4 contract spine (zod) | Front-end zod mirror (shared semantics) | `frontend/src/schema/lessonContent.ts` |
| §3.4 anti-overfit gate | 4 layered hard-case fixtures | `backend/tests/fixtures/lesson_content/*.lesson.yml` |
| validation CLI | Validate lesson YAML + flag un-verifiable answers | `scripts/validate_lesson_content.py` |
| §3.2 / §3.3 eval skeleton | schema-valid + answer round-trip + coverage 紅綠燈 + golden | `scripts/eval_lesson_content.py` |
| test harness (pytest) | Ties eval into the repo test framework | `backend/tests/test_lesson_content_schema.py` |
| front/back parity gate (vitest) | Validates the SAME fixtures through zod | `frontend/src/schema/__tests__/lessonContent.contract.test.ts` |
| §3.2 golden snapshots | Frozen normalized JSON per fixture | `backend/tests/fixtures/lesson_content/_golden/*.golden.json` |

## The contract in one paragraph

A `Lesson` is `{ id, lesson_code, title?, blocks[] }`. `blocks` is an ordered, typed
sequence — a discriminated union of
`paragraph | figure | table | parallel_passage | exercise`, each with a stable `id`. The
"一般 vs 圖文" split degrades into block **ordering + anchors**, not two layouts (plan §2.3).
An `exercise` block carries a question-type discriminated union covering the 7 registered
types (`multiple_choice | fill_in_blank | ordering | trait_inference | guided_steps |
graphic_text_integration | keypoints_table`) plus a `custom` escape hatch.

### The answer-verifiability invariant (plan §2.2 — the whole point)

Every `exercise` MUST declare three things, no exceptions:

- **`answer_space`** — how the student answers (`choice | multi_choice | text | order | free_text`)
- **`answer`** — the standard answer, stored **machine-comparable** (never prose)
- **`grader`** — how it is judged (`exact | set | ordered | rubric_ai | manual`)

The `custom` escape hatch is **not exempt** from `answer` + `grader`; it may only set
`needs_review: true` to route itself to a human queue. "漂亮 HTML" never counts as an
answer. The invariant is enforced in code (pydantic `model_validator` + zod
`superRefine`), so a lesson that looks fine but is un-gradable is **rejected at
validation time**, not discovered later.

### Anchor model

Exercises carry `anchors: [{ block_id, char_start?, char_end? }]` — the 聚光燈 pointer
into the passage that the current pipeline lost. Every anchor must point at an existing
non-exercise block (validated).

## The 4 layered fixtures (anti-overfit — hard courses first, §3.4)

Deliberately layered so passing them proves the contract expresses **real variation**,
not just easy narrative courses. All are hand-transcribed from real lessons in
`backend/data/lessons/_parsed_2026-05-01/`.

| Fixture | Real lesson | Layer / why it's hard | Types exercised |
|---|---|---|---|
| `G6-L22.lesson.yml` | 小兵立大功：雞鳴狗盜的故事 | general **narrative** — the dominant `guided_steps` 問題.解決.結果 spotlight | `guided_steps`, `multiple_choice` |
| `G7-L30.lesson.yml` | 都是八哥，為什麼命運不一樣？ | **graphic-text** — figure + 2 data tables interleaved, `graphic_text_integration` spotlight anchored to 圖一/表一/表二 | `graphic_text_integration`, `multiple_choice` |
| `wen-L2.lesson.yml` | 文言文怎麼讀？以「鞭虎救弟記」為例 | **文言文** — 白話/文言 對照表 as a first-class `parallel_passage` block; `custom` escape hatch still exercised elsewhere | `parallel_passage`, `custom`, `fill_in_blank`, `multiple_choice` |
| `G5-L9.lesson.yml` | 周天成的一天──頂尖選手的養成 | **multi-type / table** showcase — proves the 4 remaining types | `trait_inference`, `ordering`, `multiple_choice` (multi-select), `fill_in_blank` (text) |

Together they green-light all **7 registered question types** (enforced by
`test_all_question_types_covered`).

> Note on `G5-L9.lesson.yml`: its `trait_inference` + `guided_steps` content is faithfully
> transcribed from the real lesson, but the `ordering` and multi-select `multiple_choice`
> exercises were *composed* from the same passage to exercise those two types (the real
> `_parsed` corpus stores everything as `guided_steps` select/free_text steps — see gaps).

## How to run

All backend commands use the repo venv interpreter (has pydantic 2 + pyyaml + pytest):
`backend/.venv/bin/python` (or activate it).

```bash
# 1. Validate the fixtures against the contract (flags un-verifiable answers)
backend/.venv/bin/python scripts/validate_lesson_content.py --fixtures

# 2. Eval harness: schema + answer round-trip + coverage 紅綠燈 (console)
backend/.venv/bin/python scripts/eval_lesson_content.py --fixtures
#    ...as a markdown table:
backend/.venv/bin/python scripts/eval_lesson_content.py --fixtures --markdown

# 3. Golden snapshots (§3.2): freeze approved content, then diff on later change
backend/.venv/bin/python scripts/eval_lesson_content.py --fixtures --freeze-golden
backend/.venv/bin/python scripts/eval_lesson_content.py --fixtures --check-golden

# 4. Full pytest gate (schema + round-trip + coverage + negative + golden)
cd backend && python -m pytest tests/test_lesson_content_schema.py -v

# 5. Front/back parity gate (validates the SAME fixtures through the zod schema)
cd frontend && npx vitest run src/schema/__tests__/lessonContent.contract.test.ts
```

`zod` and `yaml` were added to `frontend/package.json` (`npm install` if a clean
checkout doesn't have them). If your npm cache errors with `EEXIST`/`EACCES`, install
with an isolated cache: `npm install --cache /tmp/npm-cache`.

## Schema gaps — status (honest — NOT fudged)

These are the design-level findings surfaced while transcribing the hard fixtures. Per
the plan (§3.4, "別讓 AI HTML 把變異性吸收掉") they are recorded here rather than papered
over by quietly widening the contract. Each is marked with its **current status** —
CLOSED means the contract expresses it faithfully AND a fixture + test exercise it.

1. **Multi-select inside `guided_steps` — CLOSED.** In the real corpus (e.g. G7-L30),
   複選 steps were downgraded to `free_text` because "前端 strategy step 目前僅支援單選比對".
   `GuidedStep` now has a `multi_select` type carrying a `list[int]` index set (set
   semantics: deduped, in-range, negatives rejected). Exercised by the G7-L30
   spotlight's 整合題 step and by unit tests on both pydantic + zod.

2. **Merged-cell tables — CLOSED for row-spanning section columns; nested sub-rows
   still via `keypoints_table`.** The defining real shape is a vmerged section-label
   **COLUMN** (G7-L30 表一 `異同` = 相同處/相異處; G7-L2 story_structure = 澳洲全民重視體育 /
   運動選手生涯), NOT a horizontal band. `TableBlock` now carries `section_label_col`
   (the vmerged column's header) + `row_sections` (per-row membership), and the grid
   width validator is **rowspan-aware**, so a faithful vmerge grid (origin row carries a
   `rowspan=N` section cell; the N-1 spanned rows omit that cell) validates. G7-L30
   table-1 is transcribed with all 14 rows in this form. In-cell □-choice picks that mix
   with 【 】 fills (G7-L2 story_structure "充足 □少量") are preserved by `KeypointBlank.options`
   (choice mode: `answer` must be one of the offered options). Deeply nested
   `label / sub_label / value` 文章重點表 structures remain modeled by the answer-bearing
   `keypoints_table` question kind (not `TableBlock`), which is the intended split
   (presentation vs answer-bearing).

3. **`fill_in_blank` mixed per-blank grading — CLOSED.** A single blank as `str` and
   multiple blanks as `list[str]` (graded `exact` / `set`) still work implicitly; for
   sentences with *mixed* per-blank types, `FillInBlankQuestion.slots` gives each blank an
   `id` + `answer` + per-slot `grader`, and the block `answer` becomes a machine-comparable
   `dict{slot_id: value}` (see `G5-L9`).

4. **`guided_steps` block-level `answer` is a heterogeneous list — coarse but now
   cross-checked.** The block `answer` mixes option indices (int), index sets (list[int]),
   and `null` for rubric-graded free_text steps. The eval harness re-grades each step by
   its derived per-step grader (select→exact / multi_select→set / free_text→soft), yielding
   `partial` for mixed flows, and it now **cross-checks the assembled block `answer` against
   the per-step answers** so a drifted block answer surfaces as `fail`. A fully per-step
   `answer` + `grader` schema (rather than a heterogeneous list + block `grader: rubric_ai`)
   is still the cleaner long-term model — deferred.

5. **白話/文言 對照表 — CLOSED (promoted to `parallel_passage`).** Formerly handled via the
   `custom` escape hatch; now a first-class `parallel_passage` presentation block (left/
   right rows), with judging delegated to a companion `fill_in_blank` anchored at it
   (presentation/judging separation, plan §2.3). `wen-L2` still exercises the `custom`
   escape hatch elsewhere so that path stays covered.

## Not done in this phase (by design)

- No AI extraction skill (Phase 3), no DOCX→PDF (Phase 3), no unified renderer (Phase 2),
  no migration of existing lessons, no DB / online changes.
- Golden snapshots cover only the 4 fixtures, not all 151 lessons — this is the
  *skeleton*, per the task ("可運作的最小骨架, 不必完整覆蓋 151 課").
- The contract is not yet wired into `specs/run-ci.sh` — left for whoever owns the
  eventual `content-schema` spec module, to avoid changing repo-wide CI in a foundation PR.
