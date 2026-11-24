---
spec_id: teacher.lesson_review
module: lesson-review
title: 學習批閱 — 老師逐課批閱成績單（單關退回、評語、每關分數與總分）
stability: active
canonical_source: backend/app/services/lesson_review_service.py
owns_code:
  - backend/app/services/lesson_review_service.py
  - backend/app/models/lesson_review.py
  - backend/app/routes/teacher/teacher_lesson_review.py
  - backend/app/routes/learning/learning_reviews.py
spec_tests:
  - backend/specs/test_lesson_review_spec.py
related_issues: [4104, 4087, 4028]
last_reviewed: 2026-11-18
owner: young
---

# 學習批閱

> 給**人**讀的 spec。機器契約在 `backend/specs/test_lesson_review_spec.py`，
> 端點行為在 `backend/tests/test_lesson_review_4104.py`。

## 1. 在管什麼

班級管理的「學習批閱」分頁（跨班賽季旁邊）：

```
全班學生名片 → 某位學生「有開始」的課 → 那一課的成績單 + 批閱工具 → 送出給學生
```

老師可以對每一關：**退回重做**、寫**評語**、打**分數**（0–100），再打一個**總分**。
只有一顆「送出給學生」，退回、評語、分數一次送出（案主定調 2026-11-18）。
送出前可以存草稿，學生看不到草稿。

學生端看到：
- 上方關卡圈圈：退回的關卡**紅色**（優先於黃 / 綠）
- 成績單：退回的卡片紅色＋「老師退回，請重做」、最上方列出要重做的關；評語（楷書紅字）、紅筆分數；標題旁總分
- 圖書館選課卡片：紅筆圈起來的總分、「老師退回 N 關」

## 2. 不變式

| # | 規則 | 為什麼 |
|---|---|---|
| 1 | 批閱存在 `lesson_reviews` / `lesson_review_steps`，**不放** `learning_sessions.step_progress` | 那一欄學生的 `PUT /progress` 寫得到，放那裡學生能改分數、或被下一次存檔蓋掉 |
| 2 | 一筆批閱 = 學生 × 課（`story_slug`），不是 session | 重做一課會開新的 session（#2889 繼承進度），綁 session 一重做批閱就不見 |
| 3 | 學生只看得到**送出**的那一版（`sent_at` 不是 null）；`draft` 只回給老師 | 老師還在改的東西不能先跑到學生那邊 |
| 4 | 「有開始」= 任何一關有作答（`__meta.step_activity`、`step_data` 非空、或有完成的關），**只打開課文不算** | 進入課文時 bootstrap 就會建 session |
| 5 | 退回「已重做」= 退回之後，這一關的資料有變（含只訂正錯題）或重新完成 | 案主定調：只訂正也算重做 |
| 6 | `__meta.step_activity` 只有伺服器寫（`save_step_progress` 比對前後資料），重送一樣的資料不算 | 還原畫面時重存一樣的資料不能把退回解除；學生也偽造不了 |
| 7 | 再送出時，還在等學生重做的退回**保留原本的退回時間**；已重做的再勾退回 = 新的一次退回 | 老師改別關的評語不該把學生的重做歸零 |
| 8 | 讀：班級成員（擁有者 / 已接受的協同教師 / 系統管理員）；寫：擁有者或「編輯者」協同教師；學生必須在網址那個班 | 案主定調：協同教師可以批；「檢視者」只能看 |
| 9 | 分數 0–100 整數；評語上限 500 字，前後空白去掉 | |

## 3. 資料表（migration `g7h8lessonrev1`）

```
lesson_reviews       id, student_id, story_slug, classroom_id, teacher_id(最後送出的人),
                     total_score, sent_at, draft(JSONB), created_at, updated_at
                     UNIQUE(student_id, story_slug)
lesson_review_steps  id, review_id(CASCADE), step_key(帶輪次，如 comprehension#c9fyn),
                     returned, returned_at, comment, score, created_at, updated_at
                     UNIQUE(review_id, step_key)
```

## 4. 端點

| | 路徑 |
|---|---|
| 名片牆 | `GET /api/teacher/classrooms/{cid}/review/students` |
| 課文清單 | `GET /api/teacher/classrooms/{cid}/review/students/{sid}/lessons` |
| 批閱資料 | `GET …/lessons/{story_slug}` |
| 存草稿 | `PUT …/lessons/{story_slug}/draft` |
| 送出 | `POST …/lessons/{story_slug}/send`（`steps` 是完整清單，沒列到的刪掉）|
| 學生：圖書館 | `GET /api/learning/reviews` |
| 學生：一課 | `GET /api/learning/reviews/{story_slug}` |

## 5. 前端

- `frontend/src/pages/teacher/review/`（分頁、名片、課文清單、批閱畫面、`reviewDraft.ts`）
- `frontend/src/components/report/StepReportCards.tsx` 的 `review` / `renderCardTools`
- `frontend/src/components/report/TeacherMarks.tsx`（紅筆分數 Caveat、評語楷書）
- `frontend/src/hooks/useMyLessonReview.ts`（學生端；存檔後重抓，退回解除由後端算）
