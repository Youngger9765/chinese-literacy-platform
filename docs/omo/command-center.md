# OMO Command Center — Master Index

> **Source of truth for OMO upload + identify + grade + correct pipeline.**
> All OMO work links back here. Update phase status as PRs merge.

---

## 0. Goal

7/1 demo flow：教授拿學生紙本學習單拍照 → 平台秒辨識課程 → 抽答案 → 即時批改 → 顯示對錯+原圖標註。

**Why this matters**：5/1 expert meeting 教授高度肯定，Young 5/2 升級為「壓箱寶」demo 主菜。
教學法依據：紙本書寫保留（體育班學生意志力較弱真實感比螢幕點擊強）+ 數位補做不到（自動批改、班級聚合、跨課文分析）。

---

## 1. Phase Status

| Phase | Scope | Status | Tracking |
|-------|-------|--------|----------|
| **1a** | upload + identify + multi-attempt + grade + flag (Demo MVP) | ✅ DONE | PR [#1573](https://github.com/Youngger9765/chinese-literacy-platform/pull/1573) |
| **1b** | image hash dedup + per-day per-user cost cap | 🚧 IN FLIGHT | Umbrella PR [#1583](https://github.com/Youngger9765/chinese-literacy-platform/pull/1583) |
| **1c** | OAuth env separation, Cron prod-only, Logging env tag | ⏳ PENDING | Skipped per Young (monitor only) |
| **1d** | Real handwriting validation + mixed-script test (中/數/英) | ⏳ PENDING | Pre-demo dry run |
| **2** | Document AI 前處理 + teacher review queue + classroom aggregation | 🔮 DEFERRED | Post 7/1 |

### Master TODO
Issue [#1343](https://github.com/Youngger9765/chinese-literacy-platform/issues/1343) — links to all sub-issues and this doc.

---

## 2. PDCA — Phase 1a (DONE)

### Plan
- [x] Define upload → identify → confirm → grade → result lifecycle
- [x] Pick Gemini 2.5-flash multimodal (no separate Vision OCR step)
- [x] Schema: `omo_uploads` 1:1 with student, `omo_upload_attempts` 1:N
- [x] Authz: per-user GCS path + signed URL 1hr TTL
- [x] Acceptance suite (env separation + API flow + 7-lesson recognition + edge cases + reject cases)

### Do
- [x] Backend routes: `/api/omo/upload|attempt|confirm|{id}|{id}/answers/{q}/flag|{id}/images/{a}/{n}` (DELETE for privacy)
- [x] `omo_identifier.py` — top-3 candidates with reasoning, conf threshold 0.4
- [x] `omo_grader.py` — per-question structured output, letter→vocab[idx] resolution
- [x] Alembic migrations `k6f7a8b9c0d1` (uploads) + `l7g8h9i0j1k2` (attempts + grading)
- [x] Frontend `OmoUpload` component (capture + status polling + result cards)
- [x] 16 pytest contract tests (`test_omo_upload.py`)

### Check
- [x] Acceptance suite passes locally (env A/B/C/D/E)
- [x] 7-lesson identification 7/7 correct in clean photos
- [x] Severe blur 8px + rotate 45° + skew handled
- [x] Pure white + irrelevant content correctly rejected
- [x] Latency budget within p95 ≤ 40s spec target

### Act
- [x] PR #1573 merged to staging
- [x] Doc this command center (this doc)
- [x] File follow-ups: Phase 1b dedup + 1c env separation + 1d real-photo validation

---

## 3. PDCA — Phase 1b (IN FLIGHT)

### Plan
- [x] Image hash (sha256 first-1MB) — short-circuit duplicate uploads
- [x] Per-day per-user identification quota (default 20/day)
- [x] Per-day per-user grading quota (default 10/day)
- [x] Soft-fail UX: "今天上傳次數已達上限，請明天再試"

### Do
- [ ] `omo_dedup.py` service + `omo_image_hashes` table
- [ ] Quota check in `_run_identification` + `_run_grading` background tasks
- [ ] `test_omo_dedup.py` covering hash-hit, quota-exceeded, reset-at-midnight
- [ ] Umbrella PR [#1583](https://github.com/Youngger9765/chinese-literacy-platform/pull/1583)

### Check
- [ ] Cost dashboard shows ≤ NT$50/day per active user
- [ ] No 429 leaked to user (soft message instead)
- [ ] Dedup hits ≥ 30% on demo workshop dry run

### Act
- [ ] Merge to staging, observe 24hr cost
- [ ] If 429 leak detected → escalate to Phase 1c rate-limit hardening

---

## 4. PDCA — Phase 1c (PENDING, monitor only)

> Skipped per Young: 「先 ship demo，infra hardening 上線後補」

### Plan
- [ ] OAuth env separation — `lingoleap-dev` token vs prod token isolation
- [ ] Cron jobs gated to prod environment only (skip staging/preview)
- [ ] Structured logging env tag (`env=prod|staging|preview`)

### Status
- ⏸️ Defer until post-demo. Monitor quota usage via GCP console.

---

## 5. PDCA — Phase 1d (PENDING, pre-demo dry run)

### Plan
- [ ] Collect 20+ real student handwriting photos (G6-L22~25, G7-L28~30)
- [ ] Mixed-script test set (中文 + 數字 + 英文混合答案)
- [ ] Multi-attempt smoke (front page + back page)
- [ ] Pre-demo dry run: 5 photos × 7 lessons, target ≥ 80% identification + ≥ 75% per-question correctness

### Do
- [ ] Build internal test harness (`/tmp/omo_real_photo_test.sh`)
- [ ] Record accuracy delta vs synthetic photos
- [ ] File issues for any < 70% accuracy lesson

### Check
- [ ] All 7 lessons identification ≥ 80%
- [ ] Per-question correctness ≥ 75%
- [ ] Override button reachable in < 2 taps when AI wrong

### Act
- [ ] If any blocker → escalate, may push some lessons to Phase 2

---

## 6. Phase 2 — DEFERRED (post 7/1)

| Capability | Why deferred |
|------------|--------------|
| Document AI 前處理（deskew + crop + binarize） | Gemini handles 45° + 8px blur acceptably — diminishing returns pre-demo |
| Teacher review queue（teacher overrides AI grade） | Not on demo critical path — student-self-override sufficient |
| Classroom aggregation dashboard | 5/1 expert meeting: focus 2 modules極致，aggregation in next iteration |
| Per-question position heatmap | Nice-to-have for teacher analytics |

---

## 7. Related Docs

| Doc | Purpose |
|-----|---------|
| [test-catalog.md](test-catalog.md) | Every OMO test + coverage gap |
| [debug-log.md](debug-log.md) | Bug-fix history with commit SHAs |
| [architecture.md](architecture.md) | System diagram + cost/latency budget |
| [risks.md](risks.md) | Risk matrix + mitigations + open items |
| [../specs/omo-upload-implementation-spec-2026-05-02.md](../specs/omo-upload-implementation-spec-2026-05-02.md) | Original implementation spec (5/2) |
| [../ceo-review-2026-05-02.md](../ceo-review-2026-05-02.md) | CEO review context |

---

## 8. Quick Links

- Master TODO: [Issue #1343](https://github.com/Youngger9765/chinese-literacy-platform/issues/1343)
- Phase 1a PR: [#1573](https://github.com/Youngger9765/chinese-literacy-platform/pull/1573)
- Phase 1b umbrella PR: [#1583](https://github.com/Youngger9765/chinese-literacy-platform/pull/1583)
- Code: `backend/app/routes/omo.py`, `backend/app/services/omo_identifier.py`, `backend/app/services/omo_grader.py`
- Models: `backend/app/models/omo_upload.py`
- Tests: `backend/tests/test_omo_upload.py`
- Frontend: `frontend/src/components/reading-steps/OmoUpload.tsx`
