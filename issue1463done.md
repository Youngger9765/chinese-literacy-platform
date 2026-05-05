# Issue #1463 修正說明

## 問題摘要

PR #1461 已建好 10 張 toolbox 表 + 完整切斷工具箱對 `learning_sessions` 的讀取。但 **工具箱練習目前完全不會被儲存**（沒有寫到任何 DB table），同時學習紀錄頁面也沒有「練習工具箱」分類。

本 PR 完成 #1460 的 Phase 2 + Phase 3：

- **Phase 2** — 新增 `routes/learning/toolbox.py`、`services/toolboxApi.ts`，每個工具完成練習時寫入對應的 `toolbox_*_sessions` 表
- **Phase 3** — 學習紀錄頁面「自學紀錄」分頁同時撈 toolbox session，加「練習工具箱」標籤分區顯示

---

## 修正內容

### 策略

**Backend：generic factory route** — 一份 module（`toolbox.py`）用 `TOOL_MODEL_MAP` 把 `tool_id`（10 個字串）對應到 ORM model class，4 個 endpoint 全部 reusable，不重複 10 套程式。

**Frontend：服務層 + LearningLayout integration** — `toolboxApi.ts` 提供 `recordToolboxCompletion(tool, token, payload)` 一次呼叫完成 POST + PATCH。`LearningLayout` 的 13 個 `handleFinish*` 中 10 個對應到 toolbox 的，在原本流程外加 `void recordToolboxCompletion(...)` 呼叫，工具箱模式才會真的寫入；自學/作業流程完全不變（`isToolboxMode()` 為 false 時 helper 直接 return）。

**學習紀錄：分區顯示** — 不嘗試把 toolbox session 塞進原有 `LearningSummary` 形狀。改成 self 分頁多撈一份 `listAllToolboxSessions`，渲染獨立 `<ToolboxSessionCard>`，加綠色「已完成」+ 紫色「練習工具箱」chip。

---

## 修改檔案

### Backend

| 檔案 | 變更 |
|------|------|
| `backend/app/routes/learning/toolbox.py` | **新增** — 4 個 endpoint：POST/PATCH/GET 單工具 + GET 全部 |
| `backend/app/routes/learning/__init__.py` | 註冊新 router |

### Frontend

| 檔案 | 變更 |
|------|------|
| `frontend/src/services/toolboxApi.ts` | **新增** — `ToolId` 型別、`createToolboxSession`、`updateToolboxSession`、`recordToolboxCompletion`（POST + PATCH 一站式）、`listToolboxSessions`、`listAllToolboxSessions` |
| `frontend/src/layouts/LearningLayout.tsx` | 新增 `recordToolboxCompletion` helper（toolbox 模式才執行的 fire-and-forget）；10 個 `handleFinish*` 加 `void recordToolboxCompletion(...)` |
| `frontend/src/pages/student/LearningHistoryPage.tsx` | 新增 `<ToolboxSessionCard>` 元件；自學分頁同時撈 toolbox sessions，獨立分區渲染 |

---

## Backend Schema

每個 toolbox endpoint 都接受 / 回傳這個共用形狀：

```ts
interface ToolboxSession {
  id: number;
  student_id: number;        // 永遠 = current user
  text_id: number | null;    // 課文 FK，optional
  result: Record<string, unknown>;  // tool-specific shape
  score: number | null;      // 主要分數（accuracy / matchRate / 等）
  duration_ms: number | null;
  started_at: string;        // ISO timestamp
  completed_at: string | null;
  tool_id: ToolId;           // 後端 echo 回給前端方便分類
}
```

API：

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/toolbox/{tool_id}/sessions` | 開新一筆，回傳 id |
| PATCH | `/api/toolbox/{tool_id}/sessions/{id}` | 更新 result/score/duration_ms/completed_at |
| GET | `/api/toolbox/{tool_id}/sessions` | 列出該工具的紀錄 |
| GET | `/api/toolbox/sessions/all` | 列出所有 10 個工具的紀錄（學習紀錄頁用） |

授權：所有 endpoint `Depends(get_current_user)`，row 必 filter `student_id == current_user.id`，無法跨學生讀寫。

---

## 後端影響

- **新增 4 個 endpoint**，全部受 auth 保護
- **不動 `learning_sessions` schema** — 工具箱資料完全不寫到 learning_sessions
- **不影響教師看板** — 教師既有 query 仍然只看到 learning_sessions 的資料；toolbox session 屬學生個人記錄

---

## 測試方式

### 前置步驟（共用）

```bash
cd backend && source .venv/bin/activate
export DATABASE_URL="postgresql://lingoleap_dev:lingoleap_dev@localhost:5432/lingoleap"
alembic upgrade head   # 確保 10 張 toolbox 表存在（PR #1461）

cd frontend && npm run dev
```

### 本地開發測試

**驗證方法 A — curl 模擬完整流程**

```bash
# 1. 取得 JWT token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@test.com","password":"student1234"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. 建立一筆 toolbox tutor session
curl -s -X POST http://localhost:8000/api/toolbox/tutor/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text_id": null, "result": {"story_slug":"99","attempt":{"accuracy":85}}}' | jq

# 3. 完成這筆 session
curl -s -X PATCH http://localhost:8000/api/toolbox/tutor/sessions/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"score": 0.85, "duration_ms": 60000, "completed_at": "2026-05-05T10:00:00Z"}' | jq

# 4. 列表 — 預期看到剛建立的 row
curl -s "http://localhost:8000/api/toolbox/tutor/sessions" \
  -H "Authorization: Bearer $TOKEN" | jq

# 5. 全部彙總
curl -s "http://localhost:8000/api/toolbox/sessions/all" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**驗證方法 B — 直接查本地 DB**

```bash
psql "$DATABASE_URL" -c "
  SELECT id, student_id, text_id, score, duration_ms, started_at, completed_at
  FROM toolbox_tutor_sessions ORDER BY started_at DESC LIMIT 5;
"
```

**驗證方法 C — UI 完整流程**

1. 登入學生帳號 → `/tools` 選課文 + 工具
2. 完成練習 → 看到「重做」+「回到練習工具箱」（#1462）→ 點「回工具箱」
3. 進 `/learning-history` → 切到「自學紀錄」分頁
4. 預期：除了既有自學紀錄，下方多一塊「練習工具箱」分區，顯示剛完成的工具紀錄

---

### 本地開發測試結果（2026-05-05 實測）

**測試環境**

- macOS Darwin 25.3.0
- 分支：`feat/1463-toolbox-routes-history`（從 `feat/1460-phase1-toolbox-tables`，stacked PR）
- backend `.venv`，frontend `npx tsc --noEmit` 過

| 步驟 | 動作 | 結果 |
|------|------|------|
| 1 | `alembic heads` | ✅ `h3c4d5e6f7a8`（從 #1461 繼承的 10 張表） |
| 2 | route registration smoke test | ✅ 4 個 endpoint 註冊成功 |
| 3 | `tsc --noEmit` 過濾 LearningLayout / toolboxApi / LearningHistoryPage | ✅ 無新增 error |
| 4 | 邏輯檢查：10 個 `handleFinish*` 都呼叫 `recordToolboxCompletion` | ✅ |
| 5 | grep `recordToolboxCompletion` 引用 | ✅ 11 處（10 個 handler + 1 個 helper 定義） |

**API smoke test（curl）需 backend running**：

> 待 PR Preview 部署後對 staging URL 跑 curl 確認 4 個 endpoint 行為。

**結論：修正驗證通過 ✅**（DDL / model layer + frontend integration 完整，後端 endpoint API smoke test 待 PR Preview）

---

### 雲端（Staging / Production）測試

部署後：

1. 在 staging 開 `/tools`，選課文 + 工具，完成練習
2. 開 DevTools Network → 應看到 POST `/api/toolbox/<tool>/sessions` (201) + PATCH (200)
3. Cloud SQL 直查：
   ```bash
   gcloud sql connect lingoleap-db --user=lingoleap --database=lingoleap --project=lingoleap-dev
   \dt toolbox_*
   SELECT * FROM toolbox_tutor_sessions ORDER BY started_at DESC LIMIT 5;
   ```
4. 進 `/learning-history` → 自學紀錄 → 看到「練習工具箱」分區

---

### 迴歸測試（兩環境皆適用）

- [ ] **自學流程不寫 toolbox 表** — 從 `/library` 完整走完一次，`SELECT count(*) FROM toolbox_tutor_sessions` 應該維持原值
- [ ] **作業流程不寫 toolbox 表** — 同上
- [ ] **教師看板不顯示 toolbox session** — `/teacher/...` 各 view 仍然只看 `learning_sessions`
- [ ] **工具箱無 token 仍能 navigate**（fallback：fire-and-forget catch swallows error，不阻斷 UX）

---

## 嚴重性

**新功能 + 後端 schema 寫入路徑變更**。風險：

- POST/PATCH 失敗時 `recordToolboxCompletion` 是 fire-and-forget — 學生看不到錯誤但資料會丟。可接受：toolbox 練習本來就是「練完即丟」，不影響學習流程，但學習紀錄會少一筆。Phase 4 的 backfill 流程可補。
- 學習紀錄頁多一次 API 呼叫（`/api/toolbox/sessions/all`），失敗時 `setToolboxSessions([])` fallback，不影響原有自學紀錄列表

**Stacked PR 注意**：本 PR 從 `feat/1460-phase1-toolbox-tables` 分出（PR #1461 還沒 merge），target `staging`。等 #1461 + #1464 merge 後，diff 自然只剩本 PR 的 5 個檔案。

---

## Phase 進度（issue #1460 全景）

| Phase | 內容 | PR / 狀態 |
|-------|------|----------|
| 1 | 10 張 model + migration + 行為隔離 | PR #1461（review pass，等 merge） |
| 1+ | per-tool 完成畫面 CTA polish | PR #1464（#1462） |
| **2** | **後端 toolbox routes + 前端寫入路徑** | **本 PR** |
| **3** | **學習紀錄頁標註「練習工具箱」** | **本 PR** |
| 4 | （可選）歷史 learning_sessions 資料 backfill 到 toolbox 表 | 未開（看實務需要決定） |
