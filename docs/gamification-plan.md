# LingoLeap Gamification Enhancement Plan

> 經 CEO / Eng / Design 三方 Review 後修訂（2026-04-05）

## Background

LingoLeap 已有基礎 gamification 系統（#26），包含：
- **XP 系統**：7 種 event types，10 級（初學者→國文之星），LEVEL_THRESHOLDS 0→4000
- **Badge 系統**：14 badges（first_session, story_5/10/25, streak_3/7/30, accuracy_90/100, level_5/10, xp_500/1000）
- **Streak 系統**：連續登入天數追蹤
- **Leaderboard API**：已建但前端未上線
- **DB Tables**：student_xp_log, student_badges, student_streaks（已存在，運作中）
- **前端**：AchievementsPage, XPAwardToast, Leaderboard 元件已存在

## 目標用戶

國小高年級～國中生（10-15 歲），教師指派作業或學生自主學習

## Octalysis Audit（現狀 → 目標）

| Core Drive | 現狀 | 目標 | 分析 |
|------------|------|------|------|
| CD1 Epic Meaning | 3 | 7 | 有「AI 朗讀助教」定位，但沒有 narrative mission |
| CD2 Accomplishment | 6 | 8 | XP + 10 levels + 14 badges + progress bar 已建，但沒跟學習單步驟深度掛鉤 |
| CD3 Creativity | 2 | 5 | 閱讀策略有 free_text，但沒有 combo 系統或自選路徑 |
| CD4 Ownership | 3 | 6 | AchievementsPage 有 badge wall，但沒有 avatar/profile 自訂 |
| CD5 Social | 1 | 4 | Leaderboard 元件存在但沒上線，無 peer interaction |
| CD6 Scarcity | 0 | 2 | 無限時任務，無 daily cap |
| CD7 Unpredictability | 0 | 3 | 無隨機獎勵、無隱藏成就 |
| CD8 Loss Avoidance | 2 | 2 | Streak 系統已有，保持低度即可（教育場景不要太多焦慮） |

## Review Verdicts

| Reviewer | Verdict | 核心意見 |
|----------|---------|---------|
| CEO | RETHINK | DAU < 10 時 gamification ROI 低，先修好已有功能 + onboarding，不是加新功能 |
| Eng | REQUEST CHANGES | 5 個 bug 必修（idempotency、first_session badge、XP scan、Toast bug、英文 key），2 個事件降級 Phase 2 |
| Design | ITERATE | Onboarding 3/10 是致命傷，步驟級 micro-reward 缺失，40% 流程無回饋 |

## Phase 1：Bug Fix + Onboarding（本次實作）

### Bug Fixes（MUST）

| # | 問題 | 修改位置 | 說明 |
|---|------|---------|------|
| B1 | `first_session` badge 永遠不觸發 | `gamification_service.py:check_and_award_badges()` | 加 `stories_completed >= 1` 條件 |
| B2 | Idempotency 缺失 — 刷新 ReportPage = 雙倍 XP | `gamification_service.py:process_session_completion()` | 加 session_id 重複 guard |
| B3 | XP 計算用全 log scan（效能炸彈） | `gamification_service.py:_get_or_create_xp_log_entry()` | 改用 `func.sum()` DB-side aggregate |
| B4 | XPAwardToast level-up 判斷是硬 coded 魔法數字 | `frontend/XPAwardToast.tsx` L85 | 改為比對 XP 前後 level 差異 |

### New XP Events

| Event | XP | 觸發點 | 難度 |
|-------|-----|-------|------|
| `step_complete` | +3 | 每個步驟完成時（填補步驟 5/6/8/9 沉默區） | 低 |
| `strategy_exercise_complete` | +10 | 閱讀策略練習完成 | 中 |
| `all_steps_complete` | +25 | 單篇 10 步驟全部完成 | 中 |
| `daily_first_login` | +3 | 每日第一次活動 | 低 |

### New Hidden Badges（中文名）

| Key | 中文名 | 條件 | Icon |
|-----|--------|------|------|
| `perfect_week` | 完美一週 | 一週內每天都學習 | 🌟 |
| `explorer` | 步步探索 | 嘗試過所有 10 種步驟類型 | 🧭 |

### Onboarding First Win

1. 選課文頁面旁加「完成可得 ~60 XP，距離 Lv2 只差這一篇！」callout
2. `first_story` badge 解鎖時 → 全螢幕 StarCelebration + confetti
3. AchievementCard locked 狀態 → 模糊預覽 + 解鎖條件文字（不只 🔒）

### 不做（Defer to Phase 2）

- `speed_reading_improve`（需歷史 CPM 比對，中-高難度）
- `combo_3_correct`（需 session-level state，高難度）
- `speed_demon` badge（CPM > 200 對國小生門檻過高）
- Leaderboard 上線（CEO: 補救教學學生不需要排名）
- 教師端 XP dashboard

## Phase 2（待 DAU > 10 後再評估）

1. `speed_reading_improve` + `combo_3_correct` XP events
2. Daily tasks（每天 3 個推薦任務）
3. Streak freeze（每週 1 次）
4. Combo 系統（連續答對 → XP 倍率）
5. Skill tree 視覺化（#931 @stgst）
6. 教師端 XP/活躍度 dashboard

## Phase 3（待確認教育場景適切性）

1. Leaderboard（需方大哥確認）
2. Seasonal events
3. Peer endorsements

## 技術約束

- 不新增 DB migration（Phase 1）
- 不呼叫 Gemini/TTS/任何外部服務
- 不加新 container 或 infra
- XP 數值可透過 XP_REWARDS dict 隨時調整
