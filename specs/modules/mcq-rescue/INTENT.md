---
spec_id: mcq.rescue.scaffold_and_fail_closed
module: mcq-rescue
title: MCQ 救援對話 — 鷹架不洩題 + Fail-Closed + State Machine 契約
stability: active
canonical_source: backend/app/services/mcq_rescue_agent.py
owns_code:
  - backend/app/services/mcq_rescue_agent.py
  - backend/app/services/rescue_session_store.py
  - backend/app/services/rescue_state_machine.py
  - backend/app/services/rescue_prompt_builder.py
spec_tests:
  - backend/specs/test_mcq_rescue_spec.py
related_issues: [1887]
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# MCQ 救援對話：鷹架不洩題 + Fail-Closed + State Machine 契約

> 這份是給**人**讀的 spec（林校長 SOP / 方大哥 / 實習生）。機器可驗的契約在
> `backend/specs/test_mcq_rescue_spec.py`。

## 1. 這個 module 在管什麼

MCQ 救援（Rescue）是學生答錯選擇題後的 **5-step AI 鷹架對話**（來自林校長 SOP）。
目標：引導學生推導出正確答案，**不直接告知答案**。

## 2. 5-Step SOP（林校長）

| Step | 目標 | 推進條件（advance_when） |
|------|------|----------------------|
| 1 | 理解題目在問什麼 | 學生能重述題目 |
| 2 | 定位課文相關段落 | 學生指出相關段落 |
| 3 | 用自己話說那段 | 學生能詮釋段落意義 |
| 4 | 對應到選項 | 學生能把詮釋對應到選項 |
| 5 | Direct Teach（答案揭示）| 學生通過 step 4 或放棄三次 |

## 3. Fail-Closed 契約（最重要）

**AI 錯誤時 `should_advance` 永遠是 `False`**。

自動升級（AI 錯誤 → `should_advance=True`）＝自動讓學生跳過不懂的題目，
從教育角度是**災難性行為**。Circuit breaker 設計：

- 連續 AI 錯誤 < `MAX_CONSECUTIVE_ERRORS`（=3）→ 錯誤降級回應，`should_advance=False`
- 連續 AI 錯誤 ≥ 3 → `RuntimeError` → HTTP 503（呼叫端必須明確處理，不靜默失敗）

## 4. 鷹架不洩題

救援對話**引導思考**而非直接給答案。
- Step 1-4：AI 問問題幫助學生推理
- Step 5（Direct Teach）：才揭示正確答案 + 解釋
- 開場語（`opening` template）：引用學生的**錯誤選項**（`{wrong_answer}`），引導反思

## 5. State Machine 不變量（`apply_state_transitions`）

這些規則在 `rescue_state_machine.py` 中是純 Python，可機器驗證：

| 規則 | 說明 |
|------|------|
| give_up ≥ threshold → 跳到 step 5 | 給學生 direct teach 機會 |
| should_advance + current_step < 5 → step += 1 | 逐步推進 |
| current_step == 5 + should_advance → should_terminate = True | 完成條件 |
| current_step 永遠在 [1, 5] | clamp 保護 |
| give_up_detected=False → give_up_count 歸零 | 真實回答重置計數 |

## 6. Session Store 不變量

- `make_key(user_id, question_id)` 格式：`mcq_rescue_{uid}_{qid}`
- TTL = 30 分鐘（與 Socratic agent 一致）
- Rate limit = 30 次 / 60 秒

## 7. Response Schema 必填欄位

Gemini 回傳的 JSON 必須含以下欄位（`required` in `RESCUE_RESPONSE_SCHEMA`）：
`ai_feedback, next_question, should_advance, should_terminate, give_up_detected, current_step, reasoning`

`reasoning` 缺失或空字串 → `ValueError`（不靜默接受，確保稽核軌跡完整）。

## 8. 待查（需 AI / DB 環境）

- 策略 YAML 檔案是否正確載入（`load_strategy_prompt`）— 待查
- `start_session` idempotency（同一 session 重複呼叫）— 待查（需 mock AI）
- Gemini response schema 實際執行正確性 — 待查

## 9. 允許 / 禁止的改動

✅ **允許**
- 調整 `GIVE_UP_THRESHOLD`（需同步 INTENT.md 和 test）
- 新增策略類型 YAML（不影響 state machine 邏輯）

⛔ **禁止（會破壞契約）**
- AI 錯誤時讓 `should_advance=True`
- 讓 `current_step` 超出 [1, 5] 範圍
- 拿掉 `reasoning` 空字串的 ValueError guard
