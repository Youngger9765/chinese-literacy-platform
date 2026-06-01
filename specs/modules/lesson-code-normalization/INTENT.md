---
spec_id: lesson.code.normalization
module: lesson-code-normalization
title: 課文代碼正規化 — 零填充剝除 + WW→文 轉換 + 全形→半形
stability: active
canonical_source: backend/app/services/lesson_code_normalization.py
owns_code:
  - backend/app/services/lesson_code_normalization.py
spec_tests:
  - backend/specs/test_lesson_code_normalization_spec.py
related_issues: [1889, 1669]
last_reviewed: 2026-06-02
owner: young
---

# 課文代碼正規化

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_lesson_code_normalization_spec.py`。
> 改動 `lesson_code_normalization.py` 或 `lesson_loader.py` 前先讀這份。

## 1. 這個 module 在管什麼

課程系統有兩層代碼：

- **catalog code**（課程目錄用）：例如 `G4-L01`、`WW-L01`、`G8-L03a`
- **parsed YAML lesson_code**（檔案層用）：例如 `G4-L1`、`文-L1`、`G8-L3a`

兩層之間的差距由三種轉換填平：

| 轉換 | 例子 |
|------|------|
| 零填充剝除 | `G4-L01` → `G4-L1`（`L0N` → `LN`）|
| WW→文前綴 | `WW-L01` → `文-L1`（文言文課文）|
| 全形→半形 | `Ａ`、`Ｂ` → `A`、`B`（YAML 答案偶爾打成全形）|

此外，還有兩張靜態例外表：
- `CATALOG_TO_PARSED_OVERRIDE`：G8 offset 修正 + G7-L31 multitext 對應（18 個 entry）
- `MULTI_LESSON_MAP` / `MULTI_LESSON_PRIMARY`：多課合一 YAML 的副鍵→主鍵對應

## 2. 核心不變量

### 2.1 `normalize_manifest_code()` 是冪等的

```
normalize(normalize(x)) == normalize(x)    # 對所有合法代碼成立
```

一個代碼跑兩次正規化結果和跑一次相同。這是 `lesson_loader.py` 依賴的前提。

### 2.2 等效代碼映射到同一規範形式

```
normalize("G4-L01") == normalize("G4-L1")  # 都 → "G4-L1"
normalize("WW-L01") == "文-L1"
normalize("G4-L03a") == "G4-L3a"
```

### 2.3 不符合模式的代碼 pass-through（原樣返回）

```
normalize("RANDOM") == "RANDOM"
normalize("totally-wrong") == "totally-wrong"
```

函數不 raise、不返回 None，不應破壞呼叫者的邏輯。

### 2.4 `halfwidth()` 是冪等的，且映射正確範圍

全形 ASCII 字母（U+FF01–U+FF5E）轉半形；範圍外字元原樣保留。

```
halfwidth("ＡＢＣ") == "ABC"
halfwidth("ABC") == "ABC"
halfwidth(halfwidth(x)) == halfwidth(x)    # 冪等
```

## 3. 允許 / 禁止的改動

✅ **允許**
- 在 `CATALOG_TO_PARSED_OVERRIDE` 新增 G8/G9 等 offset 修正 entry
- 在 `MULTI_LESSON_MAP` 新增多課合一 YAML 的副鍵

⛔ **禁止（會破壞契約）**
- 讓 `normalize_manifest_code()` 在已正規化代碼上再次改動（破壞冪等性）
- 讓函數對不符合任何模式的輸入 raise exception（呼叫者沒有防禦）
- 讓 `halfwidth()` 改動非全形 ASCII 字元（例外地轉換中文字符）

## 4. 教學 / 產品脈絡

- `normalize_manifest_code()` 由 `lesson_loader.py` 在 Level-1 catalog 掃描時呼叫，
  把 catalog YAML 的 `lesson_code` 欄位轉成與 Level-2 parsed YAML 匹配的形式。
- `halfwidth()` 由 OMO grader 呼叫，處理學生 fill-in-blank 答案的全形字母輸入。
- G8 offset 的根本原因：G8 課程目錄用「課程大綱編號」（含 sub-letter a/b），
  但已解析的 YAML 使用「解析順序流水號」，兩者差異由 `CATALOG_TO_PARSED_OVERRIDE` 橋接。

## 5. Open questions

- G9 是否也有類似 G8 的 offset 問題？（目前 `CATALOG_TO_PARSED_OVERRIDE` 沒有 G9 entry，待核查）
- `WW-` 前綴的課文是否全部已入庫？（`文-L*` 代碼目前有幾個待查）
