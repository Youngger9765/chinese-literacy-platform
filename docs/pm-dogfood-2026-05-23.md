# LingoLeap PM Dogfood Report 2026-05-23

**Environment**: staging (`lingoleap-frontend-staging`)
**Session**: ~60 min, 51 screenshots in `/tmp/pm-dogfood/`
**Persona**: 國小高年級學生 + 國小教師
**Methodology**: gstack `/browse` headless walkthrough of Flow 1 (self-learning 12 steps) + Flow 2 (assignment lifecycle teacher→student→teacher)

---

## Executive Summary

- Flow 1 time: ~25 min (12 steps walked)
- Flow 2 time: ~25 min
- **Critical breaks (P0): 6**
- **UX friction (P1): 11**
- **Product opportunities (P2): 7**

**TL;DR**: Frontend chrome and AI scaffolding (Socratic tutor, content-rich) are best-in-class for Taiwan K-12 ed-tech, **but the data integrity layer is broken under the hood**: brand-new assignments throw 403+CORS on start, the teacher's grading workflow opens reports that always say "尚未完成" (even for 已完成 sessions), and core pedagogy (閱讀聚光燈) is empty for the very first recommended lesson. There's also a glaring **silent-wrong-answer bug** in vocab-definition (step 5) that contradicts the polished feedback in vocab-application (step 6) and comprehension (step 9) — three quiz steps, three different correctness UX patterns.

If a real teacher and student tried Flow 2 cold tomorrow, they would hit "啟動作業失敗" and never recover. **This must be fixed first.**

---

## Flow 1: Student Self-Learning

### Step-by-step observations

**Step 1 · 課程簡介 (Intro)**
- Loads ~3s. Stepper shows "1/12" but page body says "本課 11 個學習步驟" excluding intro → confusing count.
- Bottom CTA says **"開始逐段朗讀"** but actually navigates to **`reading-annotation`** (做記號, step 2) — the button label is wrong. Confirmed bug.
- Side stepper is a row of single-character icons (簡記段讀詞用光重解複補報). Cryptic; requires hovering for tooltips. Students would never decode "光" = "閱讀聚光燈" without help.

**Step 2 · 讀全文-做記號**
- Two-pass instructions ("第一次找不懂", "第二次找重要") are clear.
- "❓ 不懂 / 💛 重要" appear to be labels, not action buttons. Selection mechanism (highlight text + tap label) is not communicated. Affordance unclear.
- "完成標記" button is enabled even with 0 marks → silently skippable.

**Step 3 · 逐段朗讀 (Tutor)**
- Paragraphs locked sequentially — good.
- "volume_up AI 朗讀" and "mic 開始朗讀" buttons unclear what happens when clicked (no visual hint about microphone permission).
- chevron next button enables before any actual reading is done → can be skipped completely.

**Step 4 · 全文朗讀**
- Same pattern as step 3. Skippable.

**Step 5 · 詞語理解 (vocab-definition)** — **🔴 P0 silent wrong-answer**
- 12 multiple-choice questions, drag-pair sub-mode after.
- **Wrong answers are silently accepted and advance to the next question.** No ✗ mark, no "再試一次", no explanation. Tested 3 times in a row.
- This contradicts the design of step 6 (vocab-application) and step 9 (comprehension) which give proper feedback. Three different quiz UX → inconsistent learning loop.

**Step 6 · 語詞應用 (vocab-application)**
- Fill-in-blank with word bank. Used words are greyed out (good).
- Wrong answer shows "再試一次！" callout with hint → good.
- But: even when correct word inserted, the system can show "再試一次" if it's not the *intended* answer (multiple valid fits, e.g. 疑難雜症 vs 摸不著頭緒 for "讓人＿＿，無法解決"). The system enforces single answer without explaining why.
- Right answer silently advances without celebration.

**Step 7 · 閱讀聚光燈 (reading-strategy)** — **🔴 P0 missing core pedagogy**
- For the FIRST recommended lesson `《贏得喝采的輸家》`, content is **"此課文尚未有閱讀聚光燈練習"**. 
- 閱讀聚光燈 is the central pedagogy per 5/1 expert review (memory: project_meeting_0501_decisions.md). Showing students "尚未" on the headline feature on their first lesson is a brand kill.
- "跳過，下一關 →" button skips to step 9, bypassing step 8 entirely.

**Step 8 · 文章重點表 (story-structure)**
- 3 free-text fields (主角 / 主題 / 特色) + 9 checkboxes grouped 背景/經過/結果.
- 6 correct out of 9 (3 distractors) — good cognitive demand.
- "下一關 →" enabled with 0/6 done — skippable.

**Step 9 · 閱讀理解 (comprehension)** — **🟢 BEST UX in the app**
- Wrong answer marked ✗, correct ✓, with 💡 explanation.
- "🦉 問 AI 助教，一起想想看" launches Socratic tutor modal.
- Tutor (小語老師) has quick replies: 我不知道 / 可以提示我嗎 / 再說一次 / 讓我想想. Responsive ~3s. This is excellent.
- This is what every other quiz step should mimic.

**Step 10 · 語詞複習 (vocab-word-search)**
- Word-search puzzle. Drag-to-select. Gamified, fun. No issues observed.

**Step 11 · 知識補給站 (knowledge-station)**
- Single YouTube embed. Simple, fine. Could add "看完後問你一題" for retention.

**Step 12 · 報告 (report)**
- 6 sections (朗讀總覽 / 智能分析 / 逐句對比 / 錯字清單 / 練習建議 / 課文理解力評估).
- Layout placeholder when reading not done — clear messaging "完成逐段朗讀或全文朗讀後...".

### Persistence / resumption test
- Navigated mid-vocab-definition → returned via direct URL → **all progress reset to 1/12**. No resume. P1.

### P0 critical breaks (Flow 1)
1. **Step 5 silent accept of wrong answers** — destroys learning loop, 12 questions can be cleared at 0% comprehension.
2. **Step 7 empty on flagship lesson** — first impression on core pedagogy.
3. **Step 1 button label "開始逐段朗讀" navigates to step 2 (做記號)** — false labeling.

### P1 friction (Flow 1)
1. Stepper count "1/12" vs body "11 個學習步驟" inconsistent (intro counted or not?).
2. Single-char icons need tooltip — students get lost.
3. Three different quiz feedback patterns across step 5/6/9 — should be unified to step 9's pattern.
4. Vocab-application "再試一次" with no answer reveal — could leave student stuck.
5. Every step has a "next" button that ignores progress → no friction to skip everything.
6. Mid-step refresh resets quiz progress to question 1.
7. Question 1/12 vs 5/12: Wrong-answer screenshot shows purple-bordered first option — feels like a CSS focus state being confused for correctness highlight.

### P2 opportunities (Flow 1)
1. Add celebration/confetti on correct answer + streak counter inside a quiz (Duolingo pattern).
2. Step icons could pulse/animate on the active one + show ✓ on completed.
3. After AI tutor solves the question, the next question should auto-load — currently student has to also press "下一題 →".
4. 閱讀聚光燈 missing → at minimum, show "本課暫無聚光燈練習 — 老師會在下一版加入" with a polite tone.

---

## Flow 2: Assignment Lifecycle

### Phase A: Teacher creates

**Path discovery**
- From teacher home, clicking the prominent "建立作業" quick-action card lands on **/teacher (班級管理)** which only shows "建立班級" button. **No "建立作業" button on this page.** Confusing CTA → wrong landing.
- True path: sidebar → 作業管理 → "建立作業" button top-right. Two extra clicks vs the home shortcut.

**Form**
- Inline panel slides down. Fields: 課文* (required dropdown of 165 lessons, no search), 作業標題 (optional), 說明 (optional), 截止日期 (optional), 跳過已完成 (checkbox), 朗讀目標設定 (難度標籤 + 目標語速 + 目標正確率 sliders).
- Submitting creates assignment — **no toast / no confirmation modal**. Just appears in the list. Teacher might miss it.
- **Header still shows "歡迎回來，李老師 老師！"** — name "李老師" + role "老師" stacked → "李老師 老師". Doubled. Minor copy bug.

### Phase B: Student completes

**🔴 P0 CRITICAL BUG**: Newly created assignment fails to start.
- Student goes to 班級作業 → sees new assignment "贏得喝采的輸家 待完成 📍 Bulk驗證 2026-05-16｜李老師指派"
- Clicks "開始" → red error banner: **"啟動作業失敗"**
- Console: `POST /api/assignments/4/start` returns **403** + missing CORS headers (CORS-blocked at browser).
- Repro: 100% on freshly created assignment. (Existing seeded assignments like "G6-L22 Bulk驗證" work — open without error.)
- Two distinct bugs surface together:
  - **Backend**: 403 forbidden when student in correct classroom tries to start (likely authorization mismatch between created assignment + classroom membership in seed data, OR student/assignment classroom mapping wrong).
  - **CORS misconfig**: 4xx responses don't include `Access-Control-Allow-Origin` headers → browser fails before any client-side error handling can show a useful message. Same staging subdomain; this is a backend CORS middleware bug on error responses.

### Phase C: Teacher reviews

**Assignment list (作業管理)** — looks decent.
- Drill-down shows: 目標語速 150 字/分, 目標正確率 90%, 已完成 0, 總學生 1, 共 1 次作答 (system tracked the failed start attempt as "1 次作答").
- "提醒 1 人" CTA for nudging — nice.
- Columns: 學生姓名 / 最新狀態 / 作答次數 / 最新分數 / 朗讀數據 / 評語 / 批改 — all "—".

**Classroom view (`/teacher/classroom/1`)** — rich. 7 tabs:
- 學生進度 / 學生名單 / 課文管理 / 學習分析 / 跨課文分析 / 早期介入 / 錯字熱力圖 / 協同教師
- Join code displayed prominently (`406UGX`), with 複製代碼 / 重生代碼.
- Student detail expands inline; per-lesson history table with 報告 / 對話 buttons.

**🔴 P0 BUG**: Per-session report view broken.
- Click 報告 link for L01 (which row shows "已完成 70%") → opens `/teacher/students/4/sessions/1/report`.
- Page header: "小明 的學習報告 L01" + "給 小明 的評語" + "AI 建議評語" panel + textarea.
- Page body: **"學生尚未完成此課文的學習，暫無報告資料"**
- Same for L02 (shown as 已完成 55% in row) → same message.
- "重新產生" AI 建議評語 button does nothing visible.
- Console: TeacherSessionReportPage chunk failed to load (MIME=text/html instead of JS) → stale CDN cache. Plus subsequent 403s on API calls.

**Result**: Teacher cannot view individual student reports or assign feedback. The flagship grading workflow is dead in staging.

**🟢 Strong points in teacher view:**
- 學習預警 banner on 學習分析 tab: "成績下滑 — 小明 最近 3 次分數持續下降：80 → 78 → 60" — actionable.
- 班級表現矩陣 (學生 × 課文) heatmap — color-coded by score band. Excellent for teacher pattern recognition.
- Multiple drill-down levels.

### P0 critical breaks (Flow 2)
1. **新建作業學生啟動失敗 (403 + CORS)** — assignment lifecycle is broken end-to-end.
2. **教師單堂課報告永遠顯示 "尚未完成"** — even when row shows 已完成. Backend probably treats "session complete" differently from "報告 data ready".
3. **Code-splitting chunks 404 / wrong MIME** — staging served stale `index.html` referencing old chunks. Cache invalidation issue.

### P1 friction (Flow 2)
1. "建立作業" CTA on teacher home → goes to 班級管理 (wrong page).
2. "李老師 老師" duplicated role suffix.
3. No success toast after assignment creation.
4. 165-lesson dropdown without search/filter (long scroll).
5. 學習預警 says 小明 declining; 早期介入 says "目前無高風險學生" — contradiction.
6. 平均學習時長 4559.6 分鐘/生 (~76 hours each) — suspicious metric (likely idle session minutes counted).
7. Demo data: 3rd-grade student 小明 has practiced 4年級 through 8年級 lessons — confuses the demo story.
8. "Bulk驗證 2026-05-16" is the default class name — looks like internal test data; teacher demos shouldn't see this.

### P2 opportunities (Flow 2)
1. Inline preview of selected 課文 when teacher picks from dropdown.
2. Teacher batch-assign to multiple classes at once.
3. "提醒 1 人" should support customizable nudge message (LINE / email / in-app push).
4. AI 建議評語 should auto-generate on report open (not require manual "重新產生" click).

---

## Cross-flow observations

1. **Three competing "今日課文" / "繼續閱讀" / "推薦課文" surfaces on student home** — student doesn't know which to click. Should be unified into one primary CTA.
2. **`?難度符合你目前的程度`** — the literal "?" prefix on every recommended lesson is a missing icon glyph. Polish issue but on first impression.
3. Teacher login lands on `/teacher-home`, but most actions deep-link to `/teacher` or `/teacher/assignments?classroom=N` — URL structure inconsistent.
4. No global success/error toast system — both flows fail silently or with raw red banners.
5. Step labels on assignment cards are non-interactive text labels (12 step names in a grid) — visual noise; only "開始/繼續" works. Either make labels clickable jump-to-step or compress to a progress bar.

---

## Top 5 to fix tomorrow

1. **🔴 [P0] Backend `POST /api/assignments/{id}/start` 403 on fresh assignment** — investigate authorization rule + ensure CORS middleware includes ACAO on 4xx error responses. Likely 1 backend ticket. Without this fixed, **the entire 教師指派 → 學生作答 → 教師批改 funnel is broken in staging**, and teacher demos will fail live.
2. **🔴 [P0] Teacher per-session report always says "尚未完成"** — backend probably checks a `report_ready` flag separate from `session.is_complete`. Fix the join so 已完成 sessions surface report content. Also check the chunk-loading 404 (MIME=text/html) — that's deploy cache invalidation, may be a Cloud Run revision pinning issue.
3. **🔴 [P0] Vocab-definition (step 5) accepts wrong answers silently** — add ✗ feedback + correct-answer reveal like step 9. Code: `frontend/src/components/reading-steps/VocabDefinition` or similar.
4. **🔴 [P0] Empty 閱讀聚光燈 on flagship "贏得喝采的輸家"** — either (a) populate YAML for top 6 recommended lessons before any 5/16 demo, or (b) change empty-state copy to be apologetic and offer alternative practice.
5. **🟡 [P1] "建立作業" quick-action on teacher home lands on wrong page** — change link target to `/teacher/assignments` with `?open=create` query to auto-open the form.

---

## Top 5 product opportunities

1. **Unify quiz feedback** — adopt step 9 (comprehension) as the canonical correct/wrong UX pattern across step 5, 6, 8. Adds consistency + scaffolding everywhere.
2. **Step progress persistence (resume)** — save quiz progress per question, resume on return. Without this, students who close the tab lose 10+ minutes of work.
3. **Friction on "skip" buttons** — current "下一關" enabled with 0 progress. Make it secondary; primary CTA should be "完成本關" (require some minimum interaction).
4. **Teacher: live student work preview** — currently teacher only sees aggregate; should be able to "watch" a student's session attempt (especially the Socratic dialogues) like Khan Academy's class view.
5. **Empty-state copy as opportunity** — every "尚未完成" / "目前無高風險學生" / "尚無錯字記錄" page should suggest the *next teacher action* (e.g. "建議：指派一份摘要練習作業給全班").

---

## Comparisons to Duolingo / Khan Academy

- **What LingoLeap does better**: Pedagogically rich (12-step pipeline, Socratic AI tutor, three-text-types analytics, error heatmap, early intervention) — far ahead of Duolingo for teacher tools. Aligned with Taiwan K-12 curriculum.
- **What LingoLeap should steal from Duolingo**: 
  - Consistent immediate feedback on every interaction (✓/✗ + explanation).
  - Streak / heart system that gates "skip without progress".
  - Mobile-first one-tap interactions (current click targets are decent-sized but desktop-feel).
- **What LingoLeap should steal from Khan Academy**:
  - Mastery percentage per skill (not just per lesson).
  - "Hint" button that gives progressive scaffolding before revealing answer.
  - Class roster with weekly active minutes (not raw cumulative hours — current 4559 分/生 is unreadable).

---

## Where I got stuck (most valuable signal)

- **Got stuck creating an assignment as teacher**: clicked the obvious CTA "建立作業" from home, landed on class management with no obvious way forward. Took 2 minutes to discover sidebar → 作業管理 path.
- **Got stuck as student trying to start the new assignment**: red banner "啟動作業失敗" with no actionable recovery. Refresh didn't help. Logout/login didn't help. Only by clicking the *other* (seeded) assignment did I confirm the platform works at all.
- **Got stuck reading reports as teacher**: clicked 報告 link, expecting 朗讀分析/智能分析/錯字清單 like the student-side report scaffold. Got an empty page saying "尚未完成" for a session marked 已完成. Lost confidence that any grading data was real.

These three sticking points map to the three P0s above.

---

## Appendix: Files referenced

- Step definitions: `frontend/src/config/stepConfig.ts`
- Step components: `frontend/src/components/reading-steps/`
- Assignment routes: `backend/app/routes/assignments/*.py` (split per #1811)
- Teacher routes: `backend/app/routes/teacher.py`
- Socratic agent: `backend/app/services/socratic_agent.py`
- AI service: `backend/app/services/ai_service.py`
- Frontend API client: `frontend/src/services/api.ts`

Screenshots: 51 PNGs under `/tmp/pm-dogfood/`
