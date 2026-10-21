# 架構盤點：遊戲模組獨立性與共用抽象

> issue #3663（2026-10-21）。範圍：盤點 staging 上五種課堂遊戲機制（課堂搶答
> live_quiz、雙人 PK pk、跨班賽季 league、迷城密室 escape_room、多人對抗賽
> team_arena）+ 遊戲區 hub + 班級功能開關，逐一標出「哪些已經獨立、哪些共用
> 但沒有抽象（重複實作）、哪些共用且已經做對」，最後排出一組建議的共用積木。
>
> 方法：逐檔 `grep`/`Read` + 對照既有 PRD（`docs/prd/2026-10-*.md`），**不是**
> 憑印象寫——每一條重複都附 file:line，每一條「這是刻意設計」都有 PRD 原文或
> 程式碼內的註解佐證。沒查到依據的地方標「待確認」。

---

## 1. 每個模式一張表

### 1.1 課堂搶答 live_quiz

| 項目 | 內容 |
|---|---|
| 入口路由 | 前端 `/live`（教師）、學生端經 code 加入；後端 `backend/app/routes/live_quiz.py`（272 行） |
| backend service | `backend/app/services/live_quiz/`（package）：`engine.py`、`codes.py`、`scoring.py`、`recompute.py`、`reading_pace.py`、`round_types/`、`sources/` |
| 資料表 | `live_quiz_games`、`live_quiz_players`、`live_quiz_answers`（`models/live_quiz.py`） |
| 題庫來源 | `services/live_quiz/sources/`：`comprehension.py`、`vocab_application.py`、`vocab_definitions.py`、`zhuyin.py`（共用 `base.py` 的 `QuizItem` 介面），經 `round_types/choice.py::generate_rounds()` 抽題——**這是全平台唯一的出題核心，其餘模式都呼叫它** |
| 計時/朗讀階段 | 教師選定 `lesson_uid` 清單（不是 scope_type/scope_ref），有獨立的 `reading_pace.py`（stem-alone 延遲）—— 唯一有「朗讀停頓」設計的模式 |
| 輪詢＋版本短路 | 兩層：① `routes/live_quiz.py:144` `_unchanged_from_memory()` 呼叫 `engine.fast_poll_cache`（**全平台唯一的記憶體層級 in-process 快取**，#3551 效能優化）② `engine.py:782 build_state(..., after_version=...)` DB 層級短路（`engine.py:812`）。前端對應 `components/live-quiz/useLiveQuizPoll.ts`：1s 輪詢＋200ms jitter＋連續 5 次不變退避到 3s＋lobby/ended 降頻 2.5s |
| 頻率限制會員豁免 | `main.py:333 _live_quiz_member_cache`（positive-only cache，TTL） |
| 班級開關讀法 | `classroom_features.get_classroom_feature(classroom, "live_quiz", db=db)`，呼叫點 `services/live_quiz/engine.py:90` 與 `:982`；有「舊帳相容」fallback（`classroom_features.py` 的 `_classroom_has_live_quiz_history`） |
| 劇情包/主題 | 未使用 StoryPack（教師主持的即時題庫活動，無敘事包裝） |
| 顯示名稱/隱私 | `engine.py:365` 內聯 `anonymous_display_name = f"學生{len(game.players)+1}"`，`.name` 空值時 fallback |

### 1.2 雙人 PK pk

| 項目 | 內容 |
|---|---|
| 入口路由 | 前端 `/pk`；後端 `backend/app/routes/pk.py`（174 行，路由檔開頭明寫「Deliberately its own router/prefix」） |
| backend service | `backend/app/services/pk/`：`engine.py`、`matchmaking.py`、`rounds.py`、`rating_service.py`、`ai_tiers.py`、`scoring.py`、`classroom_features.py`（見下） |
| 資料表 | `pk_queue`、`pk_matches`、`pk_ratings`（`models/pk.py`） |
| 題庫來源 | `services/pk/rounds.py::build_pk_rounds()`——**正確重用** `live_quiz.round_types.choice.generate_rounds()`（PRD §6.1 原文：「直接呼叫 generate_rounds...per-game seeded shuffle 防正解外洩的機制也原樣沿用」），只加一層依難度排序＋跨模組分層抽樣（`_stratified_pick`，修 #3602 的「幾乎全是注音」問題） |
| 計時/朗讀階段 | `reading_seconds=0` 固定（PRD §6.1：PK 不做朗讀停頓），5 題×20 秒 |
| 輪詢＋版本短路 | `routes/pk.py:62-68`：簡單 `if after_version == state["version"]`，**沒有**像 live_quiz 一樣的記憶體層快取，也**沒有**連續不變退避/慢速階段的概念（前端 `usePkMatchPoll.ts` 只有兩檔：1s / 3s，依 `status === 'active'` 二分） |
| 頻率限制會員豁免 | `main.py:371-372` 兩個獨立 cache：`_pk_queue_member_cache`、`_pk_match_member_cache` |
| 班級開關讀法 | `classroom_features.get_classroom_feature(classroom, "pk_human", db=db)`，呼叫點 `services/pk/engine.py:178`；**無**舊帳相容 fallback（PRD 明寫這把開關是全新的，沒有歷史資料要保留）。**AI PK（挑戰文學家）刻意不受此開關限制**——`classroom_features.py` 檔頭註解：「AI PK 跟班級無關」 |
| 劇情包/主題 | 無（PRD 註記：給 NPC 對話場景的故事模式是另一份進行中的設計，PK 本身不綁 StoryPack） |
| 顯示名稱/隱私 | `engine.py:718-719`：`my_user.name` / `opponent_name`，**沒有** "學生N" fallback（名稱空值直接回 `None`，和 live_quiz/team_arena 不一致——見 §2.3） |

### 1.3 跨班賽季 league

| 項目 | 內容 |
|---|---|
| 入口路由 | 前端跨班賽季頁面；後端 `backend/app/routes/league.py`（432 行，本盤點中最大的單一路由檔） |
| backend service | **沒有 package**——`services/league_service.py`（581 行）+ `services/league_scoring.py`（297 行），是本盤點唯一仍是「扁平檔案」而非 `services/<mode>/` package 的模式 |
| 資料表 | `league_invitations`、`league_seasons`、`league_teams`、`league_team_roster_members`（`models/league.py`） |
| 題庫來源 | 不走 `round_types.choice`——league 是「長期累積型」（學生日常練習成績匯總進球季排行），不是單場即時抽題，故無需共用抽題引擎 |
| 計時/朗讀階段 | 不適用（非同步、無倒數計時的即時對戰） |
| 輪詢＋版本短路 | 無——跨班賽季榜單是請求時查詢（`GET /seasons/{id}/board`），非長輪詢 |
| 頻率限制會員豁免 | 無專屬 member cache（`main.py` 未見 `_league_*_cache`）——符合它不是高頻輪詢端點的事實 |
| 班級開關讀法 | `classroom_features.get_classroom_feature(classroom, "league", db=db)`，呼叫點 `routes/league.py:56`（`_require_league_enabled`）；**有**舊帳相容 fallback（`_classroom_has_league_history`，prod 已有 3 位老師在用，見 `classroom_features.py` 檔頭） |
| 劇情包/主題 | **有**——`backend/app/assets/league_themes/` + 跨班賽季劇情包（issue #3598「跨班賽季穿越主題」），走共用的 `story_pack_service.py`（見 §2.4） |
| 顯示名稱/隱私 | 待確認（本輪未深入 league 的名次呈現邏輯，排行榜顯示名稱規則需另外查證再下結論） |

### 1.4 迷城密室 escape_room

| 項目 | 內容 |
|---|---|
| 入口路由 | 前端 `/escape-room`；後端 `backend/app/routes/escape_room.py`（127 行，`scope_type`/`scope_ref` 驅動，**無 classroom_id 參數**） |
| backend service | `backend/app/services/escape_room/`：`engine.py`、`story_adapter.py` |
| 資料表 | `escape_room_runs`（單一張表，`models/escape_room.py`） |
| 題庫來源 | `_rounds()` 同樣呼叫 `live_quiz.round_types.choice.generate_rounds()`；機關用 `["vocab_definitions","vocab_application","zhuyin"]`，大門用 `["comprehension"]` |
| 計時/朗讀階段 | `RUN_TIME_BUDGET_SECONDS = 600`（10 分鐘整局時間預算，不是逐題倒數）；PRD §5 明文排除朗讀題型 |
| 輪詢＋版本短路 | **無**——v1 是單人＋AI 隊友的同步回合制（答題後立刻 `/state`），不需要跨玩家輪詢，故沒有 `after_version` 機制。這是刻意的架構差異，不是遺漏 |
| 頻率限制會員豁免 | **無**專屬 member cache——同樣因為它不是跨玩家高頻輪詢端點 |
| 班級開關讀法 | **無**（`classroom_features.FEATURE_DEFAULTS` 沒有 `escape_room` 這個 key）。PRD §0/§4 明文：v1「單人＋AI 隊友，AI 隊友模式不受班級設定影響，任何已登入學生都能玩」；真人組隊是 Phase 2，屆時才會新增 `escape_room_team` 開關（PRD §9.3/§12，尚未批准實作） |
| 劇情包/主題 | **有**——`story_adapter.py::resolve_story_for_run()`，讀 StoryPack 既有欄位（不跟 StoryPack 要新欄位，PRD §8），fail-open（任何例外一律退回寫死的中性預設文案） |
| 顯示名稱/隱私 | 不適用（單人模式，無需顯示其他玩家名稱） |

### 1.5 多人對抗賽 team_arena

| 項目 | 內容 |
|---|---|
| 入口路由 | 前端 `/team-arena`；後端 `backend/app/routes/team_arena.py`（148 行） |
| backend service | `backend/app/services/team_arena/`：`engine.py`、`teams.py`、`towers.py`、`weapons.py`、`story_adapter.py` |
| 資料表 | `team_arena_sessions`、`team_arena_members`、`team_arena_answers`（`models/team_arena.py`） |
| 題庫來源 | `engine.py:447` 呼叫 `live_quiz.round_types.choice.generate_rounds()`（`live_quiz_choice` 別名匯入） |
| 計時/朗讀階段 | 走 `live_quiz.reading_pace`「單向沿用」（`engine.py` 檔頭註解原文：「and `live_quiz.reading_pace` one-way」），無自己的朗讀邏輯 |
| 輪詢＋版本短路 | `routes/team_arena.py:90-103`：同款「`after_version == state["state_version"]`」短路，**版本欄位命名跟 live_quiz/pk 不同**（`state_version` vs `version`，見 §2.2）；前端 `useTeamArenaPoll.ts` 與 `useLiveQuizPoll.ts` 幾乎逐行相同（1s/3s/2.5s 三檔＋連續 5 次不變退避） |
| 頻率限制會員豁免 | `main.py:383 _team_arena_member_cache`（positive-only）＋`main.py:438 _team_arena_negative_member_cache`（**唯一有「確認非會員」負向快取的模式**，5s TTL，專門處理「剛加入還沒反映到查詢結果」的競態） |
| 班級開關讀法 | **刻意沒有**——v2 改版明文拿掉了班級開關（PRD `2026-10-18-team-arena-prd.md` §0「⭐ v2 改版」rule B：「拿掉班級開關...老師端入口移除」），`classroom_features.py` 檔頭記錄 v1 曾經有過、現已移除，**不是從沒做過** |
| 劇情包/主題 | **有**——`story_adapter.py::resolve_story_for_session()`，與 escape_room 的 adapter「同款式但不同欄位」（青隊／橙隊、書塔／主堡術語），同樣 fail-open |
| 顯示名稱/隱私 | `engine.py:108 _display_name()`，`.name` 空值 fallback 成 `學生{member.rotation_order+1}`——跟 live_quiz 同樣的「學生N」政策，**但索引基準不同**（`rotation_order` vs `len(players)`，見 §2.3） |

### 1.6 遊戲區 hub（學生／教師）

| 項目 | 內容 |
|---|---|
| 入口 | `frontend/src/pages/student/StudentGameHubPage.tsx`（issue #3633，170 行）／`TeacherGameHubPage.tsx`（116 行） |
| 定位 | 取代原本側欄三個散點入口（我們班／課堂搶答／PK 對戰），並第一次給迷城密室一個真正的導覽入口——頁面檔頭註解明寫：迷城密室 #3599 上線後「NO sidebar entry anywhere, so students could never reach it through navigation at all」 |
| 鎖定邏輯 | **已抽成共用函式** `computeStudentGameFlags()`（`services/learning/session.ts`），hub 跟 pre-#3633 的 Sidebar 共用同一份——這是本盤點中前端「共用且做對了」的正面案例之一（見 §3） |
| 哪些卡片會鎖 | 跨班賽季／課堂搶答：任一已加入班級開啟即解鎖；PK／迷城密室／多人對抗賽：**永不鎖**（hub 頁面註解逐一列出原因，與各模式自己的 PRD 對應） |

---

## 2. 重複實作清單（逐一列出 file:line、差異、是否刻意）

### 2.1 `scope_type`/`scope_ref` 解析三件套 —— 最大宗、最乾淨的重複

`resolve_pool_grade()` / `validate_scope()` / `_load_lessons_for_scope()` 在
**`backend/app/services/pk/engine.py`（原第 93–150 行）** 與
**`backend/app/services/escape_room/engine.py`（原第 35–79 行）** 逐行相同，
**四個錯誤訊息字面值完全一致**（`找不到這一課的題目，請回上一頁重新選擇` 等）。

`backend/app/services/team_arena/engine.py:123` 有第三份 `resolve_pool_grade`，
但**不是**單純複製——它**缺少**另外兩份都有的 `if wanted not in
_CLASSROOM_GRADE_RANGE` 越界檢查，且錯誤文案（`_ERR_UNKNOWN_GRADE`/
`_ERR_EMPTY_POOL`）改寫成「請聯絡老師確認年級設定」/「請改天再試」而非「請回上
一頁重新選擇」。team_arena 的 scope_ref 來源是伺服器端從 `_resolve_host_grade()`
算出來的（開房學生自己的年級），不是使用者直接可控的輸入，所以越界檢查的必要
性本來就比較低——**這看起來是刻意改寫，但沒有 PRD 文字明確說「故意不做越界檢
查」，標記為「待 Young 確認是否為刻意設計」**，本次盤點**沒有**動它。

**本次已處理**（見 §4 PR-1）：抽出 `pk` + `escape_room` 那兩份完全相同的拷貝到
`backend/app/services/game_core/scope.py`，`team_arena` 的第三份維持原樣不動。

> **Round 3 更新（issue #3673，team lead 已核准）**：team_arena 的
> `resolve_pool_grade` 確認沒有任何測試釘住它自己的錯誤文案，已改成直接
> `from ..game_core.scope import resolve_pool_grade`（刪除本地那份、拿掉現在
> 死掉的 `_ERR_UNKNOWN_GRADE` 常數），越界檢查與錯誤文案現在跟 pk／escape_room
> 完全一致。上面「待 Young 確認」的狀態已解除，見該 PR。

### 2.2 輪詢版本短路 —— 三份幾乎相同的 route 層判斷式

| 位置 | 版本欄位名 | 短路寫法 |
|---|---|---|
| `routes/live_quiz.py:144-180` | `version` | 透過 `engine.fast_poll_cache`（記憶體層，比另外兩者多一層優化）+ DB 層 `build_state(after_version=...)` |
| `routes/pk.py:62-68` | `version` | `if after_version is not None and after_version == state["version"]` |
| `routes/team_arena.py:90-103` | **`state_version`** | `if after_version is not None and after_version == state["state_version"]` |

PK／team_arena 這兩段除了版本欄位命名不同，程式碼結構幾乎一致。欄位命名不一致
（`version` vs `state_version`）**本次盤點判斷為不值得統一**——改欄位名要同時動
前後端契約（`services/pkApi.ts`/`teamArenaApi.ts` 的型別、三個輪詢 hook 的
`versionRef`/`state_version` 讀取點），風險／報酬比不划算，列為**不做**（見
§4）。

### 2.3 前端輪詢 hook —— 三份 83～108 行、同一演算法的拷貝

`components/live-quiz/useLiveQuizPoll.ts`（106 行）、
`components/pk/usePkMatchPoll.ts`（83 行）、
`components/team-arena/useTeamArenaPoll.ts`（108 行）：
同一個「self-recursive `setTimeout` + jitter + 連續 N 次不變退避 + lobby/ended
慢速」演算法，三份各自的程式碼註解甚至互相點名「same polling-loop shape as
useLiveQuizPoll.ts」。差異點：

- PK 版本**沒有**「連續 5 次不變退避到 3s」與「lobby/ended 降頻 2.5s」這兩段
  邏輯，只有 `status === 'active'` 二分成 1s/3s
- 版本欄位名跟上面 §2.2 一致（`version` vs `state_version`）
- API 呼叫函式、狀態型別各自不同（`getLiveQuizState`/`getPkMatchState`/
  `getTeamArenaState`）

**本次盤點判斷為「高價值但較高風險」**，列入建議但**本次不動手**（§4 ④）——
原因見 §4 風險說明。

### 2.4 `StemWithTarget`（注音目標字標記）—— 一份抽出、一份內聯重複

`components/live-quiz/StemWithTarget.tsx`（27 行，#3642 建立）已經被
`team_arena`（`StudentTeamArenaPlay.tsx:25` 直接 import）重用，但
`pages/pk/StudentPkMatch.tsx:59-65` 有自己的內聯函式
`renderStemWithTarget()`——邏輯逐行相同（`targetIndex` 邊界檢查 + 切字串），只
有 className 不同（`text-accent underline decoration-4 underline-offset-8`
vs `font-bold text-accent underline underline-offset-2`），且 PK 版本沒有
`data-testid="stem-target"`。commit `1a2f9956c`（#3642）的訊息本身就寫著
「backend already sends extra.target_index (PK uses it)」，證實這是同一需求
的兩次實作，不是巧合。

**本次盤點判斷為低風險高價值，已著手但被 UI 改動前置截圖關卡擋下**（本 repo
`frontend-render-safety`／`frontend-design` 的規則：改 `.tsx` 前必須先有現狀截
圖），**本次 session 時間預算內未完成瀏覽器驗證流程，改列為 §4 的高優先
follow-up ticket**，方案（className 可覆寫、預設值與 live-quiz 現狀完全一致，
PK 呼叫時傳自己現有的 className 以維持像素級不變）已經設計好、可直接照做。

### 2.5 「學生N」匿名顯示名稱 fallback —— 政策一致，索引基準不一致，PK 完全沒有

- `live_quiz/engine.py:365`：`f"學生{len(game.players) + 1}"`
- `team_arena/engine.py:116`：`f"學生{member.rotation_order + 1}"`
- `pk/engine.py:718-719`：**沒有 fallback**，`.name` 為空時回傳 `None`

三種行為都存在，且沒有任何一份共用程式碼或共用常數字串
（`"學生"` 這個字面值本身被打了三次）。PK 要不要補 fallback、以及
`len(players)` vs `rotation_order` 兩種索引基準該不該統一，**都需要產品面決
定**（例如 PK 是否曾經刻意不顯示匿名名字），本次盤點只記錄現況，**不代為決
策**。

### 2.6 StoryPack adapter —— 重複，但是「故意的、良性的」重複（對照組）

`services/escape_room/story_adapter.py`（39 行）與
`services/team_arena/story_adapter.py`（59 行）結構高度相似（都是
`resolve_story_for_*(story_pack_key) -> dict`，都 fail-open 退回寫死的中性
預設值），但這是**刻意的模式**，不是失手重複——
team_arena 的 adapter 檔頭註解直接寫「Same shape as
`services/escape_room/story_adapter.py`」，兩者刻意保持「薄 adapter 投影同一
份 StoryPack 欄位到各自模式的用詞」而不互相 import，因為兩個模式的展示欄位
完全不同（氣氛對話 vs 隊伍標籤/能量條文案），硬抽共用反而要塞一堆
if-mode-then 分支。**本次盤點判斷：這是目前全平台「共用核心 + 各自輕量
adapter」做得最好的範例**，建議作為未來新模式（如 PK 的故事模式）的範本，
**不需要改動**。

---

## 3. 共用且已經做對的地方（正面對照組，避免過度抽象）

| 共用基礎設施 | 誰在用 | 為什麼值得保留現狀 |
|---|---|---|
| `live_quiz.round_types.choice.generate_rounds()` | pk、escape_room、team_arena **三個模式直接呼叫** | 全平台唯一出題引擎，每個呼叫端只傳自己要的 `source_modules`/`question_count_mode`，沒有重寫抽題邏輯 |
| `live_quiz.sources.*`（zhuyin/vocab_definitions/vocab_application/comprehension adapter） | 經由 `generate_rounds()` 被所有模式間接使用 | 單一題型轉換層，#3610 修的「一個壞題目弄垮整個題庫」防護對所有模式一視同仁生效 |
| `classroom_features.get_classroom_feature()` | pk、league、live_quiz | 單一 JSON 欄位＋型別化讀寫＋舊帳相容 fallback，三個模式共用同一套規則，新增第四個開關只要加一個 key，不需要新 migration |
| `story_pack_service.py` / `story_pack_store.py` | league（劇情主題）、escape_room、team_arena | 共用核心 schema + store，各模式自己的輕量 adapter 投影（見 §2.6） |
| `computeStudentGameFlags()`（`services/learning/session.ts`） | 學生端 Sidebar（pre-#3633）與 `StudentGameHubPage` | hub 頁面沒有重新推導鎖定邏輯，直接複用既有函式 |
| `components/podium/`（PodiumCeremony／usePodiumCeremony／podiumSound） | 目前只有 live_quiz 教師端使用 | **查證後判斷不適用於 PK**：PK 是雙人輸贏/平手結果（`PkResultScreen.tsx`），不是 N 人排名頒獎台，語意不同，不建議強行共用 |

---

## 4. 共用積木建議（按價值/風險排序）

| # | 項目 | 價值 | 風險 | 本次處理 |
|---|---|---|---|---|
| ① | 抽出 `game_core.scope`（§2.1，pk + escape_room 的 scope 解析三件套） | 高（殺掉 ~115 行逐字重複，4 個錯誤文案字面值統一成常數） | 低（純函式搬移，兩邊既有測試 monkeypatch 到模組屬性即可沿用，另加 15 條直接針對共用模組的特徵化測試） | ✅ 已完成，見 PR（本文件同批次） |
| ② | `StemWithTarget` 共用元件（§2.4） | 中高（殺掉一份視覺邏輯重複，統一 `data-testid` 利於未來測試） | 低（純 prop 擴充 + 呼叫端傳 className 維持像素不變） | 📋 已設計好改法，列為 follow-up（需先完成本 repo 的 UI 改動前截圖驗證流程，見 `rules/frontend-design.md`） |
| ③ | `game_core` 擴充：把 team_arena 的 `resolve_pool_grade` 第三份納入討論 | 中（統一行為前提是先跟 Young 確認「缺越界檢查／改寫錯誤文案」是否為刻意設計） | 中（涉及使用者可見錯誤文案變動，需要產品決策，不是純技術重構） | 📋 follow-up：先問清楚再動 |
| ④ | 統一前端 `useGamePoll` 輪詢 hook（§2.3） | 高（殺掉 ~190 行重複，未來新模式不用再抄一份） | **較高**——三份行為實際上不完全相同（PK 缺退避/慢速階段），版本欄位命名不一致（`version`/`state_version`），且這段程式碼直接決定三個即時多人模式的線上輪詢節奏，改壞了會是「學生卡在等待畫面」這種難復現的線上 bug | ⛔ 本次不做，列為 follow-up，建議拆成兩步：先把 PK 補齊退避/慢速階段（行為變更，需要單獨 PR + QA），再抽共用 hook（純重構） |
| ⑤ | 統一輪詢版本欄位命名（`version` vs `state_version`）（§2.2） | 低（只是命名一致性） | 中（牽動前後端契約與型別，益處不足以抵銷改動面） | ⛔ 不做 |
| ⑥ | 「學生N」匿名顯示名稱策略統一（§2.5） | 低中（PK 目前的「空值回 None」是否要補成「學生N」是產品決策，不是純技術問題） | 中（需要先確認 PK 要不要有這個 fallback） | ⛔ 不做，記錄現況供產品決策 |
| ⑦ | 把 `escape_room` 的「班級開關」提前設計（Phase 2 真人組隊） | 低（Phase 2 尚未核准，PRD 已經設計好 `escape_room_team` 這個 key 的位置） | 低（不涉及任何現有程式碼改動） | ⛔ 不做（尚未核准的功能不提前建） |

---

## 5. 班級整合現況總結

「這班可不可以玩／誰能開／誰能進」這個問題，目前分三種答案方式，**沒有統一
的「模組契約」介面**，但背後的資料結構是統一的：

1. **單一教師開關**（`classrooms.feature_settings` JSON 欄位）——`pk_human`／
   `league`／`live_quiz` 三個 key，透過 `classroom_features.get_classroom_feature()`
   讀、`classroom_features.validate_feature_settings_patch()` 寫，單一 PATCH
   端點（`PATCH /classrooms/{id}/pk-settings`，雖然路徑名字只提到 pk 但管三
   個開關——`classroom_pk_activity.py` 檔頭註解明寫「Route path kept as
   `/pk-settings` even though it now covers three switches...renaming it
   would be a breaking change for any existing caller for zero behavioral
   benefit」，是刻意不改名）。
2. **永不受班級限制**——PK 的 AI 對戰（挑戰文學家）、迷城密室 v1（單人+AI）、
   team_arena v2（拿掉班級開關後）。這三者的共同點：**沒有其他真人玩家**或
   **房間本身就是學生自建**，所以「這班可不可以玩」這個問題本身不成立。
3. **無獨立開關概念**——league 用「這個班的老師有沒有被邀請/接受邀請加入某個
   賽季」（`league_invitations`/`league_teams`）這種關聯式資料本身決定可見範
   圍，不是一個布林開關。

**建議**：② 和 ③ 不需要、也不應該被硬塞進 `classroom_features` 這個「布林開
關」介面——它們的「要不要玩」問題本質上不是布林值，是「有沒有房間/有沒有邀
請」。① 已經是一個乾淨、可擴充的單一模式（JSON 欄位 + 型別化 accessor +
單一 PATCH 端點），**新增第四個班級級別開關（例如未來 escape_room_team）只要
在 `FEATURE_DEFAULTS` 加一個 key，不需要新 migration、不需要新端點**——這正
是題目問的「容易跟班級機制配合」的現有答案，建議任何新模式如果需要班級層
級開關，直接比照這個模式，不要另建第二套機制。

---

## 6. 本次明確不做、以及原因

- **不統一 StoryPack adapter**（§2.6）——現狀是正面範例，硬抽象只會製造
  if-mode-then 分支。
- **不統一輪詢版本欄位命名**——改動面（前後端契約）大於效益。
- ~~不幫 PK 補上「學生N」fallback 或幫 team_arena 的 `resolve_pool_grade`
  補越界檢查~~——**Round 3 更新**：team lead 已決定兩項都做（#3672「是，PK
  補上跟另外兩個模式共用一個 helper／同一個 1-based 索引基準」；#3673「是，
  team_arena 重用 game_core.scope」），兩張票都已完成並合併，見對應 PR。
- **不現在就建立 escape_room 的真人組隊班級開關**——Phase 2 尚未核准
  （PRD 原文：「真人組隊模式（Phase 2）需要的額外表不在本次批准範圍」）。
- **不統一前端輪詢 hook**——詳見 §4 ④，風險判斷為「本次不做」，但已留
  下具體分兩步走的 follow-up 設計。

---

## 7. Follow-up tickets（建議開票順序）

1. ~~`StemWithTarget` 元件統一~~（§2.4、§4②）—— **已完成**，PK 改用共用元件，
   見 round 2 PR。
2. ~~跟 Young 確認 team_arena 的 `resolve_pool_grade` 行為差異是否刻意~~
   （§2.1、§4③）—— **已完成**，team lead 核准後直接重用 `game_core.scope`，
   見 round 3 PR（issue #3673）。
3. PK 輪詢行為補齊（退避＋慢速階段）＋之後才抽 `useGamePoll` 共用 hook
   （§2.3、§4④，刻意拆成兩張票，不要一次做完）——仍未做，見 issue #3671。
4. ~~產品面決定 PK 要不要有「學生N」匿名 fallback~~（§2.5、§4⑥）—— **已完成**，
   team lead 核准後 PK／live_quiz／team_arena 三模式共用一個 helper、同一個
   1-based 索引基準，見 round 3 PR（issue #3672）。
5. 版本欄位命名不一致（`version` vs `state_version`，§2.2）—— 仍未做，綁在
   issue #3671 一起處理（跟 useGamePoll 統一一起做才划算，見該 issue 說明）。
