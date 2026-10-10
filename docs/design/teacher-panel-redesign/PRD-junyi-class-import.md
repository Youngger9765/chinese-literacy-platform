# PRD：匯入均一班級學生

> 🤖 由 Claude AI 撰寫（非 Young 本人）· 2026-10-11 · issue #3380（從均一匯入班級學生）

## 1. 要解決什麼問題

老師和學生多半已經在用均一，也能用均一帳號登入本平台。老師在均一已經建好班、加好學生，到本平台還要重建一次。

Young 2026-10-10：「在建立班級時就問，叫做『匯入均一班級學生』：1. 可以選擇班級匯入 2. 不可以重複匯入，要做去重檢查」

### 成功指標
- 老師在建立班級時，勾選均一的班，一次建好班級和學生，不用重打名單
- 同一個均一班、同一位學生，不管匯幾次都只有一份
- 學生之後用均一登入，進到的是老師幫他匯入的同一個帳號

## 2. 已查證的事實（2026-10-10～11，只看筆數，不看學生內容）

| 事實 | 怎麼查的 |
|---|---|
| 均一的「老師→班級→學生」表：`junyiacademy.data_mart.dim_teacher_student_joins`，357 萬列、792 MB、沒有分區，每天約 08:20 更新一次（資料是 T+1） | `bq show` |
| 老師 ID ＝ `user_id_key_` ＋ 均一使用者 ID；用 Young 本人帳號對到 15 班、139 位學生 | 聚合查詢 |
| 均一登入（SSO）給我們的 ID ＝ 均一使用者資料表的 `user_id`：最近 30 天 398 位登入者全部對得上（網址型 383/383、email 型 15/15） | 正式站登入紀錄 × `datastore_backup.UserData` |
| 學生暱稱幾乎都不在班級表（142 列有 140 列是空的），要到使用者資料表抓：Young 的學生 136/138 有暱稱、108 有帳號名稱 | 聚合查詢＋本機真資料試跑 |
| 本機用 Young 真資料試跑：列班級 2.6 秒；匯 2 班 71 人花 26 秒（太慢）；重匯 0 新增；別的老師匯不到 | 本機記憶體資料庫，跑完即丟 |
| `dim_teacher_student_joins` 每天約 08:20 重建一次（最近一次 10/10 08:20） | `bq show` |
| `UserData` 每天約 08:16 更新，資料涵蓋到當天約 02:30（最新 `created_at` 為 10/9 18:30 UTC）| `bq show` |
| → 兩張表都是 T+1，不是即時、也不是每週，是每天一次 | 綜合以上兩筆 |

Young 2026-10-11 確認架構：**老師按下匯入當下才查，只存他勾選的學生；不下載、不同步整張表。**

## 2.5 為什麼不整批下載／同步均一的表

`UserData` 有 2 千萬筆使用者、17.5 GB，含未成年學生個資——整張同步進我方資料庫等於把均一全平台的未成年名冊複製一份，不成比例。按下匯入當下查一次，單次成本約新台幣 0.5 元，只存老師明確勾選的學生，資料最小化。未來若查詢量變大，可考慮請均一那邊建一個按 `teacher_user_id` 分群（clustered）的檢視表降低掃描量，但目前成本已低到可忽略，不急。

## 3. 方案

老師按下匯入的當下，查一次均一 BigQuery，只查這位老師自己的班，只存老師勾選的學生。不做每晚同步（不把全平台未成年名冊存到我方）。

- 每次查詢約台幣 0.13 元（列班級）＋約台幣 0.4 元（匯入時加查使用者資料表抓名字）；同一天重按用快取不收錢
- 用專用服務帳號 `lingoleap-junyi-bq`（只有跑查詢的權限，沒有金鑰檔），不用權限過大的預設帳號
- 功能開關預設關閉；測試環境可切成假資料

## 4. 需求與驗收條件（每條都有正向與反向測試）

測試名稱寫在每條後面，TDD：先寫測試看它失敗，再寫程式讓它通過，再故意拿掉關鍵檢查確認測試會變紅。

### R1 列出自己的均一班級
- Given 老師帳號已綁定均一（有 `junyi_identity_id`）
- When 打開「匯入均一班級學生」
- Then 列出他在均一的班級（班名、人數），已匯入過的標「已匯入」且不能再勾
- ✅ 正向：綁定的老師看到自己的班；已匯入的班 `already_imported=true`
- ❌ 反向：沒綁定均一的老師 → `linked=false`、空清單（不報錯）；學生角色呼叫 → 403；沒登入 → 401

### R2 只能匯入自己的班（越權防護）
- ✅ 正向：老師匯入自己清單裡的班 → 成功
- ❌ 反向：老師送出別位老師的均一班級編號 → 不建立任何東西（班級 0、學生 0），也不透露那個班存在

### R3 班級不重複（資料庫保證）
- 班級資料表新增欄位 `junyi_class_id`，同一位老師＋同一個均一班只能有一筆（資料庫唯一限制）
- ✅ 正向：第一次匯入建立班級
- ❌ 反向：同一班再匯一次 → 沿用原班不新建；班名在任一邊被改過再匯 → 仍沿用；同時按兩次 → 只有一個班；兩位老師各自匯自己的班 → 各一個，互不影響

### R4 學生不重複
- ✅ 正向：新學生建立帳號並加入班級；回應顯示「新增 N 位」
- ❌ 反向：重匯同一班 → 新增 0、略過全部；同一學生在兩個班 → 一個帳號、兩筆入班；學生已在班上 → 略過
- ❌ 反向：學生以前已用 email 自己註冊過（未綁均一）→ 用 email 找到舊帳號接上均一 ID，不另建新帳號

### R5 學生名字
- 名字順序：均一暱稱 → 均一帳號名稱 → 「均一學生 N」
- ✅ 正向：有暱稱的用暱稱
- ❌ 反向：暱稱與帳號名稱都空 → 用「均一學生 N」，匯入不能因為沒名字而失敗

### R6 提前建立的帳號，學生之後用均一登入
- ✅ 正向：被匯入的學生第一次用均一登入 → 登進同一個帳號（不新建）；假 email 換成他真的 email（若沒有其他帳號在用）
- ❌ 反向：被匯入的帳號不能用密碼登入（沒有人知道密碼）；真 email 已被另一個帳號使用 → 不覆蓋、不合併，保留原狀並記錄

### R7 均一查詢失敗要講實話
- ✅ 正向：查詢正常 → 列出班級
- ❌ 反向：查詢出錯或逾時 → 回 503「暫時查不到均一資料，請稍後再試」，資料庫什麼都不寫入（不可以回「沒有班級」）

### R8 成本與效能上限
- 每次查詢都設讀取量上限（`maximum_bytes_billed`）
- 匯入改成一次查完班級與學生，不逐班查；不為每位學生算昂貴的密碼雜湊
- ✅ 正向：匯入 70 人在 5 秒內完成（假資料單元測試＋真資料本機量測各一次）
- ❌ 反向：查詢預估超過上限 → 拒絕執行並回 503，不寫入

### R9 功能開關
- ✅ 正向：開關打開 → API 可用
- ❌ 反向：開關關閉 → 兩支 API 都回 404，建立班級畫面不顯示這個選項

### R10 畫面
- 建立班級對話框的「學生怎麼加入」裡多一個選項「匯入均一班級學生」：勾選班級 → 顯示「新增 N 位、已存在略過 M 位」
- 提示「均一今天新建的班，明天才查得到」
- 沒綁均一的老師看到說明文字，不會點了才出錯
- 手機 390 寬可用

## 5. 不做的事
- 每晚自動同步均一班級（沒必要，且會把全平台名冊存到我方）
- **整批下載／同步均一的 `dim_teacher_student_joins` 或 `UserData`**（`UserData` 2 千萬筆、17.5 GB，含未成年個資；按需查詢單次約新台幣 0.5 元，遠比同步整張表划算且資料最小化。未來優化方向：請均一建一個依 `teacher_user_id` 分群的檢視表，不是我方自建同步）
- 匯入後跟均一雙向同步（學生在均一退班，我方不會自動移除）
- 匯入均一的作業、成績

## 6. 上線前要開的權限（Young 決定）
1. 均一的班級表與使用者資料表：讀取權開給 `lingoleap-junyi-bq`（Young 是均一 GCP 擁有者，可自行開；或請均一做只含必要欄位的檢視表）
2. 均一隱私／法務窗口是否需要知會（未成年學生暱稱跨平台使用）
3. 後端用 `lingoleap-junyi-bq` 身分執行：先測試站，正式站另議

## 7. 驗證結果

| 需求 | 正向測試 | 反向測試 | 紅→綠證據 | Mutation 結果 |
|---|---|---|---|---|
| R1 列自己的班 | `test_positive_control_own_school_succeeds`, `test_already_imported_class_flagged_in_listing` | `test_list_classes_reports_not_linked`, `test_student_role_cannot_list_or_import`, `test_unauthenticated_cannot_list_or_import` | 原先學生角色得到 200 → 加 teacher role gate 後授權測試 5 passed | 固定 `already_imported=False` → 對應測試 1 failed；還原後 1 passed |
| R2 只能匯自己的班 | `test_positive_control_own_school_succeeds` | `test_cannot_import_another_teachers_junyi_class_idor` | 原始 client/service 介面不合導致 500 → 匯入測試通過 | 移除 fake client 的 teacher key 過濾 → 1 failed；還原後 1 passed |
| R3 班級不重複 | `test_reimport_same_class_does_not_duplicate_classroom`, `test_two_teachers_same_junyi_class_id_get_separate_classrooms` | `test_renamed_class_reimport_does_not_duplicate`, `test_concurrent_double_import_reuses_not_duplicates` | 原始匯入測試 500 → 新增欄位、唯一索引與重查處理後 32 passed | 移除唯一限制 → race 測試 1 failed；還原後 1 passed |
| R4 學生不重複 | `test_reimport_adds_only_new_students`, `test_preexisting_email_account_is_linked_not_duplicated` | `test_email_match_never_hijacks_an_already_linked_account` | 原始匯入測試 500 → email 連結與學生去重測試通過 | 關閉 email fallback → 1 failed；還原後 1 passed |
| R5 學生名字 | `test_empty_nickname_falls_back_to_username` | `test_both_nickname_and_username_empty_falls_back_to_placeholder`, `test_two_nameless_students_in_same_import_get_distinct_placeholders` | 原始匯入測試 500 → 名字後備測試通過 | 固定 placeholder 編號 → 1 failed；還原後 1 passed |
| R6 SSO 沿用帳號 | `test_first_sso_login_promotes_synthetic_email_to_real_one` | `test_promotion_skipped_if_real_email_already_taken_by_someone_else`, `test_non_synthetic_account_email_is_never_touched_by_sso_login`, `test_imported_student_cannot_password_login` | SSO synthetic email 更新加入後 3 passed | 拿掉 synthetic domain 檢查 → 1 failed；還原後 1 passed |
| R7 查詢失敗 | `test_no_matching_bq_rows_returns_empty_not_error` | `test_list_classes_returns_503_on_bq_error`, `test_import_returns_503_and_writes_nothing_on_bq_error` | 原始 list 回 500 → BQ error 轉成 503 並驗證寫入數不變 | 將 503 改為 500 → 1 failed；還原後 1 passed |
| R8 成本效能 | `test_import_uses_one_combined_query`, `test_real_queries_set_byte_caps_and_split_list_from_import`, `test_70_student_import_completes_quickly` | `test_real_query_billing_limit_failure_is_not_empty_result`, `test_imported_student_cannot_password_login` | 70 人匯入測試通過，兩種 BigQuery 查詢的 byte caps 與 JOIN 分工測試通過 | 移除密碼雜湊快取 → 70 人效能測試 1 failed（20.36s）；還原後 1 passed（3.92s） |
| R9 功能開關 | `test_positive_control_own_school_succeeds` | `test_list_classes_404_when_flag_disabled`, `test_import_404_when_flag_disabled` | 開關關閉測試通過 | 跳過 flag gate → 1 failed；還原後 1 passed |
| R10 畫面 | `JunyiClassImportSection.test.tsx` 的班級選擇、匯入統計、T+1 提示 smoke test | 同檔的 flag off 隱藏、未綁定說明、零選擇不可送出測試 | frontend smoke test only, see `JunyiClassImportSection.test.tsx`：5 passed | 前端僅 smoke test，未做 mutation |

測試站實測：本次未部署，尚無測試站證據
