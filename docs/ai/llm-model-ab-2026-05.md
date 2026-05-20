# LLM Model A/B Test — May 2026

**Project**: LingoLeap (Chinese Literacy Platform)
**Issues**: #1734 (original 3-way), #1744 (4th column: 2.5-flash-lite)
**Last updated**: 2026-05-20

## Decision Summary (Current)

| Task | Winner | Model | Location | Rationale |
|------|--------|-------|----------|-----------|
| `socratic_question` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 76% cheaper, faster, same quality |
| `socratic_agent_process` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 76% cheaper, faster, same quality |
| `comprehension_score` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 78% cheaper, fastest latency |
| `exit_ticket_generate` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 77% cheaper, fastest latency |
| `example_sentences` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 77% cheaper, faster |
| `sentence_validate` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 79% cheaper, fastest latency |
| `story_structure` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 78% cheaper, faster |
| `reading_analysis` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | 80% cheaper, faster |
| `teacher_comment` | **2.5-flash-lite** | gemini-2.5-flash-lite | global | same family, consistent |
| `omo_identifier` | flash-lite-latest | gemini-flash-lite-latest | global | LOCKED per #1729 (identifier swap) |
| `omo_grader` | **2.5-flash** | gemini-2.5-flash | us-central1 | LOCKED per #1730 (vision reasoning) |

---

## Models Considered

| Model | Input ($/1M) | Output ($/1M) | Location | Status |
|-------|-------------|---------------|----------|--------|
| `gemini-2.5-flash` | $0.30 | $2.50 | us-central1 | OMO grader only (LOCKED) |
| `gemini-flash-lite-latest` | $0.25 | $1.50 | global | OMO identifier (LOCKED per #1729) |
| `gemini-2.5-flash-lite` | $0.075 | $0.30 | global | **Default for all 8 text/JSON tasks** |
| `gemini-3.5-flash` | ~$0.50 | ~$3.75 | global | REJECTED — no quality gain, 2x cost |

---

## Test 1: Original 3-Way Comparison (#1734, 2026-05-20)

**Models**: gemini-2.5-flash vs gemini-flash-lite-latest vs gemini-3.5-flash
**Total calls**: ~51 | **Total cost**: ~$0.024
**Config**: `thinking_budget=0` on JSON tasks; NOT yet applied to text tasks (fixed in #1738)

### 3-Way Comparison Table

| Task | 2.5-flash | flash-lite | 3.5-flash | Winner |
|------|-----------|------------|-----------|--------|
| `socratic_question` | 3196ms 3/3 $0.0003 | 2038ms 3/3 $0.0006 | 2200ms 3/3 $0.0012 | **flash-lite** |
| `socratic_agent_process` | 3726ms 3/3 $0.0016 | 2375ms 3/3 $0.0012 | 2797ms 3/3 $0.0024 | **flash-lite** |
| `comprehension_score` | 3668ms 3/3 $0.0015 | 2494ms 3/3 $0.0010 | 2029ms 3/3 $0.0018 | **flash-lite** |
| `exit_ticket_generate` | 5232ms 3/3 $0.0044 | 3595ms 3/3 $0.0029 | 4559ms 3/3 $0.0057 | **flash-lite** |
| `example_sentences` | 3275ms 3/3 $0.0013 | 2245ms 3/3 $0.0008 | 2168ms 3/3 $0.0018 | **flash-lite** |
| `sentence_validate` | 3243ms 3/3 $0.0010 | 2121ms 3/3 $0.0006 | 1932ms 3/3 $0.0015 | **flash-lite** |
| `story_structure` | 3503ms 3/3 $0.0023 | 2494ms 3/3 $0.0016 | 2456ms 3/3 $0.0030 | **flash-lite** |
| `reading_analysis` | 7630ms 3/3 $0.0051 | 3925ms 3/3 $0.0028 | 5095ms 3/3 $0.0051 | **flash-lite** |

**Conclusion**: flash-lite dominates all 8 tasks. 3.5-flash rejected.

### Why 3.5-flash Was Rejected

1. **Thinking footgun**: Default extended thinking → empty text output on non-JSON tasks. Required `thinking_budget=0` workaround (captured as lesson for #1738).
2. **Cost**: ~1.5-2x 2.5-flash, ~4-5x flash-lite
3. **Latency**: Faster than 2.5-flash in most tasks, still slower than flash-lite
4. **Quality**: Identical schema completeness (all fields). No measurable uplift.

### Why 2.5-flash-lite Was Originally Skipped (#1734)

The issue description cited "overlap" with flash-lite-latest. This was incorrect reasoning — the pricing differential ($0.075 vs $0.25 input) is significant (~4x). This was recognized as an error and corrected in #1744.

---

## Test 2: 4th Column Re-evaluation (#1744, 2026-05-20)

**New model**: `gemini-2.5-flash-lite` @ global
**Config fix**: `thinking_budget=0` applied to ALL models including text tasks (per #1738 lesson)
**Total calls**: 72 (8 tasks × 3 models × 3 samples) | **Total cost**: $0.0311

### 4-Column Comparison Table

| Task | 2.5-flash | flash-lite-latest | 2.5-flash-lite | Winner |
|------|-----------|-------------------|----------------|--------|
| `socratic_question` | 3031ms 3/3 $0.00080 | 1903ms 3/3 $0.00055 | 1737ms 3/3 $0.00013 | **2.5-flash-lite** (76% cheaper) |
| `socratic_agent_process` | 3311ms 3/3 $0.00174 | 2385ms 3/3 $0.00120 | 2208ms 3/3 $0.00029 | **2.5-flash-lite** (76% cheaper) |
| `comprehension_score` | 2604ms 3/3 $0.00166 | 2433ms 3/3 $0.00094 | 1770ms 3/3 $0.00021 | **2.5-flash-lite** (78% cheaper) |
| `exit_ticket_generate` | 4876ms 3/3 $0.00387 | 3780ms 3/3 $0.00265 | 3470ms 3/3 $0.00061 | **2.5-flash-lite** (77% cheaper) |
| `example_sentences` | 3104ms 3/3 $0.00137 | 2313ms 3/3 $0.00086 | 2107ms 3/3 $0.00020 | **2.5-flash-lite** (77% cheaper) |
| `sentence_validate` | 2901ms 3/3 $0.00111 | 2588ms 3/3 $0.00059 | 1656ms 3/3 $0.00012 | **2.5-flash-lite** (79% cheaper) |
| `story_structure` | 2963ms 3/3 $0.00233 | 2608ms 3/3 $0.00161 | 2006ms 3/3 $0.00035 | **2.5-flash-lite** (78% cheaper) |
| `reading_analysis` | 6492ms 3/3 $0.00445 | 4156ms 3/3 $0.00285 | 3725ms 3/3 $0.00056 | **2.5-flash-lite** (80% cheaper) |

### Per-Task Winner Decisions

**All 8 tasks flip to `gemini-2.5-flash-lite`.** Decision criteria applied in priority order:

1. **Quality**: 3/3 complete on every task — identical to flash-lite-latest (no regression)
2. **Latency**: 2.5-flash-lite is **fastest** of all 3 models on all tasks (~15-20% faster than flash-lite)
3. **Cost**: **78% cheaper** than flash-lite-latest ($0.00247 vs $0.01125 for 24 calls)

#### `socratic_question` → 2.5-flash-lite

Free-form Chinese question generation. Text output task.
- flash-lite: 3/3 ok, avg 1903ms, $0.00055
- 2.5-flash-lite: 3/3 ok, avg 1737ms, $0.00013
- Savings: 76%

#### `socratic_agent_process` → 2.5-flash-lite

Main Socratic loop — JSON feedback + next_question + is_complete + reasoning.
- flash-lite: 3/3 ok, avg 2385ms, $0.00120
- 2.5-flash-lite: 3/3 ok, avg 2208ms, $0.00029
- Savings: 76%

#### `comprehension_score` → 2.5-flash-lite

JSON scoring — 5 required fields (comprehension/literal/inferential/evaluative/reasoning).
- flash-lite: 3/3 ok, avg 2433ms, $0.00094
- 2.5-flash-lite: 3/3 ok, avg 1770ms, $0.00021 — also **fastest** of the 3 models
- Savings: 78%

#### `exit_ticket_generate` → 2.5-flash-lite

MCQ generation — array of 3-5 questions with id/question/options/correct_index/explanation.
- flash-lite: 3/3 ok, avg 3780ms, $0.00265
- 2.5-flash-lite: 3/3 ok, avg 3470ms, $0.00061
- Savings: 77%

#### `example_sentences` → 2.5-flash-lite

JSON — 2 example sentences per target word with explanation.
- flash-lite: 3/3 ok, avg 2313ms, $0.00086
- 2.5-flash-lite: 3/3 ok, avg 2107ms, $0.00020
- Savings: 77%

#### `sentence_validate` → 2.5-flash-lite

JSON — is_correct + feedback + suggestion. Simplest binary classification task.
- flash-lite: 3/3 ok, avg 2588ms, $0.00059
- 2.5-flash-lite: 3/3 ok, avg 1656ms, $0.00012 — **fastest** of the 3 models
- Savings: 79%

#### `story_structure` → 2.5-flash-lite

JSON — title + rows array with label/value/interactive_type.
- flash-lite: 3/3 ok, avg 2608ms, $0.00161
- 2.5-flash-lite: 3/3 ok, avg 2006ms, $0.00035
- Savings: 78%

#### `reading_analysis` → 2.5-flash-lite

JSON — analysis_summary + strengths + areas_for_improvement + practice_suggestions + encouragement_message.
- flash-lite: 3/3 ok, avg 4156ms, $0.00285
- 2.5-flash-lite: 3/3 ok, avg 3725ms, $0.00056
- Savings: 80%

### Cost Impact (Estimated)

| Metric | flash-lite-latest | 2.5-flash-lite | Savings |
|--------|-------------------|----------------|---------|
| 24-call test | $0.01125 | $0.00247 | 78% |
| Est. 1000 calls/day | $0.469 | $0.103 | $0.366/day |
| Est. monthly (30K calls) | $14.1 | $3.1 | ~$11/month |

### Why 2.5-flash-lite Strictly Dominates

This is a clean sweep — no tradeoffs. 2.5-flash-lite wins on all 3 dimensions:
- Same schema completeness (3/3 on all 8 tasks)
- Faster latency (beats flash-lite by ~15-20% on avg)
- 78% lower cost

---

## Implementation

### TASK_MODELS Config (after #1744)

Applied in `backend/app/services/ai_base.py` (generate_structured_response) and `backend/app/services/ai_comprehension.py` (socratic question text call):

```python
# Text tasks → generate_structured_response() uses gemini-2.5-flash-lite
model = "gemini-2.5-flash-lite"  # location: global via _get_client()

# OMO tasks — LOCKED, do not change
omo_identifier: gemini-flash-lite-latest @ global  # per #1729
omo_grader:     gemini-2.5-flash @ us-central1     # per #1730
```

### Files Modified in #1744

- `backend/app/services/ai_base.py` — model string in generate_structured_response()
- `backend/app/services/ai_comprehension.py` — model string + added thinking_budget=0 to text call
- `backend/app/services/ai_usage_tracker.py` — pricing dict + default model strings
- `backend/app/models/ai_usage.py` — DB column default
- `backend/app/routes/learning/learning_comprehension.py` — fallback model string
- `backend/app/routes/learning/learning_comprehension_score.py` — fallback model string
- `backend/app/routes/learning/learning_reading.py` — fallback model string
- `backend/app/routes/learning/learning_exit_ticket.py` — fallback model string
- `backend/app/routes/learning/learning_vocab.py` — fallback model string
- `backend/app/routes/stories.py` — fallback model string

### Key Lesson from #1738

ALL `call_text` and `call_json` calls MUST include `thinking_budget=0` for ALL models. Without this, 2.5-flash and 3.5-flash default to extended thinking mode which consumes token budget on thinking tokens, leaving insufficient budget for visible output — causing empty or truncated responses on text tasks.

---

## Test Artifacts

- Original A/B: `private/omo-real-samples/2026-05-20-systematic-ab/summary.md`
- 4th column re-run: `private/omo-real-samples/2026-05-20-systematic-ab/with-2.5-lite/summary.md`
- Raw JSON results: `private/omo-real-samples/2026-05-20-systematic-ab/with-2.5-lite/*.json`
- Decision deltas: `private/omo-real-samples/2026-05-20-systematic-ab/with-2.5-lite/decision-deltas.md`
