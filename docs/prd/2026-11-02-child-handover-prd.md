# 帳號過戶（Child-Account Handover）— 附屬帳號轉一般帳號

Issue #3824 | 2026-11-02

## 問題

老師批次建立 / CSV 匯入的學生帳號是「附屬帳號」：合成信箱
（`{username}@student.lingoleap.local`）、密碼由老師產生並印在卡片上，`created_by_teacher_id`
記著建立者（#3818）。只有這個建立者能在班級設定裡重設密碼。

但目前沒有任何路徑讓學生把這個附屬帳號變成完全自己擁有的一般帳號。學生升學、轉班、換老師，
或單純想用自己的 email 登入時，原建立者永遠保有重設密碼的權力，而且學生沒辦法走
`forgot-password`（合成信箱收不到信）。

均一的參考做法（讀自 `JunyiAcademy/junyiacademy` staging 分支）：

- `backend/app/api/v2/user.py` 的 `/api/v2/user/child-account:merge`：學生用**另一個已存在、自己的**帳號登入，輸入附屬帳號的帳號密碼，把附屬帳號的任務 / 暱稱 / 班級列表併進那個已存在的帳號，附屬帳號被刪除（`teacher.delete_child(child)`）。
- `frontend/components/profile/ChildAccountMergeDialog.tsx` + `useChildAccountMergeApi.ts`：對應的前端對話框，走同一支 merge API。

## 設計決策：選 (b)，不選均一的「合併」做法

題目給了兩條路：

- **(a) 合併**：學生已經有一個自己的帳號，把附屬帳號的資料併過去，附屬帳號停用。這是均一
  `child-account:merge` 實際在做的事 —— 它的前提是學生**已經存在兩個獨立帳號**（例如老師不知道
  學生已經自己註冊過、或學生在家又自己用均一 SSO 登入過一次），要解決「兩個帳號」變成「一個
  帳號」的問題。
- **(b) 過戶**：附屬帳號**直接**綁定學生自己的 email + 密碼，`created_by_teacher_id` 清空，
  同一個 `user.id` 從此以後就是一般帳號。沒有第二個帳號，不需要合併。

本次 issue 的標題與描述講的是「附屬帳號轉一般帳號」—— 單一帳號的狀態轉換，不是「兩個帳號
變一個」。選 **(b)**，理由：

1. **範圍對得上**：我們要解的問題是「這個帳號現在是誰的」，不是「這兩個帳號的資料怎麼合併」。
   選 (a) 等於去解一個這次沒人要求的問題（雙帳號合併），是本次不需要的擴大範圍。
2. **零資料搬移，零資料遺失風險**：(b) 不改變 `user.id`，所有以 `user_id` / `student_id`
   關聯的資料表完全不動——自然滿足「學習紀錄不能遺失」，不需要逐表搬移、不需要處理 unique
   constraint 衝突、不需要決定「兩邊都有的資料要留哪一筆」。(a) 的均一實作要處理任務重新指派、
   暱稱沖突、教練與學生名單合併等好幾種合併衝突，複雜度高出一個量級，而且本次完全用不到。
3. **不需要新建資料表或新欄位**：`created_by_teacher_id`（#3818 已建）本身就是「這個帳號還是
   不是附屬帳號」的完整狀態訊號——清空它就是「過戶完成」。`is_synthetic_email()`
   （`classrooms/helpers.py`）已經能判斷帳號目前是不是用合成信箱。不需要新 migration。
4. **均一的合併模型本來就是為了解決「兩個帳號」這個我們沒有的前提**：均一的學生可能在家用
   SSO 自行登入建立帳號，學校又幫他建一個附屬帳號，兩個帳號天生會並存。我們的學生帳號建立
   路徑（批次建立 / CSV 匯入 / 均一班級匯入新建）目前還沒有「附屬帳號 + 自建帳號同時存在」
   這種雙軌並存的情境，套用均一的合併模型等於預先蓋一套目前用不到的機制。

等真的出現「學生已經有自己的帳號，還想把附屬帳號資料併進來」這個需求時，再參考均一的合併
設計另開一張票——不在這次預先蓋。

## 誰能做這件事（必須知道密碼 / 已登入該帳號）

這個轉換**只對 `current_user`（呼叫者自己）生效**，沒有任何「指定別人的帳號」參數——
端點不吃 `student_id`，只操作 `get_current_user` 解出來的那一個帳號。所以：

- 要觸發這個動作，必須先能拿到這個帳號的 JWT —— 唯一取得方式是 `POST /api/auth/login` 打進去，
  而登入需要知道這個帳號的 username/email + 密碼。
- 在這之上再加一層 `current_password` 欄位，要求再輸入一次目前密碼（跟既有
  `POST /api/auth/change-password` 的 `old_password` 同一個防禦模式）——即使 JWT 已經證明
  「最近登入過」，高風險動作（永久拔除建立者權限）仍多驗一次密碼，防止留在裝置上沒登出的
  token 被盜用。

沒有任何角色或班級成員檢查，因為根本不需要——這條路徑天生就是「只能對自己」。

## ⚠️ 安全複審 2026-11-03：H1 從「單階段漏洞」降級，但沒有完全關閉

**誠實狀態（第二輪對抗式複審後的結論，不要讀成「已修好」）：H1 被降級，不是被關閉。**
第一輪複審抓到原始設計（單一呼叫立刻清空 `created_by_teacher_id`）**不能合併**：

> **只知道附屬帳號密碼的人，可以永久搶走帳號。** 國小班級的實體情境是：登入卡印在紙上，
> 同學互看彼此的卡很常見。在 #3824 之前，同學偷登入最多只是「看得到」，老師還能
> 重設密碼把帳號救回來。單階段設計把這個「可救回」拿掉了——任何人只要在真正的學生之前
> 搶先呼叫一次過戶端點，`created_by_teacher_id` 就永久清空，老師之後重設密碼變成 403，
> 只剩 system_admin 救得回來。而且原始設計把過戶端點排進 `_PASSWORD_CHANGE_EXEMPT`
> （#3438 的強制改密碼豁免清單），代表**連學生自己都還沒改過卡片密碼**，這個端點也能一次做完，
> 等於把「撿到卡就能永久佔走」的門檻降到最低。

**改法：兩階段過戶，不是一次到位。**

| 階段 | 端點 | 動作 | `created_by_teacher_id` |
|---|---|---|---|
| ① 申請 | `POST /auth/claim-account` | 驗 `current_password` → 設定新密碼（立刻生效）→ 把新 email 存進新欄位 `User.pending_email`（**不**寫進 `email`）→ 發一組驗證 token | **不動**，原建立者維持 |
| ② 完成 | `GET`/`POST /auth/verify-email` | 驗證 token 時，如果該帳號有 `pending_email`，才把它寫進真正的 `email`、清空 `pending_email`，**這一刻才清空** `created_by_teacher_id` | **這裡才清空** |

為什麼這樣能解決問題：
1. **老師在等待期間仍能救回帳號**：`created_by_teacher_id` 要等到驗證完成才清空，所以申請後、
   驗證前的這段時間，老師呼叫重設密碼**仍然回 200**（見 AC9）。
2. **重設密碼＝撤銷**：教師端 `reset_student_password`（`classroom_password.py`）在成功重設時，
   如果該帳號有待處理的過戶申請，**一併清掉** `pending_email` / `email_verification_token`——
   拿到的驗證 token 立刻失效（見 AC10）。這是「可以被撤銷」的具體實作，不是文件上說說。
3. **要完成過戶，必須真正控制新 email 的信箱**：正式環境驗證信是寄到 `new_email`，
   不是回傳在 API 回應裡（只有 `settings.is_dev` 才會把 token 直接回傳，供測試使用）。
   如果有人想用**別人的** email 搶注（另一個尚未完成驗證的攻擊面，複審 finding M3：
   `resolve_google_user` 只看 Google 自己的 `email_verified`，不看我方本地的 `email_verified`），
   兩階段設計讓這招對本功能**天生無效**——因為在驗證完成之前，`users.email` 根本沒有變成
   那個被搶注的 email（還停在原本的合成信箱），`resolve_google_user` 查不到、連不上。
   這個防護是**這次新增路徑的範圍內**解決；`resolve_google_user` 本身更通用的那個問題
   （`register()` 一樣存在、比我方這次更早）不在本次範圍，另開 issue 處理（見下方
   「衍生、另開票的項目」）。

**一次到位不等於更安全，等待期是刻意的取捨**：如果攻擊者申請時填的新 email **就是自己能收信的
信箱**，他可以馬上去收信、馬上完成驗證——兩階段本身不能讓這種狀況完全不可能發生，只能把
「立即、永久、無法挽回」改成「有一段視窗、可偵測、可撤銷、有稽核紀錄」。這跟 #3818 本身的
「兩道獨立關卡」設計哲學一致：不追求完美，追求可問責、可挽回。

### 第二輪複審：上面那句「取捨」實際上等於沒關 H1，誠實記下來

第二輪對抗式複審（同一位 reviewer，針對這次修完的版本）指出上面那段「取捨」寫得太輕鬆——
**實際攻擊路徑只要一分鐘**：攻擊者拿到卡片密碼後，(1) 呼叫 `change-password`
（這一步仍在 #3438 豁免清單裡，知道密碼就能做）(2) 呼叫 `claim-account`，`new_email` 填
**自己**能收信的信箱 (3) 立刻兌換驗證 token。全程老師沒有任何機會介入——因為**目前完全沒有
通知機制，班級名單上也看不到「這個學生有一筆待處理的過戶申請」**，「老師可以在等待期重設密碼
挽回」這個說法必須有人真的去做才成立，而現狀沒有任何東西會促使老師去做。

**為什麼現在沒出事（查證，不是信任）**：
- `settings.is_dev` 在 `ENVIRONMENT in ("staging", "production")` 時明確是 `False`
  （`backend/app/config.py`），所以 staging／production 的 API 回應**不會**外洩驗證 token。
- staging／production **目前完全沒有寄信邏輯**，token 不會透過任何管道送達任何人。
- 結論：**第二階段在 staging／production 目前根本無法完成**——不是因為攻擊者做不到，
  是因為這個功能本身在這兩個環境還沒有真正「活起來」。`ENVIRONMENT=preview`
  （PR 預覽部署，見 `.github/workflows/preview-deploy.yml`）的 `is_dev=True`，
  驗證 token **會**在 API 回應外洩，但 preview 是短暫環境、沒有真實學生資料，
  關閉 PR 就銷毀，複審同意這個風險面可以接受。

**誠實結論**：H1 從「單次呼叫、立即、永久、無從挽回」降級成「需要第二階段驗證信才生效、
目前在 staging/production 這兩個持久環境裡因為沒接寄信而實際上打不通」，**但設計本身
沒有解決「攻擊者用自己能收信的信箱」這個情境**——這不是安全控制生效，只是剛好現在沒有
寄信管線讓它被觸發。一旦日後接上真的寄信功能，或是有人在 preview 環境操作，風險會立刻變
成真實可利用。後續要在「接寄信」或「做老師端可見性 UI」之前完成的工作（冷卻期、token
到期、老師可見性／通知、resend-verification 的濫用缺口、`pending_email` 到期時間）已經
開進 #3829，列為那兩件事的前置阻擋項。

### 連帶修正（同一次安全複審，M/L 級）

| 編號 | 問題 | 修法 |
|---|---|---|
| M1 | 查 email 是否撞號（409）排在密碼強度檢查（422）之前——用任一個附屬帳號的密碼 + 刻意弱的新密碼，可以零風險、無限次測試任意 email 在平台上存不存在 | 密碼強度檢查移到 email 查重之前（見 `account_claim_service.request_claim()` 的檢查順序） |
| M2 | 過戶申請端點完全沒有限流，`current_password` 可以被無限次猜 | 加兩個 rate limit bucket：IP 20 次／分、帳號 5 次／分（跟 `/auth/login` 的雙桶模式一致） |
| L1 | 稽核紀錄只有「發生了什麼動作」，沒有舊 email／新 email／原建立者 id，失敗的嘗試（密碼錯誤）也沒留痕跡 | `audit_log()` / `audit_log_endpoint()` 加 `extra` 欄位；申請成功、申請失敗、完成過戶、撤銷過戶四種結果各自留一筆，新增三個 `AuditAction`：`CLAIM_ACCOUNT_REQUESTED` / `CLAIM_ACCOUNT_COMPLETED` / `CLAIM_ACCOUNT_REVOKED` |
| L2 | 兩個帳號同時申請過戶到同一個 email，查重跟寫入中間有空檔，真的撞上時在完成階段會丟未捕捉的 `IntegrityError`（500） | phase ② 的 `db.commit()` 包 `try/except IntegrityError`，捕到就回 409 而不是 500（`email_verification_service.verify_email_by_token()`） |

### 衍生、另開票的項目（複審有提到，不在本次範圍內修，已開票）

- **#3829** — H1 殘餘風險的後續工作（冷卻期、token 到期、老師可見性／通知、
  `resend-verification` 的濫用缺口 N2、`pending_email` 到期時間 N3），列為「接寄信」或
  「做老師端 UI」之前的必做前置項，見上方「第二輪複審」段落。
- **#3830** — 兩個跟 #3824 無關的既有問題：(1) `PreviewModeWriteGuardMiddleware` 的
  `startswith("Bearer ")` 大小寫判斷問題（`main.py` 約 830 行，FastAPI 的
  `get_authorization_scheme_param` 不分大小寫但這個中介層分大小寫，理論上存在繞過空間）
  (2) `resolve_google_user` 用本地 email 比對連結帳號、不看我方 `email_verified`
  （複審 finding M3 的根因，其實是 `register()` 本來就有的既有問題；本次兩階段設計已讓
  #3824 這條新路徑無法放大這個既有問題，見上方說明，但 `register()` 本身那個更通用的問題
  不在本次範圍）。兩者都在我開工前就存在，複審明確建議另開票。

## 驗收條件補充（兩階段設計新增，接續原 AC1-AC8）

**AC9 — 過戶申請後、驗證完成前，原建立者仍可重設密碼（200）**
Given 老師 A 建立學生帳號 S，S 已完成強制改密碼、呼叫過戶申請（回應 200，尚未驗證）
When A 呼叫 `POST /classrooms/{id}/students/{S}/reset-password`
Then 回應 200（跟單階段設計的差異就在這裡——這是這次安全修復的核心驗收點）

**AC10 — 原建立者在等待期間重設密碼 = 撤銷過戶申請**
Given 承 AC9，A 已經成功重設 S 的密碼
When 直接讀 DB
Then `S.pending_email` 變回 `NULL`、`S.email_verification_token` 變回 `NULL`；
拿著舊 token 呼叫 `verify-email` 回 400（token 已失效）

**AC11 — 驗證完成才是過戶生效的時間點**
Given S 完成過戶申請（pending 狀態）
When S 用回應中的驗證 token 呼叫 `GET /auth/verify-email`
Then 回應 200；直接讀 DB：`S.email` 變成申請時填的新 email、`S.pending_email` 變回 `NULL`、
`S.created_by_teacher_id` **這時候才**變成 `NULL`

**AC12 — 尚未完成強制改密碼的帳號，連過戶申請都打不進去**
Given 老師批次建立學生帳號 S，S 從未呼叫過 `change-password`
When S 呼叫過戶申請端點
Then 回應 403 `PASSWORD_CHANGE_REQUIRED`（#3438 既有的門擋在最外層，過戶端點刻意
**沒有**被排進豁免清單——這正是本次安全修復的另一半）

## 驗收條件（Given / When / Then）

**AC1 — 附屬帳號本人過戶成功**
Given 老師 A 批次建立學生帳號 S（`created_by_teacher_id = A`，合成信箱），S 已加入 A 的班級
When S 用自己的帳號密碼登入，呼叫 `POST /api/auth/claim-account`，帶上目前密碼 + 真實 email
+ 新密碼
Then 回應 200；直接讀 DB：`S.email` 變成新 email、`S.password_hash` 對得上新密碼、
`S.created_by_teacher_id` 變成 `NULL`

**AC2 — 過戶後，原建立者重設密碼回 403**
Given 承上，S 已完成過戶
When A 呼叫 `POST /classrooms/{id}/students/{S}/reset-password`
Then 回應 403（沿用 #3818 既有邏輯：`created_by_teacher_id` 為 `NULL` 時，任何教師都不是
密碼教師，含 system_admin 以外全部擋下）

**AC3 — 密碼錯誤時過戶失敗，帳號不變**
Given 同 AC1 的 S
When S 帶著**錯的**目前密碼呼叫過戶端點
Then 回應 401；直接讀 DB：`S.email`、`S.created_by_teacher_id` 都沒變

**AC4 — 新 email 已被別人使用時過戶失敗**
Given S 之外還有另一個帳號 T，`T.email = "real@example.com"`
When S 用正確的目前密碼，但 `new_email = "real@example.com"` 呼叫過戶端點
Then 回應 409；S 的 email 沒變

**AC5 — 已經是一般帳號的呼叫者，過戶會被拒絕（不是「成功但沒事做」）**
Given 某帳號 U 是自行註冊的（`created_by_teacher_id` 本來就是 `NULL`）
When U 呼叫過戶端點
Then 回應 400（不是這個情境的操作對象，不是靜默成功）

**AC6 — 過戶不影響班級關係與學習紀錄**
Given S 在過戶前已加入某班級、有作業提交紀錄（`AssignmentSubmission`）
When 過戶完成
Then `ClassroomStudent` 的那一列 `student_id` 不變，`AssignmentSubmission` 的那一列
`student_id` 不變（因為 `user.id` 從頭到尾沒變，見下方資料表盤點）

**AC7 — 每次過戶留一筆稽核紀錄**
Given S 完成過戶
When 過戶端點回應 200
Then `audit` logger 收到一筆 `action = "claim_own_account"`、`user_id = S.id`、
`target_student_id = S.id` 的結構化紀錄

**AC8 — 弱密碼被拒**
Given S 的目前密碼正確
When 新密碼不符合既有密碼強度規則（`validate_password_strength`：≥8 碼、含字母、含數字）
Then 回應 422，帳號狀態不變

## 不做的範圍（Out of Scope）

- **帳號合併**（均一 `child-account:merge` 那種「兩個既有帳號併成一個」）—— 見上方設計決策。
- **前端 UI**（過戶表單、提示文案）—— 這次只做後端 API + 測試，另開票處理介面。
- **Email 驗證信寄送**——沿用既有 dev-mode 行為（`settings.is_dev` 時在回應中直接回傳
  verification token，正式環境應改寄信，這點與既有 `/auth/register`、`/auth/resend-verification`
  的現狀一致，不在本次新增寄信邏輯）。
- **已被停用教師角色的建立者，過戶後的連動**——跟 #3818 PRD 一致的立場：不特別處理。
- **家長 Portal 相關的過戶**——只收斂教師建立的附屬帳號，不碰家長那條線。

## 資料表盤點（user_id / student_id 關聯，#3824 要求逐一列出）

選擇 (b) 之後，所有以下資料表**完全不需要改動**——`user.id` 自始至終不變，只有
`users` 表自己的三個欄位（`email` / `password_hash` / `created_by_teacher_id`）被更新：

| 資料表 | 關聯欄位 | 是否受影響 |
|---|---|---|
| `classroom_students` | `student_id` | 否——同一個 id，班級關係原封不動（AC6） |
| `classroom_teachers` | `teacher_id` | 否——與本次無關（過戶對象是學生） |
| `assignments` / `assignment_submissions` | `teacher_id` / `student_id` | 否（AC6 直接驗證） |
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
  （階段①立即）、`pending_email`／`email_verification_token`（階段①寫入、階段②或撤銷時清空）、
  `email`／`created_by_teacher_id`（**階段②才**更新，見安全複審段落）；`id` 本身從頭到尾不變，
  所以所有指向它的外鍵（上面每一列）都繼續有效 |

（完整清單取自 `grep -rn 'ForeignKey("users.id"' backend/app/models/`，共 29 個關聯點，分佈在
上述所有表。）

## API / Schema 變更（2026-11-03 改為兩階段，見上方安全複審段落）

**階段①** 新增 `POST /api/auth/claim-account`（需登入，已完成 #3438 強制改密碼）：

```python
class ClaimAccountRequest(BaseModel):
    current_password: str
    new_email: EmailStr
    new_password: str = Field(..., min_length=1, max_length=128)

class ClaimAccountResponse(BaseModel):
    message: str
    verification_token: str | None = None  # dev-mode only, mirrors /auth/register
```

業務邏輯（`services/account_claim_service.py::request_claim()`，沿用 `routes/auth.py` 的
「thin HTTP boundary，business logic 進 service module」既有結構）。**檢查順序本身就是
安全修復的一部分**（M1：強度檢查必須在查 email 之前，否則弱密碼可以當免費的 email 是否
存在探針）：

1. `current_user.created_by_teacher_id is None` → 400（AC5：不是附屬帳號，沒有東西可過戶）。
2. `current_user.student_profile.password_changed is False` → 403（H1 防禦縱深，外層
   `_PASSWORD_CHANGE_EXEMPT` 已經先擋一次，這裡是第二道，見 AC12）。
3. `verify_password(current_password, ...)` 失敗 → 401（AC3）。
4. `enforce_password_strength(new_password)` → 422（AC8，M1：順序移到 email 查重**之前**）。
5. `new_email` 已被別的帳號使用、或已被別人設成 `pending_email` → 409（AC4）。
6. 更新 `password_hash`（立刻生效）、`pending_email = new_email`（**不**動 `email`）、
   新的 `email_verification_token`、`student_profile.password_changed = True`。
   **不動 `created_by_teacher_id`**（這是跟單階段版本的關鍵差異）。
7. `db.commit()`。路由層（`routes/auth.py`）在成功與每一種失敗分支都呼叫
   `audit_log_endpoint(action=AuditAction.CLAIM_ACCOUNT_REQUESTED, extra={...})`（L1：
   失敗嘗試也要留痕跡）。

**階段②** 沿用既有 `GET`/`POST /api/auth/verify-email`，擴充
`services/email_verification_service.py::verify_email_by_token()`：

1. 用 token 找到帳號；若 `user.pending_email is not None`，代表這是一次過戶完成：
   `user.email = user.pending_email`、`user.pending_email = None`、
   **此時才** `user.created_by_teacher_id = None`。
2. `db.commit()` 包 `try/except IntegrityError` → 409（L2：email 搶號的真正競態保護，
   階段①的查重只處理非競態的常見情況）。
3. 成功時路由層額外發出 `audit_log_endpoint(action=AuditAction.CLAIM_ACCOUNT_COMPLETED,
   extra={"previous_teacher_id": ..., "final_email": ...})`。

**撤銷**：`routes/classrooms/classroom_password.py::reset_student_password()` 在成功重設密碼時，
若該帳號 `pending_email is not None`，一併清空 `pending_email` / `email_verification_token`，
並發出 `audit_log_endpoint(action=AuditAction.CLAIM_ACCOUNT_REVOKED, extra={"reason": "password_reset_by_creator"})`。

`AuditAction` 新增三個成員（取代原本單一的 `CLAIM_OWN_ACCOUNT`）：
`CLAIM_ACCOUNT_REQUESTED` / `CLAIM_ACCOUNT_COMPLETED` / `CLAIM_ACCOUNT_REVOKED`。

**限流**（M2）：`claim-account` 端點加兩個 bucket，跟 `/auth/login` 同一套
`InMemoryRateLimiter`：IP 20 次／分、帳號 5 次／分。

## 資料庫變更（2026-11-03 更新：需要一個新欄位）

原始單階段設計不需要 migration；**兩階段設計需要新增一個欄位**（Young 已同意，
2026-11-02）：

```python
# app/models/user.py — User
pending_email: Mapped[str | None] = mapped_column(String(254), nullable=True, index=True)
```

Migration `d4e5clmemail_add_pending_email.py`（接續 #3818 的
`c3d4pwteach1`，`alembic heads` 確認仍是單一 head）：idempotent
`ADD COLUMN pending_email VARCHAR(254) NULL` + `CREATE INDEX IF NOT EXISTS`，
無 FK（純字串，不是外鍵）、無回填（全新概念，沒有舊資料可回填）。

`created_by_teacher_id`（#3818 既有欄位）本次把清空的時間點從階段①延後到階段②，
欄位本身的 schema 不變，只是何時寫 `NULL` 不同。
