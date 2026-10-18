# Issue #3633 — 遊戲區 集中入口（WIP 暫停筆記）

> 2026-10-18 暫停：Young 要先做課堂搶答（Kahoot 類）改善，這張票先擱著。
> 本檔是已完成的規劃，尚未動任何 production code（worktree 目前 clean，
> 這個 commit 只有這份筆記）。接續時直接照下面派工即可，不用重查。

## worktree
`/Users/young/project/clp-game-hub`，branch `feat/issue-3633-game-hub`（base `origin/staging` @ 33180b297）。
⛔ 不是 `.claude/worktrees/*`。

## 問題（issue #3633 原文摘要）
學生側欄「我們班／課堂搶答／PK 對戰」散在各處，且 `/escape-room`（迷城密室）
**有頁面但側欄完全沒有入口**，學生從選單走不到。要集中成一個「遊戲區」入口
（學生側＋老師側），舊網址不改。只上 staging，Hans 驗收後才上 main。

## 路由決定
- 學生遊戲區頁：`/game-hub`
- 老師遊戲區頁：`/teacher/game-hub`
- 舊路由全部保留：`/student/our-class` `/live` `/pk` `/escape-room` `/teacher/league` `/teacher/live`

## 已讀過、驗證過的現況（不用再查一次）
- `frontend/src/components/layout/StudentSidebar.tsx` — `getStudentNavItems(pendingAssignmentCount, flags)`
  目前輸出含三個要被取代的項目：
  - `我們班` (`/student/our-class`，icon 🏆，only when `flags.league`)
  - `課堂搶答` (`/live`，icon 🎮，only when `flags.liveQuiz`)
  - `PK 對戰` (`/pk`，icon ⚔️，**unconditional**，AI PK 從不受班級開關限制)
- `frontend/src/components/layout/TeacherSidebar.tsx` — `getTeacherNavItems()` 目前含
  `跨班賽季` (`/teacher/league`) 與 `課堂搶答` (`/teacher/live`) 兩個要被取代的項目，
  前後是 `班級管理` `作業管理` ... `使用說明`。
- `frontend/src/components/layout/Sidebar.tsx` 目前會 fetch `fetchMyEnrolledClassrooms`
  算出 `leagueEnabled`/`liveQuizEnabled` 傳給 `<StudentSidebar>`；consolidation 後這段
  對 sidebar 本身變成死碼（hub 頁自己內部重新 fetch），**由我（foreman）整合時清掉**，
  不要叫 worker 動這段。
- `frontend/src/components/layout/sidebarUtils.ts` 的 `isActive(pathname, path)` 是
  generic prefix matcher，另外對 `/student` `/teacher-home` `/teacher` 有特殊規則。
  要讓「在 /live、/pk、/student/our-class、/escape-room 時 遊戲區 仍亮著」，
  需要幫 `/game-hub` 和 `/teacher/game-hub` 各加一組 prefix 清單 —— **這段也是我自己做**，
  不派給 worker（會跟兩邊 worker 衝突同一檔案）。
- `frontend/src/services/learning/session.ts::fetchMyEnrolledClassrooms(token)` 已存在，
  回傳 `{ classrooms: StudentEnrolledClassroom[], total, student_grade }`，
  每個 classroom 有 `league` `live_quiz` `pk_human` `grade` `is_active` 等欄位。
  本票不改這支，各頁各自呼叫（codebase 既有慣例，`StudentPkEntry.tsx`／
  `StudentEscapeRoomEntry.tsx` 都各自呼叫同一支，不是透過共用 hook）。
- `frontend/src/services/classroomApi.ts::listMyClassrooms(token)` 已存在，回傳
  `{ items: ClassroomResponse[], total }`，每個 classroom 有 `pk_human` `league` `live_quiz`。
- `frontend/src/pages/teacher/ClassroomPkSettingsPanel.tsx` 已存在，吃
  `{ token, classroomId, pkHuman, league, liveQuiz, onChanged }`，單一班級的三個開關
  （真人 PK／跨班賽季／課堂搶答）都在裡面，**不用改**，老師遊戲區頁直接每個班一份。
- Story assets 可用：`/story-assets/league-tang/guide-changan-icon.png`（跨班賽季卡）、
  `/story-assets/pk-li-bai/icon.png`（PK 卡）；迷城密室與五人對抗賽沒有美術，用 emoji。
- Tailwind 斷點是預設值（sm 640 / md 768 / lg 1024 / xl 1280），390/768/1280 三寬度
  直接用標準 `sm:`/`lg:` class 即可，不需自訂斷點。

## 鎖定規則（跟現行側欄一致，issue 原文已確認）
| 卡片 | 鎖定條件 | 鎖定文案 |
|---|---|---|
| 跨班賽季（我們班） | `!leagueEnabled`（ANY enrolled classroom 有 `league`） | 老師尚未開啟 |
| 課堂搶答 | `!liveQuizEnabled`（ANY enrolled classroom 有 `live_quiz`） | 老師尚未開啟 |
| PK 對戰 | 永不鎖（跟現行側欄一樣 unconditional） | — |
| 迷城密室 | 永不鎖（issue 明確說不受班級開關限制） | — |
| 五人對抗賽 | 永遠鎖（功能還沒做） | 即將推出 |

鎖定卡片用 `<button disabled>`，不是直接不顯示（issue 給兩個選項都合規，選「顯示但鎖」
比較像 game lobby）。

## 檔案切分（避免 codex/cursor 撞檔）
**Worker A（codex，學生側）**只動：
- NEW `frontend/src/pages/student/StudentGameHubPage.tsx`
- NEW `frontend/src/pages/student/__tests__/StudentGameHubPage.test.tsx`
- MODIFY `frontend/src/components/layout/StudentSidebar.tsx`
- REWRITE `frontend/src/components/layout/__tests__/StudentSidebar.featureGate.test.tsx`

**Worker B（cursor，老師側）**只動：
- NEW `frontend/src/pages/teacher/TeacherGameHubPage.tsx`
- NEW `frontend/src/pages/teacher/__tests__/TeacherGameHubPage.test.tsx`
- MODIFY `frontend/src/components/layout/TeacherSidebar.tsx`
- NEW `frontend/src/components/layout/__tests__/TeacherSidebar.gameHub.test.tsx`

**我（foreman）自己**事後整合：
- `frontend/src/components/layout/sidebarUtils.ts`（game-hub active prefix matching）
- `frontend/src/components/layout/Sidebar.tsx`（刪掉死碼 league/liveQuiz fetch、
  `isActiveLocal` 改用匯出的 `isActive`）
- `frontend/src/routes/AppRoutes.tsx`（兩個新 lazy route）
- `frontend/src/components/layout/__tests__/Sidebar.role-split.test.tsx` + 其 snapshot
  （兩邊 worker 都會動到的共用檔，兩邊都 done 之後我重寫 + 重新產生 snapshot）
- 全專案 `npm run lint` + `npm run test`，critic-agent review，PR，merge，staging QA

兩個 worker 都不准碰：`AppRoutes.tsx` `Sidebar.tsx` `sidebarUtils.ts`
`Sidebar.role-split.test.tsx`，以及 `frontend/src/pages/teacher/live/`、
`frontend/src/pages/live/`（別的並行工作在動，#3631/#3630）。

## 已確認：0 live exec slots（2026-10-18 查過，派工沒問題）

## 完整派工 prompt 已經寫好（在上一輪 assistant 回合的草稿裡，兩份都含完整
context + 卡片規格 + test list + TDD 紅綠要求），**還沒真的送出去** 就被喊停。
接續時重新組一次 prompt（上面這份筆記的規格內容就是全部素材，不用重查 codebase）。

## 下一步（接續時）
1. 重讀這份筆記
2. 用上面兩組檔案切分，組 codex/cursor 兩份 dispatch prompt（含卡片表、鎖定規則、
   TDD 紅綠要求、「不要碰哪些檔」清單）
3. `codex exec` 丟 Worker A（學生側），`cursor-safe-exec` 丟 Worker B（老師側）
4. 收件後：review diff → 自己跑 `npm run lint` + `npm run test` 全專案 →
   補 `sidebarUtils.ts` / `Sidebar.tsx` / `AppRoutes.tsx` / role-split 測試整合 →
   critic-agent review → commit + push → PR to staging (`Related to #3633`，
   milestone 遊戲化第一期) → merge (squash --admin，CI 全綠) → staging QA
   (headless browser，真的從側欄點進去，390/1280 截圖) → 留言 #3633 + assign
   66tarosan（不要關票）
