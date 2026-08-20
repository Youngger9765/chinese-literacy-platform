---
spec_id: omo.upload.flow
module: omo-upload
title: OMO 紙本上傳 — 拍照識課 + AI 批改端到端流程
stability: active
canonical_source: omo-upload-implementation-spec-2026-05-02.md
owns_code:
  - backend/app/services/omo_upload_service.py
  - backend/app/services/omo_identifier.py
  - backend/app/services/omo_grader.py
  - backend/app/services/omo_scoring.py
  - backend/app/services/omo_storage.py
  - backend/app/services/omo_question_schema.py
  - backend/app/services/omo_state_service.py
  - backend/app/services/omo_jobs.py
  - backend/app/services/omo_lesson_catalog.py
  - backend/app/services/omo_title_matching.py
  - backend/app/routes/omo/upload.py
  - backend/app/routes/omo/grade.py
  - backend/app/routes/omo/lifecycle.py
  - backend/app/models/omo_upload.py
  - frontend/src/components/omo/OmoUpload.tsx
  - frontend/src/components/omo/OmoIdentifyResult.tsx
  - frontend/src/components/omo/OmoResultPage.tsx
  - frontend/src/services/omoApi.ts
owns_data: []  # 一修的 _parsed_2026-05-01/ 已封存（#2683）。二修抽取器補齊對應欄位前，
               # 這個 module 不擁有任何資料檔 —— 跟它的 spec 契約現況一致，
               # 登記在 data/curriculum_qa/content_known_gaps.yaml#locks_removed_with_the_first_edition
spec_tests: []
related_issues: []
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-01
owner: young
---

# OMO 紙本上傳：拍照識課 + AI 批改端到端流程

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。它記錄了 OMO 功能的設計意圖、
> 唯一真相、允許/禁止的改動，以及目前已知的 drift。
> 機器可驗的契約如果未來有，會放在 `backend/specs/test_omo_upload_spec.py`。
> 改動 OMO 上傳、識課、批改流程前先讀這份。

## 1. 這個 module 在管什麼

OMO（紙本 → 拍照 → AI 批改）功能的完整端到端流程：學生把寫完的紙本學習單拍照
上傳，AI **自動辨識這是哪一課**（不需要學生先選課），然後逐題抽出學生手寫答案、
對照 lesson YAML 的標準答案批改，最後回傳批改結果給學生看。

這個功能的教學法動機（來自 5/1 專家會議 + 林校長共識）：
- **紙本書寫保留**：體育班學生意志力較弱，紙本書寫有真實感
- **不重複做**：學生在紙上已寫，平台不要要求他重打一次（曾教授：「不要做重複的事」）
- **數位補紙本做不到的**：自動批改、班級數據聚合、跨課文模式分析

## 2. 唯一真相（canonical source）

**`backend/data/lessons/_parsed_2026-05-01/**/*.yml` 的 `fill_in_blank` / `vocab_bank` /
`multiple_choice` 欄位是批改的 ground truth。** AI 從照片抽出的學生答案要對照這些
欄位才能判對錯。識課邏輯靠 YAML 的 `title` 欄位做 fuzzy match。

字母作答的對應規則由 `vocab_bank` 決定（詳見 `omo-assessment` module INTENT.md）。

## 3. 系統分層與端到端狀態機

識課和批改是非同步 job，狀態寫在 `OMOUpload.status`：

```
pending → identified → grading → done / error
```

| 狀態 | 觸發 | 後續 |
|------|------|------|
| `pending` | 學生上傳照片，識課 job 啟動 | 等 AI OCR 找 title |
| `identified` | 識課完成，top-3 candidates 呈現給學生確認 | 學生點確認觸發 `grading` |
| `grading` | 學生確認課程，批改 job 啟動 | Gemini 結構化輸出抽每題答案 |
| `done` | 批改完成，`answers` JSONB 已寫入 | 前端渲染批改結果 |
| `error` | 任一 job 失敗 | 前端顯示錯誤提示，可重試 |

## 4. 識課邏輯（identify_lesson_from_image）

從照片識課的可信度層次（降序）：

| 策略 | 可信度 | 條件 |
|------|--------|------|
| title 直接 match（Levenshtein < 3）| 95% | OCR 能清楚抓到標題大字 |
| title 含 70% 字元 | 85% | 標題部分遮蔽 |
| story_text 前 100 字 match | 80% | 封面沒標題，但內文開頭能比對 |
| keyword overlap（vocabulary 詞）| 60% | 最低信心，給 top-3 兜底 |

**識課失敗處理**：
- 拍糊 / OCR 抓不到 title → 用 story_text snippet 退一步比對
- top-3 confidence 都偏低（< 60%）→ 前端強制學生手動 dropdown 選課

## 5. 批改邏輯（extract_answers_from_image）

AI 批改 = 照片 + 該課 yml schema → per-question 學生答案 + 對錯：

- `fill_in_blank` 題型：對 `vocab_bank`（字母題）或直接手寫內容比對
- `multiple_choice` 題型：抽學生圈的 A/B/C/D，對 `answer` 欄位
- 每題加 `ai_confidence`（0-1），< 0.7 → 前端標「AI 不確定，請確認」

## 6. 隱私設計

- 照片存 GCS bucket（`lingoleap-omo-uploads`），signed URL 1 小時 TTL
- GCS lifecycle：90 天後自動刪除
- `DELETE /api/omo/{session_id}` 讓學生主動刪除
- `OMOUpload` table 不存照片原始內容，只存 GCS signed URL

## 7. 允許 / 禁止的改動

✅ **允許**
- 改 `omo_identifier.py` 的 fuzzy match 閾值（不影響批改邏輯）
- 加新 route 到 `backend/app/routes/omo/`（先看現有 upload / grade / lifecycle）
- 改 `omoApi.ts`（前端 API wrapper，不影響 DB schema）
- 增加 `ai_confidence` 的顯示門檻（UX 決策）

⛔ **禁止（會破壞 lesson data 或 DB schema 完整性）**
- 改 `OMOUpload` DB schema 而不跑 Alembic migration（會炸 Cloud SQL）
- 直接改 `backend/data/lessons/_parsed_2026-05-01/` 的 yml 而不經過 content pipeline（lesson data 的 SOT 是 docx/Excel，不是手動編 yml）
- 用 `vocabulary` 清單順序推字母（違反 `omo-assessment` module 的契約，詳見該 INTENT.md）
- 移除 `ai_confidence` 欄位（前端依賴它標「AI 不確定」）
- 讓 GCS bucket 變 public read（學生手寫個資）

## 8. 目前已知的 drift（2026-06-01 量測）

- `omo_question_schema.py` 的 `_resolve_letter_answer()` 用 `vocabulary[index]` 推字母，違反
  `vocab_bank` SOT 契約（詳見 `omo-assessment` INTENT.md §4，tracked in issue 2015）
- 識課準確率目標：7/1 demo gate = ≥ 90% top-1 命中率，尚未有正式量測數字
- AI 抽答案準確率目標：≥ 80%（fill_in_blank + MCQ 平均），尚未有正式量測數字

## 9. 教學 / 產品脈絡（pytest 寫不進去、但 AI 要知道）

- OMO 是 7/1 demo 的「壓箱寶」，60 秒現場展示。AI 自動識課是最強視覺化 AI 能力的示範
- **不要在批改後讓學生重打答案**：學生已在紙上寫，平台不該要求重工
- override button（學生說 AI 抽錯）是必含功能，override 記錄回 server 供 prompt 改善
- 老師後台（OMO review）是 7/2+ 延伸功能，不在 7/1 demo scope

## 10. Open questions

- GCS bucket region 是否要跟 Cloud Run 同 asia-east1（跨 region 流量費）？
- 單張學習單最大上傳張數？（3 張？5 張？）
- 識課準確率 < 90% 時的 fallback UX：強制 dropdown 還是 AI 還是繼續辨識？
- 老師批改 override 的 DB 欄位（`teacher_override` JSONB）何時實作？
- AI 抽錯的 override 資料是否納入 fine-tuning pipeline？

## 11. 怎麼維護這份 spec（meeting-to-spec capture）

這份 spec 的更新觸發點是：
1. **7/1 demo review 後**：識課準確率 / 批改準確率實測數字出來，填回 §8
2. **教授 6/15 dry run 後**：如有 UX 反饋改動識課或批改流程，更新 §3-§5
3. **任何改動 OMO 核心邏輯前**：先確認 §7 的允許/禁止清單沒有衝突
