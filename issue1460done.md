# Issue #1460 Phase 1 修正說明

## 問題摘要

練習工具箱（`/tools` 頁面，10 個工具）目前沿用 `learning_sessions` 表與作業/自學共用，造成 schema 混亂與資料來源難以區分。本 PR 為 issue #1460 的 **Phase 1**：建立 10 張獨立 toolbox session table（model + idempotent migration），不動 routes / 不動前端，作為 Phase 2-4 的 foundation。

---

## 修正內容

### 策略

採用 **SQLAlchemy mixin + 10 個薄類別** 的設計：

- 共用欄位（`id`, `student_id`, `text_id`, `result`, `score`, `duration_ms`, `started_at`, `completed_at`）抽到 `ToolboxSessionMixin`
- 每個工具 class 只設定 `__tablename__`，繼承 mixin + Base
- migration 用迴圈跑同一段 DDL，配 `IF NOT EXISTS` 達成冪等

優點：1) DRY — 加新工具只需 3 行；2) 強型別 — 各工具仍是獨立 ORM class，可獨自加欄位；3) 與 issue 設計（10 張獨立表，不沿用、不混淆）一致。

---

## 修改檔案

### 1. `backend/app/models/toolbox.py`（新檔）

```python
class ToolboxSessionMixin:
    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    text_id = Column(Integer, ForeignKey("texts.id", ondelete="SET NULL"),
                     nullable=True, index=True)
    result = Column(JSONB, nullable=False)
    score = Column(Float, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False,
                        server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    @declared_attr
    def __table_args__(cls):
        return (Index(f"ix_{cls.__tablename__}_student_started",
                      "student_id", "started_at"),)


class ToolboxTutorSession(ToolboxSessionMixin, Base):
    __tablename__ = "toolbox_tutor_sessions"
# … 9 more
```

10 個 class（順序對應前端 `TOOL_OPTIONS`）：
- `ToolboxTutorSession` (朗讀練習)
- `ToolboxFullReadingSession` (全文朗讀)
- `ToolboxListeningSession` (聽力理解)
- `ToolboxVocabSession` (生字書寫)
- `ToolboxSentencePracticeSession` (造句練習)
- `ToolboxVocabDefinitionSession` (詞語配對)
- `ToolboxVocabApplicationSession` (詞語應用)
- `ToolboxComprehensionSession` (課文理解)
- `ToolboxVocabWordSearchSession` (詞語搜尋)
- `ToolboxKnowledgeStationSession` (知識補給站)

### 2. `backend/alembic/versions/h3c4d5e6f7a8_create_toolbox_session_tables.py`（新檔）

冪等 raw SQL DDL — `CREATE TABLE IF NOT EXISTS` + 4 個 index per table（pkey + student_id + text_id + 複合 student_started）。

```python
revision = "h3c4d5e6f7a8"
down_revision = "g2b3c4d5e6f7"   # alembic heads = 1，無 multi-head 風險

TOOLBOX_TABLES = [10 個表名…]

def upgrade():
    for table in TOOLBOX_TABLES:
        op.execute(f"CREATE TABLE IF NOT EXISTS {table} (...)")
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_student_id ...")
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_text_id ...")
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_student_started ...")

def downgrade():
    for table in TOOLBOX_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
```

### 3. `backend/app/models/__init__.py`

把 10 個 class import 到 `app.models` namespace（autogenerate 偵測 + 方便外部 import）。

---

## 修改檔案地址

| 檔案 | 說明 |
|------|------|
| `backend/app/models/toolbox.py` | **新增** — mixin + 10 個 model |
| `backend/alembic/versions/h3c4d5e6f7a8_create_toolbox_session_tables.py` | **新增** — 冪等 migration |
| `backend/app/models/__init__.py` | 註冊 10 個 toolbox class export |

---

## 後端影響

**無 endpoint 改動**。Phase 1 只建表，現有 routes 仍寫 `learning_sessions`。Phase 2 才會新增 `backend/app/routes/toolbox.py` 並切換路由邏輯。

---

## SQLAlchemy Safety Checklist（CLAUDE.md 規定）

| 項目 | 狀態 |
|------|------|
| FK 都有 `index=True`（Rule 1）| ✅ `student_id`, `text_id` 皆 indexed |
| FK ondelete 設定明確 | ✅ `student_id` CASCADE / `text_id` SET NULL |
| Timestamps 有 `server_default` | ✅ `started_at` = `func.now()` |
| Timestamps 用 `timestamptz` | ✅ `DateTime(timezone=True)` |
| `alembic heads` = 1 | ✅ 修改後 `h3c4d5e6f7a8 (head)` 唯一 |
| Migration 冪等（IF NOT EXISTS） | ✅ 連跑兩次 upgrade 無錯誤 |
| Downgrade 可逆 | ✅ `alembic downgrade -1` 清乾淨 |

---

## 測試方式

### 前置步驟（共用）

```bash
cd backend && source .venv/bin/activate
export DATABASE_URL="postgresql://lingoleap_dev:lingoleap_dev@localhost:5432/lingoleap"
```

### 本地開發測試

> 環境：本地 PostgreSQL（lingoleap-db local replica）

**驗證方法 A — alembic heads / model imports**

```bash
alembic heads                                      # 預期：h3c4d5e6f7a8 (head) 單一
python -c "from app.models import ToolboxTutorSession; print('ok')"
```

**驗證方法 B — 完整 migration cycle**

```bash
alembic upgrade head                               # 建表
psql "$DATABASE_URL" -c "\dt toolbox_*"            # 預期：10 rows
alembic downgrade -1                               # 拆表
psql "$DATABASE_URL" -c "\dt toolbox_*"            # 預期：no relation
alembic upgrade head                               # 重建（idempotent）
alembic stamp h3c4d5e6f7a8 && alembic upgrade head # 二次 upgrade 無 op
```

**驗證方法 C — schema 細節（取一張 sample）**

```bash
psql "$DATABASE_URL" -c "\d toolbox_tutor_sessions"
psql "$DATABASE_URL" -c "
  SELECT tablename, indexname FROM pg_indexes
  WHERE tablename LIKE 'toolbox_%' ORDER BY 1, 2;"
```

---

### 本地開發測試結果（2026-05-04 實測）

**測試環境**

- macOS Darwin 25.3.0
- PostgreSQL 15 (local: lingoleap_dev / lingoleap_dev / lingoleap)
- backend `.venv` (Python 3.11+)
- 分支：`feat/1460-phase1-toolbox-tables`（從 `staging`）

| 步驟 | 指令 / 動作 | 結果 |
|------|------------|------|
| 1 | `alembic heads` | ✅ `h3c4d5e6f7a8 (head)` 單一 |
| 2 | model import smoke test | ✅ 10 個 class 全載入；`Base.metadata` 含 10 個 `toolbox_*` table |
| 3 | `alembic upgrade head` | ✅ `g2b3c4d5e6f7 -> h3c4d5e6f7a8` 套用成功 |
| 4 | `\dt toolbox_*` | ✅ 10 個 table 全部建立 |
| 5 | `\d toolbox_tutor_sessions` | ✅ 8 columns + PK + 3 indexes + 2 FK constraints |
| 6 | `pg_indexes` 統計 | ✅ 40 個 index（10 tables × 4：pkey + student_id + text_id + student_started） |
| 7 | `alembic downgrade -1` | ✅ 10 個 table 全 DROP CASCADE |
| 8 | `\dt toolbox_*` 二次驗證 | ✅ no relation found |
| 9 | `alembic upgrade head`（重做） | ✅ 重建成功 |
| 10 | `alembic stamp` + `alembic upgrade head` | ✅ idempotent — 第二次 upgrade no-op 無錯誤 |

**Sample schema（`toolbox_tutor_sessions`）**

```
   Column     |           Type           | Nullable |   Default
--------------+--------------------------+----------+--------------
 id           | integer                  | not null | nextval(seq)
 student_id   | integer                  | not null |
 text_id      | integer                  |          |
 result       | jsonb                    | not null |
 score        | double precision         |          |
 duration_ms  | integer                  |          |
 started_at   | timestamp with time zone | not null | now()
 completed_at | timestamp with time zone |          |
Indexes:
    "toolbox_tutor_sessions_pkey" PRIMARY KEY, btree (id)
    "ix_toolbox_tutor_sessions_student_id" btree (student_id)
    "ix_toolbox_tutor_sessions_student_started" btree (student_id, started_at)
    "ix_toolbox_tutor_sessions_text_id" btree (text_id)
Foreign-key constraints:
    "toolbox_tutor_sessions_student_id_fkey" FK (student_id) REFERENCES users(id) ON DELETE CASCADE
    "toolbox_tutor_sessions_text_id_fkey" FK (text_id) REFERENCES texts(id) ON DELETE SET NULL
```

**結論：修正驗證通過 ✅**

---

### 雲端（Staging / Production）測試

> Phase 1 是 DDL-only，部署到 staging 時 GitHub Actions 會自動跑 migration。

**驗證方法 A — Cloud SQL 直接查**

```bash
gcloud sql connect lingoleap-db --user=lingoleap --database=lingoleap --project=lingoleap-dev
\dt toolbox_*    # 預期：10 個 table
```

**驗證方法 B — staging backend logs**

部署後檢查 Cloud Run logs，確認 migration 在 startup 期間成功跑完（搜 `Running upgrade g2b3c4d5e6f7 -> h3c4d5e6f7a8`）。

---

### 迴歸測試（兩環境皆適用）

- [ ] `learning_sessions` 表結構未動 — 既有作業/自學流程繼續可寫
- [ ] `mcq_rescue_session` 表結構未動 — #1387 流程不受影響
- [ ] `alembic current` 顯示 `h3c4d5e6f7a8`，不會 multi-head
- [ ] 新建一筆測試 row：
  ```sql
  INSERT INTO toolbox_tutor_sessions (student_id, result)
    VALUES (1, '{"foo": "bar"}'::jsonb);
  SELECT * FROM toolbox_tutor_sessions LIMIT 1;
  ```
- [ ] FK CASCADE 行為：刪一個測試 user → 對應 toolbox 紀錄自動消失
- [ ] FK SET NULL 行為：刪一個測試 text → 對應 toolbox 紀錄 `text_id` 變 NULL

---

## 嚴重性

**架構級 foundation，但本 PR 風險低**：

- 只建新表，不動 schema、不寫資料、無 routes 變更
- 部署期間若 migration 失敗，rollback `alembic downgrade -1` 即清乾淨
- 既有 query / API 完全不受影響（沒人會去 SELECT 空表）

**後續 Phases 風險才會浮現**：
- Phase 2（routes 切換）：要做 dual-write 或 feature flag，避免雙寫不一致
- Phase 3（學習紀錄整合）：UI 需區分 toolbox vs assignment session
- Phase 4（歷史資料 migrate）：可能上線前後資料分散，需 backfill 腳本

---

## Phase 進度

| Phase | 內容 | 狀態 |
|-------|------|------|
| **1** | **10 個 model + migration + 前端 single-shot UX** | **✅ 本 PR** |
| 2 | `backend/app/routes/toolbox.py` + 前端 API 切換 | ⏳ 下一個 PR |
| 3 | 學習紀錄頁面新增「練習工具箱」分類 | ⏳ |
| 4 | （可選）歷史資料從 `learning_sessions` 遷移 | ⏳ |

---

## 追加：前端 single-shot UX（Phase 1 補充）

PR Preview 實測發現兩個問題（user 在 PR review 提出，2026-05-04）：

1. **學生在工具箱練習時，仍可從「上面的點點」跳到其他學習步驟** — 應隱藏 stepper
2. **進入工具看到自學留下的 localStorage 紀錄** — toolbox 應該是乾淨初始狀態

### 修正

**1. 隔離 toolbox localStorage scope** — `frontend/src/services/learningStorageScope.ts`

新增 `setToolboxMode(boolean)` / `isToolboxMode()`，並讓 `getLearningStorageScope` 在 toolbox 模式下加 `__t` 後綴：

```ts
// Before
export function getLearningStorageScope(storyId): string {
  // assignment scope OR storyId
}

// After
export function getLearningStorageScope(storyId): string {
  if (sessionStorage.getItem('toolboxMode') === '1') {
    return `${storyKey}__t`;        // ← isolated from self-practice / assignment
  }
  // ... existing assignment / self-practice logic
}
```

效果：toolbox 練習的 localStorage（`vocab_progress_<id>__t`、`writing_progress_<id>__t` 等）跟自學完全分離，學生看到的是乾淨初始狀態。

**2. PracticeToolbox 入口 / 出口切換 flag** — `frontend/src/pages/student/PracticeToolbox.tsx`

```tsx
// 進入工具：set flag → navigate
const handleStart = () => {
  setToolboxMode(true);
  navigate(`/learn/${storyId}/${stepPath}`, { state: { returnTo: '/tools' } });
};

// 回到 /tools 頁面：clear flag
useEffect(() => { setToolboxMode(false); }, []);
```

**3. ImmersiveTopBar 隱藏 stepper + back 改回 /tools** — `frontend/src/components/layout/AppShell.tsx`

```tsx
const inToolbox = isToolboxMode();

// 步驟標籤：toolbox 模式不顯示 N/total
{inToolbox ? currentStep.label : `${currentStep.label} ${currentStepIndex + 1}/${totalSteps}`}

// dots + 左右箭頭：toolbox 模式整個 hidden
{!inToolbox && <div role="navigation">...prev/dots/next...</div>}

// back button
const handleBack = () => {
  if (inToolbox) { setToolboxMode(false); navigate('/tools'); return; }
  /* fallback to /library or /student */
};
```

### 影響檔案

| 檔案 | 變更 |
|------|------|
| `frontend/src/services/learningStorageScope.ts` | 新增 toolbox scope `__t` + `setToolboxMode` / `isToolboxMode` helpers |
| `frontend/src/pages/student/PracticeToolbox.tsx` | `handleStart` 設 flag + mount-time 清 flag |
| `frontend/src/components/layout/AppShell.tsx` | `ImmersiveTopBar` 讀 `isToolboxMode()`，三處渲染分支：N/total、dots/箭頭、back button |

### 自學 / 作業流程不受影響

- 從 `/library` → 課文 → 學習流程進入：`toolboxMode` 沒被設為 1，scope = storyId 或 `__a_<assignmentId>`，dots 正常顯示，行為與本 PR 之前完全一致
- 作業流程：`activeAssignmentId` 仍走原邏輯，無 collision

### 後續 phase 仍會做

- Phase 2：把 toolbox 的儲存/讀取從 `learning_sessions` 切換到新建的 10 張 `toolbox_*` 表
- 本 PR 已完成「不從 `learning_sessions` 讀取」；Phase 2 完成「寫入新 toolbox 表」

---

## 追加 2：徹底斷掉 `learning_sessions` 讀取（Phase 1 第 2 輪補充）

PR Preview 二輪測試 user 仍看到資料：「裡面的紀錄沒有清除不知道是吃到哪裡的資料」。深查發現：

1. **`FillInBlankExercise.tsx` 用 raw localStorage key**（沒走 scope）— 跟自學共用 `vocab_app_progress_<storyId>`
2. **`LearningLayout` 對任何進入 `/learn/...` 的 session 都會做 GET 既有 + POST 建立** `learning_sessions` row。然後 `useProgressSync` 從這個 session 載入 `step_progress`，把 `readingAttempt` / `vocabResult` 等過去結果 rehydrate 到記憶體 → tool 元件透過 props 看到自學紀錄
3. **`ToolPicker.tsx` label 不一致** — 顯示「詞語配對」但內部及 `stepConfig` 是「詞語理解」

### 修正

| 檔案 | 變更 |
|------|------|
| `frontend/src/components/tools/ToolPicker.tsx` | label `詞語配對` → `詞語理解`，與 `stepConfig.ts` / `AppRoutes.tsx` 統一 |
| `frontend/src/components/reading-steps/FillInBlankExercise.tsx` | `vocab_app_progress_<id>` 改用 `scopedStepStorageKey('vocab_app_progress_', id)` |
| `frontend/src/layouts/LearningLayout.tsx` | 三處 `if (isToolboxMode()) return;` gate：(a) `useEffect` restore dbSessionId from sessionStorage、(b) `useEffect` GET-or-create session、(c) `handleStartReading` POST session。完整斷掉 `learning_sessions` 讀寫鏈 |

### 效果（Phase 1 完整版）

| 場景 | dbSessionId | localStorage scope | 顯示資料源 |
|------|-------------|---------------------|------------|
| 自學 | 現有 / 新建 | `<storyId>` | `learning_sessions` + 自學 localStorage（不變）|
| 作業 | 現有 / 新建 | `<storyId>__a_<assignmentId>` | `learning_sessions` + 作業 localStorage（不變）|
| **工具箱** | **永遠 null** | **`<storyId>__t`** | **完全空白，不接觸任何既有資料源** ✅ |

工具箱進入工具：
- ❌ 不從 sessionStorage 還原 dbSessionId
- ❌ 不 GET 既有 in_progress session
- ❌ 不 POST 建新 session
- ❌ 不 load `step_progress`（`useProgressSync` 看到 dbSessionId === null 直接 no-op）
- ✅ localStorage 走 `__t` scope，自學紀錄不會出現
- ✅ 工具元件以「全新初始狀態」渲染

> ⚠️ Phase 1 的代價：toolbox 練習目前**完全不會被儲存**（沒有寫到任何 DB table）。Phase 2 要新增 `backend/app/routes/toolbox.py` + 前端切到新 endpoints 才會把資料寫進 10 張新表。在 Phase 2 完成前，工具箱算「練完即丟」。

---

## 追加 3：完成練習後不再跳到下一步

PR review 第三輪 user 說明 UX 規格：「在練習工具箱中，每一關結束後只會出現重做或回到練習工具箱的按鈕，不會有下一步」。

### 修正

`LearningLayout` 內 14 個會 navigate 到下一步的位置（`handleStartReading` + 13 個 `handleFinish*`）抽出共用 helper：

```tsx
const navigateAfterFinish = useCallback(
  (nextStep: string) => {
    if (isToolboxMode()) {
      navigate('/tools');           // ← 工具箱模式：回到 picker
      return;
    }
    navigate(`/learn/${storyId}/${nextStep}`);
  },
  [navigate, storyId],
);
```

把所有 `navigate(\`/learn/\${storyId}/<step>\`)` 換成 `navigateAfterFinish('<step>')`，工具箱模式自動轉去 `/tools`，自學/作業流程行為完全不變。

### 仍待後續 PR 處理（已轉給 user 同意拆 PR）

| 項目 | 預定 PR |
|------|---------|
| 每個工具的完成畫面 CTA 從「下一步/繼續」改為「重做」+「回到練習工具箱」 | 接續 PR 1（Q1）|
| Phase 2：寫入新 toolbox 表 + Phase 3：學習紀錄頁標註「練習工具箱」| 接續 PR 2（Q2）|

本 PR 已完成 issue #1460 的 Phase 1（DB schema + 行為隔離）。完成畫面的 CTA polish 屬 UX layer，per-tool 工程量大，獨立 PR 處理。
