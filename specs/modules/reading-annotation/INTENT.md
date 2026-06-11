---
spec_id: reading.annotation.persistence
module: reading-annotation
title: 做記號持久化 — AnnotationEntry DB 契約 + 端點規格
stability: active
canonical_source: backend/app/models/annotation.py
owns_code:
  - backend/app/models/annotation.py
  - backend/app/routes/learning/learning_annotations.py
  - frontend/src/services/learning/annotationApi.ts
owns_data: []
spec_tests:
  - backend/specs/test_reading_annotation_spec.py
related_issues:
  - 2070
source_meetings: []
last_reviewed: 2026-06-05
owner: young
---

# Reading Annotation Persistence — 做記號持久化規格

> 給**人**讀的 spec。機器契約在 `backend/specs/test_reading_annotation_spec.py`。
> 改 annotation model / endpoint / frontend wiring 前先讀這份。

## 1. 這個 module 在管什麼

`ReadingAnnotation.tsx` (reading-annotation step) 中學生劃的記號（❓不懂 / 💛重要）
原本只存在 `localStorage`。本 module 定義將其同步到 DB 的規格：

- **DB SOT**：`annotation_entries` 表（每筆 = 一個記號）
- **localStorage**：保留為 offline cache / 首屏立即顯示
- **同步方向**：mount 時 DB → Redux（覆蓋 localStorage snapshot）；每次變更 debounce 800 ms → DB

## 2. AnnotationEntry schema

| Column | Type | 規則 |
|--------|------|------|
| `id` | SERIAL PK | server 自動產生 |
| `session_id` | FK → learning_sessions | CASCADE DELETE; `index=True` |
| `paragraph_index` | INTEGER | 0-based, `>= 0` |
| `char_start` | INTEGER | `>= 0` |
| `char_end` | INTEGER | `> char_start` |
| `annotation_type` | VARCHAR(20) | "unknown" 或 "important" |
| `client_id` | VARCHAR(64) nullable | 前端產生的 `ann-<ts>-<N>` |
| `created_at` | TIMESTAMPTZ | server_default=NOW() |

## 3. API 設計

### PUT `/api/learning/sessions/{session_id}/annotations`
- 全量替換（delete-insert atomic）
- Payload: `{ annotations: AnnotationIn[] }`
- Input cap: max 500 per session
- Auth: `get_current_user` + 只能存取自己的 session
- Returns: 儲存後的所有記號（含 server id）

### GET `/api/learning/sessions/{session_id}/annotations`
- 回傳該 session 所有記號，按 (paragraph_index, char_start) 排序
- Auth: 同上

## 4. 前端同步規則

1. **mount**: `loadAnnotations(dbSessionId)` 
   - DB 有資料 → dispatch `INIT`（覆蓋 localStorage snapshot，reset undoStack）
   - DB 空 → 保留 localStorage 資料（學生可能是第一次，或 offline 開始的）
2. **annotations 變更**: debounce 800 ms → `saveAnnotations(dbSessionId, payload)`
   - `dbHydratedRef` = false 期間（mount DB load 未完成）→ 不觸發 save
   - save 失敗 → console.warn，localStorage 副本仍然在

## 5. 授權邊界

- 學生只能存取自己的 session（`_get_owned_session` 確認 `session.student_id == current_user.id`）
- 沒有 teacher 讀取端點（#2070 範圍只做 student 端，teacher dashboard 留後續）

## 6. 開放問題

- [ ] Teacher dashboard 讀取 annotation（#2070 backlog，後續 issue）
- [ ] 完成後的 session 是否允許覆寫（目前允許，step_progress 的 completed 限制不適用於 annotations）
