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
| 賽季結構 | 兩階段時間窗：**報名期**（如 10/12–11/9）→ **算分期**（如 11/9–11/27，約 3 週，刻意排在段考後、學習扶助成長測驗前，讓學生能專心參賽、複習觀念）| 參考產品公開活動說明 |
| 積分來源 | 技能升等（二級 1 分／三級 2 分／精熟 4 分）＋ 影片**首次完整觀看**（1 分）＋ 老師指派技能且達精熟（**+2 分**）；**學習扶助任務包要整包做完才算分，做一半＝0 分** | [2025 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/)｜[vocus.cc 分析文](https://vocus.cc/article/637c920afd897800012bafdf) |
| 防灌水規則 | 只採計「報名年級－2」以上程度的技能；**只算賽程期間新增的分數**（降級不扣分、已得分保留，但重新升級不會再給分）| [2025 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/)｜[十年回顧](https://official.junyiacademy.org/star-exploration-10-years/) |
| 班級排名 | **班級「平均」積分**（不是總分）——這樣大班小班才公平；**依年級分組**，分全國榜與縣市榜 | [vocus.cc 分析文](https://vocus.cc/article/637c920afd897800012bafdf)：「競賽以班級平均點數與全國小隊比較，而非總分」 |
| 個人 vs 團體 | 主賽制是班級（團體）平均榜；另設個人門檛（如 120 點）發個人徽章，避免大班裡個別學生的努力被稀釋到看不見 | [2025 獎勵辦法](https://www.junyiacademy.org/event/2025-star-exploration-prize/) |
| 班級徽章 | 班級**平均**達 120 點發班級徽章；全國前 10 名班級（依年級分組）發電子獎狀 | 同上 |
| 寶箱機制 | 班級**過半（≥50%）學生參與**後，解鎖隨機加分寶箱——這是**鼓勵參與度**的機制，不是防作弊 | [vocus.cc 分析文](https://vocus.cc/article/637c920afd897800012bafdf) |
| 「夜幕低垂」 | 每日 22:00–隔日 6:00 排行榜畫面凍結不更新（不是防作弊，是**防熬夜**的心理設計）| [2025 常見問答](https://www.junyiacademy.org/event/2025-star-exploration-faq/) |
| 核心理念 | 「**只要投入就一定會被看見的舞台**」——獎勵效力（投入度），不是獎勵天賦（能力）| [十年回顧](https://official.junyiacademy.org/star-exploration-10-years/) |
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
- 參考產品的公開網頁與公開文章（以上連結）；內部程式碼細節不寫進本 repo
- 本 repo 原始碼（§3/§5/§8 的技術對照與風險，皆為本次規劃實際讀取/測試驗證，非轉述）：`backend/app/models/{gamification,session,text}.py`、`backend/app/services/gamification_service.py`、`backend/app/routes/{stories,gamification}.py`、`backend/app/services/lesson_indexes.py`

## 10. CTO 與 UIUX 審查（2026-10-15）與據此修正

### CTO（技術）
| # | 發現 | 修正 |
|---|---|---|
| 1 | 遊戲經驗值帳本混了連續學習等加分、完課去重沒有唯一約束 | 計分改讀 `learning_sessions`：每位學生每課取第一次 `completed_at`，落在賽季時間窗內才算；不讀經驗值帳本 |
| 2 | `Text.grade` 對第二版課號幾乎都是空的（`sessions_bootstrap.py:68-72`） | 年級用課程目錄（`story_slug` → `get_lesson_by_id` 的 grade）；隊伍年級由老師報名時填、必填 |
| 3 | 「完成」由前端說了算：腳本一分鐘可完成上百課 | 聯賽內唯讀判斷：每人每天最多計 N 課、`completed_at − started_at` 低於下限不計、異常名單給老師看 |
| 4 | 老師可代學生送出完課（`gamification.py:72-83`） | 聯賽只計學生本人完成的紀錄（判斷方式待定） |
| 5 | 完課結算擁有者檢查 | 已於 2026-10-13 修好並上正式站（`gamification.py:232-237`），CTO 引用的是服務層，路由層已擋 |
| 6 | 同一季一個學生只能屬於一隊 | 名單表 `UNIQUE(season_id, student_id)`；「最多 3 隊」是跨賽季上限 |
| 7 | 找對手班級不能列出全機構班級（會露班名、老師名） | 一次性邀請碼；機構為空就拒絕；擁有者＝班級主教師 |
| 8 | 結果會隨 session 被刪而漂移 | 賽季結束寫結果快照；改權重＝用新快照重算並留紀錄 |
| 9 | 全國賽 | 才需要只增不改的計分事件表＋排程批次彙總＋物化榜單；MVP 現算即可 |
| 10 | 答案外洩 | v1 只計完課、不計正確率，所以不擋上線；日後納入正確率前必修 |

### UIUX（體驗）
- 「年級減 2」會排除學習扶助的孩子 → **老師指派的課一律計分**，只有自選的課套年級門檻
- 個人排行榜與「補救教學學生不需要排名」立場衝突 → 個人頁以「跟自己比＋門檻進度」為主；排行榜等方大哥同意再上
- 學生端看不到同學各自的分數，只看「全班 18/25 人已參與」；誰還沒參與只有老師看得到（標「尚未參與」，不用紅色）
- 讀家記憶做成「學習紀錄」裡的分頁；家長只看貢獻與徽章、不看名次；測試階段警語只給老師
- 補齊各狀態（無賽季、未報名、中途加入、多隊切換、已結束、0 分、離線、邀請失效）與 390／768／1280 排版

### MVP（兩邊共識）
保留：同機構跨班邀請賽（邀請碼、名單鎖定、班級平均現算）、我們班頁、老師班級進度頁、門檻徽章、讀家記憶分頁、家長一格
延後：跨班個人排行榜與暱稱、寶箱、跨校賽、全國賽、縣市榜、獎狀下載、學習扶助任務包規則

## 11. 定案（2026-10-15，Young 授權由開發端判斷）
1. 老師指派的課一律計分，不套年級門檻；學生自選的課才套「本年級 − 2 以上」
2. 老師代學生送出的完成不計分；只計學生本人帳號完成的紀錄
3. 防灌分：每人每天最多計 5 課；`completed_at − started_at` 少於 3 分鐘不計；異常名單給老師看
4. 班級報名後學生預設參加；第一期只公開班級彙總、不公開個人排名，個人退出機制隨個人排行榜一起做
5. 個人資料保留至賽季結束後一年，之後只留班級彙總
6. 個人排行榜延後（待方大哥確認排名政策）
7. MVP 照第 10 節共識範圍開工

## 12. UI 重新設計 + 功能補齊（2026-10-16，#3554 後續）

> 起因：Young 驗收 MVP（#3554 留言 2026-10-15）後指示「畫面請重新設計 有質感的；功能都要跟星空探險隊一樣」。
> MVP 當時只照抄了星空探險隊的**計分規則**（§5），畫面是純白表單＋列表，且星空的敘事／對戰視覺／寶箱提示／個人進度圖像化都還沒做。本節補這兩塊：**功能補齊**（§12.1 逐項對照）＋ **視覺重新設計**（§12.2）。

### 12.1 功能逐項對照（均一星空探險隊 vs 我們）

調研方法：依公開網頁、公開文章與實際活動畫面整理功能清單；內部程式碼細節不寫進本 repo（完整調研紀錄留在私有 repo）。

| # | 星空探險隊功能 | 本次狀態 | 說明 |
|---|---|---|---|
| 1 | 故事敘事 + 主視覺（狐狸貓星球 / 暗黑力量）| **Done（自有 IP）** | 讀家自己的故事與美術，不沿用均一的角色/文案/圖檔（CLAUDE.md IP 邊界）。主題定為「讀家星圖」：書蟲角色＋星圖隱喻，由本次 CSS/inline SVG 自繪，無外部圖檔依賴 |
| 2 | 集體清除進度條，兩隊能量並排| **Done（改造，非照搬數字）** | 均一的「3,000 單位暗黑力量／每 40 點換 1 單位燃料」是**全國多校累積池**的敘事數字，我們的賽季規模是兩班邀請賽，沒有對應的全國池可換算，照搬數字會是假數據。改為：兩班的「平均分 → 班級徽章門檻（120分，`weights.badge_threshold`）」各自一條能量條，左右並排面對面，兩條都滿即雙方都解鎖班級徽章——保留「兩隊並肩朝同一目標推進」的視覺精神，但目標是兩隊都已知、已驗證存在的真實門檻，不是編造的全域數字 |
| 3 | 兩種隊伍（星塵小隊／光束小隊，依報名分組）| **Partial（概念對應，分隊邏輯不同）** | 我們的「兩隊」＝邀請方班級 vs 應邀方班級（跨班邀請賽結構），不是同校內依人數分兩組；均一的分隊概念不直接適用於我們的賽制（PRD §4 已定案），這裡只借視覺語言（兩隊對照），不借分隊規則 |
| 4 | 個人進度| **Done** | 讀家記憶既有 `my_points`／`class_average_points`；本次新增 `badge_threshold` 讓前端畫真正的「我的分數 → 個人徽章門檻」進度環，不再只有文字 |
| 5 | 全國／縣市排名| **Not possible this round（已知缺口，非本票新發現）** | 需要兩個前提都不存在：① `official` 型賽季（全平台開放報名，PRD §4 schema 已留但 MVP 不開放，Phase 3）② `School` 的結構化縣市欄位（PRD §9.5 待 Young 決定是否新增，屬 migration 核准流程）。本次**不**新增這兩者（超出 league-only 的 additive 範圍），維持 PRD 既有 Phase 3 規劃 |
| 6 | 班排名＋累計貢獻點數| **Done（重新設計）** | 對應 `LeagueProgressTab`（teacher-only，班級內真名——PRD §6 既有規則：自己班內維持現狀真名顯示）。本次改造列表視覺＋依分數排序＋尚未參與維持灰色中性（PRD §10 UIUX 既有規則不變）|
| 7 | 限定頭貼（活動限定頭貼，達成條件解鎖專屬大頭貼）| **Partial（降scope，誠實標註）** | 完整「可切換大頭貼」系統＝新的頭像資產＋選擇器 UI＋使用者資料綁定，超出本次 UI 改版的合理範圍（也不是 Young 這次要的核心——他要的是「畫面有質感」，不是新頭像系統）。本次做**成就徽章視覺卡**（個人徽章／班級徽章，達門檻即解鎖的插畫式徽章，仿既有 `BadgeGrid.tsx` 視覺語言），不做可切換大頭貼。完整頭像系統列為後續，需要 Young 決定是否值得做 |
| 8 | 寶箱機制（班級過半參與解鎖隨機寶箱）| **Done（補完提示文案）** | `treasure_chest_eligible` 布林值 MVP 已有；本次新增 `treasure_chest_participants_needed`（§12.3 後端變更），讓 UI 能顯示「還差 N 人」而非只有「鎖住／解鎖」兩態。真正的「隨機加分」機制仍是 PRD Phase 2（MVP 範圍, PRD §4 已明載），本次不做隨機加分，只做參與度提示 |
| 9 | 夜幕低垂（22:01–隔日起算凍結畫面更新）| **Not done（既有明確延後決定）** | PRD §9.7／§10 分期表已將此列為 Phase 4，2026-10-15 review 時已決定不排進 MVP；本次沒有新資訊推翻這個決定，維持延後 |
| 10 | 介紹影片| **Not done this round** | 沒有既有讀家主題動畫素材；真要做需要走 `animation-director`／影像學院產線（另案），不在這次「重新設計 UI＋補功能」的程式碼改動範圍內。本次版面保留一個可放影片的區塊位置（之後補影片不必再動版面），但暫不放假的佔位影片 |
| 11 | 邀請流程（班級報名／邀請碼）| **Done（保留邏輯，重新設計視覺）** | 功能、授權矩陣、安全檢查全部不動（PRD §7 已定案的邀請碼機制），只重做視覺：三步驟改成卡片式精靈流程，而非純表單堆疊 |
| 12 | 個人排行榜（跨班排名＋暱稱系統）| **Not possible — 既有明確產品決策，非本票可重啟** | PRD §11.6「個人排行榜延後（待方大哥確認排名政策）」是 Young 2026-10-15 已定案的決策，不是遺漏。本次不重啟這個範圍 |

**小結**：12 項中 Done 5、Done(重新設計/改造) 2、Partial 2、Not possible/not done（既有明確理由）3。沒有一項是「忘記做」——每個 Not done/Not possible 都對應 PRD 既有章節的明確決定或明確的技術前提缺口。

### 12.2 視覺重新設計決策（UIUX，Young 授權由開發端判斷的小決定，附理由）

1. **沿用既有「Tactile Scholar」設計系統，不另開深色星空主題**——`DESIGN.md` 明載全站「Dark Mode：暫不實作（Phase 6+ 考慮）」。幫單一功能硬套深色全頁主題，會跟全站其他頁面（白色／暖米底）視覺斷裂，那是「不一致」不是「有質感」。改用既有 `GamificationHero.tsx` 已驗證過的語言（`bg-gradient-to-br from-accent to-accent/80` 深紫漸層卡片＋白字＋`bg-white/20` 進度軌道）做對戰首頁的英雄區塊——本身就有「成就／星空」的質感，且與全站一致。星圖／書蟲意象改用 inline SVG／CSS 繪製的星點裝飾做點綴，不做整頁換膚
2. **徽章視覺比照既有 `BadgeGrid.tsx` 的卡片語言**（彩色邊框＋圖示＋鎖定灰階＋解鎖高亮），個人徽章用 `accent`（品牌紫）、班級徽章用 `tertiary-container`（鼓勵橙）系統色，不新創色票
3. **兩隊面對面的能量條**放在對戰首頁最上方（Young 指定的版面需求），用左右鏡像布局：桌面（≥768px）左右並排、手機（<768px）上下堆疊，中間放共同門檻與「VS」視覺錨點
4. **行動裝置優先**：三個斷點（390／768／1280）都要可讀，手機版把「建立邀請賽」三步驟改成單欄精靈（一次顯示一步＋進度點），不是桌面三欄表單縮小
5. **文案延續既有中文風格**（不加句號、短句、鼓勵語氣），不使用星空探險隊的專有名詞（暗黑力量／恆毅星塵／理解光束等一律不出現）

### 12.3 後端變更（additive only，無新表／無 migration）

新增兩個計算欄位到既有兩個 response（`get_season_board` 的每一列、`get_my_team_summary`）：`badge_threshold`（該賽季凍結的徽章門檻）、`treasure_chest_participants_needed`（距解鎖寶箱還差幾人，0＝已解鎖）。純粹從既有 `weights_snapshot` 算出來，**不新增欄位到資料庫、不改既有欄位語意、不需要 migration**——TDD：`backend/tests/test_league_service.py` 新增 3 條測試（先紅後綠），見 git log。

### 12.4 畫面清單（本次改動的檔案）

| 畫面 | 檔案 | 改動 |
|---|---|---|
| 班級賽首頁（老師）| `frontend/src/pages/teacher/TeacherLeaguePage.tsx` | 全面重畫：對戰英雄區（兩隊能量條＋VS）＋精靈式邀請流程＋排行榜卡片化＋徽章/寶箱提示 |
| 班級賽進度 tab（老師，`ClassroomTabs` 內）| `frontend/src/pages/teacher/panel/LeagueProgressTab.tsx` | 列表視覺重畫＋個人分數條＋班級彙總卡片置頂 |
| 讀家記憶（學生，`學習紀錄` 內）| `frontend/src/pages/student/LearningHistoryPage.tsx`（`LeagueHistorySection`）| 個人進度環＋徽章卡片＋班級寶箱提示，取代純文字列 |

### 12.5 待 Young 決定（本次沒有動，列出來給他選）

1. §5 全國／縣市排名：要不要排進下一輪（需要 `official` 賽季型態實作 + `School.county` 欄位 migration）
2. §7 完整可切換頭像系統 vs 現在的成就徽章卡：值不值得做
3. §10 介紹影片：要不要排進影像學院產線


### 12.6 CTO 自審（`redutek-cto` skill 框架）

- **可逆性**：全部是 two-way door——UI 改版（CSS/元件）與 API 新增欄位都可逆、不碰 schema、不影響既有呼叫者（純新增欄位，舊 client 忽略新欄位不受影響）。不需要慢想，直接做
- **build vs buy**：UI 元件全部複用既有 `GamificationHero`／`BadgeGrid` 的視覺語言與既有 Tailwind 設計 token，沒有新裝套件、沒有新建設計系統
- **複雜度預算**：沒有新表、沒有新服務、沒有新依賴；只改 3 個既有檔案 + 2 個既有函式新增欄位
- **驗證才宣稱完成**：§12.3 的 TDD 已先紅後綠（見 commit）；UI 改動後跑 `npm run lint` + `npm run test`（render-smoke）+ headless 截圖三斷點，PR 合併後在 staging 用真資料（建一組跨班邀請賽＋學生真實完成一課）驗證，結果見 PR 說明與最終報告

### 12.7 命名定案（2026-10-16，Young 核准）

Young 核准：使用者看得到的名稱**「班級賽」／「班級賽季」一律改為「跨班賽季」**（教師側側欄、`ClassroomTabs` tab、`TeacherLeaguePage` 標題、學生端「我們班」頁與讀家記憶空狀態文案、家長儀表板）。**程式碼識別碼（`league`、`TeacherLeaguePage`、路由 `/teacher/league`）維持不變**，只改使用者看到的字。

同時核准在側欄項目與頁面標題下方各加一行副標，幫使用者分清楚「課堂搶答」（單堂課、約 10 分鐘的即時活動）跟「跨班賽季」（跨週累積的長期賽季）這兩個外觀相似（都是遊戲化🎮🏆圖示）但性質完全不同的功能：

| 功能 | 副標文案 |
|---|---|
| 課堂搶答 | 現在全班一起玩，約 10 分鐘 |
| 跨班賽季 | 和別班比幾週，平常讀課文就累積 |

落地：`NavItem` 新增 `description?: string`（`NavButton.tsx`），側欄展開時（≥768px 平板/桌面）在 label 下方顯示；390px 手機版用的是 `MobileTabBar`（底部固定列，icon+極短 label），螢幕驗證過放不下副標，故 390px 維持不顯示——這是刻意的版面判斷，不是遺漏。

同一批順手把學生端「我們班」頁（`StudentOurClassPage.tsx`）補上跟老師端同樣的「兩隊能量條對戰首頁」（之前完全沒有，只有自己兩個數字卡片），補齊原始需求 §「student views: battle home with both classes' energy bars face to face」在學生端的缺口。

### 12.8 已知特性：帳號若已讀完全部課程，新賽季拿不到新分數（2026-10-16，Young 定案維持現狀）

**現象**（2026-10-16 staging 真實驗證發現）：計分只算每堂課「有史以來第一次」的 `completed_at`（§5 既有規則，比照均一「只算第一次」）。如果一個帳號已經把某堂課完成過（即使是很久以前、即使當初是用假帳號／QA 测试快速點完），之後不管再怎麼認真重做那堂課，系統永遠只看那個「史上第一次」的紀錄——而那筆舊紀錄幾乎必定落在新賽季的時間窗之外，所以**這堂課對這個新賽季來說，再也拿不到分了**。

**驗證過程**：staging 用一鍵登入「學生 小明」測試，該帳號每堂課都有數十到數百筆歷史完成紀錄（追溯到 8 月）。依本次 PRD 的 ≥3 分鐘防刷規則，選三堂課（slug 20011／20013／L06）刻意用真實瀏覽器、真實等待 ≥3 分鐘重新完成，**三堂課全部沒有加分**——用 API（`GET /api/learning/sessions?story_slug=...`）查證，每堂課「史上第一次」的 `completed_at` 都落在今天賽季開始之前（有的甚至不到 3 分鐘就完成，是更早的 QA 測資）。換一堂小明從未完成過的指派作業（slug 20015，`total:1` 筆歷史紀錄）測試，則**立刻正常加分**（班級平均從 0 變成 0.007，`participant_count` 0→1，API 回應附在交付報告）。

**判定（Young 2026-10-16 定案）**：**維持現狀，不改程式碼**。這是刻意設計（比照均一星空探險隊「只算第一次」），不是 bug。小明是測試用的 QA 帳號，已經把 175 堂課幾乎全部洗過一輪，才會踩到這個邊界；**真實學生**面對的是完整 175 堂課的課程庫，長期使用下仍會有大量尚未完成過的課可以在新賽季賺分，不會出現「完全沒有分可拿」的情況。

**影響範圍**：僅影響「已經把課程庫刷得很熟的重度帳號（主要是內部 QA／demo 帳號）在全新賽季的第一時間」；不影響一般學生的正常使用體驗。往後如果真實學生長期使用後也開始出現類似狀況（例如升到高年級、課程庫被刷完），可以再重新評估是否要加「賽季內重做也能計分一次」之類的機制，但**本票不處理**。

## 14. Story Pack 模組（2026-10-16，由 LeagueTheme 通用化）

Young 核准將「主題內容」從 league 專用的 `league_themes` 改名為通用的 `story_packs`
（issue #3594 留言：「同意建主題表」，同日追加「泛用化」指示）——**資料庫 schema 與
LeagueTheme 核准的完全相同，只是改成跟遊戲模式無關的名稱**，方便之後其他遊戲模式
（PK、迷城密室……）共用同一張表。這次是 **MVP 範圍**（Young 2026-10-16 明令：「先
MVP，不要把重心放在劇情包擴展」），下列是故意沒做、留到之後真的有第二個消費者時
再做的部分。

**現在有的**：
- `story_packs` 表（id / key unique / content JSONB / is_builtin / created_by /
  created_at / updated_at）+ `league_seasons.story_pack_key`（nullable FK）。
- `app/schemas/story_pack.py`：`StoryPack` schema，欄位跟原本 `LeagueTheme`
  完全一樣（era/title/intro/faction_labels/energy_bar_label/milestones/
  chest/badges/result_copy）——**內容豐富的劇情包（如上古神話的多個篇章）直接用
  既有的 `milestones` 陣列表達，每個篇章一條，標題/引用都寫進 `message` 裡**，
  沒有另外建一個 chapter/scene 巢狀 model。
- **政治中立驗證器**（`BANNED_POLITICAL_TERMS`）：`_forbid_markup` 內建擋
  中華／中國／祖國／民族／我國／炎黃子孫／統一／收復／大一統／大戰，任何一個
  出現在任何文字欄位（title/intro/milestone/chest/badge/result_copy……）都會被
  Pydantic validator 擋下 422，不是只靠人工審查內容。所有劇情包的故事框架一律
  是「掉進一本書／故事」，衝突一律是抽象的（迷霧、時間亂流），不是某個國家或
  民族。
- 五個內建劇情包：**上古神話**（預設，引用《三五歷紀》《淮南子》《尚書》
  《史記》四段真實古籍出處）、唐、宋、武俠（原創世界，無既有小說/遊戲角色門派
  名稱，无暴力詞彙）、偵探劇（少年偵探社，無真實地點人物，無犯罪暴力詞彙）。
- 管理頁「劇情包管理」（`/admin` 側欄）：列表／編輯 JSON（即時驗證錯誤）／
  指派給某賽季——跟原本 League Theme Studio 功能相同，只是改名。
- `SqlAlchemyStoryPackStore` 是正式環境的 store；「平台預設」指標仍是
  process-local（不是 DB 欄位——Young 核准的 schema 本來就沒有這個欄位），
  已在 code docstring + 管理頁 UI 上明確寫「正式站多台伺服器可能不會立即同步」
  的警語。

**這次刻意沒做（之後才評估的）**：
- **多遊戲模式的 adapter 介面**：目前 season-assignment（`get_season_story_pack_key`
  等）還是直接寫在 `story_pack_store.py` 裡查 `LeagueSeason`，沒有抽成跟遊戲
  模式無關的介面。等 PK／迷城密室真的要綁 story pack 時，再各自定義自己的
  FK 欄位（例如 `pk_matches.story_pack_key`）跟一支小小的查詢函式，不要在只有
  一個消費者時先蓋抽象層。
- **NPC／對話／章節物件（含引用出處的結構化欄位）／realm·time_axis·space_scale
  等瀏覽用 metadata／suited_subjects·age_range**：這些都曾經在規劃中出現過，
  但 Young 2026-10-16 明確說「先 MVP」收斂掉了，連同「台灣原住民族神話篇章」
  （射日傳說，泰雅族版本已查證來源但需要文化內容審查，留到之後）一起延後。
  如果之後真的要做，schema_version 已經是 `Literal[1]`，可以在那時候 bump 成 2
  並加上有版本控管的新欄位，不會動到現有五個劇情包的資料。

**怎麼換劇情包**：系統管理員在「劇情包管理」選一個賽季 ID、按「指派給此賽季」。
切換**只改故事文字/美術**（title/intro/chest/badge 的文字與 emoji），完全不碰
`league_scoring.py` 的計分（`LeagueWeights`／`badge_threshold`／寶箱參與比例），
regression lock 見 `tests/test_story_pack_embedded_in_responses.py::
TestSwapPacksKeepsMechanicsUnchanged`（連續切換五個劇情包，逐欄位比對計分欄位
byte-identical，只有 `theme.key`/`theme.title` 隨劇情包改變）。
