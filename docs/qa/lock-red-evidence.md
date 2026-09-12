# 回歸鎖的「紅過」紀錄

> 沒看過紅的鎖是劇場。這份記錄每一支**具名跑在 CI 的回歸鎖**是怎麼被證明會咬的：
> **mutation**（把被測的東西弄壞，確認紅的是預期那一條）或 **復現**（在真環境看過那個錯值）。
>
> ⛔ 新增到 `pytest.yml` 具名清單的鎖，**必須**在下面 `verified` 有一筆，
>    否則 `specs/test_locks_have_red_evidence_spec.py` 會紅。

## 已驗過會咬
- `test_no_stray_conflict_markers_3181.py` — 原始缺陷是**掃全庫撞到的**：`origin/staging` 上的 `.claude/skills/extract-vocab-definitions/SKILL.md` 帶著 `<<<<<<< Updated upstream`（第 284 行）與 `=======`（**檔案最後一行**），沒有 `>>>>>>>` —— 有人 `stash pop` 撞衝突、清掉對方那半、忘了刪標記，而**沒有任何測試會因此而紅**。mutation：把標記放回去 → 紅；還原 → 3 passed。⭐ 建這條鎖的當下它就抓到第二個東西：`docs/intern-training/` 那份 Git 教材（已棄用的鏡像，SOT 在 `frontend/public/`）—— 白名單原本只列了一份。附兩條自驗：掃到的檔案數必須 > 500（副檔名清單或 `git ls-files` 壞掉時，主斷言會恆綠）、以及白名單裡的檔案必須還存在（免得例外默默變成空話）
- `reportedWords3173.test.ts` — mutation（四條，每條都咬中自己那一項）：拿掉 `了` 的 `*得` → 只有「功夫『了』得 → ㄌㄧㄠˇ」紅；拿掉 `得` 的 `了*` → 只有「功夫了『得』 → ㄉㄜˊ」紅；把 `多*興邦` 放寬回 `多*` → 只有「有多『難』 → ㄋㄢˊ」紅；把 `多*興邦` 整個刪掉 → 對照組「多難興邦仍然是 nan4」紅。還原 → 18 passed。⭐ **斷言打在字型會畫出來的讀音，不是 styleSet 字串** —— 既有的 `polyphonicProcessor.test.ts` 44 條全綠而 行／著 錯了半年（#3177），正是因為斷言停在 `'ss01'` 而註解寫的讀音是錯的。⭐ 另外：**對照組抓到我自己的取捨** —— 原本計畫是刪掉 `多*`（理由是「多難興邦全庫 0 處」），但那條對照讓它紅了，於是改成收窄成 `多*興邦`，兩邊同時正確、零取捨
- `test_font_is_taiwan_reading_authority_3173.py` — mutation：把抽取器產出的台灣音整批換成大陸音（han4→he2、qi2→qi1、xie3→xue4…）→ **12 failed**，正好是那 12 條台灣音斷言；缺口組（液／癌）、表錯組（蛻／蠕）與 pypinyin 對照 5 條正確存活。還原 → 17 passed。⭐ 這條守的是**換字型時不可以把台灣音換掉** —— 字型是注音顯示的讀音真值，換成大陸讀音的字型會讓全站注音默默錯掉，而沒有任何其他測試看得到。附三組刻意的反向斷言：`液`／`癌` **斷言字型「沒有」台灣音**（哪天補上會紅，那是好消息不是壞消息），`蛻`／`蠕` **斷言字型對、`taiwan_pronunciation.json` 那兩列錯**（防止有人反過來去「修正」字型配合那張表 —— #3177 就是這樣把對的改成錯的）
- `test_rate_limiter_isolation_3171.py` — mutation：只拿掉 `ai_rate_limiter.reset()` → AI 那條隔離鎖 + 盤點鎖 2 failed，**TTS 那條照樣綠**；只拿掉 `tts_rate_limiter.reset()` → TTS 那條 + 盤點鎖 2 failed，**AI 那條照樣綠**（證明兩個是各自獨立鎖住的，不是一條鎖順便蓋到）；兩個都拿掉（回到出事前的樣子）→ 3 failed；還原 → 5 passed。原始缺陷是**實跑復現**的：PR #3170 的 CI 紅在 `test_teacher_api.py::...test_generate_ai_comment_uses_cached_comment_without_second_model_call`，`assert 429 == 200`，而同一份 code 本機全套 3981 passed。附兩條正向對照（限流器本身真的會擋第 6 次），否則「下一支拿到乾淨的」可能只是限流器整個壞掉
- `test_qa_token_fail_closed_3160.py` — mutation（#3169 那輪，七條，兩組獨立跑出同樣結果）：閘門 404→503 → 6 failed 含兩條核心鎖；404→500 → 2 failed；**404→403（仍是 4xx）→ 只有 `disabled_returns_404` 紅，`disabled_is_not_a_5xx` 正確存活** —— 這條證明兩條新斷言不是同義重複，量的是範圍不是那個數字；detail 去掉設定名 → 可診斷性那條紅；`raise`→`return`（把 fail-closed 的門真的開掉）→ **12 failed**；route 層 503→404 → 範圍對照 + 既有未動的 `test_storage_down_503` 紅。⚠️ 這個檔在 2026-09-11 之前沒被任何 workflow 點名，它確實會被「Run the whole backend suite」跑到，但不受問責登記簿約束

- `test_email_domain_validation.py` / `test_characterization_auth_phase2_co_teaching.py` / `test_characterization_auth_phase2_gamification.py` — 復現：三支都因 `POST /api/classrooms` 的跨校授權收緊而 403（2/15/10 筆），實跑確認非污染（單獨跑一樣紅）；補上 school 範圍角色後 16/15/10 passed。這三支的價值是它們**擋住把該授權放寬**：拿掉 `_make_school_member` 就回到 403 紅

- `teacherExportDoesNotLogoutOn5xx.test.ts` — mutation：把 `notifySessionUnauthorized()` 移回 `if (!res.ok)` 之下（任何錯誤都登出）→ 500 與 503 兩條 failed，401 那條正向對照照樣綠；還原 → 3 passed。原始缺陷是實跑復現的，不是讀 code 推論

- `authTransientFailureRetries.test.tsx` — mutation：把 hydration 重試改成永遠直接 throw → 「502 後重試成功仍保持登入」與「連線失敗後重試成功仍保持登入」2 failed，「401 不重試」那條照樣綠（咬得精準）；還原 → 3 passed，既有 `authNetworkFailureKeepsToken` 6 條同時綠

- `test_join_preview_rate_limit_3081.py` — mutation：拿掉 `/classrooms/join-preview` endpoint-level limiter check → 第 11 次同 user 探 code 回到 200 而非 429，1 failed；還原 → 1 passed
- `test_classroom_join_and_batch.py` — mutation：在 `/classrooms/join-preview` 的 return 之前插入真的寫入 `ClassroomStudent` 並 commit（正是這條鎖要擋的「唯讀查詢卻偷偷入班」）→ `TestClassroomJoinPreview::test_preview_does_not_enroll` 1 failed，同 class 另外 6 條照樣綠（證明咬得精準、不是整批陪紅）；還原 → 48 passed。⚠️ 這個檔在 2026-09-04 之前從未被任何 workflow 點名執行過，7 條 preview 鎖等於寫了沒插電
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
- `scripts/space_drift_scan.py`（#2864）— mutation：把 L0034 的修正退回 → 抓到 2 處、SPACE_DRIFT=FAIL；**把誤報濾網關掉 → 4 處**（抽取器自組的 `年級5課次17` 那類回來了，證明濾網是有作用的不是裝飾）；還原 → 0 處 PASS。⭐ 逐字門結構上抓不到這一類：它第 77 行 `re.sub(r'\s+','',s)` 比對前把空白全拿掉 —— 那是刻意且正確的（DOCX 的 run 會亂切），代價是這一類看不到，所以另走一條
- `test_evals_are_wired_or_explained_spec.py`（#2854）— mutation：把接上的 eval 從 run-ci.sh 拿掉 → 1 failed；**把壞掉那支（`eval_keypoints_text_fidelity`）接進 CI → 1 failed**（正向對照擋假綠燈）；讓能跑的那支不再印 PASS → 1 failed（exit 0 不算過）；還原 → 8 passed。⭐ 盤點發現六支裡有兩支是 **exit 0 但零輸出**：`eval_keypoints_text_fidelity` 根本沒有 `main()`、`eval_lesson_schema --all` 的 schema-dir 指向已刪的 `_online-schema` 回 0/0 —— 照 exit code 收會多兩盞假綠燈
- `test_gate_scripts_are_classified_spec.py`（#2729）— mutation：新增一支沒登記的門 → 1 failed（這就是票要的『擋』）；把某支的理由寫成一個字 → 1 failed；把已接上的留在 NOT_WIRED → 1 failed；還原 → 5 passed。⚠️ 第一版**紅在自我參照**：NOT_WIRED 的名字寫在這支 spec 裡，而它自己也在被掃的目錄下 —— 不排除自己的話每一支都會被算成「有人叫」，整支恆綠
  ⚠️ **偵測器改嚴之後又多找到 9 支**：原本用「整份檔案含這個檔名」判，別的 spec 只是在 docstring 裡**提到**它就被算成「有人叫」。改成行層級（只收含 `subprocess`/`python `/`import`/`SCRIPTS /` 的行）之後才撈出來 —— 其中 `keypoints_shape_gate.py` 印 `KEYPOINTS_SHAPE_GATE=PASS` 卻**檢查 0 課**（找寫死的 `v3/keypoints.yml`，而 #2916 之後 155 個檔全有 slug），`lint_prompt_overfit.py` 的預設輸入目錄根本不存在
- `test_golden_files_declare_provenance_spec.py`（#2729 機制 4）— mutation：新增一個沒 provenance 的 golden → 2 failed；把一版警語從 baseline 拿掉 → 1 failed；把檢查器的「跳過 metadata key」拿掉 → 1 failed；還原 → 6 passed。⚠️ 我加 `_provenance` 之後**當場把那兩支檢查器弄壞**（它們把它當成一課 → `KeyError: 'row_count'`）——所以鎖裡多一條盯著那個跳過還在。另：我兩次量測不一致（10 vs 95），因為第一版 regex 把裸字 `source` 也算成 provenance
- `test_eval_cases_come_from_real_failures_spec.py`（#2856）— mutation：加一條沒有 provenance 的 case（＝憑空設計的）→ 2 failed；把一條的負向對照拿掉 → 1 failed；`locked_by` 指到不存在的檔 → 1 failed；**把六條的發現方式全改成同一種 → 1 failed**（只看得到一種失敗就會漏掉別種）；還原 → 21 passed
- `test_skill_docs_do_not_contradict_themselves_spec.py`（#2858）— mutation：把矛盾那句放回 `lesson-overview-scan/SKILL.md` → 1 failed；把偵測器的主題清單清空 → 正向對照 1 failed；還原 → 41 passed。⭐ 起因：那份 skill 有**九天**同時寫著「還沒驗的：跑兩次的一致率」與「重跑一致率已量（L0072×3）」，相隔幾行 —— 讀的人拿到哪一句全看他從哪裡開始讀。另配一條反向對照：單純的「還沒驗」不可以被誤判成矛盾（否則會逼人刪掉誠實的話）
- `test_module_docstrings_name_real_things_spec.py`（#2712）— mutation：把一支不存在的 API 加回 docstring → 1 failed；把解析器的縮排條件改壞 → 正向對照 2 failed；還原 → 4 passed。⭐ 起因：`lesson_layer_loaders.py` 的 docstring 列著**五支根本不存在的函式**。⚠️ 我第一次只拿掉兩支，因為 `grep "^def load_layer1_lessons"` 回 0 看起來像「其餘還在」——**正向對照也回 0**，那個 0 什麼都不證明。這條鎖用 `hasattr` 直接問模組，不用 grep
- `test_review_flag_lives_at_the_top_2919.py`（#2919）— mutation：把巢狀旗標放回 L0139 → 1 failed；**把 30 課人手寫的 `char_marks_note` 清掉 → 正向對照 1 failed**；還原 → 4 passed。⚠️ 我第一版的清理連 `char_marks_note` / `review_reason_note` 一起 pop，一口氣刪掉 178 行 / 30 檔的人工分析（「右緣累計字數只印到 400，p2 之後那一欄是空的 —— 原稿如此，不是漏抽」那種）—— 看 diff 才發現，正是 PDCA 裡「刪證據 ≠ 消除矛盾」那條

- `test_zhuyin_map_alignment_3175.py` — mutation（**六條全部咬中，而且咬得精準**）：把非中文的長度消耗改回一格（＝重新引入 `zip` 那個位移）→ 7 failed（三條對齊鎖），**純中文正向對照照樣綠**；改成逐字呼叫 `lazy_pinyin` → 2 failed，其中 `test_context_disambiguation_survives_an_embedded_number` 單獨守著「目的地」的上下文消歧義；拿掉 fail-closed 的就地停住 → **只有** `test_fail_closed_stops_instead_of_guessing` 紅；把中文字範圍縮回舊的（漏掉 `〇` 與 CJK 擴充 B）→ 2 failed；拿掉「看起來像注音才收」的形狀檢查 → **只有** `test_a_chinese_char_never_gets_a_non_bopomofo_ruby` 紅；中文分支也照長度消耗 → 13 failed 含正向對照與裁判。還原 → 15 passed。
  **未修的父版跑最終版測試 → 9 failed / 6 passed**（綠的 6 支正是三條純中文正向對照、裁判牙齒測試，以及兩條在舊範圍下走不到的新案例）。原始缺陷是**實跑復現**的：`_build_zhuyin_map("民國2019年楊俊體育課")` → 年→ㄊㄧˇ、楊→ㄩˋ、俊→ㄎㄜˋ，體育課三個字沒有注音；`"…我點頭。"` 的「頭」拿到**句號**當 ruby。服務端量測：`data/lessons/L*/v3/key_reading.*.yml` **151 課有 135 課（89.4%）至少一段對不齊，51870 個中文字有 36026 個（69.5%）落在位移點之後**。
  ⚠️ **fail-closed 那條是 mutation 逼出來的**：第一輪它 survived —— 真實語料 25080 條字串裡 pypinyin 一次都沒對不上，**沒有輸入走得到那個分支，它等於沒被測**。補 monkeypatch 才咬得到。中文分支那條同病，由 code review 指出後補。
  ⚠️ **裁判改過兩次，兩次都是它自己太寬或太嚴**：第一版太嚴（pypinyin 的上下文輕聲變調 意思→ㄙ˙、弟弟→ㄉㄧ˙ 不在字典異讀表裡，那是對的讀音）；改成「聲韻母對得上就原諒輕聲」之後**太寬** —— code review 當場示範 `is_legal('這','ㄓㄜ˙')` 回 True，而 ㄓㄜ˙ 是「著」的讀音，常用字裡這種碰撞有 33 對，**正好是這支鎖要擋的那一類**。最終改成逐筆白名單（跑遍全語料實測出來就 5 筆）。
  ⚠️ **我自己的形狀檢查第一版是錯的**：`[ㄅ-ㄦ]` 漏掉排在 ㄦ 後面的三個介音 ㄧㄨㄩ(U+3127–3129)，「育」(ㄩˋ)、「一」(ㄧ) 當場被判成不是注音 —— **純中文正向對照立刻紅**，那正是正向對照存在的理由
- `test_font_readings_match_shipped_font_3177.py` ＋ `frontend/src/components/zhuyin/polyphonicReadings.test.ts` — mutation（**五條全部咬中**，baseline 94 vitest ＋ 4 pytest 全綠）：把 `d: 1` 加回「行」→ 5 vitest failed（四條行的讀音 ＋ 棘輪），**著 的七條照樣綠**；加回「著」→ 4 failed（三條著 ＋ 棘輪），**行 的照樣綠**（兩個字各自獨立鎖住，不是一條鎖順便蓋到）；改壞 fixture 裡「行」的 `ss01`（模擬讀音表跟字型漂掉）→ **pytest `test_fixture_matches_the_shipped_font` 紅** ＋ 3 vitest；從 fixture 刪掉「著」→ **pytest `test_fixture_covers_every_polyphonic_char_in_poyin_db` 紅** ＋ 7 vitest（覆蓋率破洞會讓 `readingOf()` 回 null，而 `not.toBe()` 對 null 是恆真的 —— 這條擋的就是那個）；`styleSetMapper` 的 `j > default` 分支改成 off-by-one → 16 vitest failed。還原 → 94 ＋ 4 全綠。
  **未修的父版資料（`origin/staging` 的 `poyin_db.json`，行／著 都帶 `d: 1`）跑最終版測試 → 8 failed / 25 passed**。原始缺陷是**實跑處理器復現**的：把真的 `poyin_db.json` 餵進真的 `PolyphonicProcessor.process()`，跑遍服務端 `backend/data/lessons` 全樹（去重 76265 段文字）→ `行`／`著` 共 **6050 處，拿掉 `d` 之後 5607 處（92.7%）讀音會變**（行 2817、著 2790）。修正前「著」讀 ㄓㄨˋ（著作）2751 次而讀 ㄓㄜ˙（看著／穿著）只有 39 次 —— 那個分布本身就是倒置的證據。
  ⭐ **這兩支存在的理由是：既有的 `polyphonicProcessor.test.ts` 44 條全綠，而它鎖住的是一個錯的信念。** 那些斷言停在 styleSet 字串（`expect(...).toBe('ss01')`），註解寫「ss01 = xíng二聲」，而出貨字型說 `行` 的 ss01 是 **hang2**；它還餵自己捏的 fixture（`d: 1` 是手寫進去的），所以連真的 `poyin_db.json` 對不對都沒在驗。新的斷言改成打在**字型會畫出來的讀音**上，真值由 `backend/scripts/extract_font_readings.py` 從 TTF 抽出來。那九條錯的已從舊檔移除。
  ⚠️ **`frontend/public/**` 原本兩支 workflow 都沒涵蓋** —— 只改 `poyin_db.json` 的 PR **不會跑任何測試**（pytest 只認 `backend/**`，frontend-checks 只認 `frontend/src/**`）。鎖建了沒插電的老問題，本 PR 一併補上；後端那三個跨語言路徑則是被既有的 `test_cross_language_paths_are_in_the_ci_filter` 當場咬紅才補進去的

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
