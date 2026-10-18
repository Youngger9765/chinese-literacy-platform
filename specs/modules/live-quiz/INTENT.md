---
spec_id: live-quiz.engine.round-types-and-authz
module: live-quiz
title: 班級經營／課堂搶答 — 回合類型可插拔引擎、答案洩漏防護、計分可重算
stability: active
canonical_source: backend/app/services/live_quiz/engine.py
owns_code:
  - backend/app/models/live_quiz.py
  - backend/app/services/live_quiz/**
  - backend/app/routes/live_quiz.py
  - backend/app/schemas/live_quiz.py
  - backend/alembic/versions/c371b776d12f_create_live_quiz_tables.py
spec_tests:
  - backend/tests/test_live_quiz_engine.py
  - backend/tests/test_live_quiz_round_choice.py
  - backend/tests/test_live_quiz_sources.py
  - backend/tests/test_live_quiz_scoring.py
  - backend/tests/test_live_quiz_recompute.py
  - backend/tests/test_live_quiz_rate_limit.py
  - backend/tests/test_live_quiz_reading_pace_3631.py
related_issues: [3551, 3630, 3631]
last_reviewed: 2026-10-19
owner: young
---

# 班級經營／課堂搶答（Live Quiz）

> 這份是給**人**讀的 spec。機器可驗的契約在上面列的測試檔。
> 改動 `app/services/live_quiz/**` 前先讀這份。

## 1. 這個 module 在管什麼

老師投影主持、全班用手機即時搶答的課堂活動。介面名稱「**班級經營**」
（側欄叫「課堂搶答」），程式代號 `live_quiz`，API `/api/live-quiz/*`，
學生加入網址 `/live/:code`。

⚠️ **「競賽」是另一個不同的模組**（跨班/跨校/全國的長期排行榜，依學習完成度
加權計分，不採用這裡的分數）。本文件前面若有舊版留下的「contest」字樣，
一律以本節命名為準（2026-10-15 Young 定案）。

## 2. 獨立性四條規則（PRD 原文）

1. **依賴只往一個方向**：這個 module 讀課文資料（`lesson_uid_loader`）、
   帳號、班級；其他 module 完全不知道它存在。刪掉整個 `live_quiz/` 套件，
   其他程式照常運作。
2. **每個題目來源一支 adapter**：`services/live_quiz/sources/` 底下
   comprehension / vocab_definitions / vocab_application / zhuyin 四支，
   各自讀一份已載入的課文 dict、吐出 `QuizItem`。加新題型 = 新增一支
   adapter + 在 `sources/__init__.py` 登記一行，**不改引擎**。
3. **開場就把題目快照存起來**：`LiveQuizGame.rounds_snapshot` 是建立當下
   凍結的 JSON，之後課文改版不影響進行中的場次。
4. **自己的資料表、自己的 API 路徑**：`live_quiz_games` /
   `live_quiz_players` / `live_quiz_answers`，`/api/live-quiz/*`；不寫入
   `learning_sessions` / `mcq_attempt` / XP 任何既有學習紀錄表。

## 3. 回合類型可插拔（word-search 的插座，2026-10-15 Young 定案）

PRD §10：「競賽＝主題：課文 × 回合類型 × 屬性」。第一期只有一種回合類型
`choice`（`round_types/choice.py`），但引擎只管流程：

```
回合開始(start/next_round) → 收作答(submit_answer) → 伺服器計分(recompute)
  → 揭曉(reveal_round) → 排行(cached_leaderboard) → 下一回合或結束
```

每個回合類型自己提供四件事（見 `round_types/base.py` 的 contract docstring）：

| 介面 | 做什麼 |
|---|---|
| `generate_rounds(lessons, settings, rng)` | 建立這場遊戲凍結的 round 清單，回傳 `(rounds, question_count_fallback)` |
| `score_submission(payload, submission, elapsed_ms)` | 純函數：算這一題的 `(is_correct, base_points)` |
| `player_view(payload, revealed, show_options)` | 學生安全視圖（揭曉前無答案；閱讀階段無選項） |

**下一個回合類型（字盤找詞，下一個 PR）要怎麼插**：
1. 新增 `round_types/word_search.py`，實作上述三個函式
2. `round_types/__init__.py` 的 `ROUND_TYPES` dict 加一行
3. 完全不改 `engine.py`、不改三張資料表結構 —— `LiveQuizAnswer.submission`
   本來就是通用 JSON（字盤找詞可以存 `{"found_words": [...]}`），
   `scoring.py` 的 `double_points_last` / `streak_bonus` 是引擎層的
   cross-cutting modifier，套用在任何回合類型的 `base_points` 上，
   回合類型完全不需要知道這兩個設定存在

## 4. 答案不洩漏（三層防護，各自獨立測試鎖住）

1. **揭曉前永遠不回傳 `correct_key`**（`player_view(revealed=False)` 完全
   省略這個 key，不是給 null）— 包含 HOST 自己的視圖（統一規則，host 也要
   等 reveal 才看到答案）
2. **閱讀階段（§12 #2）連 `options` 都不給**——伺服器端強制「先只顯示題幹
   N 秒」，不只是前端倒數假裝不顯示
3. **per-game 選項位置洗牌**（`round_types/choice._shuffle_display_positions`）
   ——comprehension 題庫的正解**字母**本來就被 `/api/stories/{id}` 公開端點
   洩漏，洗牌讓 `correct_key` 絕不等於來源教材的答案字母，兩者對不起來，
   **只防住「拿洩漏的字母去對這場的 key」這一種攻擊**
   ⚠️ **防不住的**（2026-10-15 複審指出，未過度宣稱）：那個公開端點**連選項
   文字也一起洩漏**，不只是字母——學生可以直接拿公開端點給的「正解那句話」
   去對照這場畫面上同一句話出現在哪個位置，不需要知道字母對應關係，洗牌
   對這條路完全沒有防護。真正的修法是 **#3555**（公開端點本身不該把答案
   送出去），是另一支正在處理的 PR，**本 module 不修、也不能把這段洗牌
   當成 #3555 的替代品**

## 5. 排名政策（2026-10-15 PRD §13 定案，**2026-10-18 Young 針對學生端覆寫，#3631**）

> 「補救教學學生不需要排名」是平台既有立場（`docs/gamification-plan.md`）——
> 這條立場仍然成立，但 2026-10-18 Young 針對「每題揭曉的即時回饋」決定
> 不完全套用：學生需要看到自己的分數與相對位置才有競賽感，純粹隱藏
> 反而違背 Kahoot 式課堂搶答的體驗預期。**下面這段是現況，不是舊政策**；
> 舊政策「學生手機永遠看不到名次或總分」整段已被取代，保留在 git history。

- **每題揭曉（`reveal`／`ended`，非 practice_mode）時，`your_player` 給
  這位玩家本題得分（`last_answer_points`）＋累計總分（`total_score`）**
  —— `engine._player_rank_info()`（`engine.py`）算出這位玩家自己的名次：
  - 若排進全場前 5 名：給 `rank`（1-based 整數，就是這位玩家自己的名次）
  - 若排在第 6 名以後：給 `rank_delta`（相對「這一回合開始前」名次的
    正負位移；正＝前進、負＝後退、0＝不變），**絕不**給 `rank` 數字——
    前端渲染成「這題前進/後退了 N 名」，不可以顯示「第 N 名」
  - `rank_delta` 的「之前」是**用這回合的得分反推**（`total_score` 減掉
    這回合自己拿到的分數），不是存一份名次歷史——沒有新資料表、沒有
    migration
  - practice_mode 仍然整組隱藏（`total_score`／`rank`／`rank_delta`／
    `last_answer_points` 一律不給），跟原本 `last_answer_points` 的
    practice_mode 閘門是同一條
- **完整排名（`leaderboard`，含每個人的分數與名次的整份陣列）仍然只給
  host**——這一條沒有變，`_player_rank_info()` 回傳的是「這一個玩家自己
  的一個數字」，不是整份名單，拿不到別人的分數或名字：
  - **頒獎台（結束畫面）只公開前三名、顯示分數 —— 已實作（#3630）**，
    見 `frontend/src/components/podium/PodiumCeremony.tsx`
  - **揭曉畫面公開前五名、顯示分數 —— 已實作（#3631）**，
    `TeacherLiveQuizReveal.tsx` 從前三名無分數改成前五名＋分數；
    **最後一題的揭曉不顯示這個排行榜**，直接讓老師按鈕進頒獎台
    （保留驚喜，同 Kahoot）
- 第一期不做雙倍分 / 連對加分的**使用者介面**（§13 決定，未變）；後端的
  `double_points_last` / `streak_bonus` 設定保留、預設 `False`、測試齊全，
  但沒有前端開關——如果以後 Young 決定要做，只要加一個設定開關，不用動
  引擎或資料表

## 6. 讀家記憶（read-only results 介面，Young 2026-10-15）

`engine.get_game_results(db, game)` 是唯一一個「讀取一場遊戲完整結果」的
入口：每位玩家的最終分數、每回合逐題正確率、場次設定與時間戳。

這是為了未來「競賽」長期排行榜模組準備的讀取介面——**但競賽不會真的呼叫
它**：競賽依學習完成度計分，不採用課堂搶答的分數。保留這個函式單純是
「如果以後真的需要讀課堂搶答的歷史紀錄（例如老師端的『歷次課堂搶答』），
走這一個函式，不要自己重新組 `LiveQuizAnswer` 查詢」。

⛔ **沒有「從這場遊戲的設定建立新遊戲」的函式**——2026-10-15 Young 明確
drop 掉這個 seam（原本為了「兩班玩同一組題目」設計），因為競賽模組不會
重播課堂搶答的設定。

## 7. 遲到加入（late join，§12 #3）

`LiveQuizPlayer.joined_at_round_index` 記下加入當下的 `current_round_index`
（-1 = 大廳加入，所有回合都能玩）。玩家只能回答
`round_index > joined_at_round_index` 的回合；之前的回合永遠不會有這個
玩家的 `LiveQuizAnswer` 列——「未參加」是**沒有這一列**，不是存一個額外的
狀態欄位，`get_game_results` 的逐題正確率天生就用「有回答的人數」當分母，
不需要額外過濾。

## 8. 允許 / 禁止的改動

- ✅ 新增回合類型、新增題目來源 adapter
- ✅ 調整 `scoring.py` 的加分公式（但要過 mutation 測試）
- ⛔ 讓任何 round type 直接寫 `LiveQuizGame` / `LiveQuizPlayer` 欄位
  （一律透過 `engine.py` 的函式，round type 只收/吐資料）
- ⛔ 讓 `build_state()` 把完整的 `leaderboard` 陣列（含別人的名字/分數）
  回傳給非 host 的呼叫者——自己的 `your_player.rank`（§5，#3631 新增）
  是唯一例外，那是「這位玩家自己的一個數字」，不是整份名單
- ⛔ 讓第 6 名以後的玩家拿到 `rank` 數字（只能給 `rank_delta`）——前端
  不可以把 `rank_delta` 換算回「第 N 名」字樣顯示給使用者
- ⛔ 揭曉前任何角色的 `/state` 回應出現 `correct_key`

## 9. 讀題時間與看解析（#3631 新增，2026-10-18 Young 定案）

**讀題時間**：`round_types/choice.generate_rounds` 的 `settings` 多兩個
互斥的鍵（只會出現一個）：

- `reading_seconds`（int，手動覆寫，舊行為）——**每一回合**都用這個固定
  秒數，不管題幹長短；`app/services/pk/rounds.py` 用這個把 PK 的讀題
  時間固定成 `0`（PK 不要讀題停留），這個escape hatch 完全沒動
- `reading_pace`（`"slow"|"standard"|"fast"`，預設 `"standard"`，老師
  在設定頁選）——**每一回合各自**用 `reading_pace.compute_reading_seconds
  (stem, pace)` 算秒數（字數 × 速度係數，夾在 2–20 秒之間），同一場遊戲
  裡長題幹跟短題幹的讀題時間不一樣

新增模組 `backend/app/services/live_quiz/reading_pace.py`，純函數、無狀態、
係數與上下限理由（含實測全題庫字數分布）寫在該檔 docstring；
`test_live_quiz_reading_pace_3631.py` 對全部 179 課、四種題型、三種速度
掃過一輪，鎖住「結果一定落在上下限內」。

**看解析**：`QuizItem`（`sources/base.py`）新增 `explanation: str | None`
欄位，只有 `comprehension` adapter 會填（讀 yml 本來就有的 `explanation`
欄位，179 課裡 50 課有）；`player_view()` 的揭曉閘門跟 `correct_key` 共用
同一個 `revealed` 判斷——沒有解析文字時完全不出現這個 key（不是空字串），
前端用「有沒有這個 key」決定要不要畫「看解析」按鈕。
