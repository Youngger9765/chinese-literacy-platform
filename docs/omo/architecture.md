# OMO Architecture

> System diagram, data flow, cost model, latency budget, GCS + DB layout.

---

## 1. System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Frontend                                  │
│  ┌────────────────────────┐                                          │
│  │  OmoUpload.tsx         │                                          │
│  │  • file picker / webcam│                                          │
│  │  • status polling      │                                          │
│  │  • result cards        │                                          │
│  └─────────┬──────────────┘                                          │
└────────────┼─────────────────────────────────────────────────────────┘
             │ multipart/form-data + Bearer JWT
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Backend FastAPI (Cloud Run)                         │
│                                                                      │
│  POST /api/omo/upload ──► validate (10MB, 5 files, image/*)          │
│       │                                                              │
│       ├──► GCS write: {user_id}/{upload_id}/0/0.jpg                  │
│       │                                                              │
│       ├──► INSERT omo_uploads (status=identifying)                   │
│       ├──► INSERT omo_upload_attempts (attempt_idx=0, is_active=t)   │
│       │                                                              │
│       └──► BackgroundTask: _run_identification                       │
│             │                                                        │
│             ▼                                                        │
│   ┌─────────────────────────────────────┐                            │
│   │   omo_identifier.py                  │                            │
│   │   ├─ load 7 OMO lesson metadata     │                            │
│   │   ├─ build identification prompt    │                            │
│   │   └─ Gemini 2.5-flash multimodal    │ ──► Vertex AI              │
│   │       max_output_tokens=2048        │      (us-central1)         │
│   │       temperature=0.1               │                            │
│   │       returns top-3 candidates      │                            │
│   │       filter conf ≥ 0.4             │                            │
│   └─────────────────────────────────────┘                            │
│             │                                                        │
│             └──► UPDATE omo_uploads SET status=identified,            │
│                  identification=[...], ai_confidence=top.conf         │
│                                                                      │
│  POST /api/omo/{id}/confirm  ──► UPDATE lesson_id=...                │
│       │                                                              │
│       └──► BackgroundTask: _run_grading                              │
│             │                                                        │
│             ▼                                                        │
│   ┌─────────────────────────────────────┐                            │
│   │   omo_grader.py                      │                            │
│   │   ├─ load lesson YAML                │                            │
│   │   ├─ _build_question_schema         │                            │
│   │   │   (resolve letter → vocab[idx]) │                            │
│   │   ├─ _build_grading_prompt          │                            │
│   │   └─ Gemini 2.5-flash structured    │ ──► Vertex AI              │
│   │       max_output_tokens=2048        │                            │
│   │       returns per-question:          │                            │
│   │         student_answer + score      │                            │
│   │         + ai_confidence + reasoning │                            │
│   └─────────────────────────────────────┘                            │
│             │                                                        │
│             └──► UPDATE omo_uploads SET status=graded,                │
│                  answers=[...], overall_score=avg, progress={...}     │
│                                                                      │
│  GET /api/omo/{id} ──► returns full state for frontend polling       │
└─────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Cloud SQL PostgreSQL                                                │
│  • omo_uploads (id, student_id, lesson_id, status,                   │
│                 identification JSONB, answers JSONB,                 │
│                 overall_score, ai_confidence, progress JSONB)        │
│  • omo_upload_attempts (id, omo_upload_id, attempt_idx,              │
│                         image_paths JSONB, is_active, ocr_preview)   │
└─────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  GCS Buckets (per-env, private, signed URL 1hr)                     │
│  • lingoleap-omo-uploads-prod                                        │
│  • lingoleap-omo-uploads-staging                                     │
│  • lingoleap-omo-uploads-preview                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Sequence

```
1. Student taps "OMO 上傳" → camera/file picker
2. Frontend POST /api/omo/upload with image bytes
3. Backend:
   a. Validate mime + size + count
   b. INSERT omo_uploads row (status=pending → identifying)
   c. INSERT omo_upload_attempts row (attempt_idx=0)
   d. Upload bytes to GCS at {user_id}/{upload_id}/0/N.jpg
   e. Fire BackgroundTask → Gemini identify
   f. Return 201 with {upload_id, status: "identifying"}
4. Frontend polls GET /api/omo/{id} every 1s
5. When status=identified, frontend shows top-3 candidates
6. Student taps the correct one (or top-1 if conf ≥ 0.9 auto-confirm)
7. Frontend POST /api/omo/{id}/confirm {confirmed_lesson_id}
8. Backend:
   a. UPDATE lesson_id, status → grading
   b. Fire BackgroundTask → Gemini grade
   c. Return 200 immediately
9. Frontend continues polling
10. When status=graded, frontend renders per-question result cards
11. Optional: student taps "AI 抽錯了" → PATCH /{id}/answers/{q}/flag
```

---

## 3. Cost Model

### Per call (NT$)

| Operation | Input tokens | Output tokens | Cost (NT$) |
|-----------|--------------|---------------|------------|
| Identification | ~2000 (prompt + image) | ~500 (top-3 JSON) | ~0.012 |
| Grading | ~3000 (prompt + image + schema) | ~2000 (N×answer rows) | ~0.030 |

Source: Gemini 2.5-flash pricing (Vertex AI) ÷ tokens. Image counted as ~1500 tokens for 1024×1024.

### Monthly projection

Assumption: 1500 active students × 7 lessons × 2 photos average / month

| Operation | Calls/month | Cost/month |
|-----------|-------------|------------|
| Identification | 21,000 | NT$252 |
| Grading | 21,000 | NT$630 |
| **Total Gemini** | 42,000 | **~NT$882** |
| GCS storage (1500 × 7 × 2 × 500KB = 10.5GB @ NT$0.6/GB) | — | NT$6.3 |
| GCS egress (signed URL views, ~50% × 500KB) | — | NT$3 |
| **Grand total** | — | **~NT$891/mo** |

Budget headroom: 3x for Phase 2 features (Document AI ~NT$0.04/page would 2x the bill).

---

## 4. Latency Budget

| Stage | p50 | p95 | Notes |
|-------|-----|-----|-------|
| Upload (multipart parse + 10MB GCS write) | 0.3s | 1.1s | Network dominant |
| Identify (Gemini multimodal call) | 6s | 14s | Cold start can add 3s |
| Grade (Gemini structured output) | 12s | 25s | Output-size dominant |
| **Total user-perceived** | **~20s** | **~40s** | Within 60s spec |

Frontend shows progress: "上傳中" → "AI 辨識課程" → "請確認" → "AI 批改中" → "完成" so 20-40s doesn't feel as long.

---

## 5. GCS Layout

| Bucket | Env |
|--------|-----|
| `lingoleap-omo-uploads-prod` | Production |
| `lingoleap-omo-uploads-staging` | Staging |
| `lingoleap-omo-uploads-preview` | PR Preview |

### Path format

```
{user_id}/{omo_upload_id}/{attempt_idx}/{file_index}.jpg
```

Example: `42/1573/0/0.jpg` = student #42's upload #1573 first attempt first photo.

### Lifecycle policy

**No auto-delete.** Per Young: raw photos kept forever for audit, teacher review, ML retraining.

DELETE `/api/omo/{id}` privacy endpoint purges objects on demand (Phase 1c work to verify enforcement).

### Access

- Bucket private. Only service account `lingoleap-backend@lingoleap-dev.iam.gserviceaccount.com` has objectAdmin.
- Signed URL 1-hour TTL on `GET /api/omo/{id}/images/{attempt_id}/{n}`.

---

## 6. DB Layout

### `omo_uploads`

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | autoinc |
| `student_id` | int FK users(id) | index, ondelete=CASCADE |
| `lesson_id` | int nullable | index, set after confirm |
| `identification` | JSONB nullable | top-3 candidates with reasoning |
| `answers` | JSONB | per-question array |
| `overall_score` | float nullable | avg of per-question scores |
| `ai_overall_confidence` | float nullable | avg ai_confidence |
| `progress` | JSONB | {stage, total, graded} |
| `status` | varchar(32) | pending\|identifying\|identified\|grading\|graded\|error |
| `error_message` | varchar(500) nullable | user-facing error |
| `ai_confidence` | float nullable | denormalised top-1 candidate conf |
| `created_at`, `updated_at` | timestamptz | server_default=now() |

Compound index: `ix_omo_uploads_student_lesson (student_id, lesson_id)` — supports per-student-per-lesson aggregation queries.

### `omo_upload_attempts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | int PK | autoinc |
| `omo_upload_id` | int FK omo_uploads(id) | index, ondelete=CASCADE |
| `attempt_idx` | int | 0-based ordering |
| `image_paths` | JSONB | list of GCS object paths for this attempt |
| `ocr_preview` | varchar(500) nullable | short OCR snippet for UI |
| `is_active` | bool | which attempt is currently used for grading |
| `captured_at` | timestamptz | server_default=now() |

Index: `ix_omo_upload_attempts_upload_id` on `omo_upload_id`.

### Migrations

| Revision | Description |
|----------|-------------|
| `k6f7a8b9c0d1` | `add_omo_uploads` — initial table |
| `l7g8h9i0j1k2` | `add_omo_phase1a_attempts_grading` — add attempts table + answers/progress columns |

---

## 7. AI Stack Details

| Aspect | Choice | Reasoning |
|--------|--------|-----------|
| Model | `gemini-2.5-flash` | Multimodal + structured output + cheaper than 2.5-pro |
| Region | `us-central1` | asia-east1 does NOT have Gemini models |
| Auth | Service account via Vertex AI | No API key management; works in Cloud Run |
| Temperature | 0.1 | Low for deterministic identification + grading |
| Max output tokens | 2048 | Identification + grading both need room for reasoning |
| Circuit breaker | 3 consecutive errors → RuntimeError → HTTP 503 | Prevent runaway cost on AI outage |
| Fail-closed | status=error, never auto-pass | Catastrophic to auto-grade-pass on error |

---

## 8. Why not...

- **Why not Document AI for deskew/binarize?** Diminishing returns at current accuracy. Gemini handles 45° + 8px blur well. Add only if Phase 1d real-photo dry run shows < 80%.
- **Why not Cloud Vision OCR + separate match step?** Two RPC hops, more code paths, no quality gain. Gemini multimodal does both in one call.
- **Why not store image bytes in DB?** GCS cheaper + scalable + signed-URL native. DB stores paths only.
- **Why not auto-delete old uploads?** Young: keep raw forever for audit + retraining. Privacy DELETE endpoint exists for compliance.
- **Why not separate identify+grade Cloud Run service?** Latency too high (RPC + cold start). Background task in same service is sufficient at current scale.
