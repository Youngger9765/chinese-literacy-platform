# 回歸鎖的「紅過」紀錄

> 沒看過紅的鎖是劇場。這份記錄每一支**具名跑在 CI 的回歸鎖**是怎麼被證明會咬的：
> **mutation**（把被測的東西弄壞，確認紅的是預期那一條）或 **復現**（在真環境看過那個錯值）。
>
> ⛔ 新增到 `pytest.yml` 具名清單的鎖，**必須**在下面 `verified` 有一筆，
>    否則 `specs/test_locks_have_red_evidence_spec.py` 會紅。

## 已驗過會咬

- `test_characterization_learning_sessions_1955.py` — 復現：同上，靜默跳過導致「路由沒註冊」
- `test_characterization_omo_1949.py` — 復現：py3.11+fastapi0.141 AttributeError
- `test_classrooms_dev_filter_1999.py` — 同上（它是污染源那一側）
- `test_course_level_modules_are_loaded_2964.py` — mutation：拿掉 COURSE_LEVEL_MODULES 的補回 → 紅
- `test_dialogue_history.py` — 復現：#1135 gate 上線後一直 422（12 條）
- `test_followup_never_vanishes_2964.py` — 復現：L0144 的加碼題在磁碟上、載完之後兩層都沒有
- `test_perf_1243_remaining_optimizations.py` — 對照：兩邊的修都拿掉 → 12 條紅
- `test_reading_benchmark_reaches_the_row_2964.py` — 復現：175 課的門檻整批 None
- `test_session_scoring_below_threshold_2904.py` — 復現：prod 561 課完成只有 9 筆有分數
- `test_student_progress.py` — mutation：把 fallback 的 completed 分支改成 False → 1 條紅
- `test_reading_audio_upload.py` — mutation：拿掉活路的上傳呼叫 → 1 failed；改掉 blob path 前綴 → 1 failed；還原 → 15 passed
- `test_reading_audio_replay_student.py` — mutation：拿掉 IDOR 的 owner 過濾 → 1 failed；還原 → 9 passed（那條 IDOR 斷言在此之前從沒執行過）
- `test_key_reading_qa_2712.py` — mutation：把 target 改回「整篇總字數」→ 1 failed；還原 → 14 passed
- `test_key_reading_range_restored_2912.py` — mutation：把 L0003 改回「只有第七段」（end=start、passage 截到 259）→ 1 failed；還原 → 4 passed
- `test_key_reading_rule_is_stated_once_2912.py` — mutation：把 end 寫死回 start → 2 failed；把 skill 的規則改回舊的 → 1 failed；還原 → 5 passed
- `test_key_reading_data_matches_extractor_2912.py` — mutation：手改一課的資料 → 1 failed（指名哪一課）；改抽取器不重生 → 1 failed；還原 → 2 passed
- `test_key_reading_reaches_the_student_2912.py` — mutation（打**真正的服務路徑** `lesson_uid_loader`，先驗證服務端輸出真的變了才算數）：截斷成 150 字 → 2 failed；整個不給 key_reading → 3 failed；還原 → 4 passed
- `test_key_reading_span_gap_is_flagged_2912.py` — mutation：拿掉一課的 `needs_human_review` → 1 failed；把理由裡的數字抹掉 → 1 failed；給對得上的課亂標（正向對照）→ 1 failed；拿掉一課的 `printed_counter_last` → 1 failed；還原 → 5 passed
- `test_key_reading_anchor_matches_counter_2912.py` — mutation：把段號校正整段關掉（`if False`）→ 3 failed；還原 → 9 passed。⚠️ **保守閘門③（換過去要真的對得上）全庫沒有課走得到**，整批 mutation 咬不到它 —— 所以把判斷抽成純函式 `realign_anchor()`，用合成輸入單獨鎖：拿掉 ③ → `test_gate_3_refuses_a_neighbour_that_hits_more_marks_but_still_misses` 紅
- `test_key_reading_ledger_matches_reality_2912.py` — mutation：從帳本刪掉一課 → 1 failed；把兩桶合併回「不是缺口」（就是原本那句錯話的形狀）→ 1 failed；帳本記一課其實有念順順的 → 1 failed；抽掉 `how_to_close` → 1 failed；還原 → 5 passed
- `test_deferred_answer_extraction_stays_unreachable_2823.py` — mutation：把 `if options or answer:` 改成 `if False:`（讓真語料形狀落進 fallback）→ 3 failed；把 docstring 裡的 `#2823` 改掉 → 1 failed；還原 → 5 passed。另附正向對照 `test_the_tripwire_can_actually_fire`，證明真的有輸入會設那個旗標 —— 否則那三條「不該落到 fallback」是恆真的
- `test_claudemd_only_names_live_gates_spec.py` — mutation：把 CLAUDE.md 的必跑門改回 `content_evidence_gate.py`（沒有任何 runner 叫它）→ 2 failed；改成指向不存在的 `specs/run-ci-deleted.sh` → 3 failed；還原 → 4 passed。⚠️ 它的正向對照第一版是壞的：regex 只找 `scripts/`，而真正在跑的門住在 `specs/` —— 改完 CLAUDE.md 之後那條立刻紅，才發現只找一個目錄會讓整支靜靜地變恆真
- `frontend/tests/e2e/classicalTrackReachable.spec.ts` — 真瀏覽器（headless，打 staging）：把「來源沒這大題的課側欄不該有那一步」反過來斷言 → 1 failed（證明它分得出兩種課，不是所有課都長一樣）；把正向對照改成期待文言文那句 → 1 failed（證明正常課沒被降級成唸全文）；還原 → 4 passed。⭐ 這支存在的理由是**我自己的錯**：我從資料層看到 `has_key_reading=false` 就在總帳本寫「🔴 真缺口，學生看不到」，真的走一次才發現學生看得到，而且看到的正是學習單要的原文
- `test_dead_source_paths_only_shrink_spec.py` — mutation：新增一支含死引用的檔 → 1 failed；把一個**存在**的路徑加進 DEAD 清單 → 1 failed（證明存在性判斷分得出來）；還原 → 3 passed。⚠️ 第一版沒咬：上限設 12 而實際是 10，**留了兩格 slack 的棘輪不會叫** —— 上限要等於當下實測值
- `frontend/.../worksheetButton2845.test.ts` — mutation：把那顆的 aria-label 改回帶 PDF → 1 failed；多加一個下載呼叫點 → 1 failed；**把整區刪光 → 3 failed**（少了這條，一堆「不准有」在整區被刪時會全綠）；還原 → 6 passed。⚠️ 第一版用「數所有含『學習單』的 label」判，把**上傳學習單（#1637）**那套也算進來，一開始就紅在錯的地方 —— 改成鎖「什麼不准出現」
- `test_worksheet_url_is_not_silently_dead_2845.py` — mutation：拿掉 docstring 的 `#2845` → 1 failed；把 `_derive_docx_url` 接進 `routes/stories.py` → 1 failed（提醒接之前先確認檔案拿得到）；把 manifest 砍到 3 行 → 前提對照 1 failed；還原 → 3 passed
- `test_progress_table_is_fresh_spec.py` — mutation：把進度表回退成 staging 上那份（51 課）→ 2 failed；只改「現況」那格的數字讓它跟表身漂移 → 1 failed；還原 → 3 passed。⭐ 這張表自己的檔頭就寫著「不要手改」，但**沒有東西擋它過期** —— 它就這樣停在 51 課，而實際是 175/175

## grandfathered（既有債，未逐支驗過）

2026-08-28 一次插電 104 支，其中 **95 支沒有逐支驗過它會咬**。
它們都是綠的、也都是為某個真 bug 寫的，但「當初有沒有紅過」沒有紀錄。
這是**看得見的債**，不是通過 —— 動到哪一支就順手補一筆進上面，並把它從這裡移除。

- `test_ai_analysis_deprecation_1648.py`
- `test_ai_base_split_1953.py`
- `test_ai_generation_split_1888.py`
- `test_asset_proxy_on_served_path_2748.py`
- `test_assignment_1762.py`
- `test_assignments.py`
- `test_auth_route_split_1844.py`
- `test_auth_token_gate.py`
- `test_blank_marker_regex_2878.py`
- `test_bracket_inline_choice_2786.py`
- `test_characterization_omo_1857.py`
- `test_checked_box_answer_leak_2555.py`
- `test_choice_rows_carry_options_2736.py`
- `test_classical_modules_entry_2752.py`
- `test_course_intro_present_2736.py`
- `test_dashboard_assignment_completion.py`
- `test_docx_named_styles_2715.py`
- `test_docx_second_opinion_2868.py`
- `test_every_lesson_detail_validates_2725.py`
- `test_every_module_has_a_named_guard_2872.py`
- `test_every_module_has_a_skill_2843.py`
- `test_gate_uses_current_step_ids_2730.py`
- `test_goal_box_self_check_entry_2752.py`
- `test_health_alias_2737.py`
- `test_inline_choice_grading_2776.py`
- `test_inline_choices_stay_in_the_sentence_2768.py`
- `test_keypoints_columns_bridge_2736.py`
- `test_keypoints_shape_gate_empty_claim_2736.py`
- `test_knowledge_station_videos_2736.py`
- `test_lesson_cover_served_2767.py`
- `test_lesson_ordering_2736.py`
- `test_lesson_row_keypoints_2749.py`
- `test_lesson_strategy_join_2898.py`
- `test_manifest_builder_does_not_destroy_2795.py`
- `test_matrix_option_bank_2749.py`
- `test_mcq_rescue_split_1887.py`
- `test_migration_pii_repair_1931.py`
- `test_mixed_blank_shapes_2785.py`
- `test_module_entry_gate_parser_2752.py`
- `test_multi_text_and_followups_entry_2752.py`
- `test_n1_queries_fix_1217.py`
- `test_n1_queries_fix_1301.py`
- `test_omo_grader_split_1879.py`
- `test_omo_hint_1637.py`
- `test_omo_history_1975.py`
- `test_omo_identifier_split_1886.py`
- `test_omo_pdf_split_1976.py`
- `test_omo_session_sync_2027.py`
- `test_organizations_split_1890.py`
- `test_perf_sql_aggregates.py`
- `test_progress_carry_forward_2889.py`
- `test_raw_table_not_public_2769.py`
- `test_reading_attempt_history.py`
- `test_reading_benchmark_2722.py`
- `test_regression_2_5_flash_lite_default_1744.py`
- `test_regression_fill_in_blank_127_lessons_1753.py`
- `test_regression_llm_models_per_task_1734.py`
- `test_regression_omo_grader_circuit_breaker.py`
- `test_regression_omo_grader_locked_1730.py`
- `test_regression_omo_grader_question_order_1973.py`
- `test_regression_omo_identifier_swap_1729.py`
- `test_regression_omo_job_hardening_1772.py`
- `test_regression_reading_transcription_truncation.py`
- `test_regression_text_title_n_plus_1_1810.py`
- `test_regression_thinking_budget_1738.py`
- `test_regression_tts_rate_limit_1808.py`
- `test_restart_does_not_skip_own_prior_attempt_1764.py`
- `test_round_progress_2916.py`
- `test_sample_uids_survives_missing_spotlight_2751.py`
- `test_schema_drift_guard_2683.py`
- `test_second_edition_session_start_2683.py`
- `test_section_completeness_2876.py`
- `test_seed_data_pii_1920.py`
- `test_single_blank_inline_choice_2750.py`
- `test_single_spotlight_producer_2683.py`
- `test_skip_policy_snapshot_1764.py`
- `test_sot_stale_offline_gate_2736.py`
- `test_source_coverage_2877.py`
- `test_spotlight_known_gaps_ledger_2772.py`
- `test_spotlight_ordering_items_2683.py`
- `test_spotlight_table_content_2683.py`
- `test_spotlight_textbox_heading_2714.py`
- `test_step_progress_api.py`
- `test_step_progress_parse.py`
- `test_step_sequence_from_worksheet_2736.py`
- `test_story_structure_cell_parser_2776.py`
- `test_sub_exercise_reaches_students_2865.py`
- `test_submission_counts_not_inflated_1764.py`
- `test_teacher_dev_classroom_filter_1985.py`
- `test_teacher_report_completion_1911.py`
- `test_teacher_sees_grouped_attempts_1764.py`
- `test_teacher_students_1882.py`
- `test_tts_cache_fail_closed_2765.py`
- `test_uid_tree_module_isolation_2683.py`
- `test_vocab_application_option_bank_2736.py`
