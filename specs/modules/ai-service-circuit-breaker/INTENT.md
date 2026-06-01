---
spec_id: ai.service.retry_and_safety
module: ai-service-circuit-breaker
title: Gemini 共用客戶端 — 重試常數、GeminiContentFilterError 不重試、安全回傳行為
stability: active
canonical_source: backend/app/services/ai/base.py
owns_code:
  - backend/app/services/ai/base.py
  - backend/app/services/ai/gemini_client.py
  - backend/app/services/ai_service.py
  - backend/app/services/ai_base.py
owns_data: []
spec_tests:
  - backend/specs/test_ai_service_circuit_breaker_spec.py
related_issues: []
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# Gemini 共用客戶端：重試、安全過濾、常數契約

> 給**人**讀的 spec（Young / 實習生 / 審 code 的人）。機器契約在
> `backend/specs/test_ai_service_circuit_breaker_spec.py`。
> 改 `ai/base.py` 或 `ai/gemini_client.py` 前先讀這份。

## 1. 這個 module 在管什麼

`ai_service.py` 是向後相容的 re-export 外殼；真正的共用邏輯住在：

- `ai/base.py` — 純 Python 常數（`MAX_RETRIES`、`RETRY_BASE_DELAY`、`GEMINI_TIMEOUT`）+
  `_repair_json()`（無 google.genai import）
- `ai/gemini_client.py` — Vertex AI 客戶端、safety filter、`generate_structured_response()`

這份 spec **不管** per-service 的 circuit breaker（那些住在 `omo_grader.py` 和
`socratic/__init__.py`，分別被 `omo-upload` 和 `socratic-dialogue` spec 管）。
這份管的是「所有 Gemini 呼叫共用的底層行為」。

## 2. 重試常數（`ai/base.py` 已驗證值）

| 常數 | 值 | 意義 |
|------|-----|------|
| `MAX_RETRIES` | **3** | 每次 Gemini 呼叫最多嘗試次數 |
| `RETRY_BASE_DELAY` | **1.0** 秒 | 指數退避基底（第 k 次延遲 = 1.0 × 2^k 秒）|
| `GEMINI_TIMEOUT` | **30** 秒 | asyncio.wait_for timeout；超時拋 TimeoutError |

**改這些數字前必須更新本 spec。** spec test 以常數名稱而非 magic number 驗證，
確保 spec 跟 code 同步。

## 3. GeminiContentFilterError — 不重試

`generate_structured_response()` 有一個特殊規則：

> **`GeminiContentFilterError` 不走重試迴圈，立即往上拋。**

安全過濾（Gemini 封鎖 prompt/response）是**確定性的**，重試不會改變結果。
呼叫端（路由層）應回傳對學生友好的訊息，而非 500 error。

```python
except GeminiContentFilterError:
    raise   # ← 跳過 retry，直接往上傳
```

## 4. 重試耗盡後的行為（fail-open 警示）

`generate_structured_response()` 在 `MAX_RETRIES` 次全部失敗後拋出 `last_error`
（最後一次例外）。**它不會回傳 `{}`、`None` 或任何「假成功」值。**

這個行為很重要：上層的路由（`comprehension`、`reading`、`vocabulary` 等）
應該自己決定 fail-closed 語意（回傳 `understood=False` 或 HTTP 503），
而不是依賴底層靜默回傳合理看起來的預設值。

> 待查（待查）：socratic agent 的 circuit breaker 觸發後，`generate_structured_response`
> 是否仍有機會被呼叫？（目前看來兩層獨立，circuit breaker 在外層先判斷。）

## 5. `ai_service.py` 是 re-export 外殼

```python
# ai_service.py
from .ai_base import (MAX_RETRIES, RETRY_BASE_DELAY, ...)
from .ai_comprehension import *
from .ai_reading import *
# ai_generation → 待查：ai_service.py 提到 ai_generation.py 但該檔案不存在
```

現有代碼 `from app.services.ai_service import MAX_RETRIES` 繼續有效。

> **待查**：`ai_service.py` 第 30 行 `from .ai_generation import *` 但
> `ai_generation.py` 不存在於磁碟。這是 dead import 還是已遷移到另一個路徑？
> 下次改 `ai_service.py` 時確認。

## 6. 允許 / 禁止的改動

✅ **允許**
- 調整 `MAX_RETRIES`（但必須更新本 spec 的表格）
- 調整 `GEMINI_TIMEOUT`（但必須更新本 spec 的表格）
- 新增 `_repair_json()` 修復策略（純 Python，不需更新 spec 常數）

⛔ **禁止（會破壞契約）**
- 讓 `GeminiContentFilterError` 進入重試迴圈（重試不會改結果，只浪費 token）
- 讓 `generate_structured_response()` 在全部失敗後靜默回傳 `{}` 或 `None`
  （下游依賴拋出例外來判斷需要 fallback）
- 在 `ai/base.py` 加 `google.genai` import（破壞「pure Python 常數層」設計）
