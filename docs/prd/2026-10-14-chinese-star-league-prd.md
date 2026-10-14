# PRD｜跨班／跨校／全國賽與個人排行榜（工程代號 `league`）

> 狀態：規劃中，待 CTO／UIUX review｜2026-10-14 建立，2026-10-15 依 Young 指示大改版
> ⛔ 本版重點：**競賽計分不靠即時搶答，改比照均一「星空探險隊」量日常學習量**；三模組零依賴；兩個已驗證的誠信風險列為上線前必解決事項

## 0. 這版改了什麼（給 reviewer 的導讀）

1. **不用品牌名**：拿掉「國文競技場」等自創名稱。全文一律用白話：**跨班邀請賽／跨校邀請賽／全國賽／個人排行榜**。唯一的品牌名是 Young 定案的 **「讀家記憶」**（學生自己的學習歷程頁面）
2. **計分來源整個換掉**：原本設計是接「課堂挑戰」（Kahoot 式即時搶答，issue #3551，現正名 **班級經營**，工程代號 `live_quiz`）的答題結果。Young 2026-10-15 明確推翻：**競賽是長期賽季，量的是「日常學習完成度」，不是臨場搶答**，直接比照均一「星空探險隊」。`league` 現在**完全不依賴** `live_quiz`，只讀既有、已上線的學習紀錄
3. **三模組架構**：`live_quiz`（班級經營，課堂內用，跟排名無關）／`league`（本案，賽季＋計分＋排行榜）／`讀家記憶`（學生自己的歷程頁，只讀 `league`）。三者互不依賴對方的程式碼
4. **兩個已驗證（非猜測）的誠信風險**：公開 API 洩漏題目正解、完課端點不驗證正確性——這兩點在「量日常學習完成度」的新設計下**仍然成立、甚至更直接**，列為上線前必解決的風險（§8）

## 1. 要解決什麼

老師看到均一教育平台「星空探險隊」（年度全國性團隊學習競賽）帶動的學習動機，希望中文閱讀這邊也有類似機制：
學生可以跨校、跨班比賽，也可以有個人排行榜，但**不能洩漏未成年學生的個資**。

**成功指標**
- 老師 3 步內可以對另一班發出跨班邀請（選對象班級 → 設定賽季時間窗 → 送出）
- 個人排行榜：學生在「只看得到暱稱＋自己的真實名次」的榜單上看到自己進步
- 隱私：跨班／跨校／全國範圍的任何 API 回應，**0 筆**出現其他班級學生的真實姓名、email、學校全名、使用者 id
- MVP 範圍：賽季＋班級報名（名單鎖定）＋依現有學習活動加權計分＋依年級分組的班級平均榜＋個人排行榜＋讀家記憶；跨班邀請賽＝鎖定兩班的迷你賽季

## 2. 調研摘要：均一「星空探險隊」

> 以下皆為均一教育平台公開網頁／公開文章內容，僅作公開案例研究引用，不涉及均一內部資料。均一是非營利教育機構，此處純為賽制設計參考，不代表任何商業關係。存取日期 2026-10-14／15。

### 2.1 賽制骨架（跨多篇來源交叉核對）

| 項目 | 均一做法 | 來源 |
|---|---|---|
| 參賽單位 | 團隊賽，**以「班級」為單位報名**，每隊至少 3 人；不限同校同班，可自組「線上班級」跨校組隊；**一位學生最多報名 3 個團隊** | [2025 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/) |
| 年級範圍 | 涵蓋 **1–9 年級** | [2025 活動介紹](https://www.junyiacademy.org/event/2025-star-exploration-intro/) |
| 賽季結構 | 兩階段時間窗：**報名期**（如 10/12–11/9）→ **算分期**（如 11/9–11/27，約 3 週，刻意排在段考後、學習扶助成長測驗前，讓學生能專心參賽、複習觀念）| [2025 活動說明](https://www.junyiacademy.org/event/2025-star-exploration-rule/)｜[2025 活動介紹](https://www.junyiacademy.org/event/2025-star-exploration-intro/)｜本機 clone `junyiacademy/backend/junyi/marketing_event/campaign_model.py`（`register_start/end`、`game_start/end` 兩段式欄位）|
| 積分來源 | 技能升等（二級 1 分／三級 2 分／精熟 4 分）＋ 影片**首次完整觀看**（1 分）＋ 老師指派技能且達精熟（**+2 分**）；**學習扶助任務包要整包做完才算分，做一半＝0 分** | [2025 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/)｜[vocus.cc 分析文](https://vocus.cc/article/637c920afd897800012bafdf) |
| 防灌水規則 | 只採計「報名年級－2」以上程度的技能；**只算賽程期間新增的分數**（降級不扣分、已得分保留，但重新升級不會再給分）| [2025 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/)｜[十年回顧](https://official.junyiacademy.org/star-exploration-10-years/) |
| 班級排名 | **班級「平均」積分**（不是總分）——這樣大班小班才公平；**依年級分組**，分全國榜與縣市榜 | [vocus.cc 分析文](https://vocus.cc/article/637c920afd897800012bafdf)：「競賽以班級平均點數與全國小隊比較，而非總分」 |
| 個人 vs 團體 | 主賽制是班級（團體）平均榜；另設個人門檛（如 120 點）發個人徽章，避免大班裡個別學生的努力被稀釋到看不見 | [2025 獎勵辦法](https://www.junyiacademy.org/event/2025-star-exploration-prize/) |
| 班級徽章 | 班級**平均**達 120 點發班級徽章；全國前 10 名班級（依年級分組）發電子獎狀 | 同上 |
| 寶箱機制 | 班級**過半（≥50%）學生參與**後，解鎖隨機加分寶箱——這是**鼓勵參與度**的機制，不是防作弊 | [vocus.cc 分析文](https://vocus.cc/article/637c920afd897800012bafdf) |
| 「夜幕低垂」 | 每日 22:00–隔日 6:00 排行榜畫面凍結不更新（不是防作弊，是**防熬夜**的心理設計）| [2025 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/) |
| 核心理念 | 「**只要投入就一定會被看見的舞台**」——獎勵效力（投入度），不是獎勵天賦（能力）| [十年回顧](https://official.junyiacademy.org/star-exploration-10-years/) |
| 技術骨架 | `MesCampaign`（賽季期間設定）／`MesPlayer`（個人參賽實體，`score` 累積、`exercise_highest_levels` 防重複計分）／`MesGroupPlayer`（團隊分數彙總）| 本機 clone `junyiacademy/backend/junyi/marketing_event/{campaign_model,player_model}.py` |
| 規模 | 十年累積近 20 萬人次參與；第三季單季 500+ 校、17,339 人（較前季 +5,000 人）；活動期間學習時間由平均 205 分鐘增至 417 分鐘、活躍天數 6→10 天 | [十年回顧](https://official.junyiacademy.org/star-exploration-10-years/)｜[第三季回顧](https://official.junyiacademy.org/blog/starexplore-season3-review/) |

### 2.2 未查證（誠實標註，不假裝查到）

- 排行榜畫面實際逐欄顯示什麼（是否顯示學生真實姓名、是否只到班級層級）——WebFetch 對該頁僅能看到連結與靜態殼，實際渲染內容未查證。**因此本案設計一律採最保守假設**：不管均一實際怎麼顯示，我們跨班／跨校／全國範圍一律不露真實姓名
- 縣市看板的實際地理資料從何而來（我們平台 `School` 沒有結構化縣市欄位，見 §9）

## 3. 三模組架構（零依賴，Young 2026-10-15 定案）

```
live_quiz（原「課堂挑戰」／contest，issue #3551，分支 feat/issue-3551-contest-mode）
  → 正名「班級經營」。老師投影、全班即時搶答、單堂課複習用。
  → 不是競賽積分來源，league 完全不讀它的任何表或服務。

league（本案。工程代號 league，使用者看到的字一律是「跨班邀請賽／跨校邀請賽／全國賽／個人排行榜」）
  → 只「讀」既有、已合併進 staging 的表：
       StudentXPLog（app/models/gamification.py，既有的 XP 帳本，
                     session_complete 事件已對 session_id 冪等）
       LearningSession（app/models/session.py，session_mode:
                     self_study | assignment，text_id）
       Text（app/models/text.py，grade: 4–9，DB 直接存）
       Classroom / ClassroomStudent / School / Organization / StudentProfile（既有租戶模型）
  → 自己的表：LeagueNickname / LeagueInvitation / LeagueSeason /
             LeagueTeam / LeagueTeamRosterMember（見 §7）
  → 不改、不寫入 learning / assignment / gamification 的任何程式碼或資料表（單向依賴）

讀家記憶（學生自己的學習歷程頁，Young 定案的唯一品牌名）
  → 只讀 league（本案 MVP 範圍）：自己參加過哪些賽季／班級、拿了多少分、
    有沒有徽章。更廣義的「完整學習歷程時間軸」留 Phase 2。
```

**為什麼不接 `live_quiz`**：① `live_quiz` 的自主挑戰（第二期，非同步版）還沒做完，接它會讓 league 卡在別人的進度上；② Young 的產品定位是「長期投入」而非「臨場反應快」——這正是均一星空探險隊的設計精神（量每天的學習，不是量一場搶答的手速）；③ 少一條依賴，league 現在可以直接對著**已經在 staging 上、已經穩定**的資料開工，不必等別人的分支合併。

## 4. 賽制設計

| 概念 | 說明 |
|---|---|
| **賽季（Season）** | 一段計分時間窗（`game_start` ~ `game_end`）。兩種：`invitational`（跨班邀請賽，由一次邀請接受後自動建立，鎖定剛好 2 班）／`official`（全平台開放報名的正式賽季，Phase 2+，本 PRD 定義 schema 但 MVP 不開放建立）|
| **班級報名（Team）** | 一個班級加入一個賽季。報名當下把班上**現有名單**拍照存證（見下一列），之後班上轉學生、新生都不影響這個賽季的計分範圍 |
| **名單鎖定（Roster Lock）** | Young 2026-10-15 明確要求：**參賽者的隊伍歸屬在報名當下鎖定**。技術上是報名時把 `ClassroomStudent` 的名單複製一份存進 `LeagueTeamRosterMember`，之後只讀這份快照，不再即時查班級現況 |
| **個人排行榜** | 常態開啟（非賽季限定），每週一 00:00 重置，範圍＝「同校同年級」。顯示暱稱＋分數；**自己的名次永遠顯示精確數字**，其他人在人數不足時顯示名次區間（見 §6）|
| **跨班邀請賽** | 班級擁有者對另一班發邀請（提議賽季時間窗＋計分規則版本）→ 對方班級擁有者接受 → 系統自動建立一個只有這兩班的賽季＋各自報名＋鎖定名單 |
| **跨校邀請賽 / 全國賽** | Phase 2／3，schema 已預留（`LeagueSeason.kind`／跨機構目錄），MVP 不開放 |
| **班級排名** | **班級平均分**＝（名單鎖定當下所有學生的分數加總，含 0 分）÷ 名單人數。不用「只算有參與的人」當分母——人數本身已經在報名時鎖定，不會被「只挑會寫的人參賽」操弄 |
| **個人／班級徽章** | 個人累積 ≥ 門檻（預設 120 分）發個人徽章；班級平均 ≥ 門檛（預設 120 分）發班級徽章。只是回應裡的計算欄位，不寫進既有 `gamification.BADGE_CATALOGUE`（不碰既有系統）|
| **寶箱（參與度獎勵）** | 班級名單 ≥ 50% 的人分數 > 0 時，回應裡標記 `treasure_chest_eligible: true`。**MVP 只做這個布林值**，真的隨機加分機制留 Phase 2（均一的寶箱本質是「鼓勵參與度」不是防作弊，優先度較低）|

## 5. 計分：版本化的加權規則（對齊均一，逐項列出我們怎麼落地）

Young 指示：**從既有的學習紀錄讀，不碰 learning／assignment 程式碼**。計分完全讀既有、已上線的表（§3），不新增任何寫入學習流程的鉤子。

| 均一機制 | 我們的對應（讀哪個既有欄位）|
|---|---|
| 技能達精熟 → 得分 | 一堂課的 `StudentXPLog(event_type="session_complete")`（既有、對 `session_id` 冪等，`gamification_service.process_session_completion`）|
| 老師指派 + 精熟 → +2 分 | 該筆完課對應的 `LearningSession.session_mode == "assignment"` → 加成 |
| 只算**第一次**（影片／技能）| 每個學生對每一課只取**最早**一筆 `session_complete`，之後重複完成同一課不會再得分（即使重做是在賽季期間內——判斷基準是「這課第一次完成的時間」，不是「這次重做的時間」）|
| 「年級減 2」防灌水 | `Text.grade >= 學生自己的年級 - 2`，低於門檛的課不計分 |
| 學習扶助任務包要全部做完才算分 | **MVP 不做**——我們沒有「一包多課綁一起才算數」的既有資料結構，要做這個需要新建對 assignment 的綁定邏輯，與「不碰 learning/assignment 程式碼」的限制衝突。列為 Phase 2，需要 Young 決定是否值得為此開一個新的唯讀介面 |
| 班級平均 | `sum(名單鎖定成員的分數，含 0) / 名單人數` |

**版本化加權表（`LeagueWeights`，凍結進每個賽季，之後調整不影響已開賽的賽季）**：

| 參數 | MVP 預設值（v1，待 Young 核定）| 說明 |
|---|---|---|
| `lesson_complete` | 10 分 | 一堂課第一次完成的基礎分（我們的最小單位是「一堂課」，均一的是「一個技能」——沒有對應單位，自訂基礎分）|
| `assignment_bonus` | +2 分 | 直接沿用均一的「老師指派 +2」，因為是**固定加成**，跟基礎分單位無關 |
| `grade_floor_offset` | 2 | 直接沿用均一的「年級減 2」|
| `badge_threshold` | 120 分 | 均一的 120 分約等於「12 個技能」；我們把 `lesson_complete` 訂為 10 分，讓「120 分≈12 堂課」的故事在我們這邊同樣成立，刻意保留同一個數字方便對照，不是獨立推導出來的 |
| `treasure_chest_participation_ratio` | 0.5 | 直接沿用均一的「過半參與」|

這五個數字**只是 MVP 預設值**，Young 可調整；一旦有賽季用某個版本開賽，那個賽季就凍結在那個版本的快照上，不會被之後的預設值調整追溯影響。

## 6. 個資保護（具體規則）

| 情境 | 顯示什麼 | 不顯示什麼 |
|---|---|---|
| 老師看自己班的排行榜（既有 `/api/gamification/leaderboard/{classroom_id}`）| 真實姓名（現狀維持）| — |
| **個人排行榜**（跨班可見）| 系統產生的**暱稱**（固定詞庫組合）＋圖示；**自己的那一行永遠顯示真實精確名次與分數**（Young 2026-10-15 明確定案：這不是隱私風險，你本來就知道自己是誰）| 真實姓名、email、學校全名、班級名稱、`user_id` |
| 個人排行榜裡**別人**的名次 | 同校同年級人數 < 5 人時，別人的名次顯示**名次區間**（如「前 20%」）而非精確數字；≥ 5 人時顯示精確名次（但仍是暱稱，不是真名）| 同上 |
| **跨班邀請賽榜單** | **班級層級的彙總**（平均分、參與人數、徽章旗標）——兩班互相邀請時本來就知道對方是哪一班，所以班級名稱本身不算洩漏；**個別學生**的分數/名次一律不在這個 API 裡出現 | 對方班級任何個別學生的姓名／分數／座號 |
| 家長（`ParentStudentLink`）查看 | 自己小孩的真實分數與排名 | 其他學生的任何可識別資訊 |

**團體彙總預設制**（Young 2026-10-15）：跨班／跨校／全國的顯示**預設都是班級層級彙總**，不是「點進去看每個學生」——這點從一開始就是這樣設計，不是事後補的例外。

**待 Young 上線前決定（不可延後）**：
1. **opt-in／opt-out**：學生／家長能不能選擇不參加個人排行榜？要在**上線前**決定機制（MVP 先假設「預設參加、班級內老師可個別排除」，需要 Young 確認）
2. **資料保留與刪除**：賽季結束後，`LeagueTeamRosterMember`／排行榜聚合資料要保留多久？要不要支援學生／家長申請刪除？MVP 暫不做刪除流程，但這題不能一直懸著

## 7. 架構：資料表草案

```
league_nicknames           student_id(FK→users, unique) / nickname / icon_key / reroll_count
league_invitations         inviter_classroom_id / invitee_classroom_id / created_by / status
                            (pending|accepted|declined|expired|revoked) / game_start / game_end /
                            weights_version / responded_by / responded_at
league_seasons              kind(invitational|official) / name / invitation_id(nullable FK, unique) /
                            register_start / register_end(nullable, official 用) / game_start / game_end /
                            weights_snapshot(JSON，凍結的 LeagueWeights) / created_by
league_teams                season_id / classroom_id / registered_by / registered_at
                            （UNIQUE season_id+classroom_id）
league_team_roster_members  team_id / student_id / locked_at
                            （UNIQUE team_id+student_id —— 這張表就是「名單鎖定」本身）
```

**API 草案**

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/league/leaderboard/personal` | 個人排行榜（同校同年級，暱稱＋自己精確名次）|
| GET / POST | `/api/league/nickname/me`、`/api/league/nickname/me/reroll` | 取得／重roll 暱稱 |
| POST | `/api/league/invitations` | 班級擁有者發出跨班邀請（僅同機構，見下）|
| GET | `/api/league/invitations?classroom_id=` | 查詢本班收到／送出的邀請 |
| POST | `/api/league/invitations/{id}/respond` | 接受／婉拒 |
| POST | `/api/league/invitations/{id}/revoke` | 邀請人撤回（僅 pending 狀態）|
| GET | `/api/league/seasons/{id}/board` | 這個賽季的班級平均榜（依年級分組排序）|
| GET | `/api/league/my-history` | 讀家記憶：自己參加過的賽季／分數／徽章 |

**邀請授權矩陣（Young 2026-10-15 明確要求）**

| 動作 | 誰可以做 | 不行 |
|---|---|---|
| 發出邀請 | **班級擁有者**（`Classroom.teacher_id`）| 共同教師（co-teacher）、其他班老師 |
| 接受／婉拒邀請 | **被邀班的擁有者** | 共同教師、邀請方自己 |
| 跨機構（跨校）邀請 | **預設拒絕**——兩班所屬學校必須屬於**同一個** `Organization`，否則 403 | 不同機構／任一方無機構歸屬 |
| 已撤回／已過期的邀請再回應 | 一律拒絕（409）| — |
| 重複接受（已接受的邀請再送一次 accept）| **冪等**，回傳既有結果，不重建賽季 | — |

## 8. 風險：兩個已驗證的競賽誠信缺口（上線前必解決）

> 這兩點不是臆測，是這次規劃讀 code 時親自驗證到的，附檔案路徑／行為證據。**在修好之前，league 算出來的分數不能被當成「公平競賽結果」對外宣傳**，個人排行榜／班級排行榜在內部仍可先上（讓老師看到自己班的學習量趨勢是有價值的），但「公平競賽」的對外敘事要等這兩點解決。

| # | 風險 | 證據 |
|---|---|---|
| 1 | **題目正解透過公開 API 外洩** | `GET /api/stories/{story_id}`（`backend/app/routes/stories.py:566`）**沒有登入驗證**，而回應的 `multiple_choice` 欄位（`backend/app/services/lesson_indexes.py:797` `_mcq_from()`）把每一題的 `"answer"`（正解字母）原樣放進去。任何人都能 `curl` 這支 API 先拿到正解，再回去完成那堂課。repo 本身的 commit history 也印證這是重複出現的問題類型（`stories.py:656-665` 註解：「2026-08-19 全庫：51 課有干擾項、148 課有未挖空答案，全在公開回應裡……這是同一天第七條答案外洩路徑」），已有專用回歸鎖 `test_structure_answer_key_not_served_2736.py` 鎖住「文章重點表」那一條路徑，但**本案要讀的「閱讀理解」(`comprehension`→`multiple_choice`) 這條路徑沒有被那條鎖涵蓋** |
| 2 | **完課端點不驗證正確性，只信任前端回報** | `POST /api/gamification/session-complete`（`backend/app/routes/gamification.py:218-244`）的 `reading_accuracy`／`comprehension_passed`／`comprehension_score` 全部是**請求體裡前端直接送來的值**，伺服器沒有拿學生實際作答紀錄重新核算——只要是自己的 `session_id`，想回報什麼準確度都會被接受 |

**為什麼這在新設計下仍然、甚至更直接相關**：舊設計（接 `live_quiz`）的風險是「搶答題目被看到正解」；新設計計的是「這堂課有沒有完成」，而上面兩點合起來代表：**一個學生可以不讀內容、直接查到正解、再自己回報『我答對了』，伺服器照單全收，league 照樣給分**。這比搶答被看到正解更嚴重，因為它是「完成度」這個指標本身的根基。

**建議（待 CTO 定案，不是本案自行決定）**：
- 短期：league 上線時機不绑定這兩個缺口的修復（學習量趨勢對老師仍有價值），但在使用者可見的文案裡**明確標示「目前為測試階段，正解防護與完課驗證尚在強化中」**，不可用「公平競賽」字眼對外宣傳
- 中期：① 把「閱讀理解」併入既有的 `test_structure_answer_key_not_served_2736.py` 同類回歸鎖，或另開一條專屬鎖 ② `session-complete` 改成伺服器端重新核算 `reading_accuracy`／`comprehension_passed`，不再信任前端回報值——這兩項都是**既有模組（stories / gamification）的修復**，不是 `league` 自己能單向解決的，需要另外開票並遵守「安全改動要過 code review」的既有規則

## 9. 待決定事項（需要 Young 核定）

1. **opt-in／opt-out 機制**：個人排行榜要預設全部學生參加、老師可排除，還是預設不參加、要家長同意才加入？
2. **資料保留與刪除**：賽季資料保留多久？要不要支援申請刪除？
3. **`lesson_complete` / `assignment_bonus` / `badge_threshold` 的實際數字**：§5 的 v1 預設值是否核定，還是要重新校準（例如先跑一季看分佈再調）
4. **學習扶助任務包全對半不算分**：§5 已說明 MVP 不做，是否要排進 Phase 2、需不需要新開一個唯讀介面
5. **縣市看板**：均一有縣市加碼獎勵／縣市榜，我們的 `School` 沒有結構化縣市欄位，技術上做不到——是否要新增這個欄位（屬於既有表加欄位，需要走 migration 核准流程）
6. **§8 兩個誠信缺口的修復時程與優先序**：是否擋 league 上線，還是先上線＋加警語，兩個缺口另案處理
7. **「夜幕低垂」畫面凍結**：MVP 不做，是否要排進後續
8. **跨機構（跨校）/ 全國賽開放時程**：§4 schema 已預留，實際開放時間由 Young／營運面決定

## 10. 分期

| 期別 | 範圍 |
|---|---|
| **MVP**（待此 PRD 定案後實作）| 個人排行榜（暱稱＋自己精確名次＋他人名次區間）＋跨班邀請賽（鎖定名單的迷你賽季＋班級平均榜）＋讀家記憶（讀自己的 league 歷程）|
| Phase 2 | 跨校邀請賽（機構目錄 opt-in）＋學習扶助任務包全對半規則＋寶箱隨機獎勵機制 |
| Phase 3 | 官方全國賽（`system_admin` 開放報名）＋縣市榜（需先加 `School` 結構化縣市欄位）|
| Phase 4 | 「夜幕低垂」畫面凍結＋讀家記憶擴充成完整學習歷程時間軸（含 `live_quiz` 參與紀錄）|

---

## 附：引用來源（存取日期 2026-10-14／15）

- [2025 星空探險隊 活動說明](https://www.junyiacademy.org/event/2025-star-exploration-rule/)
- [2025 星空探險隊 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/)
- [2025 星空探險隊 獎勵辦法](https://www.junyiacademy.org/event/2025-star-exploration-prize/)
- [2025 星空探險隊｜銀河奇幻嘉年華（活動介紹）](https://www.junyiacademy.org/event/2025-star-exploration-intro/)
- [星空探險隊第三季回顧（official.junyiacademy.org blog）](https://official.junyiacademy.org/blog/starexplore-season3-review/)
- [星空探險隊十年回顧（official.junyiacademy.org）](https://official.junyiacademy.org/star-exploration-10-years/)
- [vocus.cc：星空探險隊賽制與教育理念分析](https://vocus.cc/article/637c920afd897800012bafdf)
- 本機唯讀 clone `~/project/junyiacademy`（`backend/junyi/marketing_event/{campaign_model,player_model}.py`）——僅讀取其公開原始碼架構作為賽制技術參考
- 本 repo 原始碼（§3/§5/§8 的技術對照與風險，皆為本次規劃實際讀取/測試驗證，非轉述）：`backend/app/models/{gamification,session,text}.py`、`backend/app/services/gamification_service.py`、`backend/app/routes/{stories,gamification}.py`、`backend/app/services/lesson_indexes.py`
