# Refactor Plan Round 2 — 21 files (Codex consult 2026-05-23 task-mphkeyye-rr4isw)

Source: Codex round-2 review after the 18-PR sweep (today's #1830-#1877).

## Execution Order (14 P0+P1)

1. **P0 LearningLayout.tsx** (1236L) — table-driven STEP_TRANSITIONS, session storage isolation
2. **P0 omo_grader.py** (646L) — schema/scoring/preprocess/crop_upload split
3. **P0 FullReading.tsx** (688L) — useFullReadingSession + TtsQueue + ResultPersistence
4. P1 MyAssignments.tsx (626L) — assignmentSessionContext shared with LearningLayout
5. P1 teacher_students.py (567L) — split into 4 route files
6. P1 SentencePractice.tsx (695L) — useSentencePracticeState + input/example/sidebar
7. P1 StrategyExercise.tsx (694L) — 3 exercise type files + strategyExerciseLogic.ts
8. P1 ZhuyinPhoneticGame.tsx (764L→693L) — zhuyinGameEngine + ModeSelect/PickGame/ComposeGame/ScoreBanner
9. P1 omo_identifier.py (590L) — omo_lesson_catalog + omo_title_matching + omo_identifier_prompt
10. P1 mcq_rescue_agent.py (563L) — rescue_session_store + rescue_state_machine + rescue_prompt_builder
11. P1 ai_generation.py (688L) — split per task: exit_ticket/sentence_practice/story_structure/teacher_comment
12. P1 lesson_loader.py (634L) — lesson_code_normalization + lesson_layer_loaders + lesson_indexes
13. P1 organizations.py (549L) — organizations_crud + dashboard + admin_report_export + points
14. P1 AppRoutes.tsx (617L) — learningRoutes.tsx generated from step metadata

## P2 (deferred to later session, 5 files)
- StoryManagementPanel.tsx (726L) — already partially refactored, low behavioral risk
- Intro.tsx (549L) — mostly presentational
- Sidebar.tsx (660L) — role nav cohesive
- AdminTreeSidebar.tsx (619L) — async tree confined
- ClassroomDetail.tsx (587L) — most tabs already extracted

## SKIP
- pinyin.ts (593L) — static dictionary + small API surface, splitting moves data not behavior

## Source
Codex task-mphkeyye-rr4isw (2026-05-23, duration 3m 37s)
