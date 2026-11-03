# PRD：老師可修改學生顯示名稱並管理座號（#3826）

## 問題

老師目前無法修改學生在班級名單上的「顯示名稱」，也無法管理「座號」。

## 現況調查（動手前先確認過）

- **「座號」目前不是持久化欄位**：`StudentListTab.tsx` 表格的「座號」欄顯示的是陣列索引
  `i + 1`，不是任何存進資料庫的值。
- **批次建帳號時收的「座號」只用來拼帳號名**：`classroom_batch.py` / `classroom_csv.py`
  會把老師輸入的座號字串拼進登入帳號（`{join_code}{座號}`，如 `5BIFSD1`），永久燒進
  `User.username`，之後不會再以獨立欄位呈現或可編輯。
- `User`、`StudentProfile`、`ClassroomStudent` 目前都**沒有**獨立的 `seat_number` 欄位。
- 均一教育平台的對應功能（概念參考，非原始碼，讀自
  `JunyiAcademy/junyiacademy` staging 分支）：
  - `StudentRow.jsx`：鉛筆圖示 inline 編輯顯示名稱，Enter 確認／Esc 取消，
    送出 `PUT /api/v2/user/nickname`（body 是陣列，可一次改多筆）。
  - `SeatNumberDialog.jsx`：其實沒有獨立的座號欄位 —— 它是把座號文字
    （如 `01`）前綴進暱稱字串，靠拖曳排序＋批次「按此排序新增座號」按鈕組成。
    均一那邊的「座號」本質上也是暱稱文字的一部分。

## 決定（附理由）

| 項目 | 決定 | 理由 |
|---|---|---|
| 顯示名稱 | 改 `User.name`（跟現有呈現欄位一致，全站同一顯示名稱） | 現有名單、報告、各處都讀 `User.name`；沒有另一個獨立「暱稱」欄位可改，改 `name` 最小改動 |
| **帳號登入名稱** | **不動** `User.username` / `User.email` | 帳號是學生登入用的憑證，批次建帳號時印出去的學生卡片已經用那組帳號；事後改掉會讓學生登不進去原本記得／寫在卡片上的帳號 |
| 座號 | 在 `classroom_students`（班級-學生的加入關係表）新增可為空的 `seat_number` 整數欄位 | 座號是「這個學生在這個班的座位」，跟某次帳號建立時拼進登入名的那個字串無關；掛在加入關係上，換班（#3819）或被移出班級時座號自然不會跟著走，不用額外清理邏輯 |
| 座號互動方式 | 名單列直接 inline 編輯（點擊→輸入框→Enter 確認／Esc 取消），不做均一那種拖曳排序彈窗 | 規模是單一老師的自己班級（數十人），用不到跨列拖曳排序那套；直接編輯最小可行 |
| 座號唯一性範圍 | 只在**同一班級**內檢查重複 | 需求明講「同一班的座號不能重複」；一個學生若同時在兩班（#3819 換班後舊班記錄已刪除，但理論上可能短暫跨班），座號各自獨立不衝突 |

## 驗收條件（Given / When / Then）

### AC1 — 修改顯示名稱成功
```
Given 老師 T 擁有班級 A，學生 S1 原名「舊名字」
When T 呼叫 PATCH /classrooms/{A}/students/{S1}/name，body {"name": "新名字"}
Then 回傳 200，S1.name 變成「新名字」
  And 下次讀取班級名單時 S1 顯示「新名字」
  And S1 的登入帳號（email / username）完全不變
```

### AC2 — 顯示名稱驗證
```
Given 老師 T 擁有班級 A，學生 S1
When T 呼叫改名 API，body {"name": ""}（空字串或純空白）
Then 回傳 422
When T 呼叫改名 API，body {"name": "<101 個字元>"}
Then 回傳 422
```

### AC3 — 改名權限：只能改自己班上的學生
```
Given 老師 U 不是班級 A 的 owner／admin
When U 呼叫改名 API 對班級 A 的學生 S1
Then 回傳 403，S1.name 不變

Given 學生 S2 不在班級 A（不管 S2 在不在別班）
When 班級 A 的老師 T 呼叫改名 API，路徑帶 classroom_id=A, student_id=S2
Then 回傳 404，S2.name 不變
```

### AC4 — 設定座號成功
```
Given 班級 A 有學生 S1（無座號）、S2（座號 2）
When 老師 T 呼叫 PATCH /classrooms/{A}/students/{S1}/seat，body {"seat_number": 1}
Then 回傳 200，S1.seat_number == 1
  And 下次讀取班級名單時 S1 顯示座號 1（不是陣列索引）
  And S2 座號仍是 2
```

### AC5 — 座號重複擋下
```
Given 班級 A 的 S2 座號已經是 2
When 老師 T 呼叫設定座號 API，把 S1 設成 2
Then 回傳 409
  And S1 座號不變（維持原狀，不是被設成 2 又改回去 —— 整個請求都不生效）
  And S2 座號仍是 2
```

### AC6 — 座號可以清空
```
Given S1 座號是 1
When 老師 T 呼叫設定座號 API，body {"seat_number": null}
Then 回傳 200，S1.seat_number 變成 null
  And 名單畫面對這個學生改回用陣列索引顯示（向下相容既有行為）
```

### AC7 — 座號範圍驗證
```
Given 班級 A 的學生 S1
When T 呼叫設定座號 API，body {"seat_number": 0}
Then 回傳 422
When T 呼叫設定座號 API，body {"seat_number": -1}
Then 回傳 422
```

### AC8 — 座號權限：跟改名一致
```
Given 老師 U 不是班級 A 的 owner／admin
When U 呼叫設定座號 API
Then 回傳 403
```

### AC9 — 座號只在同班級內唯一（不同班級可以重複同一個號碼）
```
Given 老師 T 的班級 A 有學生 S1 座號 1，班級 B 有學生 S3
When T 把 S3（在班級 B）設座號 1
Then 回傳 200（B 班跟 A 班座號互不衝突）
```

## API 設計

```
PATCH /api/classrooms/{classroom_id}/students/{student_id}/name
Body: { "name": "<1~100 字元，去頭尾空白後不可為空>" }
Response 200: StudentInClassroomResponse（含更新後的 name）

PATCH /api/classrooms/{classroom_id}/students/{student_id}/seat
Body: { "seat_number": <int 1~999> | null }
Response 200: StudentInClassroomResponse（含更新後的 seat_number）
Response 409: 同班級內座號重複
```

兩個端點權限皆為 `require_owner_or_admin(classroom)`，並驗證 `student_id` 確實在
`classroom_id` 這個班級裡（比照現有 `remove_student_from_classroom` 的 404 模式）。

## 資料庫變更

新增一個 migration：`classroom_students` 表加一欄
`seat_number: Integer, nullable=True`，並加
`UniqueConstraint("classroom_id", "seat_number")`
（標準 SQL 唯一約束允許多個 NULL 並存，不需要額外的 partial index）。

不需要 backfill：既有資料的 `seat_number` 全部是 `NULL`，前端對 `NULL` 的座號繼續顯示
陣列索引（向下相容），不會讓既有畫面看起來「座號不見了」。

## 前端

`StudentListTab.tsx`：
- 「座號」欄：預設顯示 `s.seat_number ?? (i + 1)`；hover 出現鉛筆圖示，點擊後變成
  一個小的數字輸入框，Enter 或打勾確認（呼叫 API），Esc 或叉叉取消。
  API 回 409 時顯示「這個座號已經有人用了」且不清空輸入框，讓老師能直接改別的數字再送。
- 「學生姓名」欄：同樣的 pencil-icon inline 編輯模式，Enter 確認／Esc 取消，改名成功後
  立即更新畫面顯示（不用整頁重新整理）。

## 不做的範圍（明確排除）

- 不改動學生登入用的帳號名稱／Email（`User.username` / `User.email`）
- 不做均一那種拖曳排序的座號管理彈窗 —— 規模不到需要那套，名單列 inline 編輯即可
- 不支援跨班級的座號統一管理／排序 —— 座號只在單一班級內唯一
- 換班（#3819）、批次移除（#3821）後座號不會自動帶到新班級或恢復 —— 新加入關係的
  座號預設是 `null`，老師要重設
