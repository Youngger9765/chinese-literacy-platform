---
spec_id: security.input_sanitizer
module: input-sanitizer
title: Prompt Injection Sanitizer — 惡意輸入過濾契約
stability: active
canonical_source: regex + length cap (no AI call)
owns_code:
  - backend/app/services/input_sanitizer.py
spec_tests:
  - backend/specs/test_input_sanitizer_spec.py
related_issues: [270]
last_reviewed: 2026-06-02
owner: young
---

# Prompt Injection Sanitizer：惡意輸入過濾契約

> 這份是給**人**讀的 spec（方大哥 / 實習生 / AI 修 security）。
> 機器可驗的契約在 `backend/specs/test_input_sanitizer_spec.py`。
> 修 `input_sanitizer.py` 前先讀這份。

## 1. 這個 module 在管什麼

`backend/app/services/input_sanitizer.py` 負責在學生/教師輸入文字到達 Vertex AI Gemini
之前，對輸入做兩類防護：

1. **Prompt injection 偵測與過濾** — regex-based，不呼叫 AI（純 CPU，毫秒級）
2. **長度截斷** — 最大 `MAX_INPUT_LENGTH = 2000` 字元（防止 token stuffing）

## 2. 核心不變式（Invariants）

### I-1: 過濾後不超長

`sanitize_ai_input(text)` 的輸出 (sanitized, was_modified)：
- `len(sanitized) <= MAX_INPUT_LENGTH`（目前 = 2000）
- 超過長度 → `was_modified = True`

### I-2: 純函式，注入模式被替換為 `[已過濾]`

已知注入模式（英文 + 中文 + LLM special tokens）均被替換為字串 `[已過濾]`，
不是刪除（刪除可能改變句意，替換保留可稽核痕跡）。

已知模式包含：
- `ignore previous instructions` / `忽略之前的指令`
- `you are now` / `你現在是`
- `act as` / `forget everything`
- LLM special tokens `[INST]` `<|system|>` `<|begin_of_text|>`
- Jailbreak 關鍵字：`jailbreak` / `DAN` / `developer mode` / `越獄` / `啟用開發者模式`

### I-3: AI turns 不被過濾

`sanitize_dialogue_turns(turns)` 只過濾 `role == "student"` 的 turn。
`role == "ai"` 的 turn 原封不動回傳（伺服器自產，可信任）。

### I-4: 空字串安全

`sanitize_ai_input("")` 回傳 `("", False)`，不 crash。

### I-5: `is_safe_input` 是 `sanitize_ai_input` 的便捷包裝

`is_safe_input(text) == not sanitize_ai_input(text)[1]`

## 3. 設計原則（Why regex, not AI）

- **無遞迴風險**：用 AI 偵測 injection = 攻擊者可以注入偵測層本身
- **延遲可預測**：regex 毫秒級，AI call 秒級，不影響學生體驗
- **可稽核**：INJECTION_PATTERNS 是人可讀的 regex 清單，可 code review

## 4. 反模式（不要做）

- ❌ 讓 injection 模式通過只記 log 不替換 — 攻擊者可以靠記錯位置的 log 來繞
- ❌ 刪除命中 substring（可能斷字）— 應替換為 `[已過濾]`
- ❌ 過濾 AI turns — AI turns 是 server-generated，過濾是誤傷
- ❌ 把 MAX_INPUT_LENGTH 設超過 10000 而不更新 Gemini max_output_tokens — token stuffing
- ❌ 在 sanitize 之前做任何 AI 呼叫 — 要先 sanitize 再 call AI

## 5. 已知邊界（待查）

- **Unicode bypass**：全形英文字母（ｉｇｎｏｒｅ）、零寬字元是否能繞過現有 regex？
  → 目前 `re.IGNORECASE` 只處理 ASCII case；全形字元未測試。待查。
- **Nested 替換**：pattern A 替換產生的 `[已過濾]` 字串是否會 trigger pattern B？
  → 目前看起來不會（替換後掃描結束），但未有顯式保護。
