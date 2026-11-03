# PRD: 協同老師「只能看」角色 + 邀請接受流程

- Issue: #3820
- Branch: `feat/issue-3820-coteacher-viewonly`
- Author: Claude AI（git-issue-pr-flow agent，代 Young 開發）

## 1. 現況

`backend/app/routes/co_teaching.py` 目前只有兩種身份：

- `primary`（主老師，即 `Classroom.teacher_id`）
- `assistant`（協同老師，邀請送出後**立刻生效**，沒有待確認狀態）

實測全 repo 後發現：**`assistant` 在大部分寫入端點其實已經被擋在 owner-only 之外**
（`require_classroom_owner`／`require_owner_or_admin`），唯一明確允許協同老師寫入的是
`classroom_password.py` 的重設密碼端點 —— 程式碼註解寫明這是「explicit product
requirement」。換句話說，「助教可以改東西」目前只對密碼重設成立；其餘寫入動作
（加/移除學生、班級設定、派作業）助教其實也做不到。

本次需求把這個隱含模型講清楚、做成兩個正式角色：

| 角色 | 讀 | 寫（班級管理/派作業/密碼） | 備註 |
|---|---|---|---|
| `editor`（原 `assistant` 更名） | ✅ | ✅ | 等同現有助教 + 補齊原本該有的管理寫入 |
| `viewer`（新增） | ✅ | ❌ | 只能看 |

## 2. 資料模型變更

`ClassroomTeacher`（`backend/app/models/school.py`）新增兩欄：

```python
status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="accepted")
accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

`role` 欄位值域改為 `primary | editor | viewer`（原 `assistant` 停用，只在歷史資料裡回填掉）。

Migration（one revision, idempotent）：
1. `ALTER TABLE classroom_teachers ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'accepted'`
2. `ALTER TABLE classroom_teachers ADD COLUMN accepted_at TIMESTAMPTZ NULL`
3. `UPDATE classroom_teachers SET role = 'editor' WHERE role = 'assistant'`
4. `UPDATE classroom_teachers SET accepted_at = invited_at WHERE status = 'accepted'`（既有資料回填，無侵入性）
5. downgrade：反向操作（role 轉回 assistant、drop 兩欄）

**回填後原本行為不變**：既有助教 row 變成 `role=editor, status=accepted`，立即可用，不需要重新邀請/接受。

## 3. 邀請／接受／拒絕／撤回 流程

參考均一（JunyiAcademy）既有的 editor/viewer 機制，但 LingoLeap 用「每個協同關係一列」
的 row-based model（不是均一那種 4 個 email list），所以設計上簡化：

- **狀態只有兩種**：`pending` → `accepted`。沒有 `rejected` 狀態持久化 —— 拒絕 = 被邀請人
  自己 DELETE 該筆（跟「離開班級」是同一個動作，均一也是這樣做：reject = remove self from
  pending list）。
- **邀請**：`POST /classrooms/{id}/teachers` body `{email, role}`，建立 `status=pending` 的
  row。對已存在使用者（pending 或 accepted）回 409。
- **接受**：`POST /classrooms/{id}/teachers/{teacher_id}/accept` —— 僅被邀請人本人（
  `current_user.id == teacher_id`）；僅 `status=pending` 可接受（否則 409）；成功後
  `status=accepted, accepted_at=now()`。
- **拒絕 / 離開 / 撤回**：沿用既有 `DELETE /classrooms/{id}/teachers/{teacher_id}`
  （owner 可撤回/移除任何人；本人可移除自己）。不分 pending/accepted，同一支端點。
- **改角色**：`PATCH /classrooms/{id}/teachers/{teacher_id}` body `{role}` —— owner-only，
  不可對 `role=primary` 的那筆操作；不分 pending/accepted 都可以改（均一也是「保留
  pending/accepted 狀態不變，只換角色」）。
- **待我確認的邀請列表**：`GET /co-teaching/invitations` —— 回傳目前使用者所有
  `status=pending` 的邀請（跨班級），因為 pending 狀態下使用者對該班級還沒有任何讀取權限，
  無法從班級頁面看到，需要一個獨立入口。

**關鍵不變量**：`status != accepted` 的協同關係，在系統任何地方都不算「班級成員」——
不能列在 `GET /classrooms`、不能讀班級詳情/學生名單/作業/報表，直到接受為止。

## 4. 權限矩陣（新增 `require_classroom_editor`）

`backend/app/auth/policies.py` 新增：

```python
def require_classroom_editor(classroom, user, db) -> None:
    """owner / system_admin / org_admin(scoped) / 'editor' 角色且已接受的協同老師。"""
```

`require_classroom_member` 同步修正：只有 `status == "accepted"` 的協同老師才算成員
（不分 editor/viewer，讀取權一視同仁）；`require_student_visible_to_teacher` 的
correlated EXISTS 子查詢同步加上 `status == "accepted"`。

### 寫入端點清單（本次從 owner-only 改成 editor-level，viewer 被擋）

| 端點 | 檔案 | 原本 | 改為 |
|---|---|---|---|
| `POST /classrooms/{id}/students` 新增學生 | `classroom_students.py` | owner | editor |
| `DELETE /classrooms/{id}/students/{sid}` 移除學生 | `classroom_students.py` | owner | editor |
| `POST /classrooms/{id}/students/search` 搜尋可加入學生 | `classroom_students.py` | owner | editor |
| `POST /classrooms/{id}/students/batch` 批次建立學生 | `classroom_batch.py` | owner | editor |
| `POST /classrooms/{id}/students/upload-csv` CSV 匯入 | `classroom_csv.py` | owner | editor |
| `PATCH /classrooms/{id}` 班級設定（名稱/年級/啟用） | `classroom_crud.py` | owner | editor |
| `POST /classrooms/{id}/regenerate-code` 重生加入代碼 | `classroom_join.py` | owner | editor |
| `POST /classrooms/{id}/texts` 指派教材 | `classroom_texts.py` | owner | editor |
| `DELETE /classrooms/{id}/texts/{tid}` 取消指派教材 | `classroom_texts.py` | owner | editor |
| `POST /classrooms/{id}/assignments` 建立作業 | `assignments.py` | owner | editor |
| `PATCH /assignments/{aid}` 更新作業 | `assignments.py` | owner | editor |
| `DELETE /assignments/{aid}` 刪除作業 | `assignments.py` | owner | editor |
| `PATCH /assignments/{aid}/submissions/{sid}` 批改 | `assignments.py` | owner | editor |
| `POST /teacher/students/{sid}/instructions` 建立個別指示 | `teacher_instructions.py` | owner | editor |
| `POST /classrooms/{id}/students/{sid}/reset-password` 重設密碼 | `classroom_password.py` | **member**（已是產品需求，所有協同老師皆可）| **editor**（viewer 擋掉） |
| `PATCH /classrooms/{id}/pk-settings` 遊戲化功能開關（真人PK/跨班賽季/課堂搶答） | `classroom_pk_activity.py` | owner | editor |
| 課堂搶答（live_quiz）建立/管理場次 | `services/live_quiz/engine.py` `_require_classroom_owned_by` | 任何協同老師(不分角色/狀態) | editor（且 status=accepted） |

### 刻意維持 owner-only（不開放給 editor）

- `DELETE /classrooms/{id}` 刪除班級 —— 破壞性操作，規格未明確要求開放，保守不變
- `POST/PATCH/DELETE /classrooms/{id}/teachers*` 協同老師管理本身（邀請/改角色/移除）—— 需求 #4 明定「主老師可以」

### 讀取端點（本次從 owner-only 放寬成 member-level，viewer 也能看）

| 端點 | 檔案 | 原本 | 改為 |
|---|---|---|---|
| `GET /classrooms/{id}/assignments` 作業清單 | `assignments.py` | owner | member |
| `GET /assignments/{aid}` 作業詳情含學生提交 | `assignments.py` | owner | member |
| `GET /classrooms/{id}/pk-activity` PK/賽季/搶答活動總覽 | `classroom_pk_activity.py` | owner | member |

其餘報表/數據類端點（`teacher_dashboard.py` / `teacher_reports.py` / `teacher_analytics.py` /
`teacher_classroom_stuck.py` / `teacher_assignment_matrix.py` / `teacher_live_monitor.py` /
`teacher_cross_text.py` / `teacher_alerts.py`）共用 `app/dependencies/tenant.py` 的
`_check_classroom_access`，本來就是 member-level（不分角色），只需要補上
`status == "accepted"` 過濾，不需要逐一改檔案。

### 刻意「不」放寬的讀取端點（讀取但仍限 editor，不開放給 viewer）

| 端點 | 檔案 | 理由 |
|---|---|---|
| `GET /teacher/assignments/{aid}/submissions/{sid}/reading-audio` 聽學生朗讀錄音 | `teacher_audio_replay.py` | 學生的原始語音錄音比「作業/報表」更敏感（涉及未成年人生物特徵相關資料），需求 #3 的「可以看作業和報表」未明確涵蓋。維持改動前 editor 就有的存取層級，不隨其餘讀取端點一起放寬到 viewer |
| `GET /teacher/assignments/{aid}/submissions/{sid}/reading-attempts(/{attempt_id}/audio)` 同上 | `teacher_audio_replay.py` | 同上 |

### Security sweep（code-reviewer 對抗複審抓到的缺口，已修）

- `classroom_students.py: _eligible_student_ids` 的 `my_classrooms` 聯集原本沒有
  `status == "accepted"` 過濾 —— 在自行開通／公開 email 網域學校情境下，一個**還沒接受**
  的協同邀請就能讓被邀請人把「被邀班級」的學生拉進自己另一個無關班級的搜尋/新增學生流程，
  違反本次「pending 無任何存取權」的不變量。已補上過濾，regression lock 見
  `tests/test_self_serve_teacher_3804.py::TestPendingCoTeachingInviteDoesNotLeakTheOtherClassroomsStudents`
  （對 mutation 驗證過：拿掉過濾會讓該測試組轉紅）。

### Out of scope（已知、非本次引入，不處理）

- `classroom_texts.py: list_classroom_texts` 的 fallback 鏈（owner 或「enrolled 學生」），
  協同老師目前任何角色都看不到教材清單——不分 editor/viewer 都一樣，非本次退化。
- `learning_reading_history.py: _get_target_cpm` 用全體協同老師（不分狀態）決定
  「哪位老師設的 CPM 目標優先」的 tie-break，不是存取閘門，非資安問題。
- `teacher_reading_progress.py: _require_can_set_targets` 用「是否曾經是任何班級的協同
  老師」當粗粒度「這人算不算老師」的判斷，非本次 classroom-scoped 權限範圍。

## 5. 前端

- `CoTeachingTab.tsx`：邀請表單加角色選擇（可編輯/只能看，預設可編輯）；教師列表顯示
  狀態徽章（待確認/已接受）；owner 可對既有協同老師改角色（下拉選單）；「離開班級」條件
  從 `role === 'assistant'` 改成 `role !== 'primary'`；pending 邀請的移除按鈕文案改「撤回」。
- 新增「待我確認的邀請」：`TeacherDashboard.tsx` 頂部顯示一張卡片（如果
  `GET /co-teaching/invitations` 回傳非空），列出「OO 老師邀請你以 可編輯/只能看 身份
  加入『班級名稱』」+ 接受/拒絕按鈕。

## 6. 驗收

- staging 用三個新註冊帳號走一次：owner、editor、viewer，各自打過能做/不能做的動作，
  附狀態碼與截圖。
- 只到 staging，不上 main/production。
