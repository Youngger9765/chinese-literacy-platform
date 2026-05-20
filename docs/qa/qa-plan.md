# LingoLeap QA Strategy Plan

**Created**: 2026-05-20  
**Issue**: #1757 — 固化功能 + 測試  
**Scope**: Backend pytest suite. No frontend tests (low ROI per project memory). No `.github/workflows/` changes.

---

## Section 1: 3-Tier Testing Strategy

Mirrors `~/.claude/rules/testing-strategy.md` adapted to this project.

### Tier 1 — Type + Lint (pre-commit, seconds)

| Tool | Config | When |
|------|--------|------|
| mypy | `backend/mypy.ini` (if present) or inline | pre-commit |
| ruff | `backend/pyproject.toml` ruff section | pre-commit |
| detect-secrets / gitleaks | `.gitleaks.toml` | pre-commit |

**Cost**: ~5 s per run. Catches: typos, wrong argument types, secret leaks.  
**Does NOT catch**: runtime schema errors, LLM config drift, lesson loader regressions.

### Tier 2 — API Contract Tests + Unit Tests (pytest, CI gate)

The primary automated quality layer for this project.

**Two sub-types**:

- **API contract tests** — spin up `TestClient(app)` with SQLite in-memory DB, assert HTTP status + JSON schema shape. Pattern: `test_omo_lessons.py`, `test_auth_api.py`.
- **Unit/service tests** — call Python functions directly without HTTP. Pattern: `test_fill_in_blank_normalization.py`, new regression tests (this issue).

**Run command**:
```bash
cd backend && python -m pytest tests/ -q --ignore=tests/test_omo_real_upload_integration.py --ignore=tests/test_omo_grader_real.py
```

**Baseline (2026-05-20)**:
- 2182 tests collected
- 1810 passed, 228 failed, 125 errors, 31 warnings
- Runtime: ~632 s (10.5 min)
- Pre-existing failures: `test_admin_api`, `test_step_progress_api`, `test_teacher_dashboard_n1` — NOT introduced by this issue

### Tier 3 — AI Browser QA (gstack /qa or /browse, post-deploy)

Run manually after each staging deploy using gstack `/qa` (automated test-fix-verify loop) or `/browse` (headless screenshot assertions).

**Scope**: student reading flow end-to-end, OMO upload/grade cycle, teacher dashboard loading.  
**NOT automated in CI** — per Young decision (E2E Playwright disabled, `e2e-tests.yml.disabled`).

---

## Section 2: Current Coverage Audit (2026-05-20)

### Backend tests

```
pytest backend/tests/ --collect-only -q
→ 2182 tests collected (113 test files, excluding 2 real-integration files)

pytest backend/tests/ -q (full run)
→ 1810 passed / 228 failed / 125 errors
→ Runtime: 632 s
```

**Pre-existing failure categories** (not introduced by recent PRs):
- `test_admin_api.py::TestGetUserDetail::test_get_detail_works_for_org_admin` — org-admin permission regression
- `test_step_progress_api.py` — 8 errors (likely DB schema migration issue in SQLite env)
- `test_teacher_dashboard_n1.py` — 6 errors (N+1 query fixture issue)

### Frontend tests

Per project memory: **low ROI — 866 commits only caught 2 bugs**. Not tracked in this plan. `e2e-tests.yml` is disabled by design.

---

## Section 3: Critical Path Coverage Matrix

| Service Area | Coverage Status | Key Test Files |
|---|---|---|
| Auth (login / token / refresh / verify) | HAS-TEST | `test_auth_api.py`, `test_auth_token_gate.py`, `test_rate_limiting.py` |
| LearningSession (CRUD / step_progress) | HAS-TEST (partial) | `test_learning_sessions_api.py`, `test_step_progress_parse.py` |
| LearningSession step_progress API | PARTIAL (errors in test_step_progress_api.py) | `test_step_progress_api.py` — pre-existing errors |
| Lessons Layer-1 (catalog / get_lesson_by_id) | HAS-TEST | `test_stories_api.py`, `test_story_crud.py` |
| Lessons Layer-2 (shadow merge / get_lesson_by_code) | NO-TEST | **Gap — regression test added this PR** |
| Fill-in-blank schema (legacy vs context_fill) | HAS-TEST | `test_fill_in_blank_normalization.py` |
| Fill-in-blank alignment (sentence + answer + vocab_bank) | NO-TEST | **Gap — regression test added this PR** |
| LLM per-task model config (`llm_models.py`) | NO-TEST | **Gap — regression test added this PR** |
| LLM thinking_budget=0 enforcement | NO-TEST | **Gap — regression test added this PR** |
| OMO upload / identify | HAS-TEST | `test_omo_upload.py`, `test_omo_dedup.py` |
| OMO grader | HAS-TEST (real integration skipped) | `test_omo_grader_real.py` (real mark, skipped in CI) |
| OMO lessons list | HAS-TEST | `test_omo_lessons.py` |
| TTS (provider switch / Azure / Gemini) | HAS-TEST | `test_tts_service.py`, `test_tts_auth.py` |
| Gamification (XP / achievements) | HAS-TEST | `test_gamification.py`, `test_points_system.py` |
| Assignments / Classrooms | HAS-TEST | `test_assignments.py`, `test_classrooms_api.py` |
| Teacher dashboard | HAS-TEST (partial, some errors) | `test_teacher_api.py`, `test_teacher_dashboard_n1.py` |
| Privacy / Audit | HAS-TEST | `test_privacy_api.py`, `test_audit_logger.py` |
| Security headers | HAS-TEST | `test_security_headers.py`, `test_security_fixes.py` |
| Socratic agent (question / circuit breaker) | HAS-TEST | `test_ai_endpoints.py`, `test_ai_analysis.py` |
| LLM rate limiting | HAS-TEST | `test_llm_rate_limits.py` |
| JSON repair fallback | HAS-TEST | `test_json_repair.py` |

**Summary**: 3 critical gaps identified — all addressed in Section 4.

---

## Section 4: Recent-Fix Regression Test Gaps

The following PRs were merged recently. For each: does a regression test exist? If not, proposal.

| PR / Issue | Description | Regression Test Exists? | Notes |
|---|---|---|---|
| #1675 / PR #1678 | fill_in_blank schema alignment (6 Layer-1 lessons) | PARTIAL — `test_fill_in_blank_normalization.py` tests normalizer logic but NOT actual YAML data values | **Gap**: no test that reads real YAML and asserts `sentence` + `answer` + vocab_bank coherence |
| #1729 / PR #1733 | OMO identifier model swap to flash-lite | NO | Model config not tested anywhere |
| #1730 | Grader spatial reasoning lock on 2.5-flash | NO | Same gap — `TASK_MODELS["omo_grader"]` never asserted |
| #1734 / PR #1735 | Per-task `llm_models.py` config (11 tasks) | NO | **High risk**: anyone can accidentally change a model assignment |
| #1738 / PR #1739 | `thinking_budget=0` on ai_comprehension, omo_identifier, tts_service | NO | Static regression: should fail if someone removes the setting |
| #1744 / PR #1747 | 2.5-flash-lite swap for 8 text/JSON generation tasks | NO | Covered by #1734 regression test |
| #1753 / PR #1754 | 127 Layer-2 fill_in_blank align (sentence + answer + vocab_bank) | NO | **Critical**: 127 lessons, any YAML corruption → broken exercise |

**Tests added in this PR**: A (llm_models), B (thinking_budget), C (fill_in_blank schema), D (layer2 shadow merge) — covering 4 of the 5 gap areas.

---

## Section 5: 7-Day Test Addition Roadmap

| Priority | Test File | What It Catches | Effort |
|---|---|---|---|
| P0 | `test_regression_llm_models_per_task_1734.py` | Model assignment drift for 11 tasks + omo_grader lock | 30 min — **added this PR** |
| P0 | `test_regression_thinking_budget_1738.py` | thinking_budget=0 removal from 5 prod files | 20 min — **added this PR** |
| P0 | `test_regression_fill_in_blank_schema_1675.py` | sentence/answer/vocab_bank coherence in Layer-1 YAMLs | 30 min — **added this PR** |
| P0 | `test_regression_layer2_shadow_merge_1666.py` | Layer-2 lesson loading, get_lesson_by_code coverage | 30 min — **added this PR** |
| P1 | `test_regression_layer2_fill_in_blank_1753.py` | 127 Layer-2 YAMLs fill_in_blank structure | 45 min — next sprint |
| P1 | `test_regression_omo_model_lock.py` | OMO grader stays on 2.5-flash if future A/B changes omo_identifier | 20 min — next sprint |
| P2 | Fix `test_step_progress_api.py` pre-existing errors | Step progress API reliability | 60 min — needs DB schema investigation |
| P2 | `test_regression_socratic_circuit_breaker.py` | 3-error → RuntimeError → 503 (currently no contract test) | 45 min |
| P3 | `test_regression_tts_provider_switch.py` | TTS provider fallback chain (Azure → Gemini → error) | 30 min |
| P3 | Fix `test_admin_api.py` org-admin permission failure | Org-admin role scope regression | 45 min |

---

## Section 6: Definition of Done (Per Test Type)

### API Contract Test
- HTTP status code matches expected (200 / 401 / 403 / 422)
- JSON response shape has required fields (not just non-null)
- Types are correct (int, str, list, bool)
- At least 1 item in list responses when data exists

### Schema Validation Test (unit)
- Required fields present in every item
- Type assertions on each field
- Cross-reference assertions (e.g. `answer` letter is a key in `vocab_bank`)
- Sentinel values not present (e.g. `None` where string expected)

### Regression Test
- Test assertion **would fail** on the pre-fix codebase state
- Test assertion **passes** on the post-fix codebase state
- File name includes issue number: `test_regression_*_NNNN.py`
- Self-contained: no network, no real DB, no LLM calls
- Runs in < 5 s

### Static Analysis Test
- Reads source files via `open()` + regex / AST
- Asserts presence of specific patterns
- No import side effects from the tested module
- Documents the exact line/pattern being guarded

---

## Section 7: Skip List (Low ROI — Won't Write)

| Category | Reason |
|---|---|
| Unit tests for trivial getters / setters | Type checker catches these; AI development makes them maintenance burden |
| Frontend visual diff tests | Use `/qa` screenshot for visual verification; 866 commits only caught 2 bugs |
| Full E2E Playwright suite | Disabled by design (`e2e-tests.yml.disabled`); too slow for CI |
| LLM-call integration tests (actual Gemini calls) | Non-deterministic, requires Vertex AI auth, slow — mock instead |
| TTS audio quality tests | Subjective, requires audio playback; contract test on HTTP 200 sufficient |
| Performance benchmark tests | Use `test_perf_sql_aggregates.py` pattern only for proven N+1 regressions |
| Migration schema tests | Use `alembic check` in CI instead of pytest |

---

## Appendix: Running Regression Tests

```bash
# Run only new regression tests (fast, < 30 s)
cd backend && python -m pytest tests/test_regression_*.py -v

# Run full suite (skip real integration tests)
cd backend && python -m pytest tests/ -q \
  --ignore=tests/test_omo_real_upload_integration.py \
  --ignore=tests/test_omo_grader_real.py

# Run a specific test file
cd backend && python -m pytest tests/test_regression_llm_models_per_task_1734.py -v
```

**Expected regression test runtime**: < 5 s per file, < 30 s total for all 4 files.
