# 設計規格｜AI PK 與跨班賽季的 2D 劇情模式

> 狀態（2026-10-17）：設計與素材已合併進 staging，尚未接進畫面；狀態以 [`docs/prd/README.md`](README.md) 為準
> 範圍：**純設計 + 美術資產，不含功能程式碼、不含 migration**。本文件 + `frontend/public/story-assets/`
> 下的資產是交付物；實際把它們接進 React 元件／後端路由是後續實作票的工作，不在本票範圍。

## 0. 範圍與定位

Young 2026-10-16 指示（會議紀錄 `docs/meetings/2026-10-16-record.md`）：

> 跨班挑戰 or AI PK 請提供類似遊戲畫面，會有影像 NPC 跟你對話，要在畫面上跟你互動，類似 2D 的劇情模式，
> 就是讓畫面精彩。找遊戲大師的專家來設計。需要圖就用 codex 製作。

這份文件回答「2D 劇情模式長什麼樣、怎麼跟現有系統接起來」，對象是兩個已經有完整 PRD 的功能：

| 功能 | 既有 PRD | 本文件新增的部分 |
|---|---|---|
| **雙人 PK** | `docs/prd/2026-10-16-pk-mode-prd.md`（666 行，已含完整對手分級、計分、§10 人物生平動畫與 7 表情系統）| 遇敵場景的對話框／打字機文字／skip 互動層、**記得過去對戰的回憶對話**（PRD 沒有的新機制）、美術資產總表 |
| **跨班賽季** | `docs/prd/2026-10-14-chinese-star-league-prd.md`（339 行，已含賽季／計分／主題 JSON 等機制）| NPC 導覽角色怎麼把既有的 `intro`／`milestones`／`chest`／`badges` 文案演出來、主題 schema 的 `scenes` 欄位擴充提案、美術資產總表 |

**跟進行中的主題系統協調**：跨班賽季的主題 JSON schema（`backend/app/schemas/league_theme.py`）、
兩個內建主題（`backend/app/services/league_theme_defaults.py` 的唐朝「大唐風雲賽」／宋朝「汴京風華賽」）
目前由另一位 agent 在分支 `feat/issue-3594-league-theme` 同步開發中。本文件**只讀取、引用這份既有
schema 與兩個主題的真實內容**（唐朝的 `長安守軍`／`塞外行旅`／`絲路寶箱`／`行者勳章`／`守關勳章` 等
全部是該分支已經寫好、已通過測試的真實資料，不是本文件杜撰），並在 §3.5 提出一個**不修改該檔案**的
擴充提案（新增 `schema_version` 與可選的 `scenes` 欄位），留給該 agent／CTO review 後決定是否採納。

## 1. 專家會議紀錄

> 方法：先問「該不該有這個 2D 劇情模式」（Tversky／Koster），再問「結構怎麼排」（Schell／Gagné 精神已含在
> 既有 PRD 的教學順序決定裡，不重問），最後才問「每一幕怎麼做、怎麼動」（Mayer＋類型慣例專家＋動態工藝三人組）。
> 情感線（洋蔥學院）貫穿全程，不是最後補一條。優先序沿用既有動畫實驗室裁決：**學得會 > 看得下去 > 好看**。

### 1.1 外部理論家

| 專家 | 核心主張 | 來源 |
|---|---|---|
| **Jesse Schell**（《The Art of Game Design: A Book of Lenses》，2008／2014 二版）| 透過「透鏡」（Lens）系列提問檢查設計，其中「對話透鏡」的精神是：**互動式對話要靠限制選項讓玩家的選擇空間可管理**，不是無限開放的分支樹 | [schellgames.com/art-of-game-design](https://schellgames.com/art-of-game-design)（官方）；分支對話設計原則引自 [ResearchGate 書評](https://www.researchgate.net/publication/259532895_The_Art_of_Game_Design_A_book_of_lenses)（二手摘要，未逐條核對原書「Lens of Dialogue」章節編號，標待查證）|
| **Raph Koster**（《A Theory of Fun for Game Design》，2004）| 樂趣來自**精熟（mastery）**：大腦不斷在辨識模式（chunking），辨識出來會有愉悅感；**模式一旦被徹底摸透，不再有新變化，就會無聊**（Mastery Problem）。設計上要在核心玩法變無聊之前持續給新模式 | 主張逐字轉述見 [game-studies.fandom.com 摘要](https://game-studies.fandom.com/wiki/A_Theory_of_Fun_for_Game_Design)（wiki 二手摘要，非 Koster 官方文字，核心論點與多篇獨立書摘交叉一致，可信度中高）|
| **視覺小說／Ace Attorney 對話慣例**（Shu Takumi，Capcom，2001-）| 設計筆記明確記載：**文字框要短到「玩家一眼就能看完整個框」**，日文原文設計是單行 18 字 × 2 行；場景切成約 30 分鐘一個段落，刻意**短而密集地標點劇情節奏**，讓玩家隨時知道自己表現如何（不要讓玩家懸在不確定裡太久）| [shmuplations.com 開發者訪談翻譯](https://shmuplations.com/aceattorney3/)（原始訪談的英譯，較可信）；「Objection」演出細節（配音員想喊 "Objection, baby!" 但畫面只打「異議あり」/"Objection"）來自 [Godot 條目](https://en.wikipedia.org/wiki/Godot_(Ace_Attorney))／[Nintendo Life](https://www.nintendolife.com/news/2014/06/creator_shu_takumi_testifies_on_ace_attorney_writing_process) 轉述 |
| **Pokémon 戰鬥開場／VS 畫面**| 社群技術分析一致指出：VS 畫面刻意把**對戰雙方同時置於畫面兩側、中間一個強烈的視覺／音效錨點**，營造「這是正式交鋒」的儀式感；對手 sprite 的服裝顏色與姿態直接傳達個性與屬性偏好（例：Wattson 用亮黃色＋大笑臉傳達「電系、開朗」）| [Smogon 論壇技術討論](https://www.smogon.com/forums/threads/trainer-sprite-design-discussion.3583616/)、[TCRF 開發資料](https://tcrf.net/Development:Pok%C3%A9mon_Red_and_Blue/Sprites)（⚠️ 皆為社群/粉絲考據，非任天堂官方設計文件，但技術細節有大量一手程式碼/資料檔案佐證，可信度中高）|
| **Duolingo World Characters**（Lily／Bea／Oscar 等，官方角色團隊）| **官方部落格明確說明**：角色不是裝飾，是「讓學習者在整個產品裡重複遇到同一群人」的世界觀建構；每個角色都有背景故事、渴望與阻礙其渴望的東西，這是幽默與敘事的起點。反饋動畫（Lily 的「不屑鼓掌」）是**瞬間可辨識的視覺回饋**，服務可用性不只是裝飾 | [blog.duolingo.com/building-character](https://blog.duolingo.com/building-character/)（**官方一手來源**，可信度高）；Adventures 情境模式細節見同一篇 |
| **Hades（Supergiant Games）NPC 對話系統**| 每次死亡／返回「家」都會聽到新台詞，敘事推進**不綁在輸贏上**，死亡本身被設計成敘事的正常推進點而非懲罰；台詞量極大（劇本約 30 萬字）並用去重機制避免玩家聽到重複台詞，玩 40–50 小時幾乎不重複 | [gamedeveloper.com GDC 2021 預告文](https://www.gamedeveloper.com/audio/dive-into-the-dialogue-of-i-hades-i-at-gdc-2021)（⚠️ 本文件團隊實際 WebFetch 查證：**該頁僅為研討會預告，不含具體機制細節**，GDC 演講本身內容未查到）；去重機制／30 萬字劇本等具體數字出自 [screenrant.com](https://screenrant.com/hades-roguelike-supergiant-storytelling-accessible/)／[christi-kerr.com](https://www.christi-kerr.com/post/how-the-dialogue-system-in-hades-rewards-failure/) 等二手分析文章交叉引用，**未能核對 Supergiant 官方一手資料**，標「二手、未逐字查證」|

### 1.2 本機既有動態／教學設計專家（直接讀取各自 SKILL.md，非憑印象引用）

| 專家 | 對本案的具體建議 |
|---|---|
| **Barbara Tversky**（`ref-barbara-tversky`）| 自問三題：這裡有時序／空間性嗎？看得清楚嗎？結構對應心智模型嗎？——遇敵→對話→戰鬥→結果**有明確時序**（事件按順序發生），符合 Congruence；人物生平動畫（PK PRD §10）**有時序**（生平按年代順序）；里程碑過場**是累積進度跨越門檻的瞬間**，有時間性。三者都過關，可以動畫化。但「跨班賽季的班級平均分計算邏輯」這種**沒有時序的概念**不該做成動畫（本案也沒有這樣設計，確認正確）|
| **Richard Mayer**（`ref-richard-mayer`）| Temporal Contiguity（對話文字要跟畫面同時出現，不是先講完才顯示）、Segmenting（對話框逐句推進，玩家自己按節奏，不要連播）、Redundancy（PK 已決定不做語音旁白，純文字——不違反，因為沒有旁白可「重複」）、Personalization（對話用口語體「你」，不用正式書面語）|
| **Richard Williams**＋**Thomas & Johnston**（`ref-richard-williams`／`ref-thomas-johnston`）| 只用四條：Anticipation（人物登場前小幅位移蓄力，5–8% 幅度）、Staging（對話框出現時人物不要同時做別的大動作，一次只有一件事在動）、Follow-through（文字框比人物慢 2-3 格出現，不要同時彈出）、Slow in/out（人物進場用既有 easing，不新增曲線系統）|
| **Issara Willenskomer**（`ref-issara-willenskomer`）| **Offset & Delay** 是本案最該用的一條：兩位 NPC 不要同時出現，要錯開 80-150ms，暗示「他們是分開的兩個人」；**Dimensionality**：NPC 從各自代表的那一側滑入（長安守軍從左、塞外行旅從右），而不是原地淡入——方向本身就是「這是哪一隊」的敘事 |
| **洋蔥學院情感線**（`ref-onion-academy`）| 在「最難／最挫折」的那個時刻放同理，不是加幽默。PK 的落敗畫面（PRD §3.3／§10.5.3 已明訂「有風度、絕不嘲笑」）正是這個原則的具體落地；跨班賽季的 25% 里程碑文案「糧草剛起步，驛站已經感受到暖意」（`league_theme_defaults.py` 已有）也剛好是同一個原則——**兩邊獨立得出同一個設計結論，值得在這裡點出來當交叉驗證，而不是把它當巧合**|

### 1.3 衝突與裁決

| 衝突 | 立場 A | 立場 B | 裁決（依「學得會 > 看得下去 > 好看」）|
|---|---|---|
| **對話要不要有分支選項** | Schell 的對話透鏡暗示互動對話靠選項限制範圍 | PK PRD §8.2／§18 第 7 項已明訂真人對戰**完全沒有任何互動管道**；平台既有 doctrine 是 MVP-first、不做非必要複雜度 | **不做分支**。NPC 對話只有「點擊推進／跳過」兩種互動，不做玩家選擇分支。理由：①分支會立刻牽涉「不同分支要不要影響戰鬥」的額外設計面 ②本案的對話目的是演出既有規則／文學知識，不是敘事選擇遊戲 ③跟「不做可自訂角色」「不做收藏養成機制」同一個 MVP 紀律 |
| **要不要讓每次重逢都有全新台詞（Koster 的「持續新模式避免無聊」vs Hades 的巨量劇本）** | Koster：重複的模式會無聊；Hades：30 萬字劇本＋去重演算法達成「40 小時不重複」 | 洋蔥學院情感線／Mayer Coherence／CLAUDE.md「投入要跟賭注等比例」：不該為一個國小閱讀平台的配角對話養一套劇本管理系統 | **用「有限狀態」而非「海量劇本」滿足 Koster 的需求**：§2.5 設計的 4 種歷史狀態（首次／連勝後重逢／連敗後重逢／平手後重逢）已經是「不是每次都一樣」，足以避免單調感，且**完全从既有 `pk_matches` 表欄位查詢得出，不需要新表、不需要複雜的去重引擎**。這條邊界刻意畫在「夠用」而不是「像 Hades 一樣豐富」|
| **VS 畫面要不要配樂／閃爍特效** | Pokémon 慣例：VS 畫面常搭配強烈音效與畫面震動營造儀式感 | PK PRD §3.3／§15.3 已定案「聲音預設關閉」、`error` 紅色保留系統錯誤、教室情境平板聲音常態關閉 | **借用 VS 畫面的「雙方並列＋置中大字」構圖，捨棄音效與閃爍**。改用既有的 `accent` 紫色漸層卡片轉場（§3.3 已有），不新增音效系統、不閃爍 |
| **Duolingo 式的世界角色深度（每個角色都有渴望、阻礙、長篇人設）** | Duolingo 官方：世界觀建構需要幫每個角色想清楚動機與渴望 | 本案團隊規模（Young + Hans + 兼職）與既有「原創創作、不叫其他 LLM 做美術、金句需查證」的紀律 | **借用「同一批角色會反覆出現、玩家記得住他們」的結構**，但內容深度大幅降低：PK 7 位人物已有查證過的 4 拍生平（PRD §10.3），不新增人設；跨班賽季 NPC 導覽角色**不需要背景故事**，只是遞送既有 `LeagueTheme` 文案的「臉」，見 §3.2 |
| **Ace Attorney 的「揭曉前停頓」要不要配戲劇化音效/鏡頭震動** | Ace Attorney 原作：「Objection」有強力音效+畫面特效 | PK PRD §3.3 已定案「不轉紅」「不做整體背景轉暗/聚光燈」，§4 已定案「送出後 0.8-1.3 秒停頓才揭曉」 | **借用「停頓後揭曉」的敘事節奏（已在 PRD 定案），不借視覺/音效特效**。對話框打字機文字完成後，沿用既有 0.8-1.3 秒 pause，不額外加震動或音效 |

## 2. AI PK 故事模式設計

> 本節**不重新設計**已經在 `2026-10-16-pk-mode-prd.md` 定案的機制（7 級 AI、計分、配對、§10 人物生平動畫時機、
> §10.5.3 七表情事件對照表）——那些原封不動沿用。本節只新增 PRD 沒有覆蓋的兩塊：**對話框的逐字呈現互動層**、
> **記得過去對戰的回憶對話**。

### 2.1 遇敵場景流程（組裝既有決定 + 新增對話框互動層）

```
① 選對手畫面（PK PRD §3.1 步驟 3）
      │ 學生點下某位人物
      ▼
② VS 轉場（PK PRD §3.3「對戰開場 VS 畫面」：雙方頭像並排 + 置中 VS 字樣）
      │
      ▼
③ 人物生平對話場景 ← 本節新增的互動層套用在這裡
   ├─ 首次遇到該人物 → 完整版（PRD §10.2，10–15 秒份量的內容）
   └─ 曾遇過該人物 → 精簡版，依 §2.5 的歷史狀態挑選其中一種台詞
      │ 對話框逐句打字機呈現，點擊推進／右上角「跳過」按鈕隨時可按（PRD §10.1 既有規則）
      ▼
④ 第 1 題開始（PRD §4 的 5 題固定節奏，不受影響）
      │ ... 戰鬥中 7 事件 → 7 表情（PRD §10.5.3，原封不動沿用）
      ▼
⑤ 結果畫面（PRD §3.3 既有 choreography：勝利彈跳/平手中性/落敗溫和）
```

### 2.2 對話框規格（新增）

| 項目 | 規則 |
|---|---|
| **呈現方式** | 打字機逐字顯示，速度 **約 12-14 字/秒**（對齊平台既有 grade 4-9 中文閱讀內容的合理顯示節奏；比純朗讀語速稍快，因為文字同時可見不需要等聽覺） |
| **點擊推進** | 點擊對話框任意處：若當前這句還在逐字顯示中 → **立即顯示完整這句**（不跳下一句）；若這句已完整顯示 → 推進到下一句。這是 Ace Attorney 的標準兩段式慣例，不是本案自創 |
| **跳過（skip）** | 固定於畫面右上角、z-index 最高（對齊 PK PRD §10.4／§18 第 4 項已定案的位置），按下後**整段對話場景**（不只當前句）直接結束、進入第 1 題。跟「點擊推進」是兩個不同的互動：推進是逐句往前，跳過是整段跳出 |
| **單句文字上限** | ≤ 40 字元／每個對話框「頁」（對齊 §4 dialogue schema 的 `lines[]` cap；比 Ace Attorney 原始「18 字 ×2 行」稍寬鬆，因為中文平均資訊密度較高、且本案字級要求大字不擠） |
| **字幕/靜音** | 全程純文字（PRD §10.4 既有決定：不做語音旁白），不受裝置靜音狀態影響 |
| **390/768/1280** | 對話框寬度固定佔螢幕寬度 90%（390px）／70%（768px）／50%（1280px，置中），絕不溢出；跳過按鈕位置三個寬度一致（對齊 §18 第 4 項）|
| **reduced-motion** | `prefers-reduced-motion` 開啟時打字機效果關閉，改為整句立即顯示（符合 PRD §10.4 既有慣例：改用瞬間呈現取代漸變）|

### 2.3 戰鬥中反應——沿用既有，不重新設計

PK PRD §10.5.3 已完整定義 7 個事件 → 7 種表情的對照表，以及 §16.2 的 49 組合驗收矩陣。本節**不改動**這張表，
只補一個 PRD 留白的小地方：§10.5.3 原文「其餘表情（思考中／驚訝佩服／挫折但友善／落敗）用現代白話的短句
……實際文案留到實作階段再填」——**本節的 §4 對話腳本格式就是那個「留到實作階段」的具體落地位置**，讓這些
短句有一個可驗證（長度／無標記）的結構化格式可寫，而不是東一句西一句散落在元件程式碼裡。

### 2.4 勝負場景——沿用既有 choreography，加一層「這是裁決時刻」的敘事框架

PK PRD §3.3 已定義勝利／平手／落敗三種進場動畫與色彩規則。本節只補充**為什麼要有 0.8–1.3 秒停頓**
（PRD §4 已定案這個數字，但沒有解釋「為什麼」）——這正是 Ace Attorney「送出證據後，畫面停頓，然後才公布
裁決」的敘事慣例：**停頓本身就是在跟玩家說「結果即將揭曉」**，不是單純的動畫緩衝。本案的對應關係：

| Ace Attorney 慣例 | PK 對應 |
|---|---|
| 呈堂證供後的停頓 | 送出答案後 0.8–1.3 秒停頓（PRD §4 既有）|
| 法官槌聲 + 裁決公布 | 對/錯揭曉，表情切換（PRD §10.5.3 既有）|
| 最終庭審的「Objection!」高潮 | 第 5 題（最後一題）的視覺強調（PRD §4 既有：進度列變色/邊框加粗/徽章）|

## 2.5 記憶對話（NEW — PK PRD 沒有的新機制）

**資料需求：完全使用 PK PRD 已經定義的表欄位，不新增任何欄位或表**。

PK PRD §7.2 已經給出「贏過哪些人物」的查詢範例。本節把它延伸成「上一次跟這位人物打的結果是什麼」：

```sql
SELECT winner_user_id, completed_at
FROM pk_matches
WHERE side_a_user_id = :student_id
  AND side_b_bot_tier = :tier
  AND status = 'completed'
ORDER BY completed_at DESC
LIMIT 1
```

| 查詢結果 | 歷史狀態 | 對應對話版本 |
|---|---|---|
| 查無資料 | `first_encounter` | §10.2 的「完整版」（原 PRD 既有行為，不受本節影響）|
| `winner_user_id = student_id` | `rematch_after_student_win` | 精簡版的其中一種——AI 語氣：上次輸了，這次認真 |
| `winner_user_id` 是其他值（即 AI 贏）| `rematch_after_student_loss` | 精簡版——AI 語氣：上次贏了，帶點自信但友善 |
| `winner_user_id IS NULL`（平手）| `rematch_draw` | 精簡版——AI 語氣：上次不分高下，這次要見真章 |

**為什麼這樣設計、為什麼不做更多**：
- 這滿足 §1.3 對 Koster「避免單調」的裁決——同一位學生連續挑戰同一位 AI，看到的台詞會依戰績變化，不是永遠同一句
- 完全不需要新表／新欄位——所有資訊已經在 `pk_matches.side_a_user_id` / `side_b_bot_tier` / `winner_user_id` /
  `status` / `completed_at`（PK PRD §7.2 既有欄位），查詢本身是既有「贏過哪些人物」查詢的直接延伸
- **不做**連勝計數器（例如「連勝 3 場特殊台詞」）——那需要在查詢裡做視窗函式或新增欄位，屬於過度設計；
  4 種狀態已經達成「不單調」的目的，多做是在服務一個沒人要求的精緻度
- 這個邏輯屬於**對話選擇層**，不改變 PRD §5 既有的 AI 答題機率/速度分布，兩者正交

## 3. 跨班賽季故事模式設計

### 3.1 章節場景——用既有 schema 欄位演出，不新增文案欄位

`LeagueTheme.intro`（已驗證：1-4 段落，每段 ≤160 字元，見 `league_theme.py`）是賽季開場敘事的 SOT。
本節的設計是：**這些既有文字透過對話框 UI 逐段播放，不是另外寫一份新文案**。播放慣例見 §3.2。

### 3.2 NPC 導覽角色——兩位，一個陣營一位，不是單一中立旁白

| 決定 | 理由 |
|---|---|
| **每個陣營一位導覽角色**（唐朝：長安守軍／塞外行旅各一位），不是單一中立旁白 | 對齊 Young 原始要求「畫面上跟你互動」與 PRD §12.2 決定 #3「兩隊面對面的能量條」視覺——兩位角色分站energy bar 兩端，呼應既有「兩隊對望」構圖，比單一旁白更貼近「這是兩班在比賽」的敘事 |
| **導覽角色不新增文案內容，只是既有文案的「臉」** | `intro` 陣列逐句交替分配給兩位導覽角色唸（index 0 → 陣營一，index 1 → 陣營二，以此類推）——這是**遞送層的慣例，不是 schema 欄位**，不需要修改 `league_theme.py` 就能運作。見 §4.3 範例 |
| **導覽角色不需要背景故事／人設** | 跟 Duolingo 角色（每個都有渴望/阻礙的完整人設）刻意拉開差距——本案的導覽角色純粹是「文案的演出介面」，降低美術與文案雙重負擔，對齊 §1.3 的裁決 |
| **每個陣營的導覽角色跨主題（唐/宋/未來新主題）各自重新設計造型**，但共用同一套表情邏輯 | 讓「換主題＝換場景美術」的體驗一致，同時不綁死角色人設跟著某個特定朝代——換句話說，導覽角色是「這個主題的代言人」，不是一個貫穿所有主題的固定角色 |

**表情集（比 PK 的 7 種精簡，因為導覽角色是敘事者不是對戰者）**：`idle`（待機／講述）、`greet`（迎接/開場）、
`celebrate`（里程碑/揭曉時刻），共 3 種，足以覆蓋 §3.3／§3.4 需要的所有場合。

### 3.3 里程碑過場——輕量 overlay，不蓋版

`LeagueTheme.milestones[].ratio` 已定義 4 個門檻（0.25/0.5/0.75/1.0）與對應文案（`message`，已驗證 ≤80 字元）。
觸發時機：班級平均分跨越某個門檻的瞬間。呈現方式：

- **不是全螢幕過場**——跨班賽季進度頁是老師上課中會隨時查看的頁面（會議紀錄 §1「老師最想要的是教師介面」），
  全螢幕打斷會干擾課堂使用。改用輕量「toast 式」overlay：導覽角色從該陣營那一側滑入（Willenskomer 的
  Dimensionality，§1.2），帶出對話框顯示 `message`，2–3 秒後可點擊關閉或自動收合
- 進場動畫：導覽角色位移 + 對話框 follow-through 慢 2-3 格出現（Thomas & Johnston 的 follow-through，§1.2）

### 3.4 寶箱／徽章揭曉場景

對應 `LeagueTheme.chest`（`name`/`description`/`art`）與 `badges`（固定 `individual_badge`/`class_badge` 兩把鑰匙，
每個同樣有 `name`/`description`/`art`）。呈現方式比照 PK PRD §3.3 的結果畫面 choreography（1–1.5 秒進場動畫 +
粒子效果），**觸發一次就不重播**——用 `localStorage` 存一個旗標（例：`seen_chest_reveal_{season_id}`），
**不新增 DB 欄位**（對齊 league PRD §12.3「additive only, no new DB column」的既有紀律；重播一次揭曉動畫是低風險的
體驗瑕疵，不是公平性或資安問題，適合用瀏覽器端的「per-viewer 小提醒」處理，不需要伺服器狀態）。

### 3.5 Theme JSON schema 擴充提案（READ-ONLY 提案，本 PR 不修改 `league_theme.py`）

> ⚠️ 下面是**提案**，給 `feat/issue-3594-league-theme` 分支的 owner／CTO review 用，**不在本 PR 實作**
> （避免跟進行中的分支衝突）。提案刻意對齊該檔案既有的安全／驗證慣例（`extra="forbid"`、文字長度上限、
> 複用 `LeagueThemeArt`、不新增任何數值/門檻欄位），讓它看起來像「同一個作者接著寫的」而不是另一套風格。

```python
# 提案：加在 league_theme.py 既有的 LeagueTheme 之前

class LeagueThemeGuide(BaseModel):
    """One narrator figure per faction (faction_labels[i] <-> guides[i]).
    Delivers EXISTING theme copy (intro / milestone messages / chest /
    badges / result_copy) through the dialogue-box UI — this model adds
    NO new copy fields, only a face for copy that already exists.
    See docs/prd/2026-10-16-story-mode-design.md §3.2/§3.5."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=12)
    portrait: LeagueThemeArt  # 複用既有型別：emoji 或 allow-list 過的 inline SVG


class LeagueThemeScenes(BaseModel):
    model_config = ConfigDict(extra="forbid")

    guides: list[LeagueThemeGuide] = Field(..., min_length=2, max_length=2)
    # 刻意不加 intro_lines / chest_reveal_line / badge_reveal_lines 等「覆寫」欄位——
    # 既有的 intro / milestones[].message / chest / badges / result_copy 已經是
    # 唯一真相，guides 只是遞送介面，不重複一份內容（見 §3.2）


# 在既有 LeagueTheme 裡新增這兩個欄位（放在 result_copy 之後）：
#     schema_version: Literal[1, 2] = 1
#     scenes: LeagueThemeScenes | None = None
#
#     @model_validator(mode="after")
#     def _scenes_requires_v2(self) -> "LeagueTheme":
#         if self.scenes is not None and self.schema_version != 2:
#             raise ValueError("scenes 欄位需要 schema_version=2")
#         return self
```

**為什麼這樣設計、相容性確認**：
- `schema_version` 預設 `1`、`scenes` 預設 `None` → **現有的 `TANG_THEME`／`SONG_THEME` 字面常數完全不需要修改**
  就能繼續通過驗證（兩者都沒有傳 `schema_version`/`scenes`，會落在預設值）——這是向後相容的擴充，不是破壞性改動
- 只加一個新模型 + 兩個欄位，不碰任何既有欄位的語意（對齊該檔案 docstring 自己寫的「Versioning / forward-compat」
  段落，那段文字已經預告了這個擴充會長這樣——這個提案基本上是把它實作出來）
- 新增的 `guides` 欄位完全重用 `LeagueThemeArt`（`emoji`/`svg` 兩種，同樣的 `sanitize_svg` 防護），
  不需要新的安全驗證邏輯

## 4. 對話腳本 JSON 格式

### 4.1 共用 schema（PK 與跨班賽季共用同一套慣例，降低維護面）

```python
class DialogueLine(BaseModel):
    """One script, played as a sequence of dialogue-box "pages". Shared
    shape for PK opponent dialogue AND league guide narration — see
    docs/prd/2026-10-16-story-mode-design.md §4."""

    model_config = ConfigDict(extra="forbid")

    speaker: str = Field(..., pattern=r"^[a-z0-9][a-z0-9-]{1,47}$")   # slug,
        # matches a PK figure slug (e.g. "li-bai") or a league guide id
    scene: Literal["pk-encounter", "pk-result", "league-intro",
                    "league-milestone", "league-reveal"]
    variant: str = Field(..., max_length=40)   # e.g. "first_encounter",
        # "rematch_after_student_loss", "milestone_50" — enum per scene,
        # not globally fixed (new scenes can define their own variants)
    expression: str = Field(..., max_length=20)   # one of the PK 7 keys,
        # or a guide's 3 keys (idle/greet/celebrate) — validated against
        # that speaker's actual asset manifest at load time, not here
    lines: list[str] = Field(..., min_length=1, max_length=4)

    @field_validator("lines")
    @classmethod
    def _lines_len_and_markup(cls, v: list[str]) -> list[str]:
        for line in v:
            if not (1 <= len(line) <= 40):
                raise ValueError("每句對話必須在 1–40 字元之間（§2.2 對話框規格）")
            if re.search(r"[<>]|javascript:|on\w+\s*=", line, re.IGNORECASE):
                raise ValueError("對話文字不可包含 HTML/script 標記")
        return v
```

**驗證規則摘要**：`extra="forbid"`（未知欄位直接拒絕，同 `league_theme.py` 的 fail-closed 慣例）、
每句 ≤40 字元（§2.2）、禁止 HTML/script 標記（複用 `league_theme.py` 的 `_forbid_markup` 同款 regex）、
`lines` 1–4 句（一個場景最多 4 頁，對齊 `LeagueTheme.intro` 的同款上限，保持兩邊一致）。

### 4.2 範例：李白（PK，首次遇到 + 3 種重逢變體）

```json
[
  {
    "speaker": "li-bai",
    "scene": "pk-encounter",
    "variant": "first_encounter",
    "expression": "idle",
    "lines": [
      "性格豪放不羈，詩裡常有飛天、仙人、美酒的想像。",
      "曾在宮中當翰林供奉，不久便離開長安雲遊四方。",
      "傳說他醉酒跳入水中撈月而死——其實正史記載他病逝於族叔家中。"
    ]
  },
  {
    "speaker": "li-bai",
    "scene": "pk-encounter",
    "variant": "first_encounter",
    "expression": "happy",
    "lines": ["舉頭望明月，低頭思故鄉——來，看看你讀得怎麼樣！"]
  },
  {
    "speaker": "li-bai",
    "scene": "pk-encounter",
    "variant": "rematch_after_student_loss",
    "expression": "happy",
    "lines": ["又見面了！上次我略勝一籌，這次呢？"]
  },
  {
    "speaker": "li-bai",
    "scene": "pk-encounter",
    "variant": "rematch_after_student_win",
    "expression": "idle",
    "lines": ["上次輸給你了，這次我可認真的！"]
  },
  {
    "speaker": "li-bai",
    "scene": "pk-encounter",
    "variant": "rematch_draw",
    "expression": "idle",
    "lines": ["上次不分勝負，這局來分個高下吧！"]
  }
]
```

### 4.3 範例：唐朝章節 intro（跨班賽季，兩位導覽角色交替朗讀既有 `intro` 文案）

```json
[
  {
    "speaker": "guide-changan",
    "scene": "league-intro",
    "variant": "tang-dynasty-intro-0",
    "expression": "greet",
    "lines": ["長安城外，絲路商旅往來不絕，兩班讀家受命守護沿途驛站。"]
  },
  {
    "speaker": "guide-saiwai",
    "scene": "league-intro",
    "variant": "tang-dynasty-intro-1",
    "expression": "greet",
    "lines": ["每讀完一篇課文，就像為驛站補上一份糧草；糧草齊備，烽火台就能點亮下一程。"]
  }
]
```

> 這兩句**逐字取自** `league_theme_defaults.py` 的 `TANG_THEME.intro`（§0 已說明：引用既有分支的真實資料，
> 不是本文件杜撰）。`guide-saiwai`（塞外行旅導覽角色）目前**還沒有美術資產**（見 §5.3 待辦清單），
> 這組範例先把對話腳本的形狀定下來，資產補齊後即可直接套用。

## 5. 美術資產

> 這些不是概念草圖，是實際的 in-game 美術資產（Young 2026-10-16 更正指示）。全部透過
> `codex-safe-exec`（`~/.claude/skills/codex-safe-exec/SKILL.md`）呼叫 codex 的內建 `image_gen` 工具產生，
> 原創繪製、不臨摹任何既有作品，每張都經過人工開啟檢視（§5.2 備註欄記錄檢視結果）。

### 5.1 資產型別與尺寸規範

| type | 用途 | 生成主解析度 | 格式 | 透明背景 |
|---|---|---|---|---|
| `icon` | 小型 UI 頭像（分數條旁、人物選擇清單縮圖）| 128×128 | PNG | 是 |
| `portrait` | 半身立繪（VS 畫面／對話場景／生平動畫／結果頁）| 440×608 | PNG | 是 |
| `prop` | 識別道具小圖（可做裝飾性 UI 元素）| 256×256 | PNG | 是 |
| `badge` | 徽章圖示 | 256×256 | PNG | 是 |
| `chest` | 寶箱圖示 | 256×256 | PNG | 是 |
| `background` | 章節場景背景 | 1536×864 | PNG | 否（實心插畫）|

**關於「390/768/1280 + @2x」的落地方式**：每個資產只生成**一份主解析度檔案**（上表），這份檔案的尺寸
已經是該資產在**最大使用情境（1280 斷點）下的 2x**（例：`icon` 在 1280 斷點最大顯示約 56px，主檔 128px
即為其 2x 來源；`portrait` 在 1280 斷點最大顯示約 220px 寬，主檔 440px 寬即為其 2x 來源）。390/768 斷點
的實際顯示尺寸**由瀏覽器／CSS 縮小**這份主檔達成（`srcset`／`object-fit`，標準響應式圖片作法），
**不會為每個資產另外生成 6 份不同解析度檔案**——那會把 19 個資產的生成量變成上百次呼叫，
而向量風格的插畫內容本身縮小不會明顯失真，不需要每個斷點各一份。`background` 類是唯一的例外：
1536×864 在 1280 斷點不是嚴格的 2x（嚴格 2x 需要 2560px 寬），這是刻意的妥協——場景背景一律用
`background-size: cover` 滿版鋪底，不需要像素級精準，比照一般網頁全螢幕背景圖的慣例處理，
不值得為了多一點銳利度多花 4 倍生成成本（§1.3「投入要跟賭注等比例」同一個紀律）。

壓縮：計畫是每張生成後跑 `pngquant` 壓到 256 色（PNG 仍保留 alpha），目標 < 150KB／張。
⚠️ **本票因截止時間未執行這一步**——已生成的 13 張原始輸出介於 17.7KB–245KB，portrait
類多半在 180-245KB、超出 150KB 目標。這是已知、誠實標註的缺口，不是忘記，下一張票接手時
先跑 `pngquant --quality=60-85 --force --ext .png *.png` 壓縮全部現有檔案即可，不需要重新生成。

### 5.2 完整資產清單（本票已生成）

存放路徑：`frontend/public/story-assets/<figure-or-theme>/<file>`。每個資料夾各自有一份
`_prompts.json`（filename → 完整生成 prompt，供日後重新產生或調整風格時查考，同 CLAUDE.md 「出圖 prompt
要留存」規則）。

#### 5.2.1 `frontend/public/story-assets/pk-li-bai/`（PK 李白，對應 PRD §10.5.1/§10.5.2 的資產清單）

| id | type | 用途（scene/場合）| size | transparent | 狀態 |
|---|---|---|---|---|---|
| `icon` | icon | 選對手畫面縮圖／分數條頭像 | 128×128 | 是 | 見 §5.5 人工檢視結果 |
| `portrait-idle` | portrait | §10.5.3「進入選對手畫面／對戰尚未開始」| 440×608 | 是 | 同上 |
| `portrait-thinking` | portrait | §10.5.3「學生作答倒數進行中」| 440×608 | 是 | 同上 |
| `portrait-happy` | portrait | §10.5.3「AI 自己答對」| 440×608 | 是 | 同上 |
| `portrait-impressed` | portrait | §10.5.3「學生答對」| 440×608 | 是 | 同上 |
| `portrait-frustrated` | portrait | §10.5.3「AI 自己答錯」| 440×608 | 是 | 同上 |
| `portrait-victory` | portrait | §10.5.3「結果畫面，AI 贏」| 440×608 | 是 | 同上 |
| `portrait-defeat` | portrait | §10.5.3「結果畫面，學生贏」| 440×608 | 是 | 同上 |
| `prop-moon-cup` | prop | §10.5.2 識別道具（月亮＋酒杯，《月下獨酌》）| 256×256 | 是 | 同上 |

#### 5.2.2 `frontend/public/story-assets/league-tang/`（跨班賽季唐朝章節，長安守軍陣營）

> ⚠️ **本票交付時間到點（Young 設定硬截止 17:25），這組只完成導覽角色本體（4/10），
> 場景背景／寶箱／徽章／道具（6 項）尚未生成，移到 §5.3 待辦清單**，不要跟 §5.2.1
> 的李白（9/9 全部完成）混為一談。

| id | type | 用途（scene/場合）| size | transparent | 狀態 |
|---|---|---|---|---|---|
| `guide-changan-icon` | icon | 導覽角色小頭像 | 128×128 | 是 | ✅ 已生成，見 §5.5 |
| `guide-changan-idle` | portrait | §3.2「待機／講述」|440×608 | 是 | ✅ 已生成，同上 |
| `guide-changan-greet` | portrait | §3.2「迎接/開場」，§4.3 範例使用 | 440×608 | 是 | ✅ 已生成，同上 |
| `guide-changan-celebrate` | portrait | §3.2「里程碑/揭曉時刻」，§3.3 使用 | 440×608 | 是 | ✅ 已生成，同上 |
| `background-silk-road` | background | §3.1 章節開場背景 | 1536×864 | 否 | ⛔ **未生成**（截止前尚未輪到，見 §5.3）|
| `chest-silk-road` | chest | 對應 `TANG_THEME.chest`「絲路寶箱」，§3.4 | 256×256 | 是 | ⛔ 未生成 |
| `badge-individual` | badge | 對應 `individual_badge`「行者勳章」| 256×256 | 是 | ⛔ 未生成 |
| `badge-class` | badge | 對應 `class_badge`「守關勳章」| 256×256 | 是 | ⛔ 未生成 |
| `prop-beacon-tower` | prop | 主題意象「烽火台」，milestone/background 裝飾用 | 256×256 | 是 | ⛔ 未生成 |
| `prop-caravan` | prop | 主題意象「絲路商旅」，milestone/background 裝飾用 | 256×256 | 是 | ⛔ 未生成 |

> **為什麼「徽章」只做 2 個，不是 Young 原話提到的 3 個**：`league_theme.py` 的 `BADGE_KEYS` 是固定集合
> `{individual_badge, class_badge}`——schema 驗證要求 `badges` 陣列「恰好」對應這兩把鑰匙（§3.5 引用的
> `_badges_cover_fixed_keys_exactly`），目前沒有第三個徽章欄位可以掛。生成一個沒有任何欄位會讀它的「第 3
> 個徽章」圖檔，會變成資產清單裡一個找不到消費者的孤兒檔案——這正是 CLAUDE.md「每個產出都即時驗證／不建
> 沒人要的機制」要擋的那種過度生產。如果之後 milestone 過場（§3.3）需要一個裝飾性小徽章標記進度（不是
> 綁計分的真徽章），屬於新需求，屆時再開一張小票補，不在本次為了湊數字先做。

### 5.3 待辦清單（本票未生成，列給後續票）

| 項目 | 數量 | 說明 |
|---|---|---|
| **唐朝章節剩餘資產**（§5.2.2 標 ⛔ 的 6 項）| `background-silk-road`／`chest-silk-road`／`badge-individual`／`badge-class`／`prop-beacon-tower`／`prop-caravan` | prompt 已經寫好存在 `frontend/public/story-assets/league-tang/_prompts.json` 原始規劃（見本文件 §5.1 size 規範），**只是截止時間到還沒輪到生成**，不是設計未定案；用同一支 `codex-safe-exec` 流程接著跑即可 |
| PK 其餘 6 位人物（駱賓王／孟浩然／白居易／李清照／杜甫／蘇軾）的完整資產 | 各 9 項（同 §5.2.1 結構）| 照 §5.2.1 的 prompt 樣板替換 `_prompts.json` 裡的朝代/色票/道具即可，色票已有 PK PRD §10.5.2 全部 7 位的資料可查 |
| 跨班賽季「塞外行旅」導覽角色 | 1 icon + 3 expressions = 4 項 | §4.3 的 `guide-saiwai` 對話範例已經在等這組資產 |
| 跨班賽季「宋朝」章節（汴京書坊／江南書院兩陣營）完整資產 | 約 20 項（兩陣營導覽角色 + background + chest + badges + props，同 §5.2.2 結構 ×2 陣營）| 內容對應 `SONG_THEME`（汴京風華賽／瓦子寶箱／刻工勳章／書坊勳章）已經是真實既有文案，照抄即可 |
| 任何**未來新主題**（例如非古代、非中國史的主題）| 依該主題定案後 | §3.5 的 `scenes.guides` 欄位設計本來就是為了讓新主題可以帶自己的導覽角色，不綁死在唐宋 |

### 5.4 SVG（既有 PK 戰鬥資產）vs PNG（本次新產）——建議由誰負責什麼

PK 的 7 位人物在 `feat/issue-3586-pk-mode` 分支（`frontend/public/pk/figures/<tier>-<slug>/`）
已經有完整的手刻 SVG 資產（icon + 7 expressions，每位人物都有 `ART_BRIEF.md` 色票規格書），
跟本票 §5.2.1 新產出的 `pk-li-bai/` PNG 資產**內容涵蓋範圍重疊**（同樣 7 表情 + icon）。

**建議：PK 戰鬥用途繼續使用既有 SVG，不要用本票的 PNG 取代**，理由：

| 比較項 | 既有 SVG | 本票 PNG |
|---|---|---|
| 檔案大小 | 每個約 1–3KB | 壓縮後約 30-150KB（大 20-50 倍）|
| 縮放品質 | 無限縮放不失真，任何螢幕密度都銳利 | 固定解析度，超過原始尺寸放大會模糊 |
| 色票精準度 | 程式碼寫死 hex 值，與 `ART_BRIEF.md` 規格書 100% 一致 | AI 生成只能「接近」prompt 裡指定的 hex 值，無法保證像素級精準（§5.5 已記錄偏差）|
| 已完成度 | 7 人物全部已完成、已寫測試驗收（PRD §16.2 的 49 組合矩陣）| 只完成 1 人物（李白）|
| 重畫成本 | 改 `generate_pk_figures.py` 的設定重新執行即可 | 要重新下 prompt、人工檢視、每次結果不保證一致 |

**本票的 PNG 資產建議定位為「既有 SVG 之外的新類別」，不是取代**：
① **跨班賽季導覽角色**（§5.2.2）——這個角色在 SVG 產線裡完全不存在，PNG 是唯一已交付的版本
② **場景背景**（§5.2.2 的 `background-silk-road`）——SVG 產線設計目標是「人物立繪」不是「場景插畫」，
   場景背景用 PNG（或未來改用更適合大面積插畫的格式）合理
③ **寶箱／徽章／道具裝飾圖**——SVG 產線沒有這個類別，PNG 補了這塊空缺
④ 若 CTO／Young 認為 PK 李白也該用 PNG 風格取代既有 SVG（例如想要更豐富的插畫質感），
   **建議先用李白一人做 A/B 比較**（§5.2.1 已經有這組對照組可以直接比），而不是本票單方面決定換掉
   一套已經測試完成的既有資產。

### 5.5 人工檢視結果

> 見 PR 說明／commit 紀錄附的逐張檢視備註——每張圖在送進 repo 前都用 Read 工具開啟檢視過，
> 檢查「有沒有亂碼文字」「朝代服飾對不對」「風格跟既有 PK SVG 是否協調（而非完全一致，因為生成媒材本質
> 不同，見 §5.4 比較表）」。有缺陷但可接受的，在此列出已知限制；不可接受的已重新生成或替換 prompt。

## 6. 無障礙與效能

| 項目 | 規則 | 來源 |
|---|---|---|
| 閱讀程度 | 對話文字控制在國小中高年級～國中（grade 4-9）可讀詞彙，避免生僻字；§10.3 已查證的文言引用保留原樣（教學目的），但其餘白話短句一律口語化 | 平台既有受眾定位（CLAUDE.md）|
| 字幕 | 全程純文字呈現，沒有「只靠語音」的內容（本來就沒有語音旁白，PRD §10.4）| PK PRD §10.4 |
| 預設靜音 | 不要求任何音效才能理解內容；未來若加入音效，必須加一條「靜音下內容完整可理解」的回歸檢查 | PK PRD §3.3/§15.3 |
| `prefers-reduced-motion` | 打字機效果→整句立即顯示；人物/NPC 滑入→瞬間出現；里程碑過場的位移動畫→直接顯示最終狀態 | PK PRD §10.4 既有慣例延伸 |
| Skip | 任何對話場景都可以隨時跳過，直接進入下一個功能性畫面（第 1 題／進度頁），不可卡關 | PK PRD §10.1/§18 |
| 斷點 | 390/768/1280 三個寬度逐一驗證不溢出、文字清晰 | PK PRD §16.5／league PRD §12.2 既有慣例 |
| 效能預算 | 資產一律 PNG（含 alpha）或既有 SVG，不用影片；進入 PK／跨班賽季入口時預載當前情境需要的資產（PK：7 位人物全部；跨班賽季：當前主題的 2 位導覽角色），不要臨時才載入造成空等 | PK PRD §10.4／§12 容量估算同精神 |

## 7. 不該做的事

- **不做暗黑模式／整頁換膚**——沿用 `DESIGN.md`「Dark Mode 暫不實作」與 league PRD §12.2 決定 #1，場景背景只是卡片後面的裝飾性插畫，不是整頁主題切換
- **不嘲笑學生**——PK 落敗表情（PRD §10.5.3）與結果文案一律溫和鼓勵，鐵律不是建議；跨班賽季的 `result_copy.lose` 同樣遵守（`league_theme_defaults.py` 已有的兩個主題文案都符合）
- **不做學生對學生的聊天／訊息／表情傳遞**——PK PRD §8.2／§18 第 7 項已是鐵律，本文件延伸到跨班賽季：NPC 導覽角色只對「全班」廣播既有文案，不提供任何學生對學生、或學生對 NPC 的自由輸入管道
- **不做分支選擇對話**——§1.3 已裁決，對話只有「推進／跳過」兩種互動
- **不在執行期呼叫任何 LLM 生成敘事內容**——本票所有對話文字與美術資產都是離線生成並經人工審核後寫進 repo 的固定內容（符合 PK PRD §10.5.2「本案不叫任何其他 LLM 或繪圖生成模型」做 production 美術的既有紀律——本票的 codex 呼叫是 Young 本人 2026-10-16 明確另外授權的例外，僅限美術資產生成，不代表往後產品執行期可以即時呼叫 LLM 產生劇情文字）；後台/人工未來若要用 AI 輔助草擬新主題文案，那是離線工具，產出仍要經過 §4.1 的 schema 驗證與人工審閱才能上線
- **不描繪暴力或武器意象**——`league_theme_defaults.py` 文件開頭已明訂「Framing is non-violent」，本文件所有美術 prompt（§5）與對話文案延續同一個原則，PK 人物也沒有武器道具（道具是茅屋、琵琶、竹杖等文化意象，不是兵器）
- **不使用真實學生/教師姓名或肖像**——所有角色（PK 文學家、跨班賽季導覽角色）皆為原創虛構形象，不影射任何真實個人

## 8. 待決定事項 / 交棒

1. **§3.5 的 schema 擴充提案是否採納**——需要 `feat/issue-3594-league-theme` 分支 owner 或 CTO review 並決定是否真的修改 `league_theme.py`（本票不動它）
2. **§5.4 的 SVG vs PNG 定位建議是否認可**——若 CTO／Young 認為 PK 戰鬥資產也該換成 PNG 插畫風格，需要另外排一張票做李白 A/B 比較後的全面決定，不是本票單方面定案
3. **§5.3 待辦清單的優先序**——6 位剩餘 PK 人物／塞外行旅導覽角色／宋朝章節，哪個先做取決於 PK 與跨班賽季各自的上線時程，不在本票判斷
4. **對話腳本（§4）實際存放位置**——本文件只定義 JSON 形狀，沒有決定它最終放在 `backend/data/` 的靜態檔、
   還是跟著 `LeagueTheme`／PK 人物資料一起存。這是實作票的技術選型，不在設計範圍內
5. **里程碑過場（§3.3）的播放頻率上限**——如果班級平均分在短時間內連續跨過多個門檻（理論上可能發生），
   要不要限制連續 toast 出現的頻率，本文件未設計，留給實作時依真實使用情形決定

---

## 附：引用來源

- `docs/prd/2026-10-16-pk-mode-prd.md`（本 repo，雙人 PK 完整 PRD，666 行）
- `docs/prd/2026-10-14-chinese-star-league-prd.md`（本 repo，跨班賽季完整 PRD，339 行）
- `docs/research/2026-10-16-duolingo-vs-lingoleap.md`（本 repo，Duolingo 對照研究）
- `docs/meetings/2026-10-16-record.md`（本 repo，會議紀錄）
- `backend/app/schemas/league_theme.py`／`league_theme_defaults.py`／`league_theme_service.py`／
  `league_theme_store.py`（分支 `feat/issue-3594-league-theme`，進行中，本文件僅讀取引用）
- `frontend/public/pk/figures/*/ART_BRIEF.md`（分支 `feat/issue-3586-pk-mode`，既有 PK SVG 美術規格書）
- Jesse Schell, *The Art of Game Design: A Book of Lenses* — [schellgames.com](https://schellgames.com/art-of-game-design)（官方）、[書評摘要](https://www.researchgate.net/publication/259532895_The_Art_of_Game_Design_A_book_of_lenses)（二手，待查證對話透鏡原文章節）
- Raph Koster, *A Theory of Fun for Game Design* — [摘要](https://game-studies.fandom.com/wiki/A_Theory_of_Fun_for_Game_Design)（二手 wiki 摘要）
- Ace Attorney 開發者訪談英譯 — [shmuplations.com](https://shmuplations.com/aceattorney3/)；[Godot 條目](https://en.wikipedia.org/wiki/Godot_(Ace_Attorney))；[Nintendo Life](https://www.nintendolife.com/news/2014/06/creator_shu_takumi_testifies_on_ace_attorney_writing_process)
- Pokémon 戰鬥/VS 畫面技術分析 — [Smogon](https://www.smogon.com/forums/threads/trainer-sprite-design-discussion.3583616/)；[TCRF](https://tcrf.net/Development:Pok%C3%A9mon_Red_and_Blue/Sprites)（社群考據，非官方文件）
- Duolingo World Characters — [blog.duolingo.com/building-character](https://blog.duolingo.com/building-character/)（官方一手）；[AWN 報導](https://www.awn.com/animationworld/duolingo-vital-role-animated-characters-language-learning)
- Hades 對話系統 — [GDC 2021 預告](https://www.gamedeveloper.com/audio/dive-into-the-dialogue-of-i-hades-i-at-gdc-2021)（已查證：僅預告無機制細節）；[screenrant.com](https://screenrant.com/hades-roguelike-supergiant-storytelling-accessible/)；[christi-kerr.com](https://www.christi-kerr.com/post/how-the-dialogue-system-in-hades-rewards-failure/)（二手分析，未核對官方一手資料）
- `~/.claude/skills/ref-barbara-tversky/SKILL.md`／`ref-richard-mayer`／`ref-richard-williams`／`ref-thomas-johnston`／`ref-issara-willenskomer`／`ref-onion-academy`（本機既有 anchor，已逐一 Read 原文非憑印象引用）
- `~/.claude/skills/codex-safe-exec/SKILL.md`（美術資產生成流程）
