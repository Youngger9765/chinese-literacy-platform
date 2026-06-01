---
spec_id: omo.grading.determinism
module: omo-determinism
title: OMO 批改確定性保證 — 「不是樂透」的架構規則
stability: active
owns_code:
  - backend/app/services/omo_scoring.py
  - backend/app/services/omo_question_schema.py
  - backend/app/services/omo_grader.py
spec_tests:
  - backend/specs/test_omo_determinism_spec.py
related_issues: [2029, 1712]
last_reviewed: 2026-06-01
owner: young
---

# OMO 批改確定性保證

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生 / AI）。機器可驗的契約在
> `backend/specs/test_omo_determinism_spec.py`。
> **AI 在改任何 omo_scoring / omo_question_schema / omo_grader 之前，先讀這份。**

## 1. 核心不變量：OMO 不是樂透

OMO 流程分兩段：

```
學生學習單照片
      │
      ▼
 ┌─────────────┐
 │  Gemini OCR │  ← 唯一的「機率步驟」(probabilistic)
 │ (Vision LLM)│    Gemini 看照片、辨識手寫筆跡
 └──────┬──────┘
        │ student_answer (原始 OCR 字串) + ai_confidence
        ▼
 ┌─────────────────────────────────────────────────────┐
 │           Pure-Python 決定性批改管線                 │
 │                                                     │
 │  _validate_student_answer()  ← 反造假閘門           │
 │         ↓                                           │
 │  _score_answer()             ← 純比對，無 LLM        │
 └─────────────────────────────────────────────────────┘
        │
        ▼
  GradedAnswer（分數固定，同樣輸入永遠同樣輸出）
```

**這是這份 spec 在守護的事：Gemini 看一次照片可能每次結果略有不同（機率的），
但只要 OCR 字串一樣，批改分數就必須完全一樣（確定的）。**

---

## 2. RULES — 改動任何下列規則會讓 OMO 變成樂透

### Rule 1：LLM 只在 OCR 步驟出現，批改管線全程無 LLM

`_score_answer` 和 `_validate_student_answer` 是純 Python 函式：
- 無 I/O
- 無 LLM 呼叫
- 無時間相依（`datetime.now()` 等）
- 無隨機性（`random` 等）

**禁止在這兩個函式裡加入任何 LLM 呼叫、DB 讀寫、或非確定性邏輯。**

### Rule 2：絕對不能移除 `allowed_values`（反造假籠子）

`_build_question_schema` 為每道題目建立有限的合法答案集合 `allowed_values`：
- **lettered 題**（學生圈字母）：A, B, C … 至多 7 個字母
- **free_form 題**（學生手寫詞語）：vocab_words 清單
- **multiple_choice 題**：固定 ["A", "B", "C", "D"]

`allowed_values` 是 Gemini 的「籠子」：Gemini 看到的 prompt 會列出這個集合，
告訴它只能回傳集合內的值。即使移除 `allowed_values`，Gemini 也可能造假一個
「看起來合理」的中文詞（例如回傳「良好」當作字母題的答案）。

**`allowed_values` 是防止 Gemini 造假的結構性保護，移除就等於打開籠門。**

### Rule 3：`_validate_student_answer` 必須把籠外的值強制清空

即使 Gemini 無視 prompt 規則、回傳了 `allowed_values` 以外的值，
`_validate_student_answer` 會把它 coerce 成 `("", True)`（空答案 + 造假旗標）。

**這是後端的最後一道防線。禁止把籠外的值當有效答案計分。**

精確語意：
- `student` 是空字串或全空白 → `("", False)`（合法的「沒作答」）
- lettered 模式：`student` 是單一字母且在 `allowed_values` 裡（大小寫不分）→
  `(student.upper(), False)`；否則 → `("", True)`
- free_form 模式：`student` 完全等於 `allowed_values` 之一（case-sensitive，中文字）→
  `(student, False)`；否則 → `("", True)`

### Rule 4：低信心讀取不自動批改，交老師判讀

當 Gemini 的 `ai_confidence < _LOW_CONFIDENCE_THRESHOLD`（目前 0.7）時，
`omo_grader.py` 會把 `student_answer` 改為空字串、並加 `[low-confidence]` 標記。

**「看不清就交老師」比「看不清就猜一個」更安全。不要把 threshold 改成 0。**

### Rule 5：`_score_answer` 的比對規則是固定的

| 情境 | 結果 |
|------|------|
| `student` 是空字串 | 0.0（沒作答） |
| `multiple_choice`：字母大小寫不分完全匹配 | 1.0 |
| 其他題型：字串完全相同 | 1.0 |
| 其他所有情況 | 0.0 |

**不要加「部分分數」、「模糊比對」或「語意相近」邏輯，除非有教學需求並更新本 spec。**

---

## 3. 已知資料缺口（2026-06-01 量測）

### 3.1 G7-L28、G7-L30 的 free_form 題 `allowed_values` 為空

這兩個 lesson 的 `fill_in_blank` 是「讀影片後填長答案」的題型，沒有 `vocabulary` 欄位，
所以 `_build_question_schema` 無法為 `allowed_values` 填入詞語清單 — 產生空 list。

**影響**：OMO 對這兩課送出 grading 請求時，Gemini 的 prompt 裡這些題目沒有合法值限制，
`_validate_student_answer` 對 free_form + 空 allowed_values 的行為是：
任何非空字串都通過（因為 `s in [] == False` → 造假判定 `True`，coerce 成空）。
換言之，Gemini 填什麼都會被清空 → 分數永遠 0 → 等同不批改這些題目。

這不是 grader 的 bug，而是 **YAML 資料缺失**。修法方向：補 vocabulary 或改為不同題型。
目前這兩課在正式批改流程中不適用 lettered 模式，問題不影響主線。

### 3.2 `_resolve_letter_answer` 仍用 `vocabulary` 索引而非 `vocab_bank`（#2015）

這個 drift 由 `omo-assessment/INTENT.md` 管理，本 spec 不重複描述。

---

## 4. 機器可驗的契約

`backend/specs/test_omo_determinism_spec.py` 驗證：

1. **反造假**：lettered 模式下，`良好`、`Z`、`99` 等籠外值全部 coerce 成空；`a` 被正規化為 `A`；空字串維持空
2. **冪等性**：對同一組輸入呼叫 50 次，每次結果完全相同（不是樂透）
3. **計分規則**：空 → 0.0；完全匹配 → 1.0；不匹配 → 0.0；MC 大小寫不分
4. **Schema 有籠**：G6/G7 全部 lesson 的每道 lettered/MC 題目都有非空 `allowed_values`
   （已知 2 個 free_form 例外 G7-L28、G7-L30 在測試中以文件形式標注）

所有契約目前**均為綠色測試（holds）** — 這份 spec 是在鎖定既有保證，不是在要求未來達到。

---

## 5. 怎麼維護這份 spec

更新觸發點：
- 任何改動 `omo_scoring.py`、`omo_question_schema.py`、`omo_grader.py` 的 PR
- 新增 lesson YAML 且含 `fill_in_blank` 或 `multiple_choice`
- 會議決議改變計分規則或允許部分分數

更新後：
1. 更新 `last_reviewed`
2. 跑 `python -m pytest backend/specs/test_omo_determinism_spec.py -v` 確認全綠
3. 若有例外（如新的 free_form 課程沒有 vocab）在 §3 新增說明
