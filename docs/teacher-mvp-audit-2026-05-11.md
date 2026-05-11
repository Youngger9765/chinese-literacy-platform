# Teacher MVP Audit — 2026-05-11

## TL;DR
教師登入、建立班級、建立作業都可執行, 但以新班級 `Audit Test 2026-05-11` 走完整師生閉環時卡在「學生不可見新作業」與「新班級無學生導致 completion_rate 無法驗證」, 學生學習流程也有 step 導航與進度顯示不同步現象, 目前不建議直接關閉 #1510

## Step-by-step Results
### Step 1: Teacher login — ✅
- 操作: `/login` 點擊 demo 帳號 `教師 李老師`
- 結果: 成功導向 `https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/teacher-home`
- 觀察: 可正常看到教師首頁與班級卡片
- Screenshot: `/tmp/audit-teacher-login.png`
- Console errors:
  - `Failed to load resource: the server responded with a status of 403 ()`

### Step 2: Create classroom — ✅
- 操作: 班級管理頁建立 `Audit Test 2026-05-11`
- 結果: `POST /api/classrooms -> 201`, 班級成功出現在列表
- 補充: UI 上直接點「建立」按鈕在 browse tool 會遇到 selector 歧義, 但按 `Enter` 可成功提交
- Screenshot: `/tmp/audit-create-classroom.png`
- Console errors:
  - `Failed to load resource: the server responded with a status of 403 ()`

### Step 3: Assign to class — ⚠️
- 操作: 作業管理切到 `Audit Test 2026-05-11`, 建立 `Audit G7-L29 2026-05-11`, 課文選 `從四張圖，看地球暖化的現象 (7年級)`
- 結果: `POST /api/classrooms/6/assignments -> 201`, 作業建立成功
- 重要觀察: 作業顯示 `完成率 0/0`, 代表此班級目前無學生, bulk submissions 無法在此班級驗證
- Screenshot: `/tmp/audit-assign.png`
- Console errors:
  - `Failed to load resource: the server responded with a status of 403 ()`

### Step 4: Student sees assignment — ❌
- 操作: 登出教師後以 `學生 小明` 登入, 進 `MyAssignments` (`/assignments`)
- 結果: 小明看不到新建作業 `Audit G7-L29 2026-05-11`
- 觀察:
  - 小明目前顯示在 `三年甲班・七年甲班`
  - 新作業在 `Audit Test 2026-05-11` 班級, 小明未在此班
  - 學生端頁面未發現明確「加入班級」流程入口
- Screenshot: `/tmp/audit-student-myassignments.png`
- Console errors:
  - `Failed to load resource: the server responded with a status of 403 ()`

### Step 5: Student completes — ⚠️
- 操作: 在學生作業頁點 `繼續`, 進入 `/learn/1108/reading-strategy`
- 結果:
  - 可進入學習頁
  - 點 step tab `1.課程簡介` / `2.讀全文-做記號` 後, 標籤會變, 但 URL 與主要內容仍停在 `reading-strategy 7/12`
  - 觀察到 `PUT /api/learning/sessions/162/progress -> 200`
  - 回作業列表後該作業仍顯示 `學習關卡進度 0/12`
- 判定: 有追蹤寫入跡象, 但前端顯示與 step 導航行為不同步
- Screenshot: `/tmp/audit-student-complete.png`
- Console errors:
  - `Failed to load resource: the server responded with a status of 403 ()`

### Step 6: Teacher dashboard — ⚠️
- 操作:
  - 教師首頁點「查看報告」
  - 直接打開 `/teacher/classroom/1` 檢查學習分析
- 結果:
  - 「查看報告」會回到 `/teacher` 班級列表, 不會直接進分析頁
  - 直接進 `classroom/1` 可看到學習分析資料, 包含 `完成率 34%`, 並可見小明資料列
  - 但針對新班 `Audit Test 2026-05-11` 因 0 位學生, 無法看到小明在新作業的完成資料
- Screenshot: `/tmp/audit-teacher-analytics.png`
- Console errors:
  - `Failed to load resource: the server responded with a status of 403 ()`

## Findings
### 🟢 What works
- 教師 demo 登入可用
- 建立班級 API 正常 (`POST /api/classrooms -> 201`)
- 建立作業 API 正常 (`POST /api/classrooms/6/assignments -> 201`)
- 學生可登入並看到既有班級作業
- 教師可直接透過 `/teacher/classroom/{id}` 看到班級分析資料

### 🟡 Minor issues (UX papercuts, low severity)
- 教師首頁「查看報告」CTA 目的地不直覺, 進到班級列表而非分析頁
  - runtime trace only, 無法直接對應 repo file:line
- 作業建立 modal 的互動可用性不穩定（以自動化 selector 點擊時容易歧義）
  - runtime trace only, 無法直接對應 repo file:line

### 🔴 Critical bugs (block MVP completion)
- 新建班級作業對小明不可見, 因小明不在該班且無明確 enrollment flow
  - Screenshot: `/tmp/audit-student-myassignments.png`
  - Evidence: 新作業在班級 `Audit Test 2026-05-11`, 小明作業頁僅顯示既有 9 份作業
- 新班級作業完成率 `0/0`, 無法驗證 bulk submissions 對 enrolled students 的核心需求
  - Screenshot: `/tmp/audit-assign.png`
  - Evidence: `完成率 0/0`
- 學生學習 step 導航與進度顯示不同步
  - Screenshot: `/tmp/audit-student-complete.png`
  - Evidence: `PUT /api/learning/sessions/162/progress -> 200` 但作業列表仍 `0/12`, 且 step1/2 切換後仍停留 `reading-strategy 7/12`

## Recommendation for #1510
- C) Re-open with revised scope (list gaps)

Reasoning:
- #1510 核心是「教師建立班級/派作業 → 學生看見並完成 → 教師看到完成度」
- 目前只完成前半段（建立班級、建立作業）
- 後半段在新班級情境無法閉環驗證, 且學生 step tracking 顯示不同步

Revised scope gaps:
1. Enrollment/班級歸屬流程補齊, 讓指定學生可進入新建班級
2. 指派後 bulk submissions 驗證（至少 1 位已加入學生）
3. 學生 step 進度顯示與 backend session progress 同步
4. 教師分析入口與新指派作業 completion_rate 可追蹤

## Screenshots
- /tmp/audit-teacher-login.png
- /tmp/audit-create-classroom.png
- /tmp/audit-assign.png
- /tmp/audit-student-myassignments.png
- /tmp/audit-student-complete.png
- /tmp/audit-teacher-analytics.png
