# LingoLeap LLM Model A/B Report — 2026-05

**Status**: Canonical reference. Mirrors `backend/app/services/llm_models.py`.
**Last updated**: 2026-05-20
**Authors**: Issue #1718 / #1729 / #1730 / #1734 / #1738 / #1742

---

## Decision summary

| Task | Model | Region | Reason |
|------|-------|--------|--------|
| `socratic_question` | gemini-flash-lite-latest | global | -33% latency, -38% cost, tied quality (fair re-run) |
| `socratic_agent_process` | gemini-flash-lite-latest | global | -36% latency, JSON schema parity |
| `comprehension_score` | gemini-flash-lite-latest | global | -32% latency, -33% cost |
| `exit_ticket_generate` | gemini-flash-lite-latest | global | -31% latency, -34% cost |
| `example_sentences` | gemini-flash-lite-latest | global | -31% latency, -38% cost |
| `sentence_validate` | gemini-flash-lite-latest | global | -35% latency, -40% cost |
| `story_structure` | gemini-flash-lite-latest | global | -29% latency, -30% cost |
| `reading_analysis` | gemini-flash-lite-latest | global | -49% latency, -45% cost |
| `omo_identifier` | gemini-flash-lite-latest | global | Fair re-run: 0.973 vs 0.934 avg conf, -14% cost |
| **`omo_grader`** | **gemini-2.5-flash** | **us-central1** | **LOCKED — lettered circle 5/5 vs 1/5 (#1730)** |

`gemini-flash-lite-latest` is the Vertex AI alias for **Gemini 3.1 Flash Lite** (released 2026-03-03 per Google).

---

## Critical config requirement

**All `generate_content` calls MUST set `thinking_config=ThinkingConfig(thinking_budget=0)`** for gemini-2.5-flash. Without it, the model silently burns `max_output_tokens` on hidden thinking tokens, truncating visible output.

Evidence (socratic_question, max_tokens=128):

| Config | thoughts_tok | candidates_tok | visible text |
|---|---:|---:|---|
| Default thinking | 120 | 4 | "各位同學好！我是" (8 char, broken) |
| `thinking_budget=0` | — | 128 | 207 char complete ✅ |

Patched in PR #1739 (Issue #1738) across 5 prod files:
- `ai_base.py:343`
- `omo_grader.py:488`
- `ai_comprehension.py:114`
- `omo_identifier.py:374`
- `tts_service.py:613`

---

## Comparison dimensions used

### P0 — Always measured

| Dimension | Method | Notes |
|---|---|---|
| Latency p50 / p95 / TTFT | N runs, percentile | Watch for cold-start bias on first call |
| Cost per call | `usage_metadata.{prompt,candidates}_token_count × PRICING` | Verify PRICING dict against current Google list price |
| Schema validity | JSON parse + required fields check | For structured outputs |
| Output completeness | Char length + finish_reason check | Catches MAX_TOKENS truncation |
| Domain accuracy | Task-specific: grader correct match, identifier lesson hit, classifier label | |
| Fabrication rate | Count of student_answer not in allowed_values (OMO-specific) | Per #1712-#1716 grader iteration |
| OCR accuracy (vision) | Sample N student handwritten chars, % match | |
| Spatial reasoning (vision) | Lettered circle / boxed answer position correctness | |

### P1 — Measured for UX-critical tasks

| Dimension | Method |
|---|---|
| 繁體中文 fluency | Manual sample read |
| Pedagogical guidance | Warm tone? Scaffolded? Suitable for 國小? |
| Output length / verbosity | Token count distribution |
| Determinism / variance | Same prompt N runs, output similarity |
| Cold start vs warm | First call latency vs subsequent |
| Region latency delta | us-central1 vs global vs asia-east1 |

### P2 — Tracked when problems surface

- Success rate (% no exception)
- Error type breakdown (safety / rate_limit / parse / MAX_TOKENS / timeout)
- Retry-recoverable rate
- Safety filter false-positive rate
- Long context degradation
- Thinking budget overhead (latency cost of `thinking_budget=0`)
- API lifecycle (preview / GA / deprecated timeline)

### Config fairness checklist (lessons from #1738)

- `thinking_budget` consistent across all models tested (0 for fair text comparison)
- Model call order shuffled (avoid cold-start bias on first model)
- Warm-up call before timing (or discard first sample)
- Same region preferred (or document the location bias)
- Multiple samples per input (median, not single shot)
- Same `max_output_tokens` per task across models
- Same `temperature` per task across models

---

## Models considered

| Model | Pricing ($/1M in/out) | Use case | Verdict |
|-------|--------------------:|----------|---------|
| **gemini-2.5-flash** | $0.30 / $2.50 | OMO grader (spatial reasoning) | **WINNER for vision spatial** |
| **gemini-flash-lite-latest** (=3.1 Lite) | $0.25 / $1.50 | All text/JSON + OMO identifier | **WINNER for everything else** |
| **gemini-3.5-flash** | $1.50 / $9.00 | Frontier (released 2026-05-19) | Rejected — no quality gain, 4-5x more expensive |
| gemini-2.5-flash-lite | ~$0.15 / $1.00 | Cheapest variant | Not tested — capability concerns vs 3.1 Lite |
| gemini-2.5-pro | $1.25 / $10.00 | Frontier text | Skipped — overlap with 3.5 Flash, not justified for our use case |

---

## Per-task A/B detail

### 1. socratic_question (call_text)

**Use**: Tutor chat — student answers, AI asks next question via Socratic method.

**Task profile**: text generation, max_tokens=128, temperature=0.7, no schema constraint.

| Metric | 2.5 Flash (fair) | flash-lite |
|---|---:|---:|
| Output tokens | 384 (full, 3 samples) | 384 |
| Avg latency | 3372ms | **2272ms** |
| Total cost | $0.001042 | **$0.000644** |
| Quality | Full 128 token 中文教學引導 | Full 128 token 中文教學引導 |

**Initial unfair result** (without `thinking_budget=0`): 2.5 Flash appeared to give only 8-char truncated output. After fix, both models produce comparable quality. **flash-lite still wins** on latency + cost.

Evidence: `private/omo-real-samples/2026-05-20-systematic-ab/socratic_question_fair.json`

### 2-8. JSON tasks (call_json)

All 7 JSON tasks used `call_json()` which already set `thinking_budget=0` from the start — A/B results valid without re-run.

| Task | 2.5 Flash | flash-lite | flash-lite Δ |
|------|-----------|------------|--------------|
| socratic_agent_process | 3726ms / $0.0016 | 2375ms / $0.0012 | -36% latency / -25% cost |
| comprehension_score | 3668ms / $0.0015 | 2494ms / $0.0010 | -32% / -33% |
| exit_ticket_generate | 5232ms / $0.0044 | 3595ms / $0.0029 | -31% / -34% |
| example_sentences | 3275ms / $0.0013 | 2245ms / $0.0008 | -31% / -38% |
| sentence_validate | 3243ms / $0.0010 | 2121ms / $0.0006 | -35% / -40% |
| story_structure | 3503ms / $0.0023 | 2494ms / $0.0016 | -29% / -30% |
| reading_analysis | 7630ms / $0.0051 | 3925ms / $0.0028 | **-49%** / -45% |

All 7 tasks: 3/3 samples schema-complete on both models. flash-lite wins all.

Evidence: `private/omo-real-samples/2026-05-20-systematic-ab/{task}.json`

### 9. OMO identifier (vision)

**Use**: Student uploads worksheet photo → AI identifies which lesson.

**Task profile**: vision input, structured JSON output, max_tokens=3072, temperature=0.1.

**Fair re-run** (both `thinking_budget=0`, 16-page batch):

| Metric | 2.5 Flash | flash-lite |
|---|---:|---:|
| Parse OK | 16/16 | 16/16 |
| Avg confidence | 0.934 | **0.973** |
| Total cost (16 pages) | $0.0197 | **$0.0169** |
| Avg latency | ~6000ms | ~4500ms |

**Previous 2/16 regression claim was an artifact of unfair config** (2.5 Flash had thinking ON, flash-lite had thinking OFF — flash-lite lost the reasoning advantage). Fair fight: flash-lite slightly better.

Evidence: `private/omo-real-samples/2026-05-20-systematic-ab/identifier_fair_*.json`

### 10. OMO grader (vision + structured) — LOCKED

**Use**: Student worksheet PDF → AI grades each question with score + reasoning.

**Task profile**: vision (multi-page) input, complex structured JSON, max_tokens=2048, temperature=0.3, allowed_values constraint.

**A/B verdict: 2.5 Flash WINS — locked, not switched to flash-lite**.

| Metric | 2.5 Flash | flash-lite |
|---|---:|---:|
| Fabrication rate | 3.0% | 3.0% (tie) |
| JSON parse error | 0 | 0 (tie) |
| Free-form 中文 OCR | identical | identical |
| **Lettered fill_blank circle detection** | **5/5 correct** | **1/5 correct** ❌ |
| Score parity ratio | — | 0.69 (threshold 0.85) |
| Cost saving | — | -25.8% (doesn't justify accuracy loss) |

**Root cause**: flash-lite has spatial localization regression on lettered circle (A-G) detection. Returns adjacent letter instead of circled one. Free-form Chinese OCR is fine on both.

Issue #1730 — `needs-fix` label, locked decision.

Evidence: `private/omo-real-samples/2026-05-20-grader-ab/`

---

## Methodology lessons learned

### What I got wrong

1. **5/18 quick A/B (`eval_3_1_lite.py`)** — text path didn't set `thinking_budget=0`. Conclusions about 2.5 Flash text quality were unreliable.
2. **OMO identifier batch (5/18 + 5/20 morning)** — ran with `thinking ON` on 2.5 Flash (unmodified prod). Claimed "16/16 baseline" → "2/16 regression on 3.1 Lite". After PR #1739 fixed thinking_budget, fair re-run shows flash-lite **wins** confidence + cost.
3. **socratic_question first comparison** — saw 2.5 Flash giving 8-char output, blamed model. Real cause: thinking burning max_output_tokens.

### What I'm now doing

- Audit `thinking_config` on **every** `generate_content` call site before A/B
- Cite `finish_reason` in raw output JSON to catch MAX_TOKENS truncation
- Document model + region + config matrix at top of each A/B script
- Cross-reference Vertex AI billing for PRICING dict accuracy (TODO)
- Shuffle model order or use median (TODO)
- Multiple samples per input, not single shot (currently 3, should bump to 5 for quality-critical decisions)

### What still has bias risk

- **Region**: 2.5 Flash @ us-central1 vs flash-lite @ global → 100-500ms routing delta unavoidable
- **PRICING dict**: hardcoded $0.30/$2.50 for 2.5-flash and $0.25/$1.50 for flash-lite — verify against actual Vertex AI invoice
- **Sample size**: 3 per task is statistically thin. Production traffic is the real test.
- **Cold start**: First call always slower. Mitigation: warm-up before timing (not yet implemented).

---

## Evidence index

| File | Content |
|------|---------|
| `private/omo-real-samples/2026-05-18-batch-results/eval_3_1_lite.py` | 5/18 quick A/B (UNFAIR — no thinking_budget=0) |
| `private/omo-real-samples/2026-05-18-batch-results/run_omo_batch.py` | 16-page identifier batch (initial baseline) |
| `private/omo-real-samples/2026-05-18-batch-results/summary.md` | 5/18 identifier + grader baseline |
| `private/omo-real-samples/2026-05-20-systematic-ab/inventory.md` | All 11 LLM call sites inventoried |
| `private/omo-real-samples/2026-05-20-systematic-ab/run_ab_test.py` | 8-task systematic A/B (call_json fair, call_text unfair) |
| `private/omo-real-samples/2026-05-20-systematic-ab/summary.md` | Original 3-way (2.5 vs 3.1 Lite vs 3.5 Flash) |
| `private/omo-real-samples/2026-05-20-systematic-ab/fair_socratic_rerun.py` | socratic_question fair re-run (post #1738) |
| `private/omo-real-samples/2026-05-20-systematic-ab/fair_identifier_rerun.py` | Identifier fair re-run (post #1739) |
| `private/omo-real-samples/2026-05-20-systematic-ab/identifier_fair_summary.md` | Identifier fair-vs-fair verdict |
| `private/omo-real-samples/2026-05-20-grader-ab/run_grader_ab.py` | Grader 2.5 vs 3.1 Lite A/B (#1730) |
| `private/omo-real-samples/2026-05-20-grader-ab/summary.md` | Grader verdict: 2.5 Flash LOCKED |
| `backend/app/services/llm_models.py` | Per-task config (source of truth — this doc mirrors it) |

---

## Related issues / PRs

- **#1718** / PR #1722 — Stage 1 swap all non-OMO to flash-lite (initially based on UNFAIR A/B; later confirmed fair)
- **#1729** / PR #1733 — OMO identifier swap to flash-lite
- **#1730** — Grader A/B verdict: stay 2.5 Flash (lettered circle spatial regression)
- **#1734** / PR #1735 — Per-task `llm_models.py` central config + 3-way A/B (3.5 Flash rejected)
- **#1738** / PR #1739 — `thinking_budget=0` patch on 3 prod files + fair re-runs
- **#1742** / this PR — Master doc consolidating evidence

---

## Future work / open questions

1. **Verify PRICING dict against actual Vertex AI invoice** — current values from public list, may differ from negotiated enterprise rate
2. **Increase A/B sample size from 3 to 5+** for quality-critical decisions (especially OMO grader where accuracy gap drives lock decision)
3. **Test prompt caching savings** — Gemini supports cached input at $0.075/1M (vs $0.30 fresh). High system-prompt-reuse tasks could save significantly.
4. **Production traffic A/B** — synthetic A/B with 3 samples is statistically thin. Once stable, route 5-10% prod traffic to alternative model for real signal.
5. **Long-context test** — none of current A/B tested >3K input tokens. If lesson context grows (e.g., multi-lesson grading), need to verify model behavior at scale.
6. **Re-test on model lifecycle changes** — `gemini-flash-lite-latest` is an alias that may update silently. Schedule quarterly re-test.
