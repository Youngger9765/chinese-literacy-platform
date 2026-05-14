# OMO Risk Matrix

> Track risks + mitigations + status. Update as phases close.

---

## 1. Risk Matrix

| # | Risk | Prob | Impact | Mitigation | Status |
|---|------|------|--------|------------|--------|
| R1 | Handwriting OCR < 80% accurate | High | High | (1) Document AI 前處理 (Phase 2) (2) Override button always visible (3) `ai_confidence < 0.7` 標 unconfirmed | 🔴 OPEN — Young 5/14 emphasized verify with real photos |
| R2 | Blurry / skewed photo | Med | Med | Gemini handles 45° + 8px blur well via multimodal; no extra processing needed | 🟢 RESOLVED — acceptance suite D1-D6 pass |
| R3 | Multi-photo merge (which attempt's answer wins per Q) | Low | Med | Multi-attempt design (`omo_upload_attempts` table) + `is_active` flag + Phase 2 teacher-pick UI | 🟢 DONE for storage; merge logic deferred to Phase 2 |
| R4 | Student privacy (PII in worksheet image) | High | High | (1) Private GCS bucket (2) Signed URL 1hr TTL (3) Per-user path `{user_id}/...` (4) DELETE endpoint for compliance | 🟢 DONE — needs Phase 1c GCS-purge verification |
| R5 | AI wrong answer at live demo | Med | High | (1) Override button reachable in < 2 taps (2) Pre-demo dry run with 5 photos × 7 lessons (3) Teacher can manually pick top-2 or top-3 candidate | 🟡 OPEN — pre-demo dry run pending |
| R6 | Gemini cost explosion (abuse / loop) | Low | Med | Image hash dedup + per-day per-user quota (Phase 1b umbrella PR #1583) | 🚧 IN FLIGHT — Phase 1b |
| R7 | Auth / quota: Vertex AI token exhaustion | Med | Med | Service account auth (no API key rotation); quota shared on `lingoleap-dev` project; monitor via GCP console | 🟡 OPEN — Phase 1c monitor only, skip hardening per Young |
| R8 | Mixed-script confusion (數字/英文/中文 in same answer) | Med | Med | Test with mixed-script samples in Phase 1d; Gemini multimodal generally handles | 🟡 OPEN — Phase 1d real-photo test |
| R9 | Cross-lesson misidentification (L23 photo → L24 result) | Med | High | Show top-3 + override + conf threshold 0.4 filter; pre-demo dry run validates | 🟡 OPEN — Phase 1d |
| R10 | Demo-day network latency on Cloud Run cold start | Low | Med | Pre-warm via synthetic ping 5 min before demo; staging already proven < 60s | 🟡 OPEN — demo-day op runbook needed |
| R11 | YAML schema drift (new lessons added mid-flight) | Low | Med | Duck-type parsing covers both dict + list shapes (Bug #2 fix); lesson_loader smoke test in CI | 🟢 RESOLVED |
| R12 | Multi-env config drift (staging using prod DB) | Med | High | Acceptance suite section A (7 checks); separate Cloud SQL + GCS bucket + JWT secret per env | 🟢 RESOLVED — PR #1579 + #1580 |
| R13 | Irrelevant content false-positive (food photo accepted) | Med | Low | Conf threshold 0.4 filter (PR #1581); acceptance E2 covers food photo | 🟢 RESOLVED |
| R14 | LLM returns malformed JSON | Low | Med | `_repair_json` helper + None-guard + circuit breaker; logs raw text for diagnostics | 🟢 RESOLVED — see Bug #1 |
| R15 | Student uploads NSFW / non-school content | Low | High | Gemini content filter active; if blocked, error returned; logs flagged for review | 🟡 OPEN — manual review process not defined |

---

## 2. Phase-Gated Open Items

### Phase 1c (skip per Young, monitor only)
- R4 (privacy DELETE GCS purge verification)
- R7 (Vertex AI token quota monitoring)

### Phase 1d (pre-demo dry run)
- R1 (real handwriting accuracy)
- R5 (live demo AI wrong scenario rehearsal)
- R8 (mixed-script)
- R9 (cross-lesson confusion)

### Phase 2 (post 7/1)
- R3 (multi-attempt merge logic)
- R15 (NSFW / non-school content review process)

---

## 3. Mitigation Patterns

| Pattern | Used in | Why effective |
|---------|---------|---------------|
| **Show top-3 + override** | R1, R5, R9 | Always recoverable — student/teacher can fix AI errors in < 2 taps |
| **Confidence threshold filter** | R13 | Cheap, catches "0-conf placeholder" LLM hallucination |
| **Circuit breaker** | R6, R7, R14 | Stops runaway cost on AI outage; surfaces 503 to user |
| **Fail-closed status=error** | R5, R14 | Never auto-pass — catastrophic to grade-pass on AI error |
| **Per-env isolation** | R12 | Backing store separation prevents cross-env contamination |
| **Hash dedup + quota** | R6 | Removes accidental loops + caps malicious abuse |

---

## 4. Demo-Day Operational Risks (R10 elaborated)

| Item | Probability | Mitigation | Owner |
|------|-------------|------------|-------|
| Cold start latency 6 → 30s on first call | Med | Pre-warm with `/api/health` ping 5 min before demo | Young |
| Live wifi flakiness | Med | Pre-cache `frontend/dist` on laptop; offline mode for non-AI steps | Young |
| Camera permissions denied | Low | Pre-test on demo laptop / phone, document permission grant flow | Young |
| Demo account login fails | Low | Have 3 backup demo accounts pre-provisioned (issue #989) | Young |
| Gemini rate-limit hit during multi-demo run | Low | Phase 1b dedup helps; have prerecorded video as fallback | Young |

---

## 5. Risk Heatmap (Prob × Impact)

```
              IMPACT
              Low    Med    High
PROB
  High        —     —      R1
  Med         R13   R3 R8  R5 R9 R10 R12
  Low         —     R6 R7  R4 R11 R14 R15
              R2 RESOLVED post-mitigation
```

Top 3 to watch pre-demo: **R1, R5, R9** (real-photo accuracy + override flow + cross-lesson).

---

## 6. Decision Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-05-13 | Skip Phase 1c hardening pre-demo | 7/1 ship priority; monitor risk via GCP console |
| 2026-05-13 | Drop D7 (blur 25px) from acceptance suite | Fundamentally not solvable at current arch; Phase 2 candidate |
| 2026-05-13 | Keep raw photos forever (no GCS lifecycle delete) | Audit + retraining value > storage cost |
| 2026-05-14 | Real-photo Phase 1d as separate dry-run, not blocker | Synthetic photos validate architecture; real-photo validates accuracy delta |
