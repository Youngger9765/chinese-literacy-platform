---
spec_id: content.lesson_loader
module: lesson-loader
title: 課文載入器 — 雙層合併 + strategy_exercise 鍵名容錯契約
stability: active
canonical_source: backend/app/services/lesson_loader.py + lesson_indexes.py + lesson_layer_loaders.py
owns_code:
  - backend/app/services/lesson_loader.py
  - backend/app/services/lesson_indexes.py
  - backend/app/services/lesson_layer_loaders.py
  - backend/app/services/lesson_code_normalization.py
spec_tests:
  - backend/specs/test_lesson_loader_spec.py
related_issues: [1666, 1889]
last_reviewed: 2026-06-02
owner: young
---

# 課文載入器：雙層合併 + strategy_exercise 鍵名容錯契約

> 這份是給**人**讀的 spec（方大哥 / 實習生 / AI 改課文 pipeline）。
> 機器可驗的契約在 `backend/specs/test_lesson_loader_spec.py`。
> 修課文 YAML 結構或 loader 邏輯前先讀這份。

## 1. 這個 module 在管什麼

課文資料分兩層：

| 層 | 路徑 | 說明 |
|----|------|------|
| **Layer-1** | `backend/data/lessons/L*.yml` | 原始 57 篇，有整數 id（1-57），有 DB FK（Text table） |
| **Layer-2** | `backend/data/lessons/_parsed_2026-05-01/*.yml` | 新解析的 158 篇；與 Layer-1 有 title 重疊 |

`build_all_lessons()` 合併兩層，Layer-1 保留 id/slug 回溯相容性，
Layer-2 enrichment fields（step_sequence、strategy_exercise、等）被 merge 進 Layer-1。

## 2. 核心不變式（Invariants）

### I-1: Layer-1 + Layer-2 總課文數 ≥ 50

`build_all_lessons()` 必須回傳至少 50 筆（目前實際值 ~165）。
若低於 50 → YAML 解析出錯，要立刻查。

### I-2: 所有課文都有 `title`、`_layer`、`id`、`grade` 欄位

每一筆 lesson dict 必須有這四個 key，且非空。

### I-3: `strategy_exercise` 接受 plural 鍵（`strategy_exercises`）

部分 G7 圖文整合 Layer-2 YAML 使用 `strategy_exercises:` (複數)。
loader 必須把 plural key merge 為 `strategy_exercise`（singular）。

驗證：`G7-L30.yml` 使用 plural key → loaded lesson 必須有 `strategy_exercise` 欄位。

### I-4: lesson_code 有重複 — 這是已知行為，不是 spec 要求「零重複」

**重要：** 由於 title 重複偵測基於精確字串比對，標點不同的 title pair
（例：Layer-1「拳力出擊──陳念琴」vs Layer-2「「拳」力出擊──陳念琴」）
會被視為不同 title，導致同一 `lesson_code` 出現在兩個 layer。

如 2026-06-02 實測，有 7 個 lesson_code 各出現 2 次（均為標點差異的 title pair）：
`G5-L11`, `G5-L12`, `G6-L18`, `G7-L15`, `G9-L10`, `G9-L15`, `G9-L17`

這是 **issue #1666 的殘留問題**，尚未完全解決。
**此 spec 顯式記錄此行為**，不用測試「零重複」（那會是壞的測試）。

### I-5: Layer-1 id 範圍 1-57，Layer-2 id 從 `LAYER2_ID_OFFSET = 1000` 開始

Layer-1 lesson `id` 必須是 1~57 的整數（來自 YAML L*.yml 的 lesson_number 欄位）。
Layer-2 lesson `id = display_order + LAYER2_ID_OFFSET`，最小值 >= 1000。
兩層 id 不重疊。

### I-6: `lessons_by_code` index 的 lesson_code 都是 `GN-LN` 格式

`build_indexes()` 的 `lessons_by_code` 只收有 `lesson_code` 欄位的課文，
且所有 lesson_code 符合 `G\d+-L\d+` 格式。

## 3. 待查事項

- **Duplicate lesson_code 的影響** — `lessons_by_code` dict 以後加入的 key 覆蓋先前；
  對於有重複 code 的 7 組課文，哪一層最後進入 index？（Layer-1 先 + Layer-2 後 → Layer-2 勝？）
  待驗。這影響 `/api/stories/{lesson_code}` 回傳的是哪份資料。待查。
- **Layer-2 YAML 中同時有 `strategy_exercise` 和 `strategy_exercises`** — 目前以
  singular 優先（`data.get("strategy_exercise") or data.get("strategy_exercises")`）。
  若兩者都有值，plural 被忽略。這是預期行為，但未有測試覆蓋。

## 4. worksheet_docx_url 自動 derive 機制（#2207）

`lesson_layer_loaders.py` 在 module 載入時讀取 `backend/data/worksheet_docx_codes.txt`（checked-in manifest，225 個 grade_code），建成 `_DOCX_CODES` frozenset（一次性讀取，不每課 re-read）。

**Priority 順序**（Layer-1 與 Layer-2 都適用）：
1. YAML 顯式 `worksheet_docx_url` 欄位 → 優先（7 個 demo 課不受影響）
2. grade_code 在 `_DOCX_CODES` 中 → derive `https://storage.googleapis.com/lingoleap-assets/worksheets/{grade_code}.docx`
3. 不在 manifest → `None`

**manifest 更新**：當 GCS 新上傳 docx 後，重新跑：
```bash
gsutil ls "gs://lingoleap-assets/worksheets/*.docx" | sed 's|.*/||; s|\.docx$||' | sort > backend/data/worksheet_docx_codes.txt
```
然後 commit `worksheet_docx_codes.txt`（不需改 loader）。

## 5. 反模式（不要做）

- ❌ 直接讀 `_LESSON_CACHE` 全域變數 — 用 `get_lesson_by_id()` API
- ❌ 修改 Layer-1 YAML 的 `lesson_number` 欄位 — 會打破 DB Text FK 映射
- ❌ 在 Layer-2 YAML 使用 id 1-999 — 會與 Layer-1 衝突（LAYER2_ID_OFFSET = 1000）
- ❌ 新增 `strategy_exercises` 複數 key 到 Layer-1 YAML — Layer-1 只認 singular；
  plural 支援只在 Layer-2 parsing 路徑
- ❌ 寫測試要求「所有 lesson_code 唯一」— 目前已知有 7 組重複（#1666 殘留）
