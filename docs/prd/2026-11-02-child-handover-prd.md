# 帳號過戶（Child-Account Handover）— 附屬帳號轉一般帳號

Issue #3824 | 2026-11-02（設計定案 2026-11-03）

## 問題

老師批次建立 / CSV 匯入的學生帳號是「附屬帳號」：合成信箱
（`{username}@student.lingoleap.local`）、密碼由老師產生並印在卡片上，`created_by_teacher_id`
記著建立者（#3818）。只有這個建立者能在班級設定裡重設密碼。

但目前沒有任何路徑讓學生把這個附屬帳號變成完全自己擁有的一般帳號。學生升學、轉班、換老師，
或單純想用自己的 email 登入時，原建立者永遠保有重設密碼的權力，而且學生沒辦法走
`forgot-password`（合成信箱收不到信）。

## 設計決策：選 (b)「過戶」，不選均一的「合併」做法

題目給了兩條路：(a) 學生已有另一個自己的帳號，把附屬帳號的資料併過去（均一
`child-account:merge` 的實際做法，前提是學生本來就有兩個獨立帳號）；(b) 附屬帳號**直接**
轉成一般帳號，不經過合併。本次選 **(b)**：issue 標題與描述講的是「附屬帳號轉一般帳號」，
是單一帳號的狀態轉換，不是「兩個帳號變一個」；而且 (b) 不改變 `user.id`，所有以
`user_id`/`student_id` 關聯的資料表完全不受影響（零資料搬移，見下方「資料表盤點」），
不像 (a) 要處理任務重新指派、暱稱衝突、名單合併等這次用不到的複雜度。詳細比較見下方
「資料表盤點」與「不做的範圍」。

## 設計演進：三版，最終定案為「建立者核准制」

這個功能的完成機制（誰能讓過戶真正生效）前後改了三版，每一版都是被對抗式安全複審
（appsec-pentest-reviewer）抓到問題後修正的，記錄下來避免未來重蹈覆轍：

| 版本 | 完成機制 | 問題 |
|---|---|---|
| v1 單階段 | 呼叫一次 `claim-account` 就立刻清空 `created_by_teacher_id` | **H1（高風險）**：只要知道附屬帳號密碼（例如看到別人的登入卡），就能一次呼叫永久搶走帳號；#3818 之前，偷登入最多只是「看得到」，老師還能重設密碼救回來，v1 把這個「可救回」拿掉了 |
| v2 email 驗證兩階段 | 申請時只存 `pending_email`，要等驗證信的 token 被兌換才清空 `created_by_teacher_id` | 第二輪複審指出**只是降級，沒有關閉**：如果攻擊者申請時填的新 email 就是自己能收信的信箱，他可以在一分鐘內「改密碼 → 申請過戶 → 兌換自己的 token」一次做完，過程中沒有任何通知讓老師知道要介入。而且 `settings.is_dev` 在 staging/production 都是 `False`、兩個環境都沒接寄信，這個機制在持久環境裡根本無法完成第二階段——**風險沒解除，只是現在剛好沒被觸發** |
| **v3 建立者核准制（本次定案，Young 2026-11-03 明確指示）** | 申請時只存 `pending_email`，要等**建立這個帳號的老師**在班級名單上明確按「核准」，才清空 `created_by_teacher_id` 並把 email 寫入 | **完全關閉 H1**：核准動作需要一個獨立的第二人（記錄在案的建立者老師）主動介入，不依賴任何本來就沒接上的基礎設施（寄信）。跟均一「附屬帳號由建立者控管」的方向一致 |

v2 的設計與分析過程見 git history（`docs/prd/2026-11-02-child-handover-prd.md` 的早期版本）；
本文件只保留最終定案（v3）的完整規格。

## 最終設計：建立者核准制

### 三個端點

| 端點 | 呼叫者 | 動作 |
|---|---|---|
| `POST /auth/claim-account` | 附屬帳號本人（需知道目前密碼） | **只送出申請**：驗證目前密碼、設定新密碼（立刻生效）、把想要的新 email 存進 `User.pending_email`。**不**動 `email`、**不**動 `created_by_teacher_id` |
| `POST /classrooms/{id}/students/{student_id}/approve-claim` | 這個學生的密碼教師（`created_by_teacher_id`，或 system_admin） | **核准**：把 `pending_email` 寫進 `email`、清空 `pending_email`，**這時候才**清空 `created_by_teacher_id` |
| `POST /classrooms/{id}/students/{student_id}/reject-claim` | 同上 | **拒絕**：清空 `pending_email`，`created_by_teacher_id` 不動（老師保留完整權限） |

`approve-claim` / `reject-claim` 跟 #3818 的 `reset-password` **共用同一道授權檢查**
（`helpers.py::require_renameable_student_target`，#3828 rebase 時與 reset-password／
rename_student 整併成的共用函式）：
呼叫者必須在這個班級的學校持有 active 的 `teacher` 角色，**且**必須是這個學生的
`created_by_teacher_id` 本人（system_admin 可略過兩項）。這是刻意的設計：
「誰能救回這個帳號的密碼」跟「誰能核准／拒絕把這個帳號永久交出去」必須是同一個人。

教師重設密碼時（#3818 既有端點），如果該帳號有待核准的申請，**一併撤銷**（清空
`pending_email`）——申請人證明自己知道的是「舊密碼」，重設之後那個基礎已經不成立，
不該讓一筆基於舊密碼送出的申請之後還能被核准。

### 為什麼這樣能完全關閉 H1

知道附屬帳號密碼的人（不管是真正的學生，還是看到卡片的同學）呼叫 `claim-account`
**最多只能送出申請**。申請本身不改變 `email` 或 `created_by_teacher_id`。要讓申請生效，
**必須**有另一個獨立的人——這個帳號記錄在案的建立者老師——主動在班級名單上按下核准。
沒有任何自動化路徑、沒有驗證信、沒有 token 可以讓申請人自己完成過戶。

對照 v2：v2 的防線建立在「申請人是否剛好不是新 email 的擁有者」這個攻擊者可控的條件上
（如果攻擊者填自己的 email，v2 的防線形同虛設）。v3 的防線建立在「核准者是不是另一個、
身分固定、系統裡已經記錄好的人」——這個條件**不受申請人控制**，無論申請人填誰的 email
都一樣擋得住。

### 班級名單可見性

`StudentInClassroomResponse` 新增 `pending_claim_email: str | None`，計算方式跟既有的
`can_reset_password` 同一個授權門檻（只有密碼教師或 system_admin 看得到非 null 值）——
老師在看到「這個學生有一筆申請、對象 email 是什麼」之後，才決定核准或拒絕。此為後端欄位，
UI 呈現不在本次範圍（見下方「不做的範圍」）。

## 誰能做這件事（必須知道密碼 / 已登入該帳號）—— 僅適用於「申請」

申請端點只對 `current_user`（呼叫者自己）生效，沒有任何「指定別人的帳號」參數。
要觸發申請，必須先能拿到這個帳號的 JWT（唯一取得方式是 `POST /api/auth/login`，
需要知道這個帳號的帳密），再加一層 `current_password` 欄位重新驗證一次（同
`POST /api/auth/change-password` 的防禦模式）。**但如前所述，知道密碼只能送出申請，
不能讓申請生效**——核准權完全在建立者老師手上。

## 驗收條件（Given / When / Then）

**AC1 — 送出申請後仍是待核准狀態**
Given 老師 A 批次建立學生帳號 S，S 已完成強制改密碼
When S 用目前密碼呼叫 `POST /auth/claim-account`，帶上新 email + 新密碼
Then 回應 200；直接讀 DB：`S.email` 不變、`S.pending_email` 變成新 email、
`S.created_by_teacher_id` 仍是 A

**AC2 — 偷密碼的人最多只能送出申請，無法自行完成過戶（核心 H1 鎖）**
Given 某人（不管是不是真正的學生）知道 S 的密碼並已登入
When 該人送出過戶申請，接著嘗試自己呼叫 `approve-claim`
Then 申請可以送出（200），但 `approve-claim` 回 403（呼叫者不具教師身分）；
S 的帳號狀態（email、created_by_teacher_id）全程未變

**AC3 — 不是建立者的老師（同班協同老師）核准／拒絕都回 403**
Given S 由 A 建立，B 是 S 所在班級的協同老師（`ClassroomTeacher`，非建立者）
When B 呼叫 `approve-claim` 或 `reject-claim`
Then 回應 403；S 的 `pending_email` 與 `created_by_teacher_id` 都不變
（此為 mutation-test 驗證過的鎖——第一版測試誤用了「完全不相關班級的老師」，
會被外層 `require_classroom_member` 擋下而非這條檢查本身，是vacuous pass；
修正後改用「同班協同老師」確保真正測到 `require_renameable_student_target`）

**AC4 — 建立者核准後，學生用新帳密登入，原建立者重設密碼回 403**
Given S 已送出申請（pending）
When A（建立者）呼叫 `approve-claim`
Then 回應 200；直接讀 DB：`S.email` 變成申請的新 email、`S.pending_email` 為 `NULL`、
`S.created_by_teacher_id` 為 `NULL`；S 能用新 email + 新密碼登入，舊 email 登入失敗；
A 之後呼叫 `reset-password` 回 403

**AC5 — 建立者拒絕後，申請消失但建立者權限不變**
Given S 已送出申請
When A 呼叫 `reject-claim`
Then 回應 200；`S.pending_email` 變回 `NULL`，`created_by_teacher_id` 仍是 A；
A 仍可對 S 執行 `reset-password`（200）

**AC6 — 建立者在待核准期間重設密碼 = 撤銷申請**
Given S 已送出申請（pending）
When A 呼叫 `reset-password`
Then 回應 200；`S.pending_email` 變回 `NULL`；之後呼叫 `approve-claim` 回 404
（沒有待核准的申請了）

**AC7 — 過戶（含完整學習紀錄）不影響班級關係與學習紀錄**
Given S 在送出申請前已加入某班級、有作業提交紀錄（`AssignmentSubmission`）
When 申請送出並被核准
Then `ClassroomStudent` 的那一列 `student_id` 不變，`AssignmentSubmission` 的那一列
`student_id` 不變（因為 `user.id` 從頭到尾沒變，見下方資料表盤點）

**AC8 — 每個動作都留一筆稽核紀錄**
Given 申請（成功或失敗）、核准、拒絕、因重設密碼而撤銷
When 各動作發生
Then `audit` logger 收到對應的 `claim_account_requested` /
`claim_account_completed` / `claim_account_revoked` 紀錄，含舊 email、新 email、
建立者 id 等細節（`extra` 欄位，見下方 API 變更）

**AC9 — 新 email 已被使用，或已被別人申請中，回 409**
Given 另一帳號 T 已持有或正在申請 `new_email`
When S 申請過戶填同一個 `new_email`
Then 回應 409，S 的欄位不變

**AC10 — 弱密碼在 email 查重之前就被拒絕（M1）**
Given `new_email` 已被使用，`new_password` 不符合強度規則
When S 申請過戶
Then 回應 422（不是 409）—— 避免拿弱密碼當「這個 email 存不存在」的免費探針

**AC11 — 尚未完成強制改密碼的帳號，連申請都打不進去**
Given 老師批次建立學生帳號 S，S 從未呼叫過 `change-password`
When S 呼叫過戶申請端點
Then 回應 403 `PASSWORD_CHANGE_REQUIRED`（#3438 既有的門擋在最外層，過戶端點刻意
**沒有**被排進豁免清單）

**AC12 — 已經是一般帳號的呼叫者，申請會被拒絕**
Given 某帳號 U 是自行註冊的（`created_by_teacher_id` 本來就是 `NULL`）
When U 呼叫過戶申請端點
Then 回應 400

**AC13 — 核准時的真實競態（L2）**
Given 兩個帳號都申請同一個 `new_email`（第二個繞過申請時的查重，直接在 DB 層造成，
模擬真實競態）
When 兩邊的建立者都呼叫 `approve-claim`
Then 先核准的那個 200；後核准的那個回 409（而不是未捕捉的 500），且後者的
`created_by_teacher_id` 不會被誤清空

## 不做的範圍（Out of Scope）

- **帳號合併**（均一 `child-account:merge` 那種「兩個既有帳號併成一個」）—— 見上方設計決策。
- **前端 UI**（班級名單上顯示申請、核准／拒絕按鈕的實際介面）—— 這次只做後端 API +
  `pending_claim_email` 欄位 + 測試，介面實作另開票。
- **通知機制**（核准者沒被主動通知有申請，要自己進班級名單才看得到）—— v2 階段的複審曾要求
  在接寄信前做通知機制；v3 採用核准制後，通知仍是「可用性」改善（讓老師更快發現），
  不是安全要件（没有通知，申請就是停在那裡等，不會自己生效），所以本次不做，列為後續
  UI 票的一部分。
- **已被停用教師角色的建立者，核准權連動**——跟 #3818 PRD 一致的立場：不特別處理。
- **家長 Portal 相關的過戶**——只收斂教師建立的附屬帳號，不碰家長那條線。
- **`pending_email` 到期時間**——一個帳號理論上可以無限期佔住一個 email 讓別人申請時一直撞
  409；這是低風險的產品體驗問題（不是安全問題，因為沒有核准就不會生效），本次不做，
  有需要再開票。

## 資料表盤點（user_id / student_id 關聯，#3824 要求逐一列出）

選擇 (b) 之後，所有以下資料表**完全不需要改動**——`user.id` 自始至終不變，只有
`users` 表自己的欄位（`email` / `password_hash` / `pending_email` /
`created_by_teacher_id`）被更新，且 `email` / `created_by_teacher_id` 只在
**核准時**才變動：

| 資料表 | 關聯欄位 | 是否受影響 |
|---|---|---|
| `classroom_students` | `student_id` | 否——同一個 id，班級關係原封不動（AC7） |
| `classroom_teachers` | `teacher_id` | 否——與本次無關 |
| `assignments` / `assignment_submissions` | `teacher_id` / `student_id` | 否（AC7 直接驗證） |
| `learning_sessions`（`session.py` 兩張表） | `student_id` | 否 |
| `student_profiles` | `user_id` | 否——`StudentProfile` 原樣保留，`school_id` 不變 |
| `reading_history` | `student_id` / `teacher_id` | 否 |
| `team_arena` | `student_id` / `teacher_id` | 否 |
| `pk`（PK 對戰三張表） | `student_id` / `side_a_user_id` / `side_b_user_id` / `winner_user_id` | 否 |
| `live_quiz` | `user_id` | 否 |
| `mcq_attempt` / `mcq_rescue_session` | `user_id` | 否 |
| `escape_room` | `student_id` | 否 |
| `ai_usage` | `student_id` | 否 |
| `gamification`（points / streak / achievements） | `user_id` | 否 |
| `points_log` | `user_id` | 否 |
| `notification_read` | `teacher_id` | 否 |
| `parent_link`（家長綁定） | `student_id` / `created_by` / `used_by` | 否——過戶不動家長連結（out of scope） |
| `student_tag` | `user_id`（兩欄） | 否 |
| `teacher_instruction` | `teacher_id` / `student_id` | 否 |
| `story_pack` / `story_tag` / `text` | 建立者相關欄位 | 否 |
| `league`（PK 賽季四張表） | 各種 `*_by` / `*_user_id` | 否 |
| `omo_upload` | `user_id` | 否 |
| `semester` | `user_id`（建立者） | 否 |
| `feedback` | `user_id` | 否 |
| `toolbox` | `user_id` | 否 |
| `users`（自己） | `id`（PK，被 `created_by_teacher_id` 外鍵引用） | **是**——`password_hash`
  （申請時立即生效）、`pending_email`（申請時寫入、核准或拒絕或撤銷時清空）、
  `email`／`created_by_teacher_id`（**只在核准時**更新）；`id` 本身從頭到尾不變，
  所以所有指向它的外鍵（上面每一列）都繼續有效 |

（完整清單取自 `grep -rn 'ForeignKey("users.id"' backend/app/models/`，共 29 個關聯點。）

## API / Schema 變更

### `POST /api/auth/claim-account`（需登入，已完成 #3438 強制改密碼）

```python
class ClaimAccountRequest(BaseModel):
    current_password: str
    new_email: EmailStr
    new_password: str = Field(..., min_length=1, max_length=128)

class ClaimAccountResponse(BaseModel):
    message: str
```

業務邏輯（`services/account_claim_service.py::request_claim()`）。**檢查順序本身就是
安全修復的一部分**（M1：強度檢查必須在查 email 之前）：

1. `created_by_teacher_id is None` → 400（AC12）
2. `student_profile.password_changed is False` → 403（H1 防禦縱深，外層
   `_PASSWORD_CHANGE_EXEMPT` 已先擋一次，這裡是第二道，見 AC11）
3. `verify_password(current_password, ...)` 失敗 → 401
4. `enforce_password_strength(new_password)` → 422（AC10，順序在 email 查重**之前**）
5. `new_email` 已被使用或已被別人設成 `pending_email` → 409（AC9）
6. 更新 `password_hash`（立刻生效）、`pending_email = new_email`（**不**動 `email`
   或 `created_by_teacher_id`）、`student_profile.password_changed = True`
7. `db.commit()`。路由層在成功與每一種失敗分支都呼叫
   `audit_log_endpoint(action=AuditAction.CLAIM_ACCOUNT_REQUESTED, extra={...})`（AC8）

### `POST /classrooms/{id}/students/{student_id}/approve-claim`（分類於
`routes/classrooms/classroom_password.py`，與 reset-password 同檔、共用授權邏輯）

```python
class ApproveAccountClaimResponse(BaseModel):
    message: str
    email: str
```

1. `require_classroom_member`（外層：呼叫者是否看得到這個學生）
2. `require_renameable_student_target`（內層：呼叫者是否為 `created_by_teacher_id` 本人或
   system_admin —— 與 reset-password 共用的同一個函式）
3. `user.pending_email is None` → 404（沒有待核准的申請）
4. 寫入 `email = pending_email`、清空 `pending_email`、清空
   `created_by_teacher_id`；`db.commit()` 包 `try/except IntegrityError` → 409（AC13）
5. `audit_log_endpoint(action=AuditAction.CLAIM_ACCOUNT_COMPLETED, extra={previous_teacher_id, final_email})`

### `POST /classrooms/{id}/students/{student_id}/reject-claim`（同檔）

```python
class RejectAccountClaimResponse(BaseModel):
    message: str
```

同樣的兩層授權檢查；`user.pending_email is None` → 404；否則清空 `pending_email`
（`created_by_teacher_id` 不動）；`audit_log_endpoint(action=AuditAction.CLAIM_ACCOUNT_REVOKED, extra={"reason": "rejected_by_creator"})`。

### `reset_student_password`（#3818 既有端點）新增的撤銷邏輯

成功重設密碼時，若該帳號 `pending_email is not None`，一併清空 `pending_email`，並多發一筆
`audit_log_endpoint(action=AuditAction.CLAIM_ACCOUNT_REVOKED, extra={"reason": "password_reset_by_creator"})`（AC6）。

### `AuditAction` 新增三個成員

`CLAIM_ACCOUNT_REQUESTED` / `CLAIM_ACCOUNT_COMPLETED` / `CLAIM_ACCOUNT_REVOKED`。
`audit_log()` / `audit_log_endpoint()` 新增 `extra: dict | None` 參數，合併進 payload
的 `detail` 欄位（L1：稽核紀錄含舊 email、新 email、建立者 id、失敗原因等）。

### `StudentInClassroomResponse` 新增欄位

`pending_claim_email: str | None`——計算方式跟 `can_reset_password` 同一個授權門檻
（只有密碼教師或 system_admin 看得到非 null 值）。

### 限流（M2，維持不變）

`claim-account` 端點：IP 20 次／分、帳號 5 次／分，跟 `/auth/login` 同一套
`InMemoryRateLimiter`。

## 資料庫變更

```python
# app/models/user.py — User
pending_email: Mapped[str | None] = mapped_column(String(254), nullable=True, index=True)
```

Migration `d4e5clmemail_add_pending_email.py`（接續 #3818 的 `c3d4pwteach1`，`alembic
heads` 確認仍是單一 head）：idempotent `ADD COLUMN pending_email VARCHAR(254) NULL` +
`CREATE INDEX IF NOT EXISTS`，無 FK（純字串，不是外鍵）、無回填（全新概念，沒有舊資料可
回填）。**Young 已確認**：2026-11-02 的「DB 直接改」授權涵蓋這次功能會用到的欄位，
包含 `pending_email`（2026-11-03 於 PR 討論中再次明確確認）。

`created_by_teacher_id`（#3818 既有欄位）本次把清空的時間點從申請延後到核准，
欄位本身的 schema 不變，只是何時寫 `NULL` 不同（由老師的核准動作觸發，不是任何
自動化流程）。

**不再需要 `email_verification_token` / `email_verified` 參與這個流程**——v2 階段曾讓
過戶流程借用既有的 email 驗證欄位，v3 改用老師核准後，這兩個欄位恢復成只服務原本的
註冊驗證信流程，`email_verification_service.py` 完全沒有被本次改動觸碰。

## 安全複審總結

**H1（高風險，已完全關閉）**：單階段設計（v1）與 email 驗證兩階段設計（v2）都未能
完全關閉「知道附屬帳號密碼即可搶走帳號」這個風險；v3 的建立者核准制讓完成過戶
**必須**有另一個獨立、身分固定的人（記錄在案的建立者老師）主動按下核准，不依賴
申請人填的 email、也不依賴任何尚未建置的寄信基礎設施。測試
`test_stolen_credentials_cannot_transfer_the_account` /
`test_non_creator_teacher_cannot_approve_403` 鎖住這個結論，並經過 mutation testing
驗證（移除 `require_renameable_student_target` 呼叫會讓對應測試真的變紅）。

**M1（已修）**：密碼強度檢查移到 email 查重之前。
**M2（已修）**：IP 20 次／分、帳號 5 次／分兩個限流桶。
**M3（因設計改變而不再適用）**：v2 階段 `resolve_google_user` 的 SSO email 搶注疑慮
建立在「有一個會被兌換的驗證 token」之上；v3 完全不產生這種 token，新 email 只有在
老師明確核准後才寫入 `users.email`，沒有任何中間的、可被攻擊者利用的「已佔用但未驗證」
狀態。
**L1（已修）**：成功與失敗的申請、核准、拒絕、撤銷都留稽核紀錄，含舊 email、新 email、
建立者 id。
**L2（已修）**：核准時的 `IntegrityError` 轉成 409，不是未捕捉的 500。

**衍生、另開票的項目（與 #3824 程式碼無關的既有問題）**：#3830 —— (1)
`PreviewModeWriteGuardMiddleware` 的 `startswith("Bearer ")` 大小寫判斷問題（`main.py`
約 830 行）(2) `resolve_google_user` 不檢查本地 `email_verified` 就連結帳號
（`register()` 本身的既有問題，與本次過戶流程無關）。兩者都在本次開工前就存在。

**#3829（v2 階段開的「H1 殘餘風險」票）**：v3 的核准制從根本上解決了 #3829 記錄的問題
（冷卻期、老師可見性、token 濫用、token 到期全部不再適用，因為整個流程不再使用
email 驗證 token），該票已關閉並說明已被 v3 設計取代。
