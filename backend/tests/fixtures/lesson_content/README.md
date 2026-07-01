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
sequence — a discriminated union of `paragraph | figure | table | exercise`, each with a
stable `id`. The "一般 vs 圖文" split degrades into block **ordering + anchors**, not two
layouts (plan §2.3). An `exercise` block carries a question-type discriminated union
covering the 6 known types (`multiple_choice | fill_in_blank | ordering |
trait_inference | guided_steps | graphic_text_integration`) plus a `custom` escape hatch.

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
| `wen-L2.lesson.yml` | 文言文怎麼讀？以「鞭虎救弟記」為例 | **文言文** — uses the `custom` escape hatch for the 白話/文言 對照表 | `custom`, `fill_in_blank`, `multiple_choice` |
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

## Open questions / schema gaps (honest — NOT fudged)

These are real design-level findings surfaced while transcribing the hard fixtures. Per
the plan (§3.4, "別讓 AI HTML 把變異性吸收掉") they are recorded here rather than papered
over by quietly widening the contract.

1. **Multi-select inside `guided_steps` is lost today.** In the real corpus (e.g.
   G7-L30), 複選 steps are downgraded to `free_text` because "前端 strategy step 目前僅支援
   單選比對". The new contract *can* express multi-select (see `G5-L9` `multi_choice` +
   `set` grader), but a `GuidedStep` is still single-`select` or `free_text`. **Gap:** a
   step-level multi-select answer type. Deferred — needs a decision on whether to enrich
   `GuidedStep` or split multi-select steps into standalone `multiple_choice` exercises.

2. **Merged-cell / nested tables are flattened.** `TableBlock` is a flat
   `headers` + `rows: string[][]`. Real 學習單 tables have merged cells, section labels
   (G7-L30 表一 相同處/相異處 via `section_label_col`), and the 文章重點表 has deeply nested
   `label / sub_label / value` structures (see `build_lesson_schema.py`
   `extract_keypoints`). **Gap:** a table model with row-spanning sections + nested
   sub-rows. Not needed for Phase 1's spotlight focus, but Phase 2's renderer will need it.

3. **`fill_in_blank` answer shape is overloaded.** We store a single blank as `str`
   (`wen-L2`) and multiple blanks as `list[str]` (`G5-L9`), graded by `exact` / `set`
   respectively. This works but is implicit. **Gap:** per-blank slot ids + per-slot
   answer/grader, for sentences with mixed blank types.

4. **`guided_steps` block-level `answer` is a heterogeneous list.** It mixes option
   indices (int) and `null` for rubric-graded free_text steps, and the block uses
   `grader: rubric_ai`. This is honest (the list *is* the machine-readable per-step
   answer set) but a stricter model would attach `answer` + `grader` per step. Deferred —
   the round-trip check treats such blocks as "soft" (present but human-graded), which is
   correct but coarse.

5. **The 白話/文言 對照表 has no first-class type.** Handled via `custom` +
   `needs_review: true` in `wen-L2`. This is the escape hatch working as designed — if
   many 文言文 lessons need it, that's the signal (plan §3.4 "逃生口比率當指標") to promote a
   registered `parallel_passage` block type rather than leave it as `custom`.

## Not done in this phase (by design)

- No AI extraction skill (Phase 3), no DOCX→PDF (Phase 3), no unified renderer (Phase 2),
  no migration of existing lessons, no DB / online changes.
- Golden snapshots cover only the 4 fixtures, not all 151 lessons — this is the
  *skeleton*, per the task ("可運作的最小骨架, 不必完整覆蓋 151 課").
- The contract is not yet wired into `specs/run-ci.sh` — left for whoever owns the
  eventual `content-schema` spec module, to avoid changing repo-wide CI in a foundation PR.
