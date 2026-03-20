# Tier 4：架構理解

你已經能寫元件、串 API、修 bug 了。這一課拉高視角，看整個 LingoLeap 的架構。理解架構讓你在「要改某個功能」時，知道從哪裡動手、改一個地方會不會影響其他地方。

---

## 完整資料流：前端到後端到資料庫

每次使用者在 LingoLeap 做任何操作，資料的流向大概是這樣：

```
[瀏覽器] 使用者點「開始學習」
    ↓
[React] onClick 呼叫 handleStartLearning()
    ↓
[api.ts] createLearningSession({ studentId, storyId })
    ↓ HTTP POST /api/learning-sessions
[FastAPI] routes/learning.py 的 @router.post("/learning-sessions")
    ↓
[Service] learning_service.py 的 create_session()
    ↓
[SQLAlchemy] 寫入 PostgreSQL 的 learning_sessions 表
    ↓ 回傳 session_id
[FastAPI] 回傳 { session_id: 456, status: "active" }
    ↓ HTTP 200 response
[api.ts] return response.json()
    ↓
[React] setSession(data) → 畫面更新，進入 Intro 步驟
```

---

## 前端架構

```
App.tsx（路由 + 全局狀態）
  ├── AuthProvider（登入狀態，任何元件可用 useAuth() 讀取）
  ├── LearningNavProvider（學習步驟導航）
  ├── StepperNav（步驟導覽列，Presentational）
  └── Routes
       ├── /library → StoryLibrary（選課文）
       ├── /intro → IntroPage → Intro.tsx
       ├── /tutor → TutorPage → LiveTutor.tsx
       ├── /comprehension → ComprehensionPage → ComprehensionChat.tsx
       ├── /vocab → VocabPage → VocabPractice.tsx
       ├── /dictation → DictationPage → DictationPractice.tsx
       ├── /fullreading → FullReadingPage → FullReading.tsx
       ├── /report → ReportPage → AssessmentReport.tsx
       ├── /teacher → TeacherDashboard（教師功能）
       └── /admin → AdminDashboard（管理功能）
```

**資料流向**：`App.tsx` → `LearningLayout` → 各步驟頁面 → 各步驟元件

**服務層**：
```
frontend/src/services/
  ├── api.ts          （課文、學習記錄等主要 API）
  ├── authApi.ts      （登入、登出、token 管理）
  ├── assignmentApi.ts（作業相關 API）
  └── ...
```

---

## 後端架構

```
backend/app/
  ├── main.py                    （FastAPI 入口，載入所有 router）
  ├── routes/
  │    ├── learning.py            （學習記錄：POST /api/learning-sessions）
  │    ├── stories.py             （課文：GET /api/stories）
  │    ├── auth.py                （登入：POST /api/auth/login）
  │    ├── teacher.py             （教師功能：GET /api/teacher/...）
  │    ├── assignments.py         （作業：CRUD /api/assignments）
  │    └── gamification.py        （遊戲化：XP、成就）
  ├── services/
  │    ├── ai_service.py          （呼叫 Vertex AI Gemini）
  │    ├── socratic_agent.py      （蘇格拉底對話邏輯）
  │    ├── gamification_service.py（XP 計算、成就判斷）
  │    └── learning_path_service.py（個人化推薦）
  ├── models/
  │    ├── user.py                （User, UserRole 表）
  │    ├── learning.py            （LearningSession 表）
  │    └── story.py               （課文相關表）
  └── database.py                 （PostgreSQL 連線設定）
```

**資料流**：`routes/` 接收請求 → `services/` 處理業務邏輯 → `models/` 存取資料庫。

Routes 不直接操作資料庫，所有 DB 操作都透過 models。Services 不直接接觸 HTTP，那是 routes 的事。

---

## 完整資料流圖：「學生完成課文理解測驗」

這是 LingoLeap 最核心的功能之一。讓我們一步一步追蹤資料的流向：

```
[ComprehensionChat.tsx]
  1. 學生輸入答案，點「送出」
  2. handleSend() 被呼叫
  3. setIsLoading(true)

[api.ts] sendComprehensionChat()
  4. POST /api/comprehension-chat
     body: { session_id, message, story_id, conversation_history }

[FastAPI] routes/learning.py
  5. @router.post("/comprehension-chat")
  6. 驗證 token（Depends(get_current_user)）

[socratic_agent.py]
  7. evaluate_student_response()
  8. 呼叫 Vertex AI Gemini 評估答案
  9. 判斷 understood: true/false
  10. 回傳 { response_text, understood, question_count }

[FastAPI] 回傳 HTTP 200
  11. { message: "...", understood: true, question_count: 3 }

[api.ts]
  12. 解析 JSON 回傳

[ComprehensionChat.tsx]
  13. setConversation([...prev, { role: 'ai', text: response }])
  14. 如果 understood，setUnderstoodCount(prev + 1)
  15. 如果達到完成條件，onFinish(result) → 進入下一步
```

---

## 跨層的影響分析

改一個地方，會影響哪裡？

| 你改了什麼 | 可能影響的地方 |
|-----------|-------------|
| `api.ts` 的函式簽名 | 所有呼叫這個函式的元件 |
| `AppView` enum 新增一個值 | `StepperNav`、`App.tsx` 的路由、所有判斷 AppView 的邏輯 |
| 後端 API endpoint 路徑 | `api.ts` 對應的 fetch URL |
| 後端 API 回傳格式 | `api.ts` 的型別定義 + 轉換函式 |
| `AuthContext` 的 token 格式 | 所有 `useAuth()` 的元件 |

---

## 練習：畫出資料流

**任務**：選以下任一功能，用文字畫出完整的資料流（從使用者操作到資料庫，再回來）

**選項 A**：學生完成生字練習，分數被存到資料庫

**選項 B**：教師查看班級學習報告

**選項 C**：學生登入，token 被存到前端

格式：

```
[元件名] 使用者做了什麼
    ↓ 呼叫什麼函式
[api.ts] 送出什麼請求（HTTP method + URL + body）
    ↓
[FastAPI route] 哪個 endpoint 接收
    ↓
[Service] 處理什麼邏輯
    ↓
[DB] 讀/寫什麼資料表的什麼欄位
    ↓ 回傳什麼
[FastAPI] 回傳什麼 JSON
    ↓
[api.ts] 轉換成什麼格式
    ↓
[元件] 更新什麼 state → 畫面顯示什麼
```

寫完後給 Young 確認，他會告訴你哪些地方理解正確、哪些地方需要調整。
