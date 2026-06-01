---
spec_id: socratic.dialogue.fail_closed
module: socratic-dialogue
title: 蘇格拉底對話 — 5 題 3 階段 + circuit breaker fail-closed 保證
stability: active
canonical_source: backend/app/services/socratic/__init__.py
owns_code:
  - backend/app/services/socratic/__init__.py
  - backend/app/services/socratic/state_machine.py
  - backend/app/services/socratic/models.py
  - backend/app/services/socratic/session_store.py
  - backend/app/services/socratic_agent.py
owns_data: []
spec_tests:
  - backend/specs/test_socratic_dialogue_spec.py
related_issues: []
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# 蘇格拉底對話：5 題 3 階段 + Circuit Breaker Fail-Closed

> 給**人**讀的 spec（Young / 實習生 / 審 code 的人）。機器契約在
> `backend/specs/test_socratic_dialogue_spec.py`。改 `socratic/` 任何檔案前先讀這份。

## 1. 這個 module 在管什麼

`SocraticAgent.process_answer()` 處理學生每一輪的回答，決定：
- 這輪答對了嗎？（`understood`）
- 下一道問題是什麼？
- 是否已到達終點（5 題全回答過）

同時管理 AI 服務異常時的 circuit breaker，確保系統故障**不會**讓學生被自動評為「理解了」。

## 2. 三階段進展邏輯（`state_machine.py`）

| 階段 | 觸發條件（`understood_count`）| 問題特性 |
|------|-------------------------------|---------|
| `factual` | 0–1 題答對 | 事實性問題（誰、什麼、在哪） |
| `inferential` | 2–3 題答對 | 推論性問題（為什麼、影響） |
| `evaluative` | ≥ 4 題答對 | 評估性問題（你覺得、如果是你） |

`determine_phase(understood_count, total_attempts)` 是一個純函式，
不依賴 DB 或 AI，可以直接 unit test。

## 3. Circuit Breaker — fail-closed 行為（最關鍵的安全保證）

`MAX_CONSECUTIVE_ERRORS = 3`（定義在 `SocraticAgent` 類別）

### 情況 A：AI 失敗 < 3 次

- `understood` 設為 **False**（不自動通過）
- 給學生一個 fallback 問題：`「讓我再想一下，請你再回答一次好嗎？」`
- `state.consecutive_errors` 累加

### 情況 B：AI 連續失敗 ≥ 3 次（circuit breaker 觸發）

- 拋出 `RuntimeError`（→ 路由層回傳 HTTP 503）
- **絕對不會** 把 `understood` 設成 True，不會增加 `understood_count`
- 這保護了「學生學習成效」資料的完整性

> **關鍵設計原則**（同 `reading-eval-safety` spec）：
> 系統故障時，寧可讓學生重試，也絕不假裝「學生理解了」。

## 4. 允許 / 禁止的改動

✅ **允許**
- 調整 `MAX_CONSECUTIVE_ERRORS`（但必須更新本 spec 的常數說明）
- 改 fallback 問題文字（`_fallback_question(state)` 函式）
- 增加 phase 數（需更新 `PHASE_ORDER` + 本 spec 的表格）

⛔ **禁止（會破壞契約）**
- 在 `except Exception` 區塊裡把 `understood` 設成 `True`
- 呼叫 `state.understood_count += 1` 在 AI 錯誤路徑裡
- 把 `MAX_CONSECUTIVE_ERRORS` 改成 0（會讓第一次 AI 錯誤就 circuit break）

## 5. `session_id` vs `db_session_id`

`SessionState.session_id`（string）= in-memory session 的 key（通常是 UUID 字串）。
`db_session_id`（int or None）= `LearningSession.id`（PostgreSQL 主鍵）。
兩者是不同的。修改 session 查詢邏輯時注意區分。

## 6. Open questions

- `MAX_CONSECUTIVE_ERRORS = 3` 這個數字有沒有辦法做到 session-level config？
  （目前是 hard-coded class variable，待查）
- `start_session()` 的 AI error path（L192）目前只 log warning，不會 circuit break；
  是否應該和 `process_answer()` 保持一致？（待查）
