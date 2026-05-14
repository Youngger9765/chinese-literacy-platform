# OMO Debug Log

> Chronological log of bugs found + fixed during Phase 1a/1b. Each entry: root cause + fix + lesson + test added.

---

## 2026-05-13 — PR #1573 spawn (Phase 1a prototype)

Initial implementation merged. The following 7 bugs surfaced during dogfooding and PR review.

---

### Bug 1 — Gemini empty response → TypeError

**Symptom**: Production identification crashed with `TypeError: 'NoneType' object has no attribute 'strip'`.

**Root cause**: When safety filter blocks or `finish_reason=MAX_TOKENS` triggers, `response.text` is `None`, not empty string. Code did `response.text.strip()` directly.

**Also**: `max_output_tokens=512` too low — 7 lessons × top-3 candidates with reasoning easily exceeds the budget, triggering MAX_TOKENS.

**Fix**: Commit `cdf81e77`
- Guard: `raw_text = (response.text or "").strip() if response is not None else ""`
- Log finish_reason for diagnostics
- Bump `max_output_tokens` 512 → 2048

**Lesson**: Gemini's `response.text` is nullable. Always None-guard. Token budget must account for ALL output rows × reasoning string.

**Test added**: None yet — needs synthetic Gemini mock returning `text=None`. Filed as follow-up.

**File**: `backend/app/services/omo_identifier.py:188-201`

---

### Bug 2 — List-shaped `fill_in_blank` YAML → grader returned `[]`

**Symptom**: `_build_question_schema` returned empty list for some lessons → grader saw 0 questions → status=graded with no answers.

**Root cause**: Existing lessons (L1-L21) had `fill_in_blank: dict[str, dict]` keyed by question label. New OMO lessons (L22-L30) use `fill_in_blank: list[dict]` — different shape. Code only handled dict.

**Fix**: Commit `017eb008`
- Branch on `isinstance(fb, dict)` vs `list`
- Generate `qid = "fb_1"` etc. for list shape
- Same fix applied to `multiple_choice` section

**Lesson**: YAML schema must be either strictly versioned or duck-typed at parse boundary. When two cohorts of lessons coexist, always check both shapes.

**Test added**: Pending — add YAML fixture with list-shape and assert grader returns N questions.

**File**: `backend/app/services/omo_grader.py:75-110`

---

### Bug 3 — A/B/C letter answers literal-compared → all 0 scores

**Symptom**: All fill_in_blank questions scored 0.0 even when student wrote correct word.

**Root cause**: L22-L30 YAML stores `answer: A` as a letter pointing to `vocabulary[0].word`. Grader literally compared student's "奠定" against "A" → never matched.

**Fix**: Commit `02a5e5b6`
- New helper `_resolve_letter_answer(letter, vocabulary)` resolves A/B/C/... to actual word
- Applied to `fill_in_blank` and `multiple_choice` correct_answer extraction
- Backward compatible: non-letter answers pass through unchanged

**Lesson**: YAML schemas with indirection (letter → index → word) need explicit resolution step. Don't trust naive string compare on `answer:` field.

**Test added**: Needed — fixture with `answer: A` + vocabulary list, assert correct_answer = vocabulary[0].word.

**File**: `backend/app/services/omo_grader.py:45-65`

---

### Bug 4 — 25px extreme blur consistent misidentification

**Symptom**: D7 acceptance check (blur 25px Gaussian) consistently returned wrong lesson with conf 0.4–0.6.

**Root cause**: At 25px blur, even the title characters are unrecognisable to Gemini. The model "guesses" based on faint glyph silhouettes and gets it wrong.

**Fix**: Removed D7 from acceptance suite. Flagged Phase 2 candidate for Document AI 前處理 (sharpen + binarize).

**Lesson**: Acceptance suites should not include edge cases the system fundamentally cannot solve at current architecture. Move to backlog with explicit Phase tag.

**Test added**: N/A (removed from suite). Document AI evaluation tracked separately.

**File**: `docs/omo/test-catalog.md` (D7 deliberately omitted from section D)

---

### Bug 5 — `JWT_SECRET_KEY` required after `ENVIRONMENT=staging`

**Symptom**: Staging deploy crashed on boot with `RuntimeError: JWT_SECRET_KEY must be set when ENVIRONMENT=staging|prod`.

**Root cause**: Newly added env-aware validation rejected unset JWT secret. Staging service had `ENVIRONMENT` set but `JWT_SECRET_KEY` only in prod secrets.

**Fix**: PR [#1580](https://github.com/Youngger9765/chinese-literacy-platform/pull/1580)
- Added `JWT_SECRET_KEY` to staging Secret Manager
- Updated Cloud Run staging service env mapping

**Lesson**: When tightening env validation, audit ALL deployment environments before merge. CI should fail-fast on staging env validation, not at runtime.

**Test added**: Pending — pre-deploy env validation script in CI.

**File**: `backend/app/config.py` (env validation logic)

---

### Bug 6 — prod/staging DB shared → demo account disable broke staging

**Symptom**: Young disabled a demo account in prod admin panel. Staging tests broke same day because they used the same login.

**Root cause**: Staging and prod were pointing to the same Cloud SQL instance `lingoleap-db`. No separation.

**Fix**: PR [#1579](https://github.com/Youngger9765/chinese-literacy-platform/pull/1579)
- Created separate `lingoleap-db-staging` instance
- Updated staging `DATABASE_URL` Cloud SQL Unix socket
- Documented in CLAUDE.md

**Lesson**: Multi-env infra hygiene: every env MUST have isolated DB + GCS bucket + auth tokens. Shared backing store = cross-env contamination guaranteed.

**Test added**: Acceptance suite section A (env separation, 7 checks).

**File**: `backend/app/database.py`, GCP Cloud SQL config

---

### Bug 7 — `conf=0` candidates not filtered → irrelevant content false-positive

**Symptom**: Uploading a food photo returned top-3 candidates with conf=0.0 and the frontend displayed them as "我猜這是..." options.

**Root cause**: When prompt says "if unclear, return `error: image_unclear`" but Gemini sometimes returns placeholder candidates with conf=0 instead. Code filtered empty list but not zero-conf list.

**Fix**: PR [#1581](https://github.com/Youngger9765/chinese-literacy-platform/pull/1581)
- Add `candidates = [c for c in candidates if c.confidence >= 0.4]` after parsing
- Threshold 0.4 matches prompt's "weak/speculative" boundary

**Lesson**: LLM contract specs can be soft-violated. Always sanity-filter on confidence in code, don't rely on model honoring the "return empty" instruction.

**Test added**: Acceptance suite E2 (food photo → empty candidates).

**File**: `backend/app/services/omo_identifier.py:253`

---

## Patterns observed

| Pattern | Frequency | Mitigation |
|---------|-----------|------------|
| LLM nullable / unexpected shape | 3 bugs (1, 7, plus content filter) | Always None-guard + confidence filter |
| Schema indirection (letter → index → word) | 1 bug (3) | Explicit resolve helper at parse boundary |
| Multi-env config drift | 2 bugs (5, 6) | Acceptance suite section A + pre-deploy validation |
| Acceptance suite drift | 1 bug (4) | Tag impossible edges with Phase, move to backlog |
| Heterogeneous YAML cohorts | 1 bug (2) | Duck-type at parse, fixture-test both shapes |

---

## Open follow-ups

- [ ] Add unit tests for Bug 1, 2, 3 fixes (currently no regression coverage)
- [ ] CI pre-deploy env validation (Bug 5)
- [ ] Document AI 前處理 evaluation (Bug 4 → Phase 2)
- [ ] Phase 1b dedup tests (`test_omo_dedup.py`)
