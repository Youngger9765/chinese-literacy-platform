---
spec_id: omo.identifier.fail_closed
module: omo-identifier
title: OMO 課文識別器 — 低可信度不自動解決 + fail-closed 契約
stability: active
canonical_source: backend/app/services/omo_identifier.py
owns_code:
  - backend/app/services/omo_identifier.py
  - backend/app/services/omo_lesson_catalog.py
  - backend/app/services/omo_identifier_prompt.py
  - backend/app/services/omo_title_matching.py
spec_tests:
  - backend/specs/test_omo_identifier_spec.py
related_issues: [1886, 1729]
last_reviewed: 2026-06-02
owner: young
---

# OMO 課文識別器：fail-closed + 低可信度安全契約

> 這份是給**人**讀的 spec（方大哥 / 實習生 / AI 修 OMO 邏輯）。
> 機器可驗的契約在 `backend/specs/test_omo_identifier_spec.py`。
> 修識別器邏輯前先讀這份。

## 1. 這個 module 在管什麼

OMO Phase 1：學生拍學習單照片上傳 → AI 辨識這張照片屬於哪篇課文。
識別出來的課文 code 才能進入 Phase 2（AI 批改）。

**識別器有兩條路徑**：

| 路徑 | 函式 | 何時使用 |
|------|------|---------|
| AI 路徑 | `identify_lesson_from_image` (async) | 一般上傳（無課文 hint） |
| hint 路徑 | `identify_lesson_from_hint` | 學生在課文頁面內上傳（系統已知課文） |

## 2. 核心不變式（Invariants）

### I-1: 錯誤時一律回傳 `[]`（fail-closed）

`identify_lesson_from_image` 在任何錯誤情況（AI API 失敗 / JSON parse 失敗 / 空回傳）
均回傳 `[]`，**不會自動把圖片歸屬到任何課文**。

理由：錯誤時自動解決 → 批改引擎拿到錯誤課文 → 學生被誤判 → 教育傷害。
Fail-closed 原則與 OMO grader 的 `understood=False` 同源。

### I-2: 低可信度候選被過濾掉（threshold = 0.4）

Gemini 回傳的候選，`confidence < 0.4` 的全部被過濾，不出現在回傳值中。
（這是 Phase 2 「弱/臆測性」邊界，見 `CLAUDE.md` OMO identifier 段。）

唯一例外：verbatim title match boost — 頂排候選 title == extracted_title 且 conf < 0.4
時，confidence 被提升至 0.95（避免 Gemini under-report 高確信度匹配）。

### I-3: hint 路徑一定回傳 `confidence=1.0`

`identify_lesson_from_hint(lesson_code)` 對已知課文碼一律回傳 `confidence=1.0`。
對未知課文碼回傳 `[]`（不 crash，不 fallback 到錯誤課文）。

### I-4: hint 路徑是純函式（deterministic），不呼叫 AI

`identify_lesson_from_hint` 在課文碼已知時，不需要任何 AI 呼叫，
直接從 curriculum catalog 回傳固定結果（latency ~0ms，無 cost）。

### I-5: circuit breaker 在 3 次連續錯誤後啟動

3 次連續 AI 錯誤 → raise RuntimeError（不是 return []）。
這是讓 caller 收到 HTTP 503，而不是悄悄回傳空結果讓前端顯示「沒有課文」。

## 3. 待查事項

- **verbatim title boost 與 threshold 的交互作用**：若 extracted_title 為空字串，
  boost 不發生；若多個候選都符合，只有第一個（confidence 最高）被 boost。
  目前代碼 OK，但未有顯式測試多 boost 候選的場景。
- **fuzzy match 門檻**：`_fuzzy_match_title` 使用的 similarity threshold 待查
  （omo_title_matching.py 中定義）；未曾被 spec test 覆蓋。

## 4. 反模式（不要做）

- ❌ AI 路徑在 except 裡 return 一個「猜測的」課文 → 必須 return []
- ❌ hint 路徑拋 KeyError 而非 return [] — 用 dict.get() 安全存取
- ❌ confidence threshold 改 < 0 → 等於拿掉過濾
- ❌ 在 circuit breaker 跳起來後 swallow RuntimeError → 前端看不到 503
