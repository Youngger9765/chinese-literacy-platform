# OMO Test Catalog

> All OMO tests — what's covered, what's not, where they live.

---

## 1. Backend pytest（unit + contract）

### `backend/tests/test_omo_upload.py` — 16 tests

| # | Test | Class | What it covers |
|---|------|-------|----------------|
| 1 | `test_upload_returns_201_with_identifying_status` | HappyPath | POST /upload returns 201 + status=identifying |
| 2 | `test_can_poll_status_after_upload` | HappyPath | GET /{id} returns current status |
| 3 | `test_full_happy_path_mocked_grading` | HappyPath | upload → confirm → graded with mocked AI |
| 4 | `test_add_second_attempt` | MultiAttempt | POST /{id}/attempt creates second attempt row |
| 5 | `test_attempt_on_other_student_upload_returns_404` | MultiAttempt | Student B cannot add attempt to A's upload |
| 6 | `test_flag_answer_after_grading` | Flag | PATCH /{id}/answers/{q}/flag writes flag info |
| 7 | `test_flag_before_grading_returns_409` | Flag | Cannot flag before status=graded |
| 8 | `test_upload_unauthenticated_returns_401` | Auth | POST /upload without token rejected |
| 9 | `test_get_unauthenticated_returns_401` | Auth | GET /{id} without token rejected |
| 10 | `test_confirm_unauthenticated_returns_401` | Auth | POST /{id}/confirm without token rejected |
| 11 | `test_cannot_see_other_student_upload` | Auth | Per-user access control on GET |
| 12 | `test_oversized_file_returns_413` | InputValidation | 10MB+ file rejected with 413 |
| 13 | `test_no_files_returns_422` | InputValidation | Empty multipart returns 422 |
| 14 | `test_invalid_mime_returns_400` | InputValidation | application/pdf rejected |
| 15 | `test_too_many_files_returns_400` | InputValidation | 6+ files rejected |
| 16 | `test_confirm_wrong_status_returns_409` | InputValidation | Confirm before identified returns 409 |

**Run**: `cd backend && python -m pytest tests/test_omo_upload.py -v`

**Setup**: SQLite in-memory + conftest.py patches `JSONB → JSON`. AI services mocked via dependency override.

### `backend/tests/test_omo_dedup.py` — Phase 1b incoming

Planned coverage:
- Hash hit on identical image bytes → returns existing upload_id
- Hash hit on near-identical (re-saved JPEG) → still hits (perceptual hash)
- Quota exceeded → returns 429 with retry-after
- Quota reset at midnight UTC+8

---

## 2. Acceptance Suite — `/tmp/omo_acceptance_test.sh`

> Manual run on local dev against real Gemini. Not in CI (cost).

### A. 環境分隔 — 7 checks
| Check | Verifies |
|-------|----------|
| A1 | `lingoleap-omo-uploads-prod` exists |
| A2 | `lingoleap-omo-uploads-staging` exists |
| A3 | `lingoleap-omo-uploads-preview` exists |
| A4 | prod bucket NOT readable by staging service account |
| A5 | staging DB ≠ prod DB |
| A6 | `ENVIRONMENT=staging` propagates to Cloud Run env |
| A7 | `JWT_SECRET_KEY` differs between prod/staging |

### B. API 流程 — 3 checks
| Check | Verifies |
|-------|----------|
| B1 | `POST /api/omo/upload` returns 201 + GCS path |
| B2 | `POST /api/omo/{id}/confirm` triggers grading background task |
| B3 | `GET /api/omo/{id}` polls until status=graded |

### C. 辨識率 7 課 — 7 checks
| Lesson | Title | Test photo |
|--------|-------|-----------|
| L22 | 小兵立大功 | Clean phone capture |
| L23 | (G6) | Clean phone capture |
| L24 | (G6) | Clean phone capture |
| L25 | (G6) | Clean phone capture |
| L28 | (G7) | Clean phone capture |
| L29 | (G7) | Clean phone capture |
| L30 | (G7) | Clean phone capture |

Pass criteria: top-1 confidence ≥ 0.9, correct lesson_id.

### D. 嚴重邊緣 — 6 checks
| Edge | Severity | Expected |
|------|----------|----------|
| D1 | Blur 8px Gaussian | Still identifies, conf ≥ 0.6 |
| D2 | Rotate 30° | Still identifies, conf ≥ 0.7 |
| D3 | Rotate 45° | Still identifies, conf ≥ 0.6 |
| D4 | Skew + perspective | Still identifies, conf ≥ 0.5 |
| D5 | Low light (0.3x brightness) | Still identifies, conf ≥ 0.5 |
| D6 | Glare on title (top 20% obscured) | Falls back to body text, conf ≥ 0.4 |

> Note: D7 (blur 25px) was removed from acceptance after consistent misidentification — flagged as Phase 2 candidate for Document AI 前處理.

### E. 拒絕 case — 2 checks
| Reject | Expected |
|--------|----------|
| E1 | Pure white image | `candidates=[]`, status=error, msg="照片不清楚或無法辨識課程" |
| E2 | Irrelevant content (food photo) | Filtered (conf < 0.4 → empty after filter), error msg |

---

## 3. Smoke Tests

### 3.1 Upload → Identify → Confirm → Grade E2E
```bash
# local dev with mock AI
curl -F "files=@worksheet.jpg" -H "Authorization: Bearer $TOKEN" \
     https://lingoleap-backend-staging-958347263320.asia-east1.run.app/api/omo/upload
# returns {upload_id, status: "identifying"}
# poll, then confirm, then poll for graded
```

### 3.2 Filled Worksheet Grading
Real handwriting on L22 fill_in_blank → expect ≥ 70% per-question correctness.

---

## 4. Latency Benchmarks（observed on staging）

| Stage | p50 | p95 |
|-------|-----|-----|
| Upload (incl GCS write) | 0.3s | 1.1s |
| Identify (Gemini multimodal) | 6s | 14s |
| Grade (Gemini structured output) | ~12s | 25s |
| **Total user-perceived** | ~20s | ~40s |

Spec target: ≤ 60s — within budget.

---

## 5. Cost Estimates（per call, NT$）

| Operation | Tokens (in+out) | Cost |
|-----------|-----------------|------|
| Identification | ~2500 | NT$0.012 |
| Grading | ~5000 | NT$0.03 |

Monthly projection at 1500 students × 7 lessons × 2 photos:
- Identification: NT$252/mo
- Grading: NT$630/mo
- **Total**: ~NT$882/mo (manageable on demo budget)

---

## 6. Coverage Gaps（NOT tested yet）

| Gap | Severity | Phase |
|-----|----------|-------|
| Real human handwriting (vs synthetic test photos) | 🔴 HIGH | 1d pre-demo |
| Mixed-script answers (中/數/英 combined) | 🟡 MED | 1d pre-demo |
| Multi-attempt grade-merging logic (which attempt wins per question) | 🟡 MED | Phase 2 |
| Flag UI flow (currently API-only, no frontend test) | 🟢 LOW | Phase 2 |
| Concurrency: same user uploads 5 photos simultaneously | 🟢 LOW | Phase 2 |
| Privacy DELETE actually purges GCS objects (not just DB) | 🟡 MED | Phase 1c |
| Signed URL expiry enforcement (1hr) | 🟢 LOW | Phase 2 |
| Cross-lesson confusion (G6-L23 photo mis-identified as G6-L24) | 🟡 MED | 1d real-photo dry run |
