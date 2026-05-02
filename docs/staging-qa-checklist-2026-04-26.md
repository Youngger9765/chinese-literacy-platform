# Staging QA Checklist — 2026-04-26 (post-13-PR batch, pre-5/1 demo)

## Environment
- Frontend: https://lingoleap-staging.web.app
- Backend: https://lingoleap-backend-staging-958347263320.asia-east1.run.app
- Demo students seeded: `demo01-03@testdata.lingoleap.dev` / `test1234` (after admin clicks [Demo] button)

## Demo Path A — Student learning (critical 5/1 demo path)

| # | Feature | Verify | Expected |
|---|---|---|---|
| A1 | Login student | demo01@testdata.lingoleap.dev / test1234 | Login OK, redirect to /student |
| A2 | Story library | Browse + select | Stories visible, can click |
| A3 | Step 1 reading-annotation | 讀全文做記號 | Highlight saves, no error |
| A4 | Step 2 tutor (逐段朗讀) | 朗讀 + 點繼續 | Encouragement shown, **NO accuracy %**, NO CPM number, persists on reload |
| A5 | Step 3 full-reading (全文朗讀) | 朗讀全文 | **Stars + 鼓勵語**, NO score circle, NO speed/accuracy stats |
| A6 | Step 4 listening (聽力理解) | (a) 輸入 "123" (b) 貼全文 (c) 點繼續 reload | (a) 不通過 (b) 高分 (c) 持久化 |
| A7 | Step 5 vocab (生字) | 練筆順 | Saves progress |
| A8 | Step 6 sentence-practice (造句) | 寫句子 | AI 批改溫柔不批評 |
| A9 | Step 7 vocab-definition (詞語定義) | 配對 | Score saved |
| A10 | Step 8 vocab-application (語詞應用) | 填空 | Saves |
| A11 | Step 9 comprehension (課文理解) | 蘇格拉底對話 5 題 | 完成觸發 score |
| A12 | Step 10 vocab-word-search | 找字 | Time recorded |
| A13 | Step 11 dictation | (a) hidden from StepperNav (b) URL `/learn/:id/dictation` 直接打 | (a) StepperNav 看不到 (b) 自動 redirect 到第一個 enabled step (#1312 fix) |
| A14 | Step 12 knowledge-station | 看影片 | Marks viewed |
| A15 | Step 13 report | (a) 看報告 (b) 沒做朗讀時打開報告 | (a) **學生版不顯示分數 numbers** (per #1094 #1097) (b) 不彈「★★★ 恭喜完成」popup，只顯示黃色警告 + 「回到課文」CTA (#1311 fix) |
| A16 | Learning history | /learning-history | NO 得分/準確率 column for students |
| A17 | Student dashboard chart tooltip | hover 30 天圖 | Shows "完成: N 篇", NO 平均分 |

## Demo Path B — Teacher (must show numbers, contrast with student)

| # | Feature | Verify | Expected |
|---|---|---|---|
| B1 | Teacher login | (any teacher account) | Login OK |
| B2 | Classroom view | List students | Students visible |
| B3 | Dashboard "recent N days" | Look at completed count | Includes submitted assignments (#1192 fix) |
| B4 | Student session report (teacher view) | Open as teacher | Numbers VISIBLE here (kept for teacher) |
| B5 | Create assignment | Teacher creates | Atomic transaction, no orphan rows (#1185) |

## Demo Path C — Admin

| # | Feature | Verify | Expected |
|---|---|---|---|
| C1 | Admin login | admin@test.com or similar | Access admin panel |
| C2 | [Demo] 建立測試學生 button | Open classroom detail | Amber-bordered button visible (#989) |
| C3 | Click button → input 3 | Submit | Creates 3 demo students, response with creds |

## Smoke / Health

| # | Feature | Verify | Expected |
|---|---|---|---|
| S1 | Backend /api/health | curl | 200 |
| S2 | Frontend landing | goto / | renders, no JS errors |
| S3 | Login page | goto /login | renders, no JS errors |
| S4 | Console errors | throughout test | none persistent |

## Issues to verify fixed (cross-reference with PRs)

- #989 → C2/C3
- #1094 → A4 A5 A15 A16 A17
- #1097 → A5
- #1098 → A6
- #1180 → invisible (logging only — N/A QA browser)
- #1181 → B5 (assignment flow integrity)
- #1182 → A4 step persistence (current_step deprecate)
- #1183 → invisible (versioning — would need replay scenario)
- #1184 → invisible (self-study classroom_id NULL)
- #1185 → B5
- #1188 → invisible (story_slug derived)
- #1189 → invisible (DialogueTurn FK)
- #1192 → B3
- #1311 → A15(b) — popup suppress when no reading data（4/28 QA matrix finding，已 fix + prod verified）
- #1312 → A13(b) — disabled step route guard（4/28 QA matrix finding，已 fix + prod verified）
