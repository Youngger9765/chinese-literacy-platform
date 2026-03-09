# API 參考文件

**國語文閱讀學習平台（LingoLeap）**
版本 1.0 | 2026 年 3 月

---

## 概覽

**Base URL（Production）**：`{BACKEND_SERVICE_URL}`

**API 文件（Swagger UI）**：`{BASE_URL}/docs`

**OpenAPI Schema**：`{BASE_URL}/openapi.json`

### 認證方式

除標注「公開」的端點外，所有 API 需要在 Header 帶上 JWT Token：

```
Authorization: Bearer {access_token}
```

Token 在登入（`POST /auth/login`）成功後取得。

### 通用回應格式

**成功**：HTTP 200/201，回應 body 依各端點說明

**錯誤**：

```json
{
  "detail": "錯誤訊息"
}
```

常見 HTTP 狀態碼：

| 狀態碼 | 說明 |
|-------|------|
| 200 | 成功 |
| 201 | 建立成功 |
| 400 | 請求格式錯誤 |
| 401 | 未授權（Token 無效或過期）|
| 403 | 無權限（角色不符）|
| 404 | 資源不存在 |
| 409 | 衝突（例如 Email 已存在）|
| 422 | 驗證失敗（欄位格式不符）|
| 429 | Rate limit 超過 |
| 503 | AI 服務暫時不可用 |

---

## 目錄

- [認證 API](#認證-api)
- [課文 API](#課文-api)
- [學習 Session API](#學習-session-api)
- [AI 學習 API](#ai-學習-api)
- [班級管理 API](#班級管理-api)
- [教師儀表板 API](#教師儀表板-api)
- [指派管理 API](#指派管理-api)
- [家長 API](#家長-api)

---

## 認證 API

### POST /auth/register — 教師/學生註冊

**Request Body：**

```json
{
  "email": "teacher@school.edu.tw",
  "password": "SecurePass123",
  "name": "王老師",
  "role": "teacher",
  "copyright_confirmed": true
}
```

**Response 201：**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "email": "teacher@school.edu.tw",
    "name": "王老師",
    "role": "teacher"
  }
}
```

**密碼規則**：至少 8 位，需包含英文大寫、小寫與數字。

---

### POST /auth/login — 登入

**Request Body：**

```json
{
  "email": "teacher@school.edu.tw",
  "password": "SecurePass123"
}
```

**Response 200：**（同 /auth/register 的 TokenResponse）

**Rate Limit**：每 IP 每分鐘最多 10 次。

---

### POST /auth/forgot-password — 寄送密碼重設信

**Request Body：**

```json
{
  "email": "teacher@school.edu.tw"
}
```

**Response 200：**

```json
{
  "message": "如果該 Email 已註冊，將會收到重設密碼信件"
}
```

---

### POST /auth/reset-password — 重設密碼

**Request Body：**

```json
{
  "token": "reset-token-from-email",
  "new_password": "NewSecurePass123"
}
```

Token 有效期：1 小時。

---

### POST /auth/verify-email — 驗證 Email

**Request Body：**

```json
{
  "token": "verification-token-from-email"
}
```

---

## 課文 API

### GET /api/stories — 取得課文列表（公開）

**Query Parameters：**

| 參數 | 類型 | 說明 |
|------|------|------|
| `grade` | string | 年級篩選（例如：`4`、`5`、`6`）|
| `search` | string | 關鍵字搜尋（課文標題）|
| `limit` | int | 每頁數量（預設 20，最大 100）|
| `offset` | int | 偏移量（預設 0）|

**Response 200：**

```json
{
  "stories": [
    {
      "id": "grade4-lesson1",
      "title": "春天的早晨",
      "grade": "4",
      "author": "王文興",
      "word_count": 320,
      "preview": "春天的早晨，陽光透過窗戶..."
    }
  ],
  "total": 57,
  "limit": 20,
  "offset": 0
}
```

---

### GET /api/stories/{story_id} — 取得課文詳情（公開）

**Response 200：**

```json
{
  "id": "grade4-lesson1",
  "title": "春天的早晨",
  "grade": "4",
  "author": "王文興",
  "content": "完整課文內容...",
  "paragraphs": [
    {
      "index": 0,
      "text": "春天的早晨，陽光透過窗戶..."
    }
  ],
  "vocabulary": [
    {
      "character": "晨",
      "zhuyin": "ㄔㄣˊ",
      "definition": "早上",
      "stroke_count": 11
    }
  ]
}
```

---

## 學習 Session API

### POST /learning/sessions — 建立學習 Session

**Request Body：**

```json
{
  "story_slug": "grade4-lesson1"
}
```

**Response 201：**

```json
{
  "id": 123,
  "student_id": 42,
  "story_slug": "grade4-lesson1",
  "status": "in_progress",
  "current_step": 1,
  "created_at": "2026-03-09T10:00:00Z"
}
```

---

### GET /learning/sessions — 列出我的學習 Sessions

**Query Parameters：**

| 參數 | 類型 | 說明 |
|------|------|------|
| `limit` | int | 每頁數量（預設 20）|
| `offset` | int | 偏移量（預設 0）|

---

### GET /learning/sessions/{session_id} — 取得 Session 詳情

---

### GET /learning/sessions/{session_id}/report — 取得學習診斷報告

**Response 200：**

```json
{
  "id": 123,
  "story_slug": "grade4-lesson1",
  "overall_accuracy": 0.94,
  "words_per_minute": 135,
  "errors": [
    {
      "character": "晨",
      "error_type": "substitution",
      "student_read": "農",
      "count": 2
    }
  ],
  "paragraph_scores": [
    {
      "paragraph_index": 0,
      "accuracy": 0.96
    }
  ],
  "ai_analysis": "整體表現良好...",
  "recommendations": ["建議加強生字「晨」的練習"]
}
```

---

### PATCH /learning/sessions/{session_id} — 更新 Session 進度

**Request Body：**

```json
{
  "current_step": 3,
  "status": "in_progress"
}
```

---

## AI 學習 API

### POST /learning/sessions/{session_id}/analyze-reading — 朗讀分析

**Request Body：**

```json
{
  "paragraph_index": 0,
  "transcript": "春天的早晨，陽光透過窗戶照進來..."
}
```

**Response 200：**

```json
{
  "accuracy": 0.94,
  "errors": [
    {
      "position": 15,
      "expected": "晨",
      "actual": "農",
      "error_type": "substitution"
    }
  ],
  "diff_result": [
    {"type": "correct", "text": "春天的早"},
    {"type": "error", "expected": "晨", "actual": "農"},
    {"type": "correct", "text": "，陽光..."}
  ]
}
```

---

### POST /learning/sessions/{session_id}/socratic/start — 開始蘇格拉底對話

**Response 200：**

```json
{
  "session_key": "socratic-session-uuid",
  "question": "這篇文章的主角為什麼選擇在春天的早晨出門？",
  "question_number": 1,
  "total_questions": 5,
  "phase": "warmup"
}
```

---

### POST /learning/sessions/{session_id}/socratic/respond — 回答蘇格拉底問題

**Request Body：**

```json
{
  "session_key": "socratic-session-uuid",
  "student_response": "因為他喜歡春天的天氣，空氣比較清新..."
}
```

**Response 200：**

```json
{
  "understood": true,
  "feedback": "很好！你掌握了文章的核心情境。",
  "next_question": "那麼你覺得作者想透過這段描寫傳達什麼感受？",
  "question_number": 2,
  "is_complete": false
}
```

**注意**：AI 錯誤時 `understood` 永遠為 `false`（不自動讓學生通過）。AI 連續錯誤 3 次 → HTTP 503。

---

### POST /learning/sessions/{session_id}/vocab/generate-example — 生字造句範例

**Request Body：**

```json
{
  "character": "晨",
  "story_slug": "grade4-lesson1"
}
```

**Response 200：**

```json
{
  "character": "晨",
  "examples": [
    "清晨的空氣特別清新。",
    "我每天早晨六點起床。"
  ]
}
```

---

### GET /learning/students/{student_id}/dashboard — 學生進度儀表板

**Response 200：**

```json
{
  "student_id": 42,
  "completed_stories": 5,
  "in_progress_stories": 2,
  "total_study_minutes": 180,
  "average_accuracy": 0.91,
  "accuracy_trend": [
    {"date": "2026-03-01", "accuracy": 0.88},
    {"date": "2026-03-08", "accuracy": 0.91}
  ]
}
```

---

## 班級管理 API

### POST /classrooms — 建立班級

**Request Body：**

```json
{
  "name": "六年二班",
  "school_id": 1,
  "academic_year": "2025-2026",
  "semester": "2"
}
```

**Response 201：**

```json
{
  "id": 10,
  "name": "六年二班",
  "join_code": "ABC123",
  "teacher_id": 1,
  "created_at": "2026-03-09T10:00:00Z"
}
```

---

### GET /classrooms — 列出我的班級

---

### GET /classrooms/{classroom_id} — 取得班級詳情（含成員列表）

---

### POST /classrooms/join — 學生加入班級

**Request Body：**

```json
{
  "join_code": "ABC123"
}
```

---

### POST /classrooms/{classroom_id}/students/batch — 批次匯入學生

**Request Body（multipart/form-data）：**

- `file`：CSV 檔案（欄位：姓名、Email）

**Response 200：**

```json
{
  "created_count": 28,
  "errors": [
    {
      "row": 5,
      "email": "invalid-email",
      "error": "Email 格式不正確"
    }
  ]
}
```

---

### GET /classrooms/csv-template — 下載學生匯入 CSV 範本

---

## 教師儀表板 API

### GET /teacher/classrooms — 教師管理的班級列表

---

### GET /teacher/classrooms/{classroom_id}/overview — 班級學習概況

**Response 200：**

```json
{
  "classroom_id": 10,
  "active_students": 28,
  "stuck_students": [
    {
      "student_id": 42,
      "student_name": "王小明",
      "stuck_points": [
        {
          "type": "character_error",
          "character": "晨",
          "error_count": 4
        }
      ]
    }
  ],
  "recent_activity": {
    "active_this_week": 22,
    "completed_this_week": 5
  }
}
```

---

### GET /teacher/classrooms/{classroom_id}/heatmap — 學習熱度圖資料

**Response 200：**

```json
{
  "students": [
    {
      "student_id": 42,
      "student_name": "王小明",
      "story_progress": {
        "grade4-lesson1": {
          "step1": "completed",
          "step2": "completed",
          "step3": "in_progress",
          "step4": "not_started",
          "step5": "not_started",
          "step6": "not_started"
        }
      }
    }
  ]
}
```

---

### POST /teacher/students/{student_id}/tags — 新增學生標籤

**Request Body：**

```json
{
  "tag_name": "需要關注",
  "color": "red"
}
```

---

### GET /teacher/classrooms/{classroom_id}/export — 匯出班級學習報表（CSV）

**Response**：`text/csv` 格式下載

---

## 指派管理 API

### POST /assignments — 建立課文指派

**Request Body：**

```json
{
  "classroom_id": 10,
  "story_slug": "grade4-lesson1",
  "due_date": "2026-03-31",
  "note": "請在月底前完成"
}
```

---

### GET /assignments — 列出指派（依班級或學生）

**Query Parameters：**

| 參數 | 說明 |
|------|------|
| `classroom_id` | 篩選特定班級的指派 |
| `student_id` | 篩選特定學生的指派 |

---

## 家長 API

### GET /parents/children — 取得連結的孩子列表

---

### GET /parents/children/{student_id}/progress — 查看孩子學習進度

**Response 200：**（同學生儀表板格式）

---

### GET /parents/children/{student_id}/sessions — 查看孩子的學習 session 記錄

---

## API 開發注意事項

### Rate Limiting

| 端點類型 | 限制 |
|---------|------|
| 認證端點（login/register）| 每 IP 每分鐘 5-10 次 |
| AI 端點（socratic/analyze）| 每用戶每分鐘 5-10 次 |
| 一般 CRUD | 無明確限制 |

### Socratic Session 生命週期

蘇格拉底對話 session 儲存在 backend 的 in-memory dict。

**重要限制**：
- Cloud Run 重啟後 session 消失
- 前端需捕捉 HTTP 422 "session not found" 並重新建立 session
- 見 `frontend/src/services/api.ts` 中的 `SessionExpiredError` 處理

### 完整 API 文件

啟動 backend 後，在瀏覽器開啟 `http://localhost:8000/docs` 可查看完整的 Swagger UI 互動式文件，包含所有端點的詳細 schema 和測試功能。
