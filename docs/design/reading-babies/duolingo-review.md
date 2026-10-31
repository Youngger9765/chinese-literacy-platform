# 閱讀寶貝 —— 對照 Duolingo 遊戲化機制的審查

> 2026-10-31 · 遊戲化學院交付（唯讀審查，依 `~/.claude/skills/ref-duolingo/SKILL.md` 逐條核對
> `docs/design/reading-babies/game-design.md`）
> **前提聲明**：本審查完成時，`game-design.md` 已依 Young 2026-10-31 定案改寫為**單一系統**——
> 閱讀寶貝直接取代文字寶貝 v1，全站只保留一套寶貝系統，沒有「兩套並存」的情況。
> 以下所有比對都建立在這個單一系統前提上，**不提出任何「讓兩套系統共存」方向的建議**。
> 本文件**只做唯讀比對**，不改 `game-design.md`、不改程式碼、不建議任何具體程式實作方式。
> 依據強度標示沿用既有慣例：**依據**＝查到可信來源或讀過本專案真實文件；
> **推論**＝沒有單一出處，是用既有原則組合出的判斷；**待查**＝需要之後驗證或找人補值。

---

## 審查範圍對照 Young 的原始三個關注點

Young 要求研究 Duolingo「怎麼把學習行為自動換成角色成長、引導學生去對的地方、不讓學生刷點數」。
這份審查用這三件事當主軸，逐一對照：

| Young 的關注點 | 對應 `game-design.md` 章節 | 對應 Duolingo 機制 |
|---|---|---|
| 學習行為自動換成角色成長 | §2（成長點數）、§3（三階進化） | XP → TSLW 品質指標、Birdbrain |
| 引導學生去對的地方 | §4（寶貝卡＋一鍵直達） | ZPD／Adaptive Lessons、Path 單元結構 |
| 不讓學生刷點數 | §2.2（決定性判定、拿掉 RNG）、§2.3（冪等唯一鍵） | Total Sessions→TSL→TSLW 演化、月挑戰改任務制、排行榜 XP 重配重 |

---

## 一、哪裡跟 Duolingo 一致（做對的地方）

### 1.1 零點擊、決定性發放 —— 呼應 Duolingo「防刷」的演化方向

`game-design.md` §2.2 把 v1 的 CSPRNG 擲骰（0.55-0.9 機率掉落）整套拿掉，改成
`quality_passed=true` **100% 決定性發放**，不疊加任何運氣成分。

這跟 Duolingo 自己從「Total Sessions（次數）→ Time Spent Learning（時間）→
Time Spent Learning Well（品質加權）」一路演化的方向一致——Duolingo 發現用**次數或機率**
當指標，學生會往「最省力的方式」去滿足系統，於是改成**只認真正有品質的行為**
（見 `ref-duolingo` 的 TSLW 段，[time-spent-learning-well](https://blog.duolingo.com/time-spent-learning-well/)）。
閱讀寶貝的 `quality_passed` 布林值判定，精神上已經是「用品質門檻取代次數/機率」這條路線的終點版本
（連 Duolingo 自己都還保留一個加權公式，閱讀寶貝直接用決定性布林值，更乾淨）。

### 1.2 遊戲進度跟能力評量分層 —— 直接對齊 Duolingo Score vs XP/Streak

`game-design.md` §2.1 的介面契約明確把「遊戲機制（成長點數、進化階段）」跟
「能力指標投影（`ability_id` 達標次數）」分成兩個獨立但共用同一底層紀錄的東西，
且**遊戲端不重新判斷對錯、不重算分數**。

這正好對應 `ref-duolingo` 的核心發現：Duolingo 把 XP/streak/Leagues（遊戲化進度）
跟 Duolingo Score/CEFR（真實能力量尺）分開呈現——後者要能被第三方信任（學校、雇主），
不能混進遊戲化的刷分成分（見 [duolingo-score](https://blog.duolingo.com/duolingo-score/)）。
閱讀寶貝的設計在這點上**比單純套用 Duolingo 做得更徹底**：它從介面契約的層次就把兩者分開，
而不是像 Duolingo 一樣兩者都還是同一個 app 畫面上顯示的數字（只是語意不同）。

### 1.3 失敗零羞恥 —— 跟 Duolingo for Schools 的「不處罰」原則一致

`game-design.md` §6.3 規定 `quality_passed=false` 時沒有負面音效、沒有「錯誤」紅色動畫、
沒有扣分，只是「這次還沒有」。

`ref-duolingo` 查到 Duolingo for Schools 的官方文章明確寫：「If students make mistakes
along their learning journey, they will be cheerfully directed to try again —
and they won't be penalized for those mistakes.」
（[duolingo-schools-equitable-learning](https://blog.duolingo.com/duolingo-schools-equitable-learning/)）
——**兩邊的設計語言幾乎是同一句話的中英文版本**，這是直接一致，不需要改。

### 1.4 單一數字餵多個下游展示 —— 跟 XP 餵多系統的架構精神一致

`game-design.md` §2.4（2026-10-31 改寫版）把「成長點數」跟「文字碎片」定義成
**同一筆 `quality_passed=true` 紀錄的兩種呈現層**，不是兩筆互相要同步的獨立資料。

`ref-duolingo` 的 XP 機制有類似架構：XP 是單一數字，但同時餵進 daily quest、league
排名、等級三個下游系統（見 `hk-xp-system` 交叉驗證段）。閱讀寶貝把這個精神用得更乾淨——
乾脆連「碎片」都不是獨立資料，是即時算出來的顯示層，徹底排除兩份資料對不上的風險，
比 Duolingo 自己的架構（XP 是獨立儲存的數字，要跟下游系統保持同步）更不容易出錯。

### 1.5 地標優先、引導作為輔助入口 —— 精神上對應 Path 的「下一步永遠清楚」

`game-design.md` §4.1 明確「地標優先，寶貝卡只是輔助入口」，不新發明導航機制。

Duolingo 的 Path 結構（單元標籤、Score 分段、可回頭複習）本身就是「永遠知道下一步在哪」
的設計（見 [how-to-review-lessons-on-duolingo](https://blog.duolingo.com/how-to-review-lessons-on-duolingo/)）。
兩者的落地方式不同（Duolingo 用的是強制線性路徑本身；閱讀寶貝是在既有地標系統上疊加卡片），
但**目標一致**：學生永遠不需要自己猜「接下來該做什麼」。

---

## 二、哪裡 Duolingo 有更好的做法，建議怎麼改

### 2.1 ⚠️ 進化比例門檻是「扁平計數」，沒有區分「站的份量」—— 這正是 TSLW 想解決的問題

`game-design.md` §3.2 的進化門檻是**扁平比例**：`quality_passed=true` 的站數 ÷ 可評量站總數，
不管是哪幾站通過。§4.3 的「下一步建議」雖然依既定站序排優先，但那只影響**建議去哪**，
不影響**計不計入比例**——學生理論上可以挑該課**較容易**的可評量站優先攻破，
湊到 50%／100% 的比例門檻，而完全跳過（或拖到最後才碰）份量較重的站（例如完整朗讀 vs
單一字詞辨識，份量明顯不同）。

Duolingo 正好踩過一模一樣的坑：用 Total Sessions（純次數）當指標時，
「發現 Total Sessions 是不完美的指標，因為它偏向鼓勵做短、簡單的 session 的人」
（原文：biased towards people who were grinding on shorter, easier sessions，
見 [time-spent-learning-well](https://blog.duolingo.com/time-spent-learning-well/)）。
後來改成 TSLW，**明確給「走正課路徑」的行為加權（×1）、給「其他活動」打折（×0.5）**，
就是為了不讓「做很多簡單的事」跟「做少量但有份量的事」被算成一樣的進度。

**建議（推論，給能力指標專家與工程落地前參考，不是本文件代為裁決）**：
評估是否需要在 §3.2 的比例公式裡，對「可評量站」加一層簡單的權重區分
（例如：完整朗讀類站權重較高、單字辨識類站權重較低），而不是全部站一視同仁地各算 1 票。
如果實測發現「179 課裡大部分課的站份量都接近」，這個風險可能不大，可以維持現狀；
但如果有課的站份量落差明顯（長課文朗讀 vs 短生詞測驗放在同一課裡），
扁平比例會讓「進階（100%）」這個對孩子宣告的「你把這一課真正該學會的東西都學會了」
產生名不副實的風險——這點值得在能力指標專家盤點「可評量站清單」時一併確認。

### 2.2 建議補一個「技術性遺失保護」的不變量 —— 呼應 Big Red Button

`game-design.md` §2.3 的冪等唯一鍵保護的是「**不要重複加成長**」（防止同一站判定多次），
但沒有明文處理反過來的風險：如果前端送出 `quality_passed=true` 後，因為網路問題或系統問題，
這筆紀錄**沒有成功寫入**，學生這次真正做對的學習行為就會**悄悄消失**，而學生完全不知道
（畫面上看起來什麼都沒發生，跟「這次沒通過」長得一樣）。

Duolingo 為了類似的風險，特地做了一個專案（Big Red Button）：「保護學生的 streak 不被
網站技術問題波及」，已經保護超過 **200 萬條** streak
（見 [protecting-streaks-from-site-issues](https://blog.duolingo.com/protecting-streaks-from-site-issues/)）。
背後的原則是：**不該讓系統自己的技術問題變成學生的損失**。

**建議（推論）**：這不需要閱讀寶貝這份設計文件本身改動（它已經正確定義了「唯一入口、唯一鍵」
的判定邏輯），但建議在工程落地時，把「前端送出 `quality_passed=true` 後務必確認後端真的寫入
成功，失敗要重試或至少讓前端知道要重送」這條**明確寫進實作驗收清單**（可以是 §8 新增一條
驗收條件），不要假設「我方發出判定」跟「學生真的拿到成長」永遠一致。

### 2.3 美術定案前，建議借用 Duolingo 的「文化敏感度五步驟」當造型審查 SOP

`game-design.md` §1.3 已經設了黑名單（不得出現恐怖/暴力/悲傷意象）與「化解心結不是打倒怪物」
的基調，方向是對的，但目前只有**禁止清單**，沒有**正向的審查流程**。

Duolingo 處理角色 Vikram 被回報疑似影射錫克社群刻板印象時，走的是五步驟流程：
① 找該文化背景的顧問與員工委員會確認問題 → ② 研究該文化裡被認可的正面典範形象 →
③ 針對造成問題的具體視覺元素（體型、道具）重新設計 → ④ 反覆跟顧問核對 → ⑤ 定案
（見 [vikram-redesign](https://blog.duolingo.com/vikram-redesign/)）。

**建議（推論）**：`game-design.md` §1.3 的「體型家族×劇情類型」公式裡，「偵探＝風衣/放大鏡剪影」
「尋寶＝卷軸/勳章剪影」這類視覺意象目前看起來是中性的，但一旦真的進入美術定案階段
（本文件已聲明美術production不在本文件範圍），建議採用類似五步驟的審查流程
——尤其「魔王」劇情類型的造型，最容易在無意間套用某種文化的「反派刻板印象」視覺語言
（例如某些文化服飾或符號被無意識套用成「壞人」造型）。這是**給未來美術落地階段的建議**，
不要求本文件現在就決定造型細節。

### 2.4 可以考慮：老師後台補一個「時間/行為量」的輔助視角

`game-design.md` §4.4 老師看到的是 `ability_id` 達標次數投影（雷達圖/長條圖）——這是能力資料，
已經對齊 Duolingo for Schools「不是又一套遊戲化介面給老師看」的原則（見 ref-duolingo 核心機制表）。

但 Duolingo for Schools 的教師儀表板同時還顯示「學生花費時間、最近一次作業」這類**行為量資料**
（見 [duolingo-schools-equitable-learning](https://blog.duolingo.com/duolingo-schools-equitable-learning/)：
「Teacher dashboards...highlight XP earned, time spent learning, and a student's
most recent assignment」）——這些資料跟「能力指標」是不同維度：能力指標回答「學會了沒」，
時間/行為量回答「有沒有在用、卡在哪一課沒動」。

**建議（推論，低優先序，標明這不是本文件職責範圍內要解決的事）**：這類「學生有沒有在用」
的訊號，本來就不是閱讀寶貝的成長紀錄表（§7.2）設計目的，也不該由這份文件決定要不要加——
只是提出來給未來規劃老師儀表板全貌時參考：Duolingo 的教師視角不只有「學會了多少」，
還有「有沒有在用」，兩者互補。

---

## 三、哪些 Duolingo 做法不適合小學生，以及原因

### 3.1 ❌ Streak + Loss Aversion（連續登入 + 損失趨避）—— `game-design.md` 已正確避開，應該維持

Duolingo 官方親口把 streak 的長期動機來源歸因於「loss aversion」（損失趨避，一種讓人
特別害怕失去已擁有東西的心理偏誤）：原文「we tap into 'loss aversion'...Even on your
laziest days...you'll be reminded to complete a lesson so as not to lose your
hard-earned progress」（見 [how-duolingo-streak-builds-habit](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)）。

**這套機制本質上是靠製造一點「怕失去」的焦慮感來驅動回訪**，Duolingo 自己的資料顯示：
即使是成年使用者，設定「高目標」的人也最難維持 streak（約 40% 落入「用了兩天卻沒有 streak」），
高標準反而先把人嚇跑（見 [improving-the-streak](https://blog.duolingo.com/improving-the-streak/)）
——連 Duolingo 自己的成年用戶族群都會被這套機制的壓力打退，國小學生的情緒調節能力
普遍低於成年人，更不適合承受同一種「怕中斷就失去」的心理負擔。

`game-design.md` §6.1 已經**明確決定不做**連續登入獎勵／streak，理由直接引用
`gamification-octalysis` 對 CD8（Loss & Avoidance）在教育場景要用到最少的警告——
**這個判斷是對的，應該維持**，不要因為「Duolingo 這麼有名的機制」而想把它加回來。

### 3.2 ❌ 公開排行榜／跨使用者排名與淘汰賽 —— 國小場景風險更高

Duolingo Leagues 每週把使用者依習慣配對進同一個排行榜，有明確的升降級與淘汰賽
（Diamond Tournament 八強/四強/決賽），即使官方提供退出選項、也承認
「This competitive feature...the competition can feel 'unfair' for learners who
are more focused on content than gaining thousands of XP per week」
（見 [duolingo-leagues-leaderboards](https://blog.duolingo.com/duolingo-leagues-leaderboards/)、
[time-spent-learning-well](https://blog.duolingo.com/time-spent-learning-well/)）。

`game-design.md` §6.4 已經決定閱讀寶貝的進度/圖鑑**預設只有本人看得到**，不像
`island-v2/design.md` 的「參觀同學島」那樣公開——理由寫得很清楚：「避免後段班學生被同學
看到自己哪一課卡在基礎型態而感到難堪」。這個判斷**是對的**，而且比 Duolingo 自己的做法
更保守（Duolingo 至少還有「可以關閉」的選項存在，代表他們自己也知道這有風險，
只是用「選擇性退出」而非「預設不公開」處理；閱讀寶貝直接選擇更安全的**預設不公開**，
對國小場景是正確的方向，不需要改回「可以選擇公開比較」）。

### 3.3 ❌ 可對外分享的成就卡片／社群炫耀機制 —— 不要為了「做得像 Duolingo」而加

Duolingo 的 streak 里程碑特地設計了「可以存、發、或在社群媒體上 #humblebrag 的分享卡片」
（見 [streak-milestone-design-animation](https://blog.duolingo.com/streak-milestone-design-animation/)，
文中原句語氣甚至帶著「Look at me, Mom! Aren't you proud?!」這種鼓勵對外炫耀的行銷調性）。

這對一般消費型 App（使用者本身就有社群帳號、可自由分享）是合理的成長引擎，但**完全不適合**
搬進國小閱讀平台：學生帳號不該有對外社群分享功能，這類機制會製造「沒有東西可以炫耀的同學
會自覺不如人」的比較壓力，也涉及未成年人數位足跡/隱私的額外風險。
`game-design.md` 目前沒有、也不應該加入任何形式的「可分享到站外」的成就呈現——
這點建議明確記錄為**刻意不做**，避免未來有人提議「學 Duolingo 做個分享卡片」時沒有依據可查。

### 3.4 ❌ AI 驅動的個人化通知推播（Bandit 演算法優化提醒文案）—— 不建議引入校園場景

Duolingo 用 bandit（吃角子老虎）演算法從近 2 億筆通知資料學習「對哪種學習者送哪句提醒
最可能讓他完成一課」，本質上是**用機器學習持續優化說服力**（見
[hi-its-duo-the-ai-behind-the-meme](https://blog.duolingo.com/hi-its-duo-the-ai-behind-the-meme/)）。

即使 Duolingo 自己有節制機制（避免同一句通知太常重複），這套設計的核心目的仍是
**最大化「被提醒後打開 App」的機率**——用在一般消費者身上是常見的留存手法，
但用在國小學生身上會有兩層問題：① 多數國小學生在校時間不該被手機通知打斷，
裝置/帳號管理權本來就該在老師/家長手上，不該讓系統直接對兒童個人裝置做心理學優化推播；
② 即使用意良善，「持續用演算法學習怎麼更有效說服兒童採取某個行為」這件事本身，
在教育場景的倫理尺度上比消費型 App 更需要謹慎。

`game-design.md` 目前的設計沒有任何通知/推播機制（引導全部發生在學生主動打開畫面之後，
透過寶貝卡呈現），**這是對的，不建議額外加入**。若未來真的需要提醒機制，建議走
Duolingo for Schools 的模式——**訊號交給老師**（老師在儀表板看到「這個學生好幾天沒碰某一課」
再決定要不要提醒），而不是系統直接對學生個人裝置做心理學優化的推播。

---

## 總結判定

`game-design.md`（2026-10-31 單一系統版）在「學習行為自動換成角色成長」與
「遊戲進度跟能力評量分層」這兩件事上，**已經做到比 Duolingo 現行機制更保守、更乾淨**的程度
（決定性判定取代機率/次數、介面契約層級就分離兩種資料、碎片不做成可花用貨幣）。

唯一值得在下一步補強的，是「引導學生去對的地方」裡的**比例門檻份量問題**（§二.1）——
這是 Duolingo 自己從 Total Sessions 一路改到 TSLW 才學到的教訓，值得趁現在還在設計草案階段
就一併考慮，而不是等上線後才發現「全站某些課可以用取巧的站序湊出進階」。

三個不適合小學生的 Duolingo 機制（streak/loss aversion、公開排行榜/淘汰賽、
可對外分享的炫耀卡片、AI 個人化推播通知）`game-design.md` 全部**已經正確避開**，
這份審查的作用主要是**把「為什麼不做」的依據補齊**，避免未來有人拿「但 Duolingo 這樣做」
當理由想加回來時，找不到反駁的證據。

---

## 引用來源

全部來自 `~/.claude/skills/ref-duolingo/SKILL.md`（2026-10-31 建立，每條均附原始 URL，
查核方式與誠實缺口見該檔案 Sources 段），本文件未另外查證新的來源。
