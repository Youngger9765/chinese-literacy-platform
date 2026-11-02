# 密碼教師（Password Teacher）— 誰能幫學生重設密碼

Issue #3818 | 2026-11-02

## 問題

均一的規則：老師或家長幫學生建的「附屬帳號」，建帳號的那個人就是這個學生的
「密碼教師」。學生忘記密碼時，只有密碼教師能在班級設定裡重設密碼。學生自己
註冊的帳號（Email、Google、均一 SSO），老師不能幫他重設，學生自己走「忘記
密碼」。

我們現在的狀況：`POST /classrooms/{classroom_id}/students/{student_id}/reset-password`
只要呼叫者是這個班的老師（擁有者／協同老師／admin），且目標帳號在這個班、具
有學生身分，就能重設。只要學生自己註冊帳號、再用加入代碼加入班級，這個班的
任何老師都能重設他的密碼 —— 這比均一寬，也就是這次要收斂的洞。

均一團隊的參考做法（讀自 `JunyiAcademy/junyiacademy` staging 分支，
`backend/junyi/user/user_models.py` 附近的 `ParentChildPair` / `spawn_child`，
以及 `backend/app/api/v2/user.py` 的密碼 API 權限檢查）：用一張獨立的關聯表
記錄「子帳號屬於誰」，建子帳號時同時建立這個關聯並把建立者設為 coach，密碼
API 只看這個關聯（不看班級關係），轉移用 `update_bond`，每次重設都留 log。

我們這次不做獨立關聯表，改成在 `User` 上加一個欄位記錄建立者（原因見下方
「設計決策」），其餘精神一致：**建立者判斷不靠班級關係推算，要有明確記錄；
密碼重設只看這個記錄；每次重設都留稽核紀錄**（我們已經有
`AuditAction.RESET_STUDENT_PASSWORD` 的 `audit_log_endpoint`，本次不需要新
建資料表）。

## 設計決策

### 為什麼用 `User.created_by_teacher_id` 而不是均一的獨立關聯表

均一的 `ParentChildPair` 支援「一個子帳號同時連去好幾個情境」且要處理
`update_bond`（轉移）、「子帳號綁 email 後自動脫離家長」等生命週期。我們這次
的範圍明確縮小：只回答「這個帳號是誰建的」，而且這次**不做帳號轉手**（見
「不做的範圍」）。一個 nullable 外鍵欄位就能表達「建立者」，且天然滿足
「一個帳號最多一個建立者」。等真的需要轉手／多重綁定時，再按當時需求決定要
不要抽成獨立表，不在這次預先蓋。

### 為什麼不能沿用既有的 `UserRole.granted_by`

`UserRole.granted_by` 記錄「這個學生角色是誰授予的」，批次建立 / CSV 匯入 /
均一班級匯入都會在建帳號的同一個交易內把它設成操作者 —— 乍看可以直接當建立
者用。但它在兩種情況下跟「帳號是誰創的」脫鉤：

1. **角色可以在帳號創建之後才被授予**：管理員用 `/roles/assignments`
   手動給一個已存在的帳號加學生角色、或均一班級匯入遇到「已存在的帳號」（例如
   這個學生之前已經透過均一 SSO 自己登入建立過帳號）時，也會補上角色並把
   `granted_by` 設成這次操作的老師 —— 但帳號本身不是這個老師建的。
2. **均一 SSO 新帳號目前完全沒有角色授予**（`resolve_junyi_user` 只建
   `User`，沒有建 `UserRole`）—— 這類自建帳號在 `granted_by` 上完全找不到
   痕跡，若誤用 `granted_by` 當建立者判準，這類帳號會被永遠排除在「有密碼
   教師」之外（這本來就是我們要的 fail-closed 結果，但代表 `granted_by`
   不是穩定可靠的「建立」訊號，不能拿來做本次權限判斷的 SOT）。

所以必須是一個只在「建帳號那個當下」寫入、之後不會被其他操作動到的欄位。

### 誰算「建立者」

| 建立路徑 | 是否設定 `created_by_teacher_id` |
|---|---|
| 老師批次建立學生（`POST /classrooms/{id}/students/batch`） | ✅ 設為呼叫者 |
| 老師 CSV 匯入學生（`POST /classrooms/{id}/students/upload-csv`） | ✅ 設為呼叫者 |
| 均一班級匯入 **新建** 的學生帳號（`import_junyi_classes`，`student is None` 分支） | ✅ 設為匯入的老師 |
| 均一班級匯入 **重用既有帳號**（學生已自行用均一 SSO 登入過，或已被別的老師匯入過） | ❌ 不動，維持原值 |
| 老師把既有帳號加入班級（`POST /classrooms/{id}/students`，依 user id 加人） | ❌ 不動 |
| 學生自己用加入代碼加入班級（`POST /classrooms/join`） | ❌ 不動（這條路徑本來就不建立任何帳號） |
| 自我註冊（Email／Google／均一 SSO 首次登入） | ❌ 永遠是 `NULL` |
| 系統管理員角色指派（`/roles/assignments`） | ❌ 不動 |

### 權限收斂（兩道獨立檢查，缺一不可 — 2026-11-02 安全複審後修正）

`reset_student_password` 最初版本把「呼叫者必須在這個學校持有 active 的
`teacher` 角色」整條拿掉，只留「呼叫者必須是 `user.created_by_teacher_id`
本人」。安全複審標出中風險：`require_classroom_member` 只查
`classroom.teacher_id` / `ClassroomTeacher` 是否有這個人，**不驗證那個人
現在是不是還持有有效的 `teacher` 角色** —— 老師的身分被管理員停用、或已
離開那間學校之後，只要當初是他建的帳號，原始版本仍然會放行。

修正後兩道檢查都要過（system_admin 例外）：
1. **原本就有的檢查保留**：呼叫者必須在這個班級的學校持有 active 的
   `teacher` 角色。
2. **本次新增**：呼叫者必須是 `user.created_by_teacher_id` 本人。

原本允許協同老師重設的行為仍然**刻意取消**：均一的模型裡密碼教師是唯一的，
協同老師不算——即使協同老師的 teacher 角色是 active 的，只要他不是
`created_by_teacher_id`，一樣擋。其餘既有的防呆檢查（目標帳號必須是這個班、
這個學校的學生，不能是老師／管理員帳號，必須已加入班級等）全部保留不變。

## 驗收條件（Given / When / Then）

**AC1 — 建立者本人重設成功**
Given 老師 A 用批次建立（或 CSV 匯入）建立了學生帳號 S，S 已加入 A 的班級
When A 呼叫重設密碼
Then 回應 200，回傳的新密碼能直接登入 S 的帳號，舊密碼不能再登入

**AC2 — 協同老師（非建立者）重設被拒**
Given 學生帳號 S 由老師 A 建立並加入 A 的班級，老師 B 是這個班的協同老師
When B 呼叫重設密碼
Then 回應 403，S 的密碼不變

**AC3 — 自行註冊並用代碼加入班級的學生，老師重設被拒**
Given 學生自行註冊帳號（之後被授予學生角色，`created_by_teacher_id` 為
`NULL`），自己用加入代碼加入某老師的班級
When 該班的老師呼叫重設密碼
Then 回應 403，S 的密碼不變

**AC4 — 自行註冊的帳號，忘記密碼流程不受影響**
Given 任一自行註冊的帳號（不限是否為學生角色）
When 呼叫 `POST /api/auth/forgot-password` 取得 reset token，再呼叫
`POST /api/auth/reset-password`
Then 兩個呼叫都回應 200，新密碼能登入

**AC5 — 前端只對密碼教師顯示「重設密碼」**
Given 班級學生列表中有密碼教師是自己的學生、也有不是自己建立的學生（例如用
代碼自行加入的）
When 老師打開班級設定的學生列表
Then 自己建立的學生顯示「重設密碼」按鈕；不是自己建立的學生顯示
「請學生自己用忘記密碼重設」文字，不顯示按鈕

**AC6 — 舊資料回填（fail-closed）**
Given 正式環境既有資料
When migration 跑完
Then 能從既有資料判斷出建立者的帳號（合成信箱網域 `@student.lingoleap.local`，
透過其最早一筆學生角色的 `UserRole.granted_by` 回推）被補上
`created_by_teacher_id`；判斷不出來的帳號維持 `NULL`，重設密碼一律視為
「沒有密碼教師」而拒絕（403）

## 不做的範圍（Out of Scope）

- **帳號轉手**（學生從一個老師的班轉到另一個老師的班，密碼教師要不要跟著
  換）—— 均一有 `update_bond` 支援，這次不做。保持現狀：`created_by_teacher_id`
  一旦寫入就不會再被任何流程改動。
- **多重密碼教師 / 家長也能重設** —— 這次只收斂教師端，家長入口（Parent
  Portal）不碰。
- **已被撤銷教師角色的建立者還能不能重設** —— 不特別處理，沿用現有「呼叫者
  是不是這個帳號的建立者」單一判準。
- **新增獨立的重設紀錄資料表** —— 沿用既有的 `audit_log_endpoint` /
  `AuditAction.RESET_STUDENT_PASSWORD`，本次不新建表。

## 資料模型變更

```python
# app/models/user.py — User
created_by_teacher_id: Mapped[int | None] = mapped_column(
    ForeignKey("users.id"), nullable=True, index=True
)
```

Migration（已取得 Young 同意，2026-11-02）：
1. `ALTER TABLE users ADD COLUMN created_by_teacher_id INTEGER NULL` +
   `CREATE INDEX` + FK（idempotent，可重跑）。
2. 回填：
   ```sql
   UPDATE users u
   SET created_by_teacher_id = sub.granted_by
   FROM (
       SELECT DISTINCT ON (ur.user_id) ur.user_id, ur.granted_by
       FROM user_roles ur
       JOIN roles r ON ur.role_id = r.id
       WHERE r.name = 'student' AND ur.granted_by IS NOT NULL
       ORDER BY ur.user_id, ur.created_at ASC
   ) sub
   WHERE u.id = sub.user_id
     AND u.email LIKE '%@student.lingoleap.local'
     AND u.created_by_teacher_id IS NULL;
   ```
   只回填合成信箱網域（`@student.lingoleap.local`，批次建立 / CSV 匯入 /
   均一匯入新建帳號共用的網域），且用「最早一筆」學生角色的 `granted_by`
   （`DISTINCT ON ... ORDER BY created_at ASC`）—— 避免後續才補授予學生角色
   的操作覆蓋掉真正的建立者。其餘帳號（真實信箱、均一 SSO 真實帳號）留
   `NULL`。

## API / Schema 變更

- `StudentInClassroomResponse` 新增 `can_reset_password: bool`，由
  `classroom_to_detail_response` 依 `current_user` 計算。
- `reset_student_password` 的授權改為
  `is_system_admin(current_user) or user.created_by_teacher_id == current_user.id`。
