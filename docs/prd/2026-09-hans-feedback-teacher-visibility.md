# Hans 現場回饋 — 教師端可見性（#3027 學生視角預覽 + #3025 即時監控儀表板）

> 來源：Hans (@66tarosan) 2026-09-01 開的兩則 issue，皆源自 2026-08~09 三場現場教師 demo。
> 本文件範圍**只涵蓋 #3027 與 #3025**。#3024 / #3028 / #3026 由另一位 agent 處理，不在此文件內。

標記說明：**已驗證** = 我實際跑過（curl / 瀏覽器操作 / 真測試套件 / mutation 驗證）；**未驗證** = 推論或未執行到的部分，都會明講「未驗證」。

**狀態**：#3027 已規劃並**實作完成**（Young 明確核准「可以做就快點做」後，本 session 一路做到底，見下方 §1.6）。#3025 維持規劃階段——它的兩個開放問題是產品決策，不是技術問題，等 Young 回答。

---

## 目錄

1. [#3027 老師看不到學生視角](#3027-老師看不到學生視角)
   - 1.1 [對 issue 主張的查證結果](#11-對-issue-主張的查證結果)
   - 1.2 [實作機制：唯讀「以學生身分預覽」](#12-實作機制唯讀以學生身分預覽)
   - 1.3 [寫入路徑清單 + 各自的阻擋方式](#13-寫入路徑清單--各自的阻擋方式)
   - 1.4 [BDD 驗收條件與測試證據](#14-bdd-驗收條件與測試證據)
   - 1.5 [規模估計 vs 實際花費](#15-規模估計-vs-實際花費)
   - 1.6 [實作紀錄：TDD + mutation 驗證 + CI 插電](#16-實作紀錄tdd--mutation-驗證--ci-插電)
2. [#3025 教師即時監控儀表板](#3025-教師即時監控儀表板)
   - 2.1 [現況查證](#21-現況查證)
   - 2.2 [「有沒有亂猜」候選定義](#22-有沒有亂猜候選定義)
   - 2.3 [即時性選項與成本](#23-即時性選項與成本)
   - 2.4 [需要 Young 決定的問題](#24-需要-young-決定的問題)

---

## #3027 老師看不到學生視角

### 1.1 對 issue 主張的查證結果

Issue 主張：「依學生程度建議關聯課程」**已經完整實作、前後端都通**，只是掛在學生自己的首頁，老師走不到。

**已驗證（讀 code 確認邏輯）：**

| 主張 | 檔案位置 | 確認結果 |
|---|---|---|
| 後端端點存在 | `backend/app/routes/learning/learning_recommendations.py:81-108` `GET /learning/recommendations/{student_id}` | 存在。回應 schema `StoryRecommendationsResponse`（`recommendations[]` + `total`） |
| 授權：老師可查特定學生 | 同檔 `:100` 呼叫 `verify_student_access(student_id, current_user, db)`，實作在 `backend/app/routes/learning/_helpers.py:39-80` | **允許三種身分**：本人 / 該學生所屬班級的授課老師（`Classroom.teacher_id == current_user.id` join `ClassroomStudent`）/ 已連結的家長。無 admin 全域 bypass |
| 演算法邏輯 | `backend/app/services/learning_path_service.py:62-253` `recommend_next_stories()` | 純規則演算法（非 LLM）：抓 60 天內 `LearningSession` 估計年級、抓 `CharacterError` 找弱字、對 175 課逐一計分（難度符合 +30、弱字覆蓋 +5/字上限 +25、重複文體 -10、近期讀過 -15、已精熟 ≥80% 準確率的課直接排除），回傳分數排序前 N 筆 |
| 零歷史資料時是否會空手 | 同檔 `:127-133` | 不會。無任何 session 歷史時預設 `student_grade = 4`，照樣對全部 175 課計分回傳 —— 對剛入班、從沒上過課的學生也有結果 |
| 前端元件掛載位置 | `frontend/src/pages/student/StudentHome.tsx:203-210`（`<section aria-labelledby="recommended-title">` 內 `<RecommendedStories />`），路由 `/student` | 確認掛載，issue 給的行號（原始寫 `:210`）精確命中 |
| 元件如何取資料 | `frontend/src/components/student/RecommendedStories.tsx:102-131` | **關鍵細節**：元件內部用 `const { user } = useAuth(); const userId = user?.id;` —— 永遠查詢「目前登入者自己」，**沒有接受外部 `studentId` prop 的能力**。這代表老師不能直接把這顆元件原封不動搬到教師頁面用，因為它會查到老師自己的 id，不是目標學生的 |
| 呼叫函式本身是否通用 | `frontend/src/services/progressApi.ts:155-165` `getStoryRecommendations(token, studentId, limit)` | **通用**，接受任意 `studentId` 參數，非硬編碼。真正限制授權的是後端 `verify_student_access`，不是這支函式。**這個通用性後來成為實作的關鍵**——見 1.2 |

**已驗證（真跑 staging，非只讀 code）：**

用 gstack headless browse（非可見視窗）在 staging（`https://lingoleap-frontend-staging-958347263320.asia-east1.run.app`）操作：

1. `goto /login` → 點擊「教師 李老師」demo 登入鈕 → 觀察到後端 `POST /api/auth/login` 冷啟動約 12-15 秒後成功，瀏覽器導向 `/teacher-home`，`localStorage.lingoleap_token` 寫入真 JWT。
2. 用該教師 token 呼叫 `GET /api/teacher/classrooms` → 200，回傳兩班（`三年甲班` id=1、`五年乙班` id=2）。
3. 呼叫 `GET /api/teacher/classrooms/2/progress` → 200，回傳該班學生 `{"student_id":6,"student_name":"小美",...}`。
4. **用該教師的 token（未換身分、未偽造任何東西）直接呼叫 `GET /api/learning/recommendations/6?limit=5`** → **200**，回傳 5 筆真實推薦（`十秒的背後`、`動物的生存妙招`…，每筆附 `difficulty_match_score` 與中文理由）。

**結論（已驗證，非推論）**：issue 的核心主張成立 —— 這個功能本身完全能跑，且授權模型早已支援「老師查詢特定學生」這個呼叫模式，**不需要任何新的後端邏輯**就能讓老師拿到某個學生的推薦清單。缺的只是「老師端有沒有一個入口去發這個請求、並把結果渲染出來」——這正是本次實作補的那一塊。

### 1.2 實作機制：唯讀「以學生身分預覽」

#### 為什麼不能只是「把學生元件搬到教師頁面」

上面 1.1 已經證明：**對於 GET 端點**（推薦、進度儀表板等），老師今天就能直接用自己的 token + 目標 `student_id` 查到資料，`verify_student_access` 已經在做正確的授權判斷。如果只是要重建「老師看到的推薦課文清單」這種**單一資料卡片**，最小改法是：教師頁面新建一顆元件，直接呼叫 `getStoryRecommendations(teacherToken, targetStudentId, 5)`，完全不需要「假裝是學生」。

但 issue 的範圍建議寫的是「以學生身分預覽」——也就是老師要看到的不只是一張卡片，而是**學生看到的整個介面**。這個規模下，逐一改寫每個學生元件讓它們都接受 `studentId` override prop，是一條**要改遍全部學生元件、且以後每加一個新學生功能都要記得再加一次 override**的路，維護成本高、容易漏改。

#### 實作機制：範圍受限的「預覽 token」+ 後端統一寫入攔截

**核心設計**（已實作，非提案）：老師發起預覽時，後端發一張**短效期（20 分鐘）、標記為 preview 的 JWT**，其 `sub` claim 指向**目標學生的 user id**（讓所有既有的、寫死 `current_user.id` 的讀取邏輯不必修改就能正確運作），但額外帶 `preview: true` 與 `preview_by: <teacher_id>` claim。前端用這張 token 打開一個獨立的「預覽模式」畫面（不覆蓋老師自己在 `localStorage` 裡的真實 session token，透過 React Router 的 navigation `state` 傳遞、只存在該頁的元件記憶體裡，畫面頂部顯示醒目的「你正在以 OOO 身分唯讀預覽，不會寫入」提示列 + 一鍵離開按鈕）。

真正的安全邊界**不是**放在前端（前端 banner 只是 UX 提示，使用者不可能被前端擋住），而是**後端一個集中的 middleware**：

**`PreviewModeWriteGuardMiddleware`**（`backend/app/main.py`，緊接在既有的 `SecurityHeadersMiddleware` :81 / `RequestLoggingMiddleware` :163 / `GlobalRateLimitMiddleware` :268 之後註冊，沿用同樣的 `BaseHTTPMiddleware` 寫法）：

```
dispatch():
  1. 若路徑不是 /api/* 或方法是 GET/HEAD/OPTIONS → 直接放行
  2. 解析 Authorization header，用既有 decode_token()（backend/app/auth/jwt.py）解 JWT
  3. 解不開（過期/偽造/沒帶）→ 不介入，讓後面的 get_current_user 正常回 401
     （這一步刻意設計成「絕不能把真的認證失敗，包裝成預覽模式訊息」）
  4. 只有成功解出 payload 且 payload.preview is True → 回 403「預覽模式為唯讀，不允許寫入」
```

**為什麼選這個設計，而不是逐一修改每個寫入端點**：後端 `/learning/*` 底下光是 POST/PUT/PATCH/DELETE 就有 **26 個端點**（見 1.3），全部靠同一個模式（`current_user.id` 決定寫入對象）。逐一在每個 handler 裡加「如果是 preview 就擋」，一來要改 26 處、容易漏改，二來**未來新增的寫入端點不會自動被涵蓋**——這正是「漏掉一個就是這個功能的全部風險」（mandate 原文）最可能發生的地方。用一個掛在最外層、對 HTTP method 做判斷的 middleware，新端點無論何時加入都自動被保護，不需要開發者記得加一行檢查。

**授權判斷沿用既有機制，不新造一套**：發預覽 token 的端點（`POST /teacher/students/{student_id}/preview-token`，`backend/app/routes/teacher/teacher_preview.py`）自建一個**比 `verify_student_access` 更窄**的檢查 `_verify_teacher_of_student()`——只接受「該老師任教包含這個學生的班級」，不像 `verify_student_access` 那樣還接受「本人」與「已連結家長」（自己預覽自己、家長預覽小孩都不在這次範圍內）。查詢方式與 `verify_student_access` 完全同構（`Classroom.teacher_id == current_user.id` join `ClassroomStudent`），**不使用任何全域 admin flag 當捷徑**——`crm memory` 明確記過 `is_admin` 在這個 codebase 裡**不是**安全的全域 bypass，本功能延續同一個紀律：一律走「老師 ↔ 學生班級關係」的查詢。

**已驗證（實測，非推論）的邊界情況**：對一個不存在的 `student_id` 發起預覽，回應是 **403**（不是 404）——因為授權檢查先跑，而一個不存在的學生天生不可能是任何老師班上的學生。這是刻意的 fail-closed 設計：不讓呼叫者從錯誤碼分辨出「這個 id 存在但不是你的學生」跟「這個 id 根本不存在」，兩者拿到一樣的 403。

**已驗證（實測解決，原本標未驗證的風險）**：規劃階段讀 code 時發現一個潛在風險——`GET /learning/students/{student_id}/dashboard`（`backend/app/routes/learning/learning_dashboard.py:59-166`）內部呼叫 `_get_or_create_streak()`（`backend/app/services/gamification_service.py:56-62`），該函式在找不到既有連續天數紀錄時會 `db.add()` + `db.flush()`，但這個 handler 從頭到尾沒有 `db.commit()`。當時只能標「未驗證」猜測這筆寫入不會真的落地。**本次實作用真測試套件直接驗證**（`backend/tests/test_preview_mode_write_guard.py::test_preview_token_dashboard_get_does_not_create_streak_row`）：在呼叫前後各查一次 `StudentStreak` 表的列數，證實呼叫這支 GET **不會**新增任何一列——`SessionLocal(autocommit=False)` 加上 `get_db()` 只有 `finally: db.close()`（沒有任何 commit），讓這筆 flush 過的資料在 session 關閉時被隱含 rollback 掉。這條測試本身就是這個行為的永久回歸鎖：未來若有人在別處補一行 `db.commit()`，這條測試會立刻變紅。

### 1.3 寫入路徑清單 + 各自的阻擋方式

以下是 `backend/app/routes/learning/*.py` 與 `toolbox.py` 底下**全部** POST/PUT/PATCH/DELETE 端點（`grep -rn '@router\.\(post\|put\|patch\|delete\)('` 的完整結果，共 26 個），按功能分組列出。「阻擋方式」欄位全部一致：**只要走 preview token，method-based middleware 就會擋** —— 這正是選這個設計而非逐一打補丁的原因，且已用最低權限身分（被預覽的學生本人）跑過測試驗證（見 1.4）。

| 分類 | 端點 | 檔案:行 | 寫入對象判斷方式 |
|---|---|---|---|
| Session 生命週期 | `POST /learning/sessions` | `sessions_bootstrap.py:51` | `student_id=current_user.id`（`:166`） |
| | `PATCH /learning/sessions/{session_id}` | `sessions_progress.py:73` | `session.student_id != current_user.id` 檢查（`:89`）—— **已測** |
| | `PUT /learning/sessions/{session_id}/progress` | `learning_step_progress.py:28` | `get_owned_session()`（`_helpers.py:24-36`）—— **已測** |
| 標註/朗讀 | `PUT /learning/sessions/{session_id}/annotations` | `learning_annotations.py:107` | `get_owned_session()` |
| | `POST /learning/sessions/{session_id}/ai-analysis` | `learning_reading.py:127` | session 擁有權檢查 |
| | `POST /learning/ai-analysis` | `learning_reading.py:236` | current_user 綁定 |
| | `POST /reading/evaluate` | `learning_reading.py:394` | current_user 綁定 |
| | `POST /reading/transcribe` | `learning_reading.py:512` | current_user 綁定 |
| | `POST /reading/save-audio` | `learning_save_audio.py:68` | `LearningSession.student_id == current_user.id`（`:135`），檔案落地也綁 `current_user.id`（`:116/126/143/170/191/203`） |
| | `POST /reading-history` | `learning_reading_history.py:85` | current_user 綁定 |
| 閱讀理解對話 | `POST /comprehension/question` | `learning_comprehension.py:41` | current_user 綁定 |
| | `POST /comprehension/chat` | `learning_comprehension.py:159` | current_user 綁定 |
| | `POST /comprehension/restart` | `learning_comprehension.py:342` | current_user 綁定 |
| | `POST /learning/sessions/{session_id}/comprehension-score` | `learning_comprehension_score.py:93` | session 擁有權檢查 |
| MCQ | `POST /learning/mcq-attempt` | `mcq_attempt.py:48` | `user_id=current_user.id`（`:60`），**每次點擊都新增一列，不覆寫**（見 2.2，這個特性剛好是 #3025 的資料來源）—— **已測** |
| | `POST /learning/mcq-rescue/start` | `mcq_rescue.py:70` | current_user 綁定 |
| | `POST /learning/mcq-rescue/respond` | `mcq_rescue.py:113` | current_user 綁定 |
| 生字/造句/聽力 | `POST /learning/sentence-practice/example-sentences` | `learning_vocab.py:55` | current_user 綁定 |
| | `POST /learning/sentence-practice/validate` | `learning_vocab.py:149` | `student_id=current_user.id`（`:239`） |
| | `POST /learning/listening/evaluate` | `learning_vocab.py:279` | `student_id=current_user.id`（`:320`） |
| 策略練習 | `POST /learning/strategy-practice/validate` | `learning_strategy.py:56` | current_user 綁定 |
| 出場券 | `POST /learning/sessions/{session_id}/exit-ticket/generate` | `learning_exit_ticket.py:61` | session 擁有權檢查 |
| | `POST /learning/sessions/{session_id}/exit-ticket/submit` | `learning_exit_ticket.py:142` | session 擁有權檢查 |
| 錯字訂正 | `POST /learning/students/{student_id}/error-corrections` | `learning_errors.py:256` | 顯式 `student_id` 路徑參數（此為唯一一個路徑本身帶 `student_id` 而非用 `current_user.id` 隱含指定的端點；middleware 的 method-based 阻擋對它同樣有效，因為它仍是 POST） |
| 練習工具箱 | `POST /toolbox/{tool_id}/sessions` | `toolbox.py:168` | `student_id=current_user.id`（`:184`），檔案內註解明講「always scoped to current_user.id — no admin / cross-student access here」（`:25`）|
| **GET 但有寫入副作用（特別列出）** | `GET /learning/students/{student_id}/dashboard` | `learning_dashboard.py:59` | 呼叫 `_get_or_create_streak()` —— **已測**（見 1.2，確認不會落地，且有專屬回歸鎖） |

**已驗證**：`grep -rln "websocket\|WebSocket" backend/app` 只在 `learning_reading_history.py:270` 出現一句「Future: push notification to teacher via WebSocket」的**註解**，沒有任何實際 WebSocket route。全站也沒有其他隱藏在 GET handler 裡的 `db.commit()/db.add()`（`awk` 掃過 `backend/app/routes/learning/*.py` 全部檔案，只有上表那一個例外）。這代表寫入邊界基本上與 HTTP method 對齊，只有一個已知例外，且該例外已被專屬測試鎖住。

### 1.4 BDD 驗收條件與測試證據

以下每條驗收條件都對應一支**真的跑過、且用 mutation 驗證過**的測試（把對應的production code 改壞，確認「就是那一條」測試會紅，不是別條，然後還原、確認回綠）。三份測試檔：

- `backend/tests/test_jwt_preview_token.py`（4 tests）—— preview token 的 claim 正確性
- `backend/tests/test_teacher_preview_token.py`（4 tests）—— 核發端點的授權
- `backend/tests/test_preview_mode_write_guard.py`（10 tests）—— 核心安全邊界

```gherkin
Feature: 教師以學生身分唯讀預覽

  Scenario: preview token 的 sub 是學生本人，不是老師（讓既有讀取路徑不必改）
    Given 我是老師，teacher_id=99，要預覽 student_id=6
    When 後端核發 preview token
    Then token 的 sub claim 解出來是 "6"（不是 99）
    And token 帶 preview=true, preview_by=99
    And token 的效期短於一般 8 小時登入 token
    測試：test_jwt_preview_token.py（4/4 passed，mutation 驗證：把 preview 改成
    False，確認 test_preview_token_carries_preview_claims 精準變紅，其餘不受影響）

  Scenario: 老師只能預覽自己任教班級的學生
    Given 老師 A 任教「小美」所在班級，老師 B 不任教
    When 老師 A 呼叫 POST /teacher/students/{小美id}/preview-token → 200，拿到 token
    And 老師 B 呼叫同一個端點 → 403
    And 未登入呼叫 → 401
    And 對不存在的 student_id 呼叫（老師 A 的 token）→ 403（不洩漏「這個 id 存不存在」）
    測試：test_teacher_preview_token.py（4/4 passed，mutation 驗證：把授權檢查
    整段改成 if False，確認「老師B被拒」與「不存在的id被拒」兩條測試精準變紅）

  Scenario Outline: 預覽模式下所有寫入一律被擋（最低權限身分：被預覽的學生本人）
    Given 我持有一張 preview=true, sub=<被預覽學生的id> 的 token
    When 我用這張 token 呼叫 <write_endpoint>
    Then 回應是 403，訊息包含「唯讀」
    And 資料庫裡沒有新增或修改任何屬於該學生的紀錄（用後續 GET 重讀驗證，不只看狀態碼）

    Examples:
      | write_endpoint |
      | POST /api/learning/mcq-attempt |
      | PATCH /api/learning/sessions/{id} |
      | PUT /api/learning/sessions/{id}/progress |

    測試：test_preview_mode_write_guard.py::TestPreviewModeBlocksWrites（4/4 passed）
    mutation 驗證：把 middleware 判斷式改成 if False，這 4 條測試（含「確認資料
    真的沒被改」那條）精準變紅，其餘 6 條（正向對照 + 讀取 + 無效 token）不受影響

  Scenario: 正向對照 —— 同一個身分，拿掉 preview claim 之後，寫入必須照常成功
    Given 我持有這個學生自己的正常（非 preview）token
    When 我呼叫 POST /learning/mcq-attempt、PATCH /learning/sessions/{id}、
         PUT /learning/sessions/{id}/progress
    Then 全部 200
    測試：test_preview_mode_write_guard.py::TestPositiveControlNormalTokenStillWrites
    （3/3 passed）—— 這條的存在，是為了讓上面「被擋」的結論站得住腳：如果沒有
    這組對照，403 有可能只是「這個端點本身壞了」，不是「preview 真的被擋」

  Scenario: 讀取類端點在預覽模式下正常運作，且已知的 GET-with-side-effect 端點不落地任何寫入
    Given 我持有一張 preview 學生 token
    When 我呼叫 GET /learning/recommendations/{id} → 200
    And 我呼叫 GET /learning/students/{id}/dashboard → 200
    Then dashboard 呼叫前後，該學生的 StudentStreak 列數不變
    測試：test_preview_mode_write_guard.py::TestPreviewModeAllowsReads（2/2 passed）

  Scenario: 無效 token 不會被誤判成「預覽模式」
    Given 我帶一個亂寫的、解不開的 bearer token
    When 我呼叫任一寫入端點
    Then 回應是 401（一般認證失敗），訊息**不含**「唯讀」
    測試：test_preview_mode_write_guard.py::TestInvalidTokenIsNotTreatedAsPreview
    （1/1 passed）—— 確保 middleware 永遠不會把「這個 token 根本讀不懂」誤報成
    「預覽模式擋你」，掩蓋真正的認證問題

  Scenario: 前端 —— 預覽入口可從老師真實導覽到達，且用的是預覽 token 不是老師自己的
    Given 老師在班級「學生進度」頁看到某學生的「預覽」按鈕
    When 點擊後，先呼叫核發端點拿 token，再導向預覽頁並帶著 token
    Then 預覽頁頂部顯示「預覽模式（唯讀）」+ 學生姓名 + 到期分鐘數
    And 呼叫推薦課文用的是這張 preview token，不是老師登入時的 token
    And 點擊「結束預覽」導覽返回
    測試：
      - StudentPreviewPage.test.tsx（5/5 passed，mutation 驗證：把打 API 的 token
        改寫死成別的字串，確認斷言 token 值的兩條測試精準變紅）
      - StudentProgressCard.preview.test.tsx（2/2 passed，mutation 驗證：把按鈕
        onClick 換成呼叫 onExpand 且拿掉 stopPropagation，確認測試精準變紅）
```

**已驗證（真跑過，非只讀 code）**：以上全部 18 支後端測試 + 7 支前端測試已在本機真的執行，每一條 fail-closed 斷言都做過「破壞 production code → 確認精準那條變紅 → 還原 → 確認回綠」的 mutation 驗證，不是只看一次綠燈。三份新後端測試已釘進 `.github/workflows/pytest.yml`（新增具名 step「Run teacher preview-mode locks (#3027)」）；兩份新前端測試已釘進 `.github/workflows/frontend-checks.yml` 既有的具名 pinned 清單（原 82 檔 → 84 檔）。兩份 workflow 編輯後都用「取到第一個空行為止，原樣執行」的方式驗證過沒有斷行 `\` 遺失（frontend 那份驗證結果：91 個 Test Files 全部 passed，數字與清單長度吻合）。

**回歸檢查（已驗證）**：後端全套測試（3937 個 collect，跑了 11m56s）在改動前後各跑一次（用 `git stash` 切換），確認 105 failed / 30 errors 兩邊完全一致（`test_characterization_auth_phase2_*`、`test_ai_endpoints.py` 等）——這些是既有環境缺口（本機測試環境沒有的外部服務相依），不是這次改動造成的迴歸。前端方面同樣用 stash A/B 比對，`ClassroomDetail.refactor.test.tsx` 的 5 個既有失敗（join code 相關，跟本功能無關）在改動前後一致存在。

### 1.5 規模估計 vs 實際花費

| 項目 | 原估計 | 實際 |
|---|---|---|
| 後端：preview token 欄位 + 核發端點 + middleware | 1-1.5 天 | 完成，含 mutation 驗證 |
| 後端：26 個寫入端點的 preview 回歸測試（含 1 個 GET 特例） | 1-1.5 天 | 完成——用**單一 middleware 涵蓋全部 26 個**，測試以代表性端點（3 個寫入 + 1 個 GET 特例）驗證機制本身，而非逐一端點各寫一條（機制本身統一擋，逐一測每個端點的邊際驗證價值低，且會讓測試檔暴增） |
| 前端：預覽入口 UI + 獨立 token 儲存 + 頂部提示列 + 結束預覽 | 1.5-2 天 | 完成——桌面表格與行動版卡片兩種版面都各自加了入口，涵蓋不同螢幕寬度下的可觸達性 |
| 端到端驗證（老師視角走一次真實預覽） | 0.5-1 天 | 進行中，見下方 §1.6 待完成項 |
| **合計** | **約 4-6 個工作天** | 一個 session 內完成（Young 核准「快點做」後不間斷執行） |

### 1.6 實作紀錄：TDD + mutation 驗證 + CI 插電

本節記錄本次實作嚴格遵守的紀律，供覆核：

1. **每一條鎖都先紅後綠**：每支測試檔案先寫測試、跑過確認因為程式碼還不存在而失敗（import error 或 404），再寫最小實作讓它變綠。
2. **每一條鎖都 mutation 驗證過**：對每個關鍵安全判斷（preview claim 檢查、授權查詢、token 使用），故意改壞一次，確認**恰好是預期的那幾條**測試變紅、其餘測試不受影響，再還原。
3. **正向對照配對**：每一條「應該被擋」的斷言，都配一條「同樣的身分、拿掉關鍵差異後應該成功」的對照測試——避免把「整個端點都壞了」誤判成「權限機制生效」。
4. **最低權限身分測試**：寫入被擋的測試全部用「被預覽的學生本人」的身分（token 的 sub 本來就是這個學生），這是這個端點原本合法能寫入的最低權限身分，不是用 admin 走捷徑通過檢查第一行。
5. **CI 插電**：兩份 workflow 都新增了具名 step / 具名清單，並用「取到第一個空行、原樣執行」的方式驗證過沒有斷行遺失。

**已驗證（本機）**：後端 + 前端 lint、單元測試、production build 全部跑過。

**尚待完成（本文件撰寫當下）**：
- staging 上用真實瀏覽器（headless）走一次「老師登入 → 點擊班級 → 點擊預覽 → 看到推薦課文 → 結束預覽」的真實導覽路徑，而非直接開網址。
- 部署到 staging → 驗證 CI 綠 → merge → 部署到 production → 在 production 用真實瀏覽器驗證。
- 在 issue #3027 留言，附上 production URL 給 Hans 驗收。

（這些步驟的執行結果會在 PR / issue 留言中附上證據，不在此文件重複貼一次。）

---

## #3025 教師即時監控儀表板

### 2.1 現況查證

**已驗證**：`ls frontend/src/components/teacher/` 的完整內容為：
`AtRiskStudents.tsx`、`ErrorHeatmapChart.tsx`、`HeatmapChart.tsx`、`NotificationBell.tsx`、`ReadingGoalsForm.tsx`、`SchoolSwitcher.tsx`、`StoryTagEditor.tsx`、`TeacherCommentSection.tsx`。Issue 列出的 6 個全部存在，另外 2 個（`SchoolSwitcher`、`StoryTagEditor`）是設定類元件，不影響「有沒有進行中即時視圖」的結論。

**已驗證**：對 `frontend/src/components/teacher/` 與 `frontend/src/pages/teacher/` 做 `setInterval|useInterval|EventSource|WebSocket|polling` 搜尋，唯一命中是 `NotificationBell.tsx:29,57`（`POLL_INTERVAL_MS = 60_000`，每 60 秒輪詢通知），這是**通知**（老師被 @ 或有新訊息時跳提示），不是「某個學生現在做到哪一題」這種進行中狀態，跟 issue 描述的訴求（老師想看到「做到哪一大題、答對答錯、有沒有亂猜」）完全不同層級。

**已驗證**：查詢 `backend/app/routes/teacher/teacher_dashboard.py:80-90` 的 `GET /teacher/classrooms/{classroom_id}/progress`（我在 1.1 的 staging 驗證裡實際打過這支，見結果 `{"student_id":6,"student_name":"小美","last_session_date":...,"last_text_title":"L02","total_sessions":2,"tags":[]}`），回應裡**沒有** `current_step`、沒有任何「現在活躍/離線」的欄位，屬於「上次讀到哪」而非「現在在哪」的統計。

**結論（已驗證）**：issue 對現況的描述準確——今天教師端完全沒有任何「課堂進行中」的視圖，全部是事後統計。

**已驗證（資料本身其實存在，只是沒有被拿來服務教師端）**：

- `backend/app/models/session.py:141` `LearningSession.current_step` 欄位存在但已**deprecated**（註解明講「不要再從 code 寫這欄，改用 `step_progress.steps_completed` 算出來的 `current_step_derived`」）；`step_progress`（`:164`，JSONB）由 `PUT /learning/sessions/{session_id}/progress`（`learning_step_progress.py:28`）寫入，內容包含 `current_step`（目前所在的 step key）、`steps_completed`、`step_data`。這代表**「這個學生現在在哪一步」這個資料本身已經存在 DB 裡，只是沒有一支教師端 API 把它彙整出來**。
- **已驗證**：`backend/app/models/session.py` 裡的 `LearningSession` **沒有 `updated_at` 欄位**（只有 `started_at`、`completed_at`）。這是一個真實的 schema 缺口：即使做出「哪些學生正在 in_progress」的清單，也沒有一個乾淨的欄位可以回答「這個 session 上一次有動靜是幾分鐘前」（用來判斷「還在做」vs「早就放著沒動、其實已經離開」）。要補這個需要新增欄位或改成每次寫入相關子表時順便更新一個時間戳——**這件事本身需要 DB migration，依規則要先問過 Young 才能動**（不在本次規劃自動核准範圍內，見 §2.4）。
- `backend/app/models/mcq_attempt.py`（全檔）：`McqAttempt` 表**每一次 MCQ 點擊都是新的一列**（`mcq_attempt.py:48-70` docstring 明講「Idempotent at the DB level (each click is a new row by design)」），欄位為 `user_id, lesson_id, question_id, choice, is_correct, created_at`。這張表本來是為了「找出反覆答錯又不用 AI 救援的學生」（Issue #1507）而建，但它天生就是 §2.2「有沒有亂猜」候選定義的資料來源。

**已驗證**：`backend/app/config.py:14` 有 `redis_url` 設定欄位，但 `grep -rln "redis" backend/app` 只在這個設定檔和 `backend/app/auth/rate_limiter.py`（一句註解：「若之後真的需要限流可以換成 Redis」）出現，**沒有任何實際連線或使用**，代表這個 codebase 今天沒有任何跨 instance 的訊息傳遞/pub-sub 基礎設施。目前的 rate limiter 是單機 in-memory。這點直接影響 §2.3 SSE/WebSocket 選項的成本估算。

### 2.2 「有沒有亂猜」候選定義

Issue 明確要求：不要發明一個系統沒有資料可以算的指標。以下三個候選全部**只用 `mcq_attempt` 表現有欄位就能算**，不需要新增任何前端埋點或 DB 欄位：

| 候選定義 | 怎麼算 | 需要的資料 | 已知限制（誠實列出） |
|---|---|---|---|
| **A. 答題過快** | 同一 `question_id` 的作答時間 <某閾值（例如 2-3 秒），用「這一列的 `created_at`」減「上一列（同 session 的上一題）`created_at`」估計 | `mcq_attempt.created_at` | 表裡**沒有「題目何時顯示給學生」的時間戳**，只有「送出答案」的時間戳，所以這是**用上一題的送出時間去估計這一題的開始時間**，第一題永遠無法估（沒有前一列可比），且如果學生在兩題之間離開分心又回來，會被誤判成「想很久」而非「秒殺」，方向上不會誤傷（漏抓比誤抓安全），但要老實講這是近似值 |
| **B. 反覆換答案** | 同一 `(user_id, lesson_id, question_id)` 短時間內出現多列、`choice` 不同 | `mcq_attempt` 本身就是「每次點擊都留一列」的設計，此定義**不需要任何新資料**，直接查現有表即可 | 換答案也可能是「認真思考後修正」，不是猜；純用次數判斷會有假陽性，需要老師端呈現成「這位同學在這題猶豫了 N 次」的中性描述，而不是直接貼「亂猜」標籤 |
| **C. 同一份作答選項模式固定** | 同一學生在同一份測驗/課程內，`choice` 高度集中在單一選項（例如 8 題有 6 題都選 A），用簡單的眾數佔比計算 | `mcq_attempt.choice` 分布 | 需要「同一份測驗」的邊界定義（用 `lesson_id` 分組即可，資料已支援），小樣本（少於 4-5 題）時這個指標統計上不穩定，需設最低題數門檻 |

**建議**：A + B 一起用（速度 + 換答案次數）比單獨用任一個都可靠，且都是 100% 決定性計算（不是 LLM 判斷、不會 drift），符合 `dev-doctrine-ref.md` EDD 那條「純 CRUD/確定性運算不需要 eval，只需要 contract test」的原則——這不是 LLM 產出，是規則運算，用一般 pytest 就能鎖住行為。

**未驗證**：以上三個候選目前都只是「資料庫理論上算得出來」，**沒有拿真實學生資料實際跑過、看數字分佈長怎樣**（例如：閾值訂 2 秒或 3 秒，需要拿 staging 或 prod 的真實 `mcq_attempt` 資料跑一次分布圖才知道合理閾值在哪，不能憑空定）。這件事本身不貴（一支唯讀 SQL 查詢腳本），但屬於「先看真資料再定規則」的前置工作，尚未做。

**明講排除的做法**：不建議用 LLM 去「判斷這個學生是不是在亂猜」——這是典型的「本來有確定性資料可以算，卻繞去用機率性判斷」，會製造出一個需要另外校準、會 drift 的黑盒子，而且比規則運算貴。

### 2.3 即時性選項與成本

| 選項 | 機制 | 這個 codebase 的現況成本 | 使用者感受到的延遲 |
|---|---|---|---|
| **輪詢（polling）** | 前端每 N 秒打一支新的彙整 GET（例如 `GET /teacher/classrooms/{id}/live-progress`），後端查 `LearningSession WHERE status='in_progress' AND classroom_id=X`，逐一 parse `step_progress` 取出目前步驟 | **最低**。這個 codebase 已經有 polling 的實例可以照抄（`NotificationBell.tsx` 60 秒輪詢），後端不需要新增任何常駐服務、不需要 Redis、不需要改 Cloud Run 的並行模型。唯一要做的是一支新的彙整查詢端點 | N 秒（輪詢間隔），例如設 10-15 秒對「課後扶助時段老師巡場」這種場景應該夠用 |
| **SSE（Server-Sent Events）** | 教師端開一條長連線，後端主動推送更新 | **中**。需要後端某處在資料變動時主動 push（例如在 `PUT /learning/sessions/{id}/progress` 寫入成功後，通知所有正在看這個班級的 SSE 連線）。Cloud Run 支援長連線，但**多個 backend instance 之間沒有共享的訊息匯流排**（上面已驗證 Redis 沒有真的接上），所以如果自動擴到 2 個以上 instance，「學生的寫入打到 instance A，老師的 SSE 連在 instance B」就收不到通知——這代表要嘛加一層 Redis pub/sub（新基礎設施），要嘛把該 Cloud Run 服務釘死在 1 個 instance（犧牲可擴展性，且不易被發現為什麼「有時候會收不到」） | 近即時（秒級） |
| **WebSocket** | 雙向長連線 | **最高**。同樣受多 instance 訊息匯流排問題影響，且這個 codebase 目前**完全沒有 WebSocket 基礎設施**（`grep -rln websocket backend/app` 只在一句註解出現，見 §2.1），是從零建置，工程與維運複雜度都明顯高於前兩者，且對「課後扶助時段、老師巡場看學生」這種場景，雙向通訊帶來的好處（老師能主動推訊息給學生？）目前 issue 沒有提出這個需求，屬於過度設計的風險 |

**建議**：先上輪詢。理由：這個 codebase 對輪詢已有可運作的先例、零新基礎設施、風險最低，且「課堂巡場」場景本身容忍 10-15 秒的延遲（老師走動觀察本來就不是毫秒級反應）。SSE/WebSocket 可以留在「輪詢證明價值後、且真的碰到延遲不夠用」時再升級，不建議一次到位。

**未驗證**：以上是我基於「這個 codebase 現有基礎設施」做的技術判斷，**不是**「哪個對老師的教學現場最有用」的產品判斷——後者需要 Young/Hans/現場老師確認可接受的延遲區間。

### 2.4 需要 Young 決定的問題

以下每題都設計成可以一句話回答：

1. **即時性要多即時？** 選 A：輪詢（10-15 秒更新一次，工程成本最低，這次先做）／選 B：一定要秒級（SSE，需額外評估多 instance 訊息同步的做法）。
   → 若答 A，本次 PRD 範圍就可以直接排入開發；若答 B，需要再開一輪技術方案評估（不在本次規模估計內）。

2. **「有沒有亂猜」要不要先做 A（答題過快）+ B（反覆換答案）兩個規則指標，暫不做 C（選項模式固定）？**
   → 若同意，範圍鎖定在兩個決定性指標，不牽涉 LLM；若要三個都做，多花的工是在「小樣本門檻」與「多指標合併呈現」的 UI 設計上。

3. **「答題過快」的秒數閾值，要不要授權我先拉一份 staging/prod 的 `mcq_attempt` 真實資料分布，抓出一個合理閾值再回來對齊，還是你已有偏好的秒數（例如均一測驗系統的經驗值）可以直接給？**
   → 若你有現成的經驗值可以省一輪資料分析；若沒有，我會先跑資料再提案。

4. **`LearningSession` 缺少 `updated_at`（沒有「這個進行中 session 上次有動靜是幾分鐘前」的欄位）——這個功能的「進行中 vs 已離開」判斷要不要做得準，值不值得為此開一個小型 DB migration（加一個 timestamp 欄位）？**
   → 這是唯一牽涉到 DB schema 變更的決定，依規則我不會自己動手建 migration，需要你明確說「可以」才會進入建 migration 的流程；若答「不值得」，我們可以先用「`status='in_progress'` 且 `started_at` 在過去 N 小時內」這種粗略近似頂著用。

---

*本文件程式碼路徑與行號均為 2026-09-01/02 從 `origin/main`（commit `260e91d1b`）讀取，#3027 的實作已在此分支完成並經 TDD/mutation 驗證，若之後有其他 PR 合併，行號可能位移。*
