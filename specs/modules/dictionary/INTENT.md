---
spec_id: dictionary.lookup
module: dictionary
title: MOE 字典查詢 — 查無字優雅降級 + 結構驗證
stability: active
canonical_source: backend/app/services/dictionary_service.py
owns_code:
  - backend/app/services/dictionary_service.py
spec_tests:
  - backend/specs/test_dictionary_spec.py
last_reviewed: 2026-06-02
owner: young
---

# MOE 字典查詢（Dictionary Service）

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_dictionary_spec.py`。
> 改動 `dictionary_service.py` 前先讀這份。

## 1. 這個 module 在管什麼

向教育部國語辭典（moedict.tw）查詢單一漢字的注音、筆畫數、定義，並以 DB 快取結果。
學生在生字練習時點選查詢，教師可看到定義和例句。

## 2. 核心不變量

### 2.1 `lookup_character()` 對非法輸入 raise `ValueError`

以下兩種情況明確 raise `ValueError`（呼叫者需處理）：
- 空字串 `""`
- 長度 > 1 的字串（例如 `"山水"`）

函數文件：`"character must be a single Chinese character"`

### 2.2 parse 結果結構完整

`_parse_moe_response(raw)` 對任何合法 moedict JSON 回應返回完整結構：

```python
{
    "zhuyin":      str | None,
    "stroke_count": int | None,
    "definitions": list[dict],   # 可為空 list，但不是 None
}
```

- `definitions` 中每個 entry 都有 `"type"`、`"definition"`、`"examples"` 三個 key
- 空 heteronym list（`{"h": []}`）返回 `definitions: []`，不 raise

### 2.3 `_has_real_definition()` 過濾讀音注記

部分漢字（例如「我」）第一個讀音是純讀音注記，例如 `"(一)之讀音。"`，
這不是真正的定義。`_has_real_definition()` 返回 `False` 讓 `_parse_moe_response()`
跳到有實質內容的讀音。

### 2.4 `_strip_markup()` 移除 moedict 反引號標注

moedict 回應使用 `` `word~ `` 格式標注注音。`_strip_markup()` 把它清掉後
文字才能正常顯示。函數對無標注文字 pass-through，對空字串安全。

### 2.5 `lookup_character()` 在 API 不可用時不 crash

當 `_fetch_from_api()` 拋出任何例外（網路超時、HTTP 5xx 等），
`lookup_character()` catch 後返回帶 `"error": "dictionary_unavailable"` 的合法 dict，
不向上傳遞例外。

**待查**：這個降級路徑只能在整合測試中驗證（需要 mock httpx）。
本 spec 測試只覆蓋純函數（`_parse_moe_response`、`_strip_markup`、`_has_real_definition`）
和 `ValueError` 輸入驗證。

### 2.6 `lookup_characters_batch()` 對無效字元 graceful（不中斷整個 batch）

批次查詢中，單一無效字元會被記錄但不中斷其餘字元的查詢；
回傳 list 長度等於輸入 list 長度。

## 3. 允許 / 禁止的改動

✅ **允許**
- 新增 source（目前只有 `"moedict"`），只要 parse 結果遵守 2.2 的結構
- 調整 `REQUEST_TIMEOUT` 常數

⛔ **禁止（會破壞契約）**
- 讓 `lookup_character()` 對空字串 pass-through（不 raise）——呼叫者依賴 ValueError 做輸入驗證
- 讓 `_parse_moe_response()` 在 `definitions` 為空時返回 `None`（前端做 `len()` 呼叫）
- 讓 `_has_real_definition()` 把讀音注記視為真定義（顯示 `(一)之讀音` 給學生看很奇怪）

## 4. 教學 / 產品脈絡

- 字典查詢在「生字練習」步驟中出現，學生可點選生字查看注音和例句
- 結果快取在 `DictionaryCache` table，避免對 moedict API 重複查詢
- `not_found: True` 的快取 entry 記住「這個字 moedict 沒有」，下次直接返回空結果而不重查

## 5. Open questions

- 待查：`lookup_character()` 在 API timeout 時的降級路徑（需要整合測試 with mock httpx）
- 待查：`DictionaryCache` 是否需要 TTL 過期機制（moedict 資料會更新嗎？）
