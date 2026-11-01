# PRD: 學校只是老師身上的標籤 — 把「組織／學校／班級」三層多租戶簡化成「班級歸屬」

- Status: Draft → 待 Young 核准 migration 段落
- Owner: Young（決策）／Claude（git-issue-pr-flow 代工）
- Issue: Fixes #3803（開 issue 時回填）
- 相關既有修復：#3800／#3802（GET /schools/{id} 403，已於 2026-11-01 merge 進 staging，是本次工作的第一個徵兆）

## 1. 現況（Current State）

### 1.1 現在的三層模型

```
Organization（org_owner / org_admin 可跨校管理）
  └─ School（org_admin / org_owner 經 school.organization_id 取得管理權）
       └─ Classroom（teacher_id 擁有者 + ClassroomTeacher 共授）
            └─ Student（ClassroomStudent 入班）
```

角色（`roles` 表，`alembic/versions/a1b2c3d4e5f6_unified_user_model.py` 種的）：

| role | scope_level | 目前實際用途 |
|---|---|---|
| `system_admin` | platform | 全域 bypass（唯一正確的全域 bypass，見 `app/auth/policies.py::is_system_admin`） |
| `org_owner` / `org_admin` | organization | 管理自己 org 底下的學校／班級／使用者／回饋／計點（`UserRole.scope_type="organization"`） |
| `principal` / `director` | school | **定義了但從未在任何授權判斷裡被檢查**（grep 只找到一處 docstring 範例、一處 `worksheets.py` 的角色字串白名單） |
| `teacher` / `student` | school | 實際授權主力。`UserRole(scope_type="school", scope_id=str(school.id))`，**schema 本來就允許同一個 user 對多個不同 school.id 各自一筆** |

### 1.2 這次盤點挖出的真缺陷（已用 `~/.claude/skills/migration-reverse-audit/reverse_dep_audit.py` 掃過 `backend/app`，9 個 token、267 處命中、26 個檔案）

**A. 一個重複出現的 bug 形狀：`get_user_org_ids()` 把「沒有 org 角色」等同「org_ids = []」，`[] 不是 None`，所以 `school.organization_id not in []` 對任何已登入的一般老師恆真 → 403。**

這個形狀目前已知命中（用上面 §1.1 的「建一個只有 school-scoped teacher role 的帳號」實測，證據見下表「復現」欄）：

| 端點 | 現況 | 復現 |
|---|---|---|
| `GET /schools/{id}` | ✅ 已修（#3800/#3802，2026-11-01 merge） | — |
| `GET /schools/{id}/members` | ❌ 403 | 本次復現：`backend/tests/`（見下方新增測試） |
| `GET /schools/{id}/classrooms` | ❌ 403 | 同上 |
| `POST /schools/{id}/semesters`（建學期） | ❌ 403 | 同上（semesters.py 的 `_require_school_write_access` 只認 org_admin／system_admin，一般老師永遠建不了自己學校的學期） |
| `PATCH /schools/{id}/semesters/{id}`、`.../activate` | ❌ 同上 | 同上 |
| `GET /schools/{id}/semesters`、`.../active` | ✅ 本來就對（`_require_school_read_access` 已有 school-member fallback） | — |
| `PATCH /schools/{id}`、`POST /schools/{id}/regenerate-code`、`POST /schools`（建校） | 現況：system_admin/org_admin-only（非 bug，是刻意設計）| 新模型下改為 system_admin-only（見 §3） |

**復現方法**：建一個只有 `UserRole(role="teacher", scope_type="school", scope_id=str(school.id))`（無 organization-scoped role）的帳號，依序打上表端點。復現腳本已轉成 TDD 測試，見 §6 與本 PR 的 `backend/tests/test_school_as_label_authz.py`。

**B. `is_admin()`（`app/auth/policies.py`）把 `org_admin` 當 system_admin 用的陷阱**：docstring 自己警告過，`app/routes/classrooms/helpers.py` 有一個重複定義只是轉呼叫，`app/routes/classrooms/__init__.py` 有一個 `# noqa: F401` 的死 import（`_is_admin`，查無任何呼叫端）。新模型下兩者都要清掉。

**C. SSO／自助加入班級完全不授予角色**（任務描述猜對了，已查證）：

- `app/services/sso_login_service.py::resolve_google_user` / `resolve_junyi_user`：建新 `User` 時**不建任何 `UserRole`**（`resolve_junyi_user` 的 docstring 甚至寫著「create a new user account (student role...)」，但程式碼裡從來沒有那一行）。
- `app/routes/classrooms/classroom_join.py::join_classroom_by_code`：自助用 join code 入班只建 `ClassroomStudent`，**同樣不授予 `UserRole(role="student", scope_type="school", ...)`**。
- 對照組：老師手動建學生（`classroom_batch.py`、`classroom_csv.py`）與均一班級匯入（`junyi_class_import_service.py`）**三處都有**授予 school-scoped student role 的程式碼（各自約在檔案中段，`UserRole(... scope_type="school" ...)`）。所以「自助加入」是唯一漏掉的路徑，不是通案設計。
- 後果：一個只透過 Google／均一 SSO 登入、再用 join code 加入班級的學生，`UserRole` 表裡永遠是空的。目前還沒找到因此直接壞掉的功能（`ClassroomStudent` 本身就足夠讓他出現在老師的班級名單、能寫作業），但任何未來「我方查詢：這個人是哪個學校的學生」的功能（例如均一匯入的 `_eligible_student_ids`、未來的 school-level 報表）都會把他們漏掉。**判定為應修的缺陷**：join 時機知道 `classroom.school_id`，補上跟 batch/CSV 匯入一致的角色授予是最小一致化。

**D. 現有「org_admin 有特權」的完整命中清單（26 個檔案，依風險分組）**：

| 分類 | 檔案 | 現況 org_admin 用途 | 新模型下的處置 |
|---|---|---|---|
| **核心授權 SOT** | `app/auth/policies.py` | `is_admin()`／`resolve_user_org_ids()`／`_org_admin_org_ids()`／`_is_org_admin_of_school()`／`require_classroom_owner`／`require_classroom_member`／`require_student_visible_to_teacher` 全部把 org_admin 當 classroom/student 的跨校 bypass | 移除 org_admin bypass；只留 `is_system_admin` + ownership/membership。`is_admin()`／`_org_admin_org_ids`／`_is_org_admin_of_school` 保留定義（有既有 characterization test 釘住、`roles.py` 仍窄用）但標 deprecated、拔掉所有跨校 bypass 呼叫點 |
| | `app/dependencies/tenant.py` | ⚠️ **2026-11-01 第一版盤點誤判為死碼，實作時查證才發現是錯的** —— `require_org_member`／`require_org_admin`／`get_tenant_filter` 這三個 **Depends 工廠**確實零呼叫端，但其中 `_check_classroom_access` 這個**私有 helper 被 9 支 `app/routes/teacher/*.py` 直接 import**（teacher_dashboard／teacher_analytics／teacher_reports／teacher_alerts／teacher_cross_text／teacher_instructions／teacher_assignment_matrix／teacher_classroom_stuck／teacher_live_monitor），且內含同款 org_admin-of-school bypass。第一版只 grep 了 public 工廠名稱，沒 grep private helper 的呼叫端，是本次盤點唯一一處真的查錯 | `_check_classroom_access` 比照 `policies.py` 拿掉 org_admin bypass（本 PR 已修，見 §1.2.A 復現表後方新增一列）；`_check_org_member`／`_check_org_admin`／`get_tenant_filter`／兩個 Depends 工廠 → 前者有一個真呼叫端（`organizations_crud.py::get_organization`，見下方 Organization 列），後兩者零呼叫端，暫不動 |
| **Schools / Semesters** | `app/routes/schools.py` | 見上表 A | 本 PR 修正 |
| | `app/routes/semesters.py` | 寫入（建立／更新／啟用學期）僅 system_admin/org_admin；讀取已有 member fallback | 寫入改為「school member（任一 active school-scoped role）或 system_admin」 |
| **Classroom** | `app/routes/classrooms/classroom_crud.py` | `create_classroom`／`list_my_classrooms` 允許 org_admin 建立／列出整個 org 的班級 | 移除 org_admin 分支，只留 owner/co-teacher（寫）、owner/co-teacher/system_admin（列表） |
| | `app/routes/classrooms/classroom_junyi_import.py` | `_require_school_membership` 的 `_is_org_admin_of_school` OR 分支 | 移除，只留 school member 或 system_admin |
| | `app/routes/classrooms/helpers.py`、`__init__.py` | `is_admin` 轉呼叫 + 死 import | 一併清掉 |
| **跨使用者讀取** | `app/routes/users.py` | `list_users`／`get_user_detail` 對 org_admin 開放「同 org 使用者」 | 改 system_admin-only（平台管理頁，無 org 概念後沒有中間層角色） |
| | `app/routes/roles.py` | `list_user_roles` 對 org_admin 開放「同 org 使用者的角色」 | 改 system_admin-only（+ 本人自己一定看得到） |
| | `app/routes/feedback.py` | 列表／PATCH 使用者回饋，org_admin 可讀寫「同 org」回饋 | 改 system_admin-only |
| | `app/routes/gamification.py` | `_assert_can_view`（沒有 co-teacher 分支，是另一個小 bug）、`get_leaderboard` 都有 org_admin 分支 | 改用新 `can()`：system_admin／classroom owner／co-teacher／本人 |
| **刻意不動（role 白名單，非租戶 bypass）** | `app/routes/testset.py`、`app/routes/worksheets.py` | `require_role(..., "org_admin"/"org_owner")` 白名單 | ⚠️ **2026-11-01 實作時校正**：第一版把這兩支歸進「org_admin bypass」要拿掉，重讀後發現判斷錯了。這兩支是**平台級功能的角色白名單**（「誰可以看測試錄音／下載教師版學習單」），org_admin/org_owner 只是白名單裡的一個名字，不涉及「org 當容器讓你伸手進別人學校/班級」——跟 schools.py／semesters.py 那種真正的跨租戶 bypass是不同性質。Young 的新模型管的是**組織/學校/班級的租戶階層**，不是「所有出現過 org_admin 字串的角色白名單」。**本 PR 不動這兩支**，避免把一個無關的平台功能權限收窄（過度延伸）|
| **Organization 本體（billing，刻意不動）** | `app/routes/organizations_crud.py`、`organization_dashboard.py`、`organization_points.py`、`app/services/points_service.py`、`app/models/organization.py`、`app/models/points_log.py` | `Organization` 帶 `total_points`／`used_points`／`subscription_*`，是休眠中的計點計費功能（`check_and_deduct_points`／`get_org_for_student` **全 repo 查無任何呼叫端**，只有 `tests/test_points_system.py` 測它自己） | **保留 Organization/OrganizationPointsLog 資料模型 + `organizations_crud.py` 的 CRUD 存取方式，不碰**（`get_organization`／`list_organizations` 本來就是「org_admin 看自己這個 org 的基本資料+學校清單」，不是伸手進別人學校——跟 teacher 看自己 classroom 同一種「擁有者看自己資源」語意，不是租戶 bypass）。但 `organization_dashboard.py`／`organization_points.py` 這兩支**確實**在用 org 當容器聚合**別人**（其他老師/學生）的統計數字，是真的租戶 bypass → 改成 **system_admin-only** 的內部報表／計費工具 |
| | `app/routes/league.py` | docstring 說「org_admin 被排除」且程式碼本來就沒給它特權 | 不用改，順手在稽核表留一筆證明 |
| **刻意不動（業務規則，非租戶 bypass）** | `app/services/league_service.py` | `_require_same_org`：`school_a.organization_id`／`school_b.organization_id` 判斷「兩班是否同機構」，用於跨班邀請賽的配對資格 | ⚠️ **2026-11-01 實作時校正**：第一版打算改成比 `school_id`，查證後發現錯了。這是 `docs/prd/2026-10-14-chinese-star-league-prd.md` 既有、已核定的**產品規則**（跨校/跨機構邀請賽目前刻意不開放，是 Phase 2/3 範圍），不是「org 當權限容器讓人伸手進別人資源」——呼叫這個檢查前，兩個班級的擁有者身分都已經各自驗證過。改成比 `school_id` 會**實際改變產品行為**（放寬成「同校才能配對」，比現在「同機構」更嚴，但這不是 Young 這次要的，他要的是權限模型簡化，不是重新定義跨班賽配對規則）。**本 PR 不動** |

### 1.3 Organization／School 兩個模型的角色分工（新模型定案後）

- `Organization`：**只剩計費/報表意義**（休眠功能，未來若要重新啟用「機構採購點數」才會用到），不再是任何使用者的登入身份、不再出現在任何授權判斷裡。
- `School`：**降級成參考名錄**（reference directory）。老師可以屬於多個學校（label），每個班級固定屬於一個學校。system_admin 維護名錄本體；一般老師只讀。

## 2. 新模型（Young 2026-11-01 定案）

1. 學校改成老師的標籤。一個老師可以有多所學校（代課、兼課、巡迴支援常見）。
2. 班級只屬於一所學校，開班時從老師自己的學校裡選（**現狀已是如此**，`classroom_crud.py::create_classroom` 本來就要求 `is_school_member`，不用改）。
3. 學校本身改成參考名錄，以教育部學校代碼加校名為主，只用來顯示、統計、對學習扶助，不參與權限判斷。
4. 權限只看兩件事：這個班是不是你開的、這個學生是不是你班上的。系統管理員例外。
5. 註冊或轉成老師時，要選確切的學校（從名錄搜尋選），不讓使用者自由輸入。

### 2.1 好消息：「老師可以有多所學校」在 schema 層其實已經成立，不需要新表

- `UserRole` 的唯一鍵是 `(user_id, role_id, scope_type, scope_id)`——本來就允許同一個 user 對不同 `school.id` 各開一筆 `scope_type="school"` 的 `teacher` 角色。
- 前端 `WorkspaceContext.tsx` 甚至**已經做好**多校老師的 UI 骨架：`teacherSchoolIds`（從多筆 school-scoped role 推導）、`activeSchoolId` + `setActiveSchoolId`（本地切換當前學校）、`hasMultipleSchools`。這是 #548 當初就設計好、只是一直沒有「怎麼加第二所學校」的進線。
- 目前唯一缺的是**進線**：沒有任何自助端點能讓一個已註冊的老師「加入第二所學校」。`system_admin` 可以用既有的 `POST /roles/assign` 手動加（不用新 migration），但沒有老師自助版。
- 類比 `Classroom.join_code` + `POST /classrooms/join` 的既有模式，`School` 本來就有 `join_code` 欄位和 `regenerate-code` 端點，但**從來沒有對應的 `POST /schools/join`**——这正是給老師自助加入第二所學校的現成缺口，**理論上不需要 migration**。

因為這點 Young 在交辦時把它跟另外兩項一起歸進「需要 migration」，§4 會照 Young 的分類老實停下來問，但一併附上「其實不用 migration」的替代方案，由 Young 選。

## 3. 盤點（詳表見 §1.2 D）

逐一決定後的分類：

- **改成只看班級歸屬**：`classroom_crud.py`、`classroom_junyi_import.py`、`gamification.py`（view/leaderboard）、`app/dependencies/tenant.py::_check_classroom_access`（被 9 支 `teacher/*.py` 直接呼叫，見下方校正）、`app/auth/policies.py`（`require_classroom_owner`／`require_classroom_member`／`require_student_visible_to_teacher`）
- **改成系統管理員才能用的唯讀／管理工具**：`users.py`（list/detail）、`roles.py`（list_user_roles）、`feedback.py`（list/patch）、`schools.py`（create/update/regenerate-code 維持 admin-only，拿掉 org_admin）、`organization_dashboard.py`、`organization_points.py`
- **改成「學校成員或系統管理員」**（這是本次新增的第三類，§2 點 4 沒提到但不補就會卡住本該可以做事的老師——semester 寫入 bug 就是這類）：`semesters.py` 寫入端點、`schools.py` 的 `list_school_members`／`list_school_classrooms`
- **刻意不動（角色白名單／業務規則，非租戶 bypass，2026-11-01 實作時校正）**：`testset.py`、`worksheets.py`（平台角色白名單，org_admin 只是白名單裡的一個名字，不是租戶 bypass）、`league_service.py`（既有 PRD 核定的「同機構才能配對」業務規則）
- **標記 deprecated、暫不刪**（Phase 2 隨 Organization 定案才處理）：`app/dependencies/tenant.py` 的 `require_org_member`／`require_org_admin`／`get_tenant_filter`（真的零呼叫端）、`app/auth/policies.py::is_admin`／`_org_admin_org_ids`／`_is_org_admin_of_school`（有 characterization test 釘住或窄用，已拔掉跨租戶 bypass 呼叫點但保留定義）
- **保留不動（out of scope）**：`Organization`／`OrganizationPointsLog` 資料模型本體、`points_service.py`、`organizations_crud.py` 的 CRUD 存取方式（擁有者看自己 org，非租戶 bypass）

## 4. 資料遷移（需要 Young 同意才能建 migration — 暫停在此）

以下三項**本 PR 不會建任何 migration／alembic revision**，先列草案等同意：

### 4.1 老師多學校（teacher ↔ school 多對多）

**選項 A（推薦，不需要 migration）**：沿用現有 `UserRole(scope_type="school")`，新增一個自助端點 `POST /schools/join`（body: `join_code`），邏輯比照 `classrooms/classroom_join.py::join_classroom_by_code`：查 `School.join_code` → 若呼叫者尚未是該校 teacher role 的 active member → 新增一筆 `UserRole(role="teacher", scope_type="school", scope_id=str(school.id))`。前端 `WorkspaceContext.tsx` 的多校 UI 已經現成。

**選項 B（需要 migration）**：另建一張 `teacher_schools` join table（`teacher_id, school_id, is_primary, job_title, joined_at`），把「老師與學校的關係」從通用的 `UserRole` 權限表裡拆出來，語意更乾淨（`UserRole` 目前身兼「權限」與「標籤」兩種意義），但要新增 table + 搬遷既有 school-scoped teacher 角色資料 + 所有讀點（`WorkspaceContext`、`list_school_members` 等）跟著改查詢來源。

→ **請 Young 選 A 或 B**。選 A 可以併入本 PR（不需要 migration，風險低，複用既有端點模式）；選 B 則排到下一輪。

### 4.2 學校名錄（教育部代碼）—— 2026-11-01 Young 核准施作（獨立 issue，另開分支）

Young 2026-11-01 口頭核准：「匯入教育部學校名錄、加上學校代碼……現在就做」。
這段不再是草案，是**已實作**的紀錄（實作分支 `feat/issue-3804-moe-school-directory`，
與 §1–§3 的 authz 收斂分開提 PR，避免兩件事互相卡）。

**資料來源**（官方，data.gov.tw 政府資料開放平臺，教育部統計處）：

| 名錄 | 資料集頁 | CSV 下載網址 | 學年度 |
|---|---|---|---|
| 國民小學名錄 | https://data.gov.tw/dataset/6087 | https://stats.moe.gov.tw/files/school/115/e1_new.csv | 115（單一學年檔） |
| 國民中學名錄 | https://data.gov.tw/dataset/6088 | https://stats.moe.gov.tw/files/opendata/j1_new.csv | 104–115（多學年合一檔，匯入時篩 115） |
| 一般高級中等學校名錄 | https://data.gov.tw/dataset/6089 | https://stats.moe.gov.tw/files/school/115/high.csv | 115（單一學年檔） |

下載日期 2026-11-01，原始檔存放於 `backend/data/moe_schools/`（含來源與資料怪癖說明的
README）。高職（技術型高中的職業類科）的獨立名錄本輪未拉，列為已知缺口，不是悄悄漏掉。

**實際欄位**（加在 `School` 表，全部 `nullable=True` 以不影響既有列；比草案多兩欄，
因為「公/私立」「國小/國中/高中」在教育部來源資料本身就有、不額外成本）：

| 欄位 | 型別 | 用途 |
|---|---|---|
| `moe_school_code` | `String(20)`, unique, indexed | 教育部學校代碼（全國唯一，驗證過 3855 筆 0 碰撞） |
| `county_code` | `String(10)` | 來源「縣市名稱」欄位的中括號代碼，**原樣保留備查，不是穩定的縣市識別碼**——臺北市單獨橫跨 `[31]`–`[42]`（12 個不同代碼，對應合併前的行政區分代碼）、高雄市橫跨 `[51]`–`[61]`，所以名錄搜尋的 `county=` 篩選是比對 `county_name` 文字，不是比對這個代碼 |
| `county_name` | `String(50)`, indexed | 縣市中文名，**存入前把「臺」正規化成「台」**（對齊既有 seed 資料 `台北市大安國小` 的慣例） |
| `school_level` | `String(10)`, indexed | `elementary` / `junior_high` / `senior_high`，依來源檔案標記（不是從校名猜測，因為「○○國中(小)」這類合併校會誤判） |
| `is_public` | `Boolean` | 來源「公/私立」欄位 |

**Young 的問題 1 答覆**：用上表三份 data.gov.tw 官方資料集（政府資料開放平台優先於
教育部統計處原始頁面，因為前者有穩定下載網址 + 版權條款明示）。

**Young 的問題 2 答覆**（現有 `schools` 表裡「網域自動建的學校」怎麼處理）：
**本輪不動、不嘗試自動合併**。教育部名錄以 `moe_school_code` 為 upsert 鍵另外寫入，
既有那些手動／網域建立的學校列（`moe_school_code IS NULL`）完全不碰、不刪、不改名。
名錄搜尋 API（§4.2 下方）只在 `moe_school_code IS NOT NULL` 的列中查，
不會把搜尋結果跟舊資料混在一起。人工比對合併留到下一輪，需要 Young 決定合併規則
（例如同名同縣市才合併，還是要人工逐筆看）——這是個會改變既有資料的決定，不在本輪
自動做。

**學校名錄搜尋 API**：`GET /api/schools/directory/search?county=&q=`
（新檔 `app/routes/school_directory.py`，不動既有 `schools.py`，降低跟
`feat/issue-3804-self-serve-teacher` 分支的衝突面）。需要登入、限流、只回名錄欄位
（不回 `join_code`）。查詢先正規化（臺→台、國民小學／國民中學展開成國小／國中、
去掉市立／縣立／私立／公立／國立前綴、全半形與空白），再用字元級相似度做模糊比對
（`difflib.SequenceMatcher`，含完整字串包含關係的加權），模糊比對 0 筆才呼叫 LLM
（Vertex Gemini，`get_model_for_task()` 取模型、照 `llm-endpoint-hardening` skill
加 rate limit／輸入長度上限／失敗不中斷搜尋只是不給建議）給拼音接近的建議。

### 4.3 註冊/轉老師時改成搜尋選校

依附 4.2（沒有名錄就沒有可選清單）。如果 4.2 先動，這項才有意義；若 4.2 暫緩，建議先用 §2.1 選項 A（自助 join code）過渡。

**以上三項在 Young 回覆前，本 PR 不觸碰 `backend/alembic/versions/`、不改 `School`／`User` 的欄位。**

## 5. 集中權限判斷：`can(user, action, resource_type, resource_id, db)`

新檔 `backend/app/auth/authz.py`，取代分散在 26 個檔案裡各自土炮的 org 判斷。設計成「一個函式 + 一張表」，不是把全部 140+ 端點一次全部改寫成呼叫它（風險太大，一次 PR 做不完也不該做）：

```python
# backend/app/auth/authz.py
Action = Literal["view", "manage"]
ResourceType = Literal["classroom", "school", "school_roster", "student", "semester"]

def can(user: User, action: Action, resource_type: ResourceType, resource_id, db: Session) -> bool:
    """Single source of truth. 系統管理員永遠是 True；其餘照 _POLICY_TABLE 分派。"""
    if is_system_admin(user.id, db):
        return True
    check = _POLICY_TABLE.get((resource_type, action))
    if check is None:
        raise ValueError(f"no policy registered for ({resource_type}, {action})")
    return check(user, resource_id, db)

_POLICY_TABLE = {
    ("classroom", "view"): _can_view_classroom,     # owner or co-teacher
    ("classroom", "manage"): _can_manage_classroom, # owner only
    ("school", "view"): lambda *_: True,            # 參考名錄，任何登入者可讀
    ("school", "manage"): lambda *_: False,         # 名錄只有 system_admin 能改（已被上層 bypass 接住）
    ("school_roster", "view"): _is_school_member,   # members / classrooms 名單，僅本校成員
    ("semester", "manage"): _is_school_member,      # 建/改/啟用學期，任一本校老師皆可
    ("student", "view"): _can_view_student,         # 本人、classroom owner、co-teacher
}
```

本 PR 實際把 §3「改成只看班級歸屬」與「改成學校成員或系統管理員」兩類的路由改呼叫 `can()`；「改成系統管理員才能用」那類（users/roles/feedback/org 報表）因為本來就是 `require_role("system_admin", ...)` 的白名單寫法，直接拿掉 `"org_admin"`／`"org_owner"` 字串即可，不特別繞去 `can()`（avoid over-engineering——那幾支本來就是角色白名單，不是「誰擁有這個資源」的判斷，套 `can()` 反而繞遠路）。`testset.py`／`worksheets.py` 維持原樣（見 §3 校正，跟租戶權限無關）。

## 6. 權限矩陣測試（本 PR 新增 `backend/tests/test_school_as_label_authz.py`）

角色 × 資源矩陣（每格都要紅過才算數，TDD "no red no credit"）：

| 角色 | 自己的班級 | 別人的班級 | 自己學校的名單/學期 | 別校的名單/學期 | 自己學校 GET | 別校 GET |
|---|---|---|---|---|---|---|
| teacher（僅 school-scoped） | ✅ 200 | ❌ 403 | ✅ 200（修復重點） | ❌ 403 | ✅ 200（#3800 已修） | ❌ 403 |
| co-teacher（assistant） | ✅ 200（view 限定，manage 403） | — | — | — | — | — |
| 曾經是 org_admin 角色（舊資料／手動指派）的使用者 | ❌ 403（新模型下不再有跨校特權，這格是本次 PR 的核心斷言——確認 org_admin bypass 真的被拿掉） | ❌ 403 | ❌ 403（除非自己也是該校 school-scoped member） | ❌ 403 | 視自己是否為 member | ❌ 403 |
| system_admin | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 | ✅ 200 |
| student | ✅（僅自己的 summary／leaderboard） | ❌ 403 | n/a | n/a | n/a | n/a |

額外鎖：
- SSO 自助建帳號／自助 join code 入班 → 之後必須查得到一筆 `UserRole(role="student", scope_type="school", scope_id=str(classroom.school_id))`（紅：目前沒有 → 綠：補上授予邏輯後）。
- Mutation 對照：把 `_is_school_member`／`can()` 的本校判斷故意改成恆真，驗證「別校」那幾格會翻紅（證明測試真的在咬，不是裝飾品）。

## 7. 驗收條件（BDD）

```
Given 一個只有 school-scoped teacher 角色（無 organization-scoped 角色、非 system_admin）的使用者
When  他呼叫 GET /api/schools/{own_school_id}/members
Then  回應是 200，且名單只包含該校的成員

Given 同一個使用者
When  他呼叫 GET /api/schools/{other_school_id}/members
Then  回應是 403

Given 同一個使用者
When  他呼叫 POST /api/schools/{own_school_id}/semesters 建立新學期
Then  回應是 201（修復前是 403）

Given 一個被指派 org_admin 角色（org 底下有兩所學校）的使用者
When  他呼叫 GET /api/classrooms（列出全部班級）或任何一所學校的 members/classrooms
Then  回應不再因為 org_admin 身分而拿到跨校資料；只看得到自己開的班或自己是 school member 的學校

Given 一個透過 Google 或均一 SSO 登入、首次用 join code 加入某班級的新帳號
When  查詢該使用者的 UserRole
Then  存在一筆 (role=student, scope_type=school, scope_id=該班級的 school_id, is_active=true)

Given system_admin
When  呼叫任何上述端點
Then  一律 200（全域 bypass 不受影響）
```

## 8. 本 PR 範圍界線

**做**：§3「改成只看班級歸屬」＋「改成學校成員或系統管理員」＋「改成系統管理員才能用」三類的程式碼修正（含實作時才發現、原本漏列的 `app/dependencies/tenant.py::_check_classroom_access`）、`can()` 中心化模組、SSO/join 角色授予修正、權限矩陣測試、更新 `test_org_admin_scope_security.py`／`test_org_school_admin_locks_3530.py`／`test_org_dashboard.py`／`test_classroom_access_cross_text_3346.py`／`test_schools_api.py`（舊模型的「org_admin 本校 200」斷言要翻成新模型的「org_admin 不再有特權 → 403」，否則新舊測試互相打架；`test_schools_api.py` 另有一條把 get_user_org_ids() 的 bug 行為當 spec 鎖住，一併更正）。

**跑過一次全套 `backend/tests/`（6900+ 條）才抓到的額外兩個檔案**（第一輪只人工抽查約 15 個高風險檔案，沒抽到這兩個）：`tests/security/test_dynamic_security.py`（3 條：`test_idor_org_admin_cannot_read_cross_org_user` 的「同 org 200」正向控制、`test_roles_list_requires_admin_not_mere_org_member` 的「org_admin 200」、`test_med1d_org_admin_lists_only_own_org_classrooms` 的「org_admin 看得到自己 org 的班」——全部翻成 403／看不到）、`tests/test_admin_api.py`（4 條：`TestListUsers::test_list_returns_200_for_org_admin`、`TestGetUserDetail::test_get_detail_works_for_org_admin`、`TestAdminClassroomAccess::test_org_admin_can_view_any_classroom`、`TestAdminCreateClassroomForTeacher::test_org_admin_creates_classroom_for_teacher`——同樣全部翻成 403）。**全套跑完：7 failed → 0 failed，6894→6901 passed，44 skipped，29 xfailed，0 新增 regression。**

**不做（等 Young 回覆 §4 才做）**：任何 `alembic revision`、`School`/`User` schema 變更、教育部名錄匯入、註冊流程改搜尋選校、`POST /schools/join` 自助多校端點（除非 Young 選 §4.1 選項 A 並口頭/書面同意併入本 PR）。

**刻意不碰（out of scope，非本次任務，2026-11-01 校正版）**：`Organization`／`OrganizationPointsLog` 資料模型本體與 `organizations_crud.py` 的擁有者讀寫方式、`app/dependencies/tenant.py` 真正零呼叫端的那三個 Depends 工廠（先標 deprecated）、`testset.py`／`worksheets.py` 的角色白名單（跟租戶權限無關）、`league_service.py` 的同機構配對規則（既有 PRD 核定的業務規則）、前端 `ADMIN_ROLES`/`Sidebar` 對 `org_admin` 字串的引用（不會因為後端不再核發 org_admin 角色而壞掉，只是从此恆假分支，Phase 2 再清）。

## 9. 安全自審（commit 前，依 CLAUDE.md 規則）

本次改動全部是**授權判斷**（誰可以呼叫既有端點），沒有新增端點、沒有新增外部輸入面、沒有改變任何端點實際做的事。

- **Authn 邊界**：未動。逐檔確認每個被改動的端點仍掛 `Depends(get_current_user)` 或 `require_role(...)`，沒有任何一處從「需要登入」退化成「不需要登入」。
- **權限提升檢查**：所有變更只往兩個方向走，沒有第三種——
  1. **收斂**（移除 org_admin/org_owner 跨租戶 bypass）：`schools.py`／`semesters.py`／`classroom_crud.py`／`classroom_junyi_import.py`／`policies.py`／`tenant.py::_check_classroom_access`／`users.py`／`roles.py`／`feedback.py`／`gamification.py`／`organization_dashboard.py`／`organization_points.py` —— 這些只拿掉既有使用者（org_admin/org_owner）原本握有的跨校/跨人權限，不可能讓任何人拿到新的、更高的權限。
  2. **放寬但綁定在呼叫者自己已驗證的身分上**：
     - `semesters.py` 寫入權限從「system_admin/org_admin」放寬到「任一 school member」—— 影響範圍限定在**呼叫者自己所屬的那間學校**（`is_school_member` 查真實 `UserRole`，不可偽造），不涉及其他學校。
     - `gamification.py` 新增 co-teacher 可見（原本只認 primary teacher）—— co-teacher 身分來自既有 `ClassroomTeacher` 表（由班級擁有者邀請建立），不是自助可得；且這跟 app 其餘地方（`policies.require_student_visible_to_teacher`）本來就有的規則一致，是修掉不一致，不是新開權限。
     - `classroom_join.py` 新增角色授予（`ensure_school_student_role`）—— 只授予最低權限的 `student` 角色、只限該班級本來就綁定的 `school_id`、冪等（已有就不重複插入），比照既有三處（batch／CSV／均一匯入）已核准的同款邏輯。
     - `schools.py::list_schools` 從「org 過濾（對一般老師永遠回空）」改成「學校成員過濾」—— 使用者只看得到**自己的**學校，不是看到更多人的。
  - **結論：沒有任何一處讓使用者拿到原本不屬於他、且與他身分無關的資源。**
- **Fail-closed 檢查**：`can()` 對未註冊的 `(resource_type, action)` 組合丟 `ValueError`（FastAPI 未捕捉的例外 → 500，不會把資料吐出去，故障時是「拒絕」不是「放行」）；`is_school_member` 對 `school_id is None` 回 `False`；所有呼叫端都是 `if not can(...): raise HTTPException(403)` 的失敗封閉寫法，没有任何「预设允许、例外才擋」的反向邏輯。
- **測試寫法**：依規則一律用最低權限角色（school-scoped teacher / student，不借用 system_admin）寫正向案例，且每個「允許」都配一條「別人的/別校的」負向對照（見 §6 矩陣），避免「測試掛了但其實什麼都沒測到」的陷阱。
- **黑白箱 gate**：CLAUDE.md 規則要求 auth/rbac/permission 改動合併前跑 `owasp-blackbox-audit` skill；該 skill 預期對著一個活的部署環境用 ZAP 等工具跑 WSTG 類別掃描。本次在 PR 尚未部署到 preview 環境前先完成上述人工 WSTG-ATHZ（Testing for Authorization）對應項目的逐條自查；待 PR Preview 部署後，於 git-issue-pr-flow Phase 3 的 `/qa` 與 security review 步驟補一輪對 preview URL 的驗證（curl 不同角色 token 打上表矩陣中的端點，確認回應碼與本機測試一致）。
