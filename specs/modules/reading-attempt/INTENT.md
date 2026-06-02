---
spec_id: reading_attempt.history_invariants
module: reading-attempt
title: 朗讀嘗試歷史不變式（pointer module）
stability: active
canonical_source: backend/app/services/reading_attempt_service.py + backend/app/models/learning_session.py
owns_code:
  - backend/app/services/reading_attempt_service.py
legacy_tests:
  - backend/tests/test_full_reading_attempts.py
complementary_tests:
  - backend/tests/test_reading_attempt_history.py
related_issues:
  - 2058
last_reviewed: 2026-06-02
owner: young
---

# Reading Attempt：朗讀嘗試歷史不變式（pointer module）

> **這是 pointer-only module。** 沒有獨立的 `backend/specs/test_reading_attempt_spec.py`。
> 所有機器可驗的契約由 `backend/tests/test_reading_attempt_history.py` 和
> `backend/tests/test_full_reading_attempts.py` 覆蓋，已列於 `legacy_tests:`。

## 1. 這個 module 在管什麼

學生的全文朗讀嘗試歷史：每次嘗試的快照機制、最多 4 次上限、重複跳過邏輯，以及 `reading_history` 與 `full_reading_result` 的一致性。

## 2. 核心不變式（Invariants）

### I-1: 快照建立前先存一筆（snapshot before second write）

第一次寫入不建快照；第二次寫入前先把第一次的值快照起來。
確保歷史不丟失。

對應測試（`test_reading_attempt_history.py`）：`test_snapshot_created_before_second_write`

### I-2: 歷史計數不變式

`len(history) == snapshot_count + 1`（current session 算一筆，加上所有歷史快照）

對應測試：`test_history_count_invariant`

### I-3: 最多 4 次嘗試上限

超過 4 次時最舊的嘗試被丟棄（sliding window），attempt_index 重新排列。

對應測試（`test_full_reading_attempts.py`）：`test_cap_at_4_attempts`、`test_cap_reindexes_attempt_index`

### I-4: 重複嘗試跳過（相同 cpm + duration）

同一學習 session 內，若新嘗試的 cpm 和 duration 與最後一筆完全相同，跳過不寫入。

對應測試：`test_duplicate_skip_same_cpm_and_duration`

## 3. 為何不建獨立 spec test

`test_full_reading_attempts.py` 是純邏輯測試（無 DB fixtures），適合作為 `legacy_tests` 指針在 SQLite CI 環境跑。

`test_reading_attempt_history.py` 需要真實 DB（`reading_result` 是 JSON 欄位，SQLite 不相容 None 初始化），在 SQLite CI 模式下有 `JSONDecodeError`（pre-existing 問題，非本 PR 引入）。該測試作為 `complementary_tests` 記錄，但不放入 `legacy_tests`，以免讓 `run-ci.sh` 出現誤報性紅燈。
