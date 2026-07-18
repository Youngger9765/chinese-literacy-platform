# 班師生作業 — BDD 驗收清單（人簽 acceptance）

> dev-pipeline THE ONE THING：人簽驗收清單（code 前）+ 機器讀現實判 done。
> 從 `docs/PRD.md` 導出。每條標**驗證層 + 證據**。狀態：✅ 已驗｜🟡 部分｜⬜ 需真人/真機（headless 測不到）
> 建立 2026-07-18（#2539 後補；先前只做 contract/EDD 測試層，缺這份人簽驗收 + 真體驗）

## 1. 建班（teacher create classroom）
- **Given** 老師登入 **When** 填班名+年級建立 **Then** 班級出現在列表、可進入
  - ✅ contract：`test_classrooms_api::TestCreateClassroom`（201/422/401/404）｜✅ 體驗：staging 真建過一班出現在列表
- **Given** 非本校成員/跨 org **When** 建班 **Then** 403
  - ✅ contract：`test_dynamic_security::test_teacher_without_school_membership_cannot_create_classroom` + 跨 org 403

## 2. 加學生（enroll）
- **Given** 班級有加入代碼 **When** 學生用代碼加入 **Then** 入班、且回填既有作業 submission
  - ✅ contract：`TestJoinClassroomByCode`（成功/大小寫/無效404/重複409）+ `#996 backfill` 測試｜✅ 體驗：代碼生成可見（staging）
  - ⬜ **真體驗**：學生端實際輸代碼加入的畫面流程（headless 未走完，cross-account）
- **Given** 班級停用/學校停用 **When** join **Then** 404｜✅ `test_join_inactive_*`
- 批次建號 / CSV 匯入 / 學生搜尋｜✅ contract 全覆蓋

## 3. 派作業（teacher create/assign assignment）
- **Given** 老師選班級+課文+目標(cpm/accuracy) **When** 建立作業 **Then** 每個在班生自動有 pending submission；學生 /my 看得到
  - ✅ contract：`TestCreateAssignment` + `TestIssue1910`（自動建 submission）+ 驗證 422（both/neither source、目標超界）｜✅ 體驗：**派作業表單真實可用**（班級+課文 dropdown populated、可選，staging 驗過）
  - 🟡 **真體驗**：建立→學生 /my 出現 這條端到端未走完（React 重繪 ref churn + cross-account；建議真機 rehearse）
- **Given** co-teacher（非 owner）**When** 建作業 **Then** 403｜✅ `test_co_teaching_api`
- **Given** 跨 org org_admin **When** 對別 org 班派作業 **Then** 403｜✅ `test_dynamic_security`

## 4. 生做作業（student start → do → submit）
- **Given** 學生有 pending 作業 **When** /start **Then** 建 session、狀態 in_progress｜✅ contract `TestStartAssignment`（+ inactive→400、已submitted→400 use /restart）
- **Given** 學生沒 start **When** 直接 submit **Then** 400「Assignment not started」｜✅ **BUG 修 + mutation 驗**（本次）
- **Given** 作業已停用 **When** submit **Then** 400｜✅ **BUG-1 修 + mutation 驗**（本次）
- **Given** 學生做完朗讀 **When** submit **Then** 狀態 submitted、成績記錄
  - ⬜ **真體驗（需真機）**：學生實際做完 7-step 朗讀作業（**錄音需麥克風，headless 本質測不到**）—— 這是「體驗」唯一真機才能驗的部分
- restart（重做）｜✅ `TestRestartAssignment`（happy/400/403/401）

## 5. 師批改 / 檢閱（teacher grade / review）
- **Given** 學生已 submit **When** 老師批改（分數+評語）**Then** 狀態 graded、學生看得到、通知學生
  - ✅ contract：`TestTeacherFeedback` + grade spec｜✅ **BUG-2 修**：批改now真的發通知（best-effort）
- **Given** 非 owner/跨 org 老師 **When** 批改/看報告/AI評語 **Then** 403（含 IDOR：跨 assignment submission→404）｜✅ **mutation 驗**（本次）
- **Given** 老師存學生評語 **When** save **Then** sanitize + 標 reviewed｜✅ `save_teacher_comment` sanitize（本次）+ 檢閱線 contract
  - 🟡 **真體驗**：老師端實際點進某學生看到其聚光燈/作業作答 render（需先造一筆學生 session，headless 未走完，demo 前 rehearse）

## 驗證層總結（誠實）
- **contract/spec/EDD（決定性）**：✅ 完整，315+ passed、關鍵鎖 mutation 驗、2 真 bug 修上 prod
- **真實體驗 e2e**：老師端可達+表單功能驗過；**學生做朗讀作業（麥克風）+ 老師端看特定學生作答 = 需真機/真人 rehearse**（headless 本質限制，非沒做）
- **人簽**：這份待 Young / 方大哥 / 教授逐條確認驗收字句是否即為所要

## 待補（如要 100% 體驗覆蓋）
- 真機 rehearse：學生做完一課作業(含錄音) → 老師端批改看得到（Monday demo 前那份 checklist 就是這個）
- PRD checkbox 對帳：`docs/PRD.md` 部分 `[ ]` 已 build 但沒勾（如建立班級/班級統計），需刷新
