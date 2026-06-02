---
spec_id: learning.stuck_detection
module: stuck-detection
title: 卡點偵測 — 掙扎學生偵測閾值 + 規則式建議
stability: active
canonical_source: backend/app/services/stuck_detection_service.py
owns_code:
  - backend/app/services/stuck_detection_service.py
owns_data: []
spec_tests:
  - backend/specs/test_stuck_detection_spec.py
related_issues:
  - 91
source_meetings: []
last_reviewed: 2026-06-02
owner: young
---

## Intent

`stuck_detection_service` 分析 `LearningSession` + `CharacterError` 找出掙扎中的學生，
並用規則（非 AI、即時、永遠可用）產生行動建議。這是教師端「誰需要幫忙」的判斷依據，
閾值直接綁 PRD（同一字錯 ≥3 次、同篇練 ≥3 次、連續 3 次正確率下滑）。

本 module 是 DB-tier 的第一個範本：純函式部分（`build_recommendations`）秒測，
DB 部分（`detect_stuck_points`）用 in-memory SQLite + phantom student_id（不驗 FK，
只驗偵測邏輯），JSONB→JSON patch 來自 `specs/conftest.py`。

## Invariants

1. 閾值常數固定：`STUCK_ATTEMPT_THRESHOLD == 3`、`CHARACTER_ERROR_THRESHOLD == 3`、
   `ACCURACY_DECLINE_SESSIONS == 3`、`LOOKBACK_DAYS == 30`。
2. `build_recommendations`：無卡點 → 回 1 筆 `encouragement`；`is_declining` → 含
   `declining`；`story_stuck` 建議上限 3 筆；`character_stuck` 建議上限 5 筆；每筆建議
   都有 `action`。
3. `detect_stuck_points` character_stuck：同字錯誤 ≥3 次才標記，< 3 不標記。
4. `detect_stuck_points` 趨勢：最近 `ACCURACY_DECLINE_SESSIONS` 次嚴格遞減 → `is_declining`
   True；遞增 → False。
5. Lookback：`started_at` 早於 30 天的 session 不計入 `accuracy_trend`。

## Known drift（契約標記，待 #91 處理）

`detect_stuck_points` 的 **story_stuck** 分支假設「同一 `story_slug` 有 ≥3 筆 session」，
但現行 schema 對 `learning_sessions` 有 `UNIQUE(student_id, story_slug)` 約束 —
一個學生每篇課文最多一筆 session，story_stuck 因此**永遠觸發不了**。
契約用一個 `xfail(strict=True)` 鎖定此事實：當有人修掉 drift（改用 `reading_attempt_history`
的 attempt_no，或移除約束），該測試會 XPASS，強制回來更新規格。

## Out of scope

- `detect_stuck_points` 對真實 User/Classroom 階層的 FK 完整性（測試刻意關閉 FK）。
- 路由層（teacher 端如何呈現建議）、AI 強化建議（本 module 只管規則式 baseline）。
