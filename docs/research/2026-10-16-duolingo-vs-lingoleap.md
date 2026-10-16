# Duolingo 模式 vs LingoLeap：研究與對照

> 存取日期 2026-10-16｜目的：盤點 Duolingo 的商業／學習／互動模式，對照 LingoLeap 現況，找出可借鏡、不該抄、以及結構性不可比的部分，作為跨班賽季／雙人 PK／讀家記憶等功能迭代的參考。

**標註圖例**：每個事實後面的括號標示證據層級——
`[官方數據]` Duolingo 自己發布的財報／部落格／白皮書｜`[媒體報導]` 第三方新聞或分析部落格轉述、尚未逐一回溯原始出處｜`[我們的推論]` 本文作者（Claude）比對兩邊現況後的判斷，非任何一方官方說法｜`[待查證]` 查到但無法確認是否仍是現行數字／政策。

---

## 1. Duolingo 商業模式：誰付錢

**核心是消費者免費增值（B2C freemium），不是機構採購。** 絕大多數使用者免費用，付費牆是個人訂閱，廣告與考試是旁支收入。

| 收入來源 | 2024 全年佔比 | 說明 |
|---|---|---|
| 訂閱（Super／Max）| 81.2%（$607.5M／$748.0M 總營收）| `[官方數據]` [Duolingo 2024 10-K](https://www.sec.gov/Archives/edgar/data/1562088/000156208825000042/duol-20241231.htm) |
| 廣告 | 7.3%（$54.9M）| `[官方數據]` 同上 |
| Duolingo English Test（DET）| 6.1%（$45.6M）| `[官方數據]` 同上 |
| App 內購買 | 5.2%（$38.7M）| `[官方數據]` 同上 |

**兩層付費訂閱**（2026-10-16 實際頁面不公開統一價，依地區／帳號浮動，以下為市面常見報價，非官方公告的單一價目表）：
- **Super Duolingo**：約 $13.99/月或 $83.99/年，個人方案；家庭方案約 $119.99/年、最多 6 人。移除廣告、無限愛心／能量、個人化複習。`[媒體報導，價格待查證——Duolingo 不在官網公開單一價表，依地區與帳號浮動]`
- **Duolingo Max**：約 $29.99/月或 $167.99/年，在 Super 之上疊加 GPT-4 驅動的 AI 功能（Explain My Answer、Roleplay、Video Call，見第 2 節）。`[媒體報導，同上待查證]`
- 2026 年內有報導指出，隨 AI 推論成本下降，Duolingo 正把部分 Max 專屬功能（如 Explain My Answer）下放給所有使用者免費用，甚至評估是否要整個收掉 Max 這一級距。`[媒體報導，待查證——出自分析型部落格轉述，未見官方公告原文]`

**規模指標（Q2 2026，官方財報）**：`[官方數據]` [Duolingo Q2 2026 新聞稿](https://investors.duolingo.com/static-files/2ef55449-ab04-4902-a5e3-01b13d67122a) / [SEC Form 8-K](https://www.sec.gov/Archives/edgar/data/0001562088/000162828026053299/q2fy26duolingo6-30x26share.htm)
- 營收 $298.5M（年增 18.3%）
- 日活躍使用者（DAU）5,870 萬（年增 23%）
- 月活躍使用者（MAU）1.406 億（年增 10%）
- 付費訂閱者 1,270 萬（年增 17%）
- 總預訂金額（bookings）$289.1M（年增 8%）
- 淨利 $33.2M

**Duolingo English Test（DET）**：線上英語檢定，單次收費約 $59，標榜比傳統托福／雅思更便宜更快。截至 2025 年底已被 6,100+ 間機構採認，含美國前 100 大學中的 98 所；2024 年約 70 萬人次應試。`[媒體報導，待查證——數字出自分析文章轉述，未直接比對 Duolingo 官方考試頁]`

**Duolingo for Schools（機構／教師入口）**：**不是獨立收費產品，是免費附加功能**——老師用自己的 Duolingo 帳號開「教室」，學生用班級代碼加入，一切仍在同一個免費／訂閱的消費者 app 底下運作，機構端沒有付費關卡。這點與下面第 4 節的重大轉折直接相關。`[官方數據]` [Duolingo for Schools 說明](https://duolingoschools.zendesk.com/hc/en-us/articles/6830454446093-What-is-Duolingo-for-Schools)

---

## 2. Duolingo 學習模式：路徑、間隔重複、AI 家教

### 2.1 課程結構

課程走**線性路徑（Path）**：分成數個主題式「Section」，每個 Section 下有數個「Unit」，每個 Unit 結尾是一道「Checkpoint」關卡測驗才能往下走。每個 Unit 內是數堂短課（lesson），練習型態包含翻譯、聽力、造句、發音、詞彙。`[媒體報導，彙整自多篇第三方課程結構說明文章，未逐篇驗證是否為 2026 年最新版本]`

Duolingo 自己發布多篇「效能研究」白皮書（如比較修完 Duolingo 課程進度與正規大學課程、CEFR 等級的對應），主張學完特定 Unit 數約等同幾個學分的正規課堂時數。`[官方數據——白皮書確實存在且由 Duolingo 發布，但本文作者未能完整解析 PDF 內文逐一核對數字，列為待查證]` [Duolingo 效能研究白皮書列表](https://duolingo-papers.s3.amazonaws.com/reports/)

### 2.2 Birdbrain：個人化與間隔重複引擎

Duolingo 的核心 AI 系統叫 **Birdbrain**，前身是 2016 年發表於 ACL 的 Half-Life Regression 演算法（Settles & Meeder），用來預測一個詞彙／文法概念「記憶半衰期」還剩多久。現行版本把「該複習什麼」與「該學什麼新內容」合併進同一個模型，依每位學習者的答對／答錯／猶豫時間／距離上次練習的天數，即時決定下一題出什麼。`[媒體報導]` [IEEE Spectrum：How Duolingo's AI Learns What You Need to Learn](https://spectrum.ieee.org/duolingo)

- 規模：每天處理約 10 億次練習，每次判斷約 14 毫秒完成。`[媒體報導，多篇分析文章重複引用，數字量級一致但未見官方逐篇確認]`
- 機制：學完新內容後高頻複習，隨時間拉長複習間隔；句子裡混入舊詞彙讓學習者在「新內容」情境下也順便複習「舊內容」。`[媒體報導]`

### 2.3 Duolingo Max：GPT-4 驅動的 AI 家教功能

| 功能 | 說明 | 狀態 |
|---|---|---|
| **Explain My Answer** | 針對學習者剛才答對或答錯的題目，即時給文法規則解釋 | 2026 年 1 月起對**所有使用者**免費開放，不再是 Max 限定 `[媒體報導，待查證]` |
| **Roleplay** | 用文字或語音跟 GPT-4 驅動的虛擬角色進行情境對話練習 | 原為 Max 專屬功能 |
| **Video Call with Lily** | 跟角色 Lily 進行 GPT-4o 驅動的視訊通話對練，被形容為「最接近真人家教」的功能，對方會有表情反應、依回答難易度即時調整 | 原為 Max 專屬，2026 年內有報導稱正下放給一般 Super 訂閱者 |

目前 Roleplay／Video Call 類功能僅開放西班牙語、法語等少數課程，尚未全語言鋪開。`[媒體報導]` [TechLearning：What is Duolingo Max](https://www.techlearning.com/how-to/what-is-duolingo-max-the-gpt-4-powered-learning-tool-explained-by-the-apps-product-manager)

**跟 LingoLeap 的落差**：LingoLeap 已有的 AI 能力（朗讀流暢度評分、蘇格拉底式理解對話、重點表與聚光燈抽取）本質上更接近「對固定課程內容做深度理解評估」，Duolingo Max 的 AI 則是「開放式對話練習」——兩者解決的是不同層次的問題（精讀 vs. 口說產出），不是同一條賽道上的技術領先與落後。`[我們的推論]`

---

## 3. Duolingo 互動機制：連勝、經驗值、聯賽

### 3.1 連勝（Streak）與 Streak Freeze

- 連勝＝連續使用天數計數器，是 Duolingo 公認的核心留存機制。官方部落格記錄超過 600 次針對連勝機制本身的 A/B 測試。`[官方數據]` [blog.duolingo.com：improving the streak](https://blog.duolingo.com/improving-the-streak)
- **Streak Wager** 實驗：課程結束時提示「要不要花虛擬貨幣賭自己能撐過接下來 7 天」，結果第 1／7／14 天留存率都顯著上升，第 7 天留存提升最多（+14%）。`[官方數據]` [blog.duolingo.com：how streaks keep learners committed](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/)
- **把「連勝」與「每日目標」拆成兩個獨立機制**（原本綁在一起，完成每日目標才算連勝）：拆開後第 14 天留存 +3.3%、整體日活躍學習者 +1%、新手第 20 天仍保有連勝的比例 +19%。`[官方數據]` 同上
- **Streak Freeze**（連勝保護道具，錯過一天不會斷連勝）：第三方分析指出，持有 freeze 道具的使用者連勝存活時間到第 21 天可達沒有 freeze 使用者的 4.5 倍。`[媒體報導，待查證——出自分析部落格，未見官方原始數字]` [duolingo.deconstructoroffun.com](https://duolingo.deconstructoroffun.com/mechanics/leagues)

### 3.2 聯賽（Leagues）

每週把使用者依當週賺到的 XP 分進約 30 人一組的聯賽，組內**前段晉級、後段降級**，中間維持原級。各段晉降門檻不同：青銅組（最低段）前 20/30 名晉級；藍寶石組以上（高段）只有前 7 名晉級。`[媒體報導]` [duolingo.deconstructoroffun.com：Leagues](https://duolingo.deconstructoroffun.com/mechanics/leagues)

**設計邏輯**（分析者推論，非 Duolingo 官方自述）：刻意把比較範圍縮小到「30 人、同週剛好一起起跑」，讓多數人覺得「有機會贏」；降級機制則利用損失趨避（怕掉段）補上「怕輸」這個額外動機，跟純粹的排行榜（只有人想往上爬）不同。`[媒體報導，屬分析觀點而非官方公開設計原則]`

### 3.3 好友連勝（Friend Streak）與好友任務（Friends Quests）

- 最多可與 5 位好友各自維持一條「共同連勝」，雙方都要當天完成才算延續。有共同連勝的使用者，完成每日課程的機率提升 22%。`[官方數據]` [blog.duolingo.com：5 product lessons from building Friend Streak](https://blog.duolingo.com/product-lessons-friend-streak/)
- Friends Quests：隨機配對好友，每週共同挑戰一個目標。`[官方數據]` [blog.duolingo.com：friends & social features](https://blog.duolingo.com/friends-social-features/)

### 3.4 愛心／能量（Hearts → Energy）

早期版本答錯會扣「愛心」，愛心歸零就不能再練習，要等恢復或付費解鎖——這是典型的「懲罰性稀缺」機制。2025 年 5 月起逐步改成「能量」系統：起始 25 點能量，答錯扣 1 點，官方說法是「獎勵答對，而非懲罰答錯」的框架轉向。`[媒體報導，待查證——官方措辭轉述自分析文章]` [Lingoly：energy system guide](https://lingoly.io/energy-duolingo/)

### 3.5 Duo 與角色敘事式通知

Duo 貓頭鷹的提醒通知會隨「已連續幾天沒使用」而改變語氣與插圖表情，從鼓勵逐漸轉向更直接、擬人化的提醒。這個「以角色人格去催促使用者」的做法本身被官方在行銷上公開擁抱（甚至做成迷因素材），但也是爭議的來源（見 3.7）。`[媒體報導]`

### 3.6 官方自己公布的效果數字彙總

| 機制 | 官方量化效果 | 來源 |
|---|---|---|
| Streak Wager | D1/D7/D14 留存顯著提升，D7 +14% | `[官方數據]` blog.duolingo.com |
| 連勝與每日目標拆開 | D14 留存 +3.3%，日活躍 +1%，新手第 20 天連勝率 +19% | `[官方數據]` blog.duolingo.com |
| 好友連勝 | 完成每日課程機率 +22% | `[官方數據]` blog.duolingo.com |
| Weekend Amulet（週末連勝保護道具）| D7 留存 +2.1%，D14 +4% | `[媒體報導，轉述官方部落格數字，未逐字核對原文]` |

### 3.7 爭議：罪惡感設計、連勝焦慮、「優化出的是投入感不是學習成效」

- **連勝焦慮**：常被引用的一份「2022 年 1,500 人調查」宣稱 62% 的使用者錯過一天會感到「罪惡」、34% 對通知感到「焦慮」。這個數字被多篇評論文章重複引用，但本文作者查證後**找不到可回溯的原始調查機構與方法學說明**，只查到二手轉述。`[媒體報導，待查證——原始調查來源不明，數字可能失真或被簡化]`
- **「損失趨避優先於學習動機」的設計批評**：評論者主張，使用者維護連勝的理由，到後期往往是「怕斷」而非「想學」，情緒機轉上跟錯過社群媒體通知的焦慮類似。`[媒體報導，屬意見評論]`
- **「優化的是投入度指標，不是語言能力」**：一篇分析引用 2012–2020 年間的相關研究回顧，指出多數研究量測的是 app 設計與遊戲化元素本身，而非學習者實際語言能力的變化；且現有研究多為小樣本、短期，量的是「認得單字」而非「能不能在真實情境中使用」。另有分析者指出，Duolingo 的難度演算法可能因為「難度提高會拉低投入度指標」而不夠積極地把使用者推向真正有挑戰性的內容，形成「優化到錯的指標」（proxy metric）的問題。`[媒體報導，屬第三方分析觀點，未見 Duolingo 官方正面回應此一批評]`

---

## 4. Duolingo for Schools：教師能做什麼，以及它正在退場

**功能面（仍在服務、但不再開放新用戶）**：老師建立教室（上限 50 人／班），拿到 6 碼班級代碼給學生加入；儀表板顯示學生的 XP、學習時間、最近一次指派作業的完成狀況；老師可指派課程進度，系統依 Birdbrain 自動調整難度。`[官方數據]` [Duolingo for Schools 說明](https://duolingoschools.zendesk.com/hc/en-us/articles/6830454446093-What-is-Duolingo-for-Schools)

**重大轉折**：Duolingo **已經停止開放新的 Duolingo for Schools 帳號與新教室**，既有教室可繼續使用到 **2027 年 7 月 31 日**，之後整個功能停止服務。官方說法是：定期檢視產品與目前使用者實際使用方式是否吻合，決定把資源收斂回「核心學習體驗」；儘管主 App 持續成長，Schools 這個機構端工具一直沒有達到相稱的使用規模，團隊沒有餘力同時維運一個免費工具又持續優化主產品。`[官方數據]` [Duolingo for Schools 重要公告](https://duolingoschools.zendesk.com/hc/en-us/articles/44824545841805-Important-information-regarding-Duolingo-for-Schools)，`[媒體報導，佐證報導]` [Class Central：Duolingo is Shutting Down Its Only Classroom Tool](https://www.classcentral.com/report/duolingo-for-schools-shutting-down/)

**這件事對本研究特別重要**：Duolingo 嘗試做教師／教室入口超過十年，最後的結論是「機構端用量撐不起維運成本，收斂回核心消費者體驗」。這代表 Duolingo 自己驗證過的，是「個人自主使用」這條路線，而不是「教師主導的課堂工具」——後者正是 LingoLeap 整個產品存在的理由。這不是誰抄誰的問題，是**兩邊從根本上在服務不同的使用情境**（見第 7 節）。`[我們的推論]`

---

## 5. 角色與 IP 策略：Duo 與「世界角色」陣容

Duolingo 的品牌行銷目標極度野心勃勃：品牌行銷資深總監 Katherine Chan 在 2024 年底公開表示，公司希望讓 Duo「比米老鼠還有名」。Duo 目前（2024 年數據）在 Instagram 有 530 萬粉絲、YouTube 694 萬訂閱、TikTok 1,820 萬粉絲；執行長 Luis von Ahn 曾估計這隻貓頭鷹本身的品牌價值達「數億美元」。`[媒體報導]` [Fast Company：Duo the owl's next big act is an animated series](https://www.fastcompany.com/91621113/duo-the-owl-next-big-act-is-an-animated-series)

Duolingo 建立了一整組「世界角色」陣容，不只 Duo 一人：Lily（憤世嫉俗的紫髮少女）、Zari、Lin、Oscar（藝術老師）、Bea、Eddy、Junior、Falstaff、Lucy（特務背景、角色設定誇張）、Vikram 等，各有獨立人設與粉絲向故事。`[媒體報導]` [duoplanet：Duolingo Character Names](https://duoplanet.com/duolingo-character-names/)

2025 年起，Duolingo 與動畫工作室 Titmouse 合作推出五集動畫影集，角色們在劇情裡要爭取成為 Duo App 的「封測員」——等於把品牌角色正式延伸進娛樂內容產業（DuoTV）。`[媒體報導]` 同上 Fast Company 報導

**跟 LingoLeap「雙人 PK」文學家對手的對照**：兩者都用「一組有名字、有人設的角色」當產品的擬人化介面，但策略目標完全不同——
- Duolingo 的角色是**原創虛構卡通形象**，服務於「品牌知名度與粉絲經濟」（週邊、動畫、社群迷因），角色性格可以誇張、甚至刻意塑造「陰森/崩潰」的反差萌人設來衝社群聲量
- LingoLeap 的「文學家對手」（駱賓王、孟浩然、白居易、李清照、杜甫、蘇軾、李白）是**真實歷史人物**，PRD 明確要求區分「信史」與「傳說」內容、不得杜撰、且學生贏了之後人物的反應不可帶嘲諷意味——服務的是教育情境下的角色可信度與示範性，不是粉絲經濟
`[我們的推論，依 docs/prd/2026-10-16-pk-mode-prd.md §10.3／§16.2]`

---

## 6. LingoLeap 現況對照基準（簡述）

LingoLeap 是 B2G＋B2B 的 SaaS（政府／學校付費，教師課堂帶領使用），服務台灣國小高年級到國中學生的國語文閱讀。三個遊戲化／競賽功能分工明確、互不依賴：

| 功能 | 工程代號 | 發起人 | 時間尺度 | 計分重點 |
|---|---|---|---|---|
| 課堂搶答（UI 顯示「班級經營」）| `live_quiz` | 老師 | 單堂課（約 10–15 分鐘）| 全班同步搶答的速度與正確率 |
| **跨班賽季** | `league` | 班級擁有者（老師）發邀請／報名 | 整個賽季（以週計）| 讀既有學習紀錄算出的日常學習完成度，**刻意不比手速**；班級報名後名單鎖定，分母含 0 分不作弊 |
| **雙人 PK** | `pk` | 學生自己 | 單場約 2 分鐘、5 題 | 正確率主導（答對固定 1000 分），速度只用於同分時決勝，不額外加分 |
| 讀家記憶 | — | 學生查看自己 | 累積 | 目前只讀 `league` 的個人歷程（參加過哪些賽季、拿多少分、有沒有徽章）|

既有遊戲化基礎設施（`gamification_service.py`）已有 XP、等級、**每日連續學習天數（streak）**與對應徽章（連續 3／7／30 天）、`streak_bonus` 加成 XP——但**沒有** streak freeze（斷了就是斷了）、**沒有**好友連勝、**沒有**公開個人排行榜（跨班賽季的個人排行榜功能已被產品面明確延後，見下方待決定事項）。`[我們的推論，依 backend/app/services/gamification_service.py 程式碼與 docs/prd/2026-10-14-chinese-star-league-prd.md §9/§11]`

---

## 7. 逐項對照表

| 維度 | Duolingo | LingoLeap | 關鍵差異 |
|---|---|---|---|
| **使用者是誰** | 自我驅動的成人／自學者，多半是興趣或職涯需求 | 國小中高年級～國中學生，由老師安排使用時機 | 自主選擇 vs. 被安排 |
| **誰在推動使用** | 使用者自己（要不要打開 App 全靠自己意願）| 老師（課堂、作業、賽季報名）＋學校／家長督促 | 消費者留存 vs. 教學現場導入 |
| **個人 vs. 群體** | 以個人帳號為主，好友功能是加分項 | 以班級為最小單位，個人功能（讀家記憶）是班級活動的衍生 | 個人優先 vs. 班級優先 |
| **內容型態** | 系統演算法組裝的短句翻譯／選擇題，跨 40+ 語言可規模化生成 | 固定課綱對齊的整課課文與理解題，逐課人工／半人工製作 | 可無限生成的短項目 vs. 有限、精緻、受課綱約束的長文本 |
| **閱讀深度** | 單句、短語為主，目標是日常對話與基礎語感 | 整篇文章的理解、流暢度（速度×正確率）、字詞深究 | 廣度優先 vs. 深度優先 |
| **商業模式** | B2C 免費增值，DAU/MAU/付費轉換是北極星指標 | B2G/B2B，政府／學校付費，成功指標是教學成效與採用率，不是個人留存 | 留存驅動收入 vs. 採購驅動收入 |
| **連勝／習慣機制** | Streak + Freeze + 好友連勝，有 600+ 次 A/B 測試迭代 | 僅基礎 streak 計數＋徽章，無 freeze、無社交連勝 | 高度優化的消費行為設計 vs. 剛起步的基礎版本 |
| **排行榜** | 個人 XP 排行榜（聯賽，30 人分組）| 跨班賽季目前只做**班級平均分**，個人排行榜因「補救教學學生排名壓力」疑慮主動延後 | 個人競爭 vs. 刻意迴避個人排名 |
| **AI 對手／角色** | 原創卡通角色陣容，品牌/粉絲經濟導向 | 真實文學家分級 AI 對手，教育示範導向，嚴格區分信史與傳說 | 娛樂 IP vs. 教育可信度 |
| **機構／教師工具** | Duolingo for Schools **正在退場**（2027-07-31 終止，不再開放新教室）| 教師儀表板、班級經營、作業指派是產品核心，持續投資 | 機構工具是 Duolingo 的棄守陣地，卻是 LingoLeap 的主戰場 |
| **誠信／防弊** | 消費情境下作弊的代價低（頂多排名不準）| PRD 已明確列出「答案外洩」「完課不驗證正確性」為上線前必解決的誠信缺口——教學現場的排名/計分結果會被用於師生互動與教學決策，容錯空間更小 | 休閒容錯 vs. 教學決策容錯空間小 |

---

## 8. 結論

### (a) 值得借鏡、可對應到既有功能的具體做法

1. **「有界的參照群體」設計邏輯（借鏡聯賽的 30 人分組精神，套進跨班賽季）**——Duolingo 聯賽把比較範圍縮小到剛好能讓多數人覺得「有機會贏」的規模；跨班賽季目前的「兩班互邀、鎖定名單」已經天然具備這個精神（兩班互相邀請，規模可控），**值得保留並強化**的是「賽季結束後重新開始」的節奏感——每個賽季都是新的開始，不會因為上一季落後就永遠抬不起頭，這點可以明確寫進讀家記憶的敘事（「上一季結束了，這一季重新開始」）。

2. **版本化凍結快照的做法（跨班賽季與雙人 PK 已經在做，Duolingo 的聯賽與計分規則調整也是同一邏輯）**——Duolingo 調整聯賽門檻或計分規則不會回頭影響已經打完的那一週；跨班賽季的 `LeagueWeights` 版本化快照、雙人 PK 的 `rating_before/after` 快照，都是同一個「規則變了，歷史紀錄不會被追溯竄改」的原則。這是**雙方獨立得出的相同設計結論**，值得在內部文件裡明確點出「這是跟 Duolingo 做法趨同的最佳實踐」，增加對這個設計決策的信心，而不需要因為「好像在抄」而猶豫。`[我們的推論]`

3. **隱藏原始分數／積分，只露出相對結果**——Duolingo 的聯賽與第三方評分系統比較後，刻意選擇「保留 Elo 做配對與分級，但不給使用者看原始數字」；雙人 PK 的 PRD 已經做了一模一樣的決定（積分對學生永遠隱藏）。這點**已經落地，不需要再借鏡**，但可以確認這個決定是對的方向，往後的跨班賽季個人排行榜若真的要做，也該採用同樣的「只露相對位置／名次區間，不露絕對分數」原則（跨班賽季 PRD §6 已經是這個設計）。

4. **「拆開獎懲機制」的實驗精神**——Duolingo 發現把「連勝」跟「每日目標」拆開、各自獨立運作，比綁在一起更有效。讀家記憶如果未來要加入連續學習天數的視覺化，應該從一開始就讓「有沒有連續學習」與「這次段落有沒有通過及格線」分開呈現，不要讓學生因為某天只是分數沒過及格線、就連帶覺得「連勝也斷了」——這是用 Duolingo 已經驗證過的分離原則，避免同一個指標被兩種不同的失敗感覆蓋。`[我們的推論]`

5. **AI 對手／角色分級作為難度敘事的介面**——雙人 PK 的七位文學家分級已經是這個方向，Duolingo 用虛構角色達成同樣效果（讓「選一個對手」變成一個有情境感的決定，而不是選一個抽象的難度數字）證明了這個介面設計本身是有效的，值得繼續投資人物生平內容與美術的細緻度（PK PRD §10 已有詳細規劃）。

### (b) 不該抄，以及為什麼

1. **連勝焦慮與罪惡感通知設計**——Duolingo 自己的使用情境是「每天要重新贏回使用者的注意力」，所以需要損失趨避與擬人化催促這類高強度手段；LingoLeap 的使用者多半是**被老師安排**使用，根本不需要靠焦慮感維持每日開啟率。更重要的是，LingoLeap 既有設計哲學（讀錯字用鼓勵橙色不用紅色、落敗畫面不做喪氣視覺、未參與標中性灰字不標警告）已經是 Duolingo 這套「焦慮驅動」機制的**反面**，雙人 PK PRD 明確寫「不做連續對戰的每日簽到、能量值耗盡等留存機制」——這不是漏做，是已經主動排除。不該為了「借鏡 Duolingo」而走回頭路。

2. **稀缺性懲罰機制（舊版愛心／能量系統）**——答錯扣資源、資源歸零就不能練習，本質是用匱乏感逼使用者付費或等待。LingoLeap 是教學現場工具，學生因為沒有「能量」而不能完成老師指派的作業，會直接變成教學事故，不是單純的產品體驗問題。連 Duolingo 自己都已經在往「獎勵答對」的方向調整，更沒有理由現在才引進懲罰式設計。

3. **個人公開排行榜的預設全面開放**——跨班賽季 PRD 已經因為「補救教學學生不需要被排名」正確地把個人排行榜延後，這個判斷與 Duolingo 自家使用情境（成人自願參與，不想比較大可退出）不同——國小班級是一個學生無法選擇離開的封閉環境，排名壓力的傷害面更大。維持現有的謹慎態度是對的，不該因為「Duolingo 這樣做很成功」就重新開放。

4. **原創虛構 IP／粉絲經濟策略**——Duolingo 投入動畫影集、社群迷因經營，目標是「比米老鼠有名」，這需要跟教育內容完全脫鉤的品牌行銷資源與長期投資，而且服務的是「擴大消費者品牌聲量」這個跟政府/學校採購邏輯無關的目標。雙人 PK 選擇真實文學家而非原創吉祥物，已經是正確方向——不需要往迪士尼化的品牌路線靠攏。

5. **速度加分的計分設計**——Duolingo 多數互動情境（含其聯賽 XP）隱含「做得越多越快，分數越高」的邏輯；雙人 PK 的 PRD 已經明確反其道而行（正確率主導、速度只決勝），理由是「不該讓用猜的但手快，贏過讀懂了但手慢的同學」。這個判斷在一個以閱讀理解深度為核心價值的平台上是對的，Duolingo 式的速度獎勵邏輯不適用。

### (c) 結構性不可比，不必勉強對照

1. **成功指標的北極星完全不同**——Duolingo 是消費者習慣養成產品，DAU／MAU／付費轉換率是生死攸關的指標，需要每天重新贏得使用者的時間；LingoLeap 的使用是教學現場已經排進課表與作業的活動，「今天有沒有打開 App」不是這個商業模式裡真正要緊的數字，教學成效與學校續約才是。拿 Duolingo 的留存指標或 A/B 測試量能（單一機制跑 600+ 次測試）當作「我們也該這樣做」的標準，是在用消費者增長團隊的尺量一個 B2G/B2B 教育採購產品。

2. **內容生成的本質不同**——Birdbrain 能夠每天處理十億次練習、即時決定下一題，前提是 Duolingo 的練習項目是演算法可以大量組裝的短句與詞彙配對，跨 40 多種語言都適用同一套生成邏輯；LingoLeap 的內容單位是一整篇對齊課綱、經過教學設計審核的課文與理解題，無法像 Duolingo 一樣用演算法「無限生成更多題目」，這不是技術差距，是兩種產品在「內容是什麼」這個根本問題上的不同定義。

3. **機構工具的策略位置互換**——Duolingo for Schools 從未成為公司重心，最終在規模不如預期之下被收斂掉，驗證了「教師/教室工具」不是 Duolingo 這種大眾消費品的核心戰場；而教師儀表板、班級經營、作業指派正是 LingoLeap 存在的全部理由。這不代表 LingoLeap 的路線有風險（Duolingo 退出的是「附加在消費者 App 上的免費機構工具」，不是「專門為機構設計的產品」），但確實代表**不能把 Duolingo 在機構端的任何經驗（包含它退場的原因）直接套用**到一個從第一天就是為機構設計的產品上——兩者的機構工具解決的是完全不同層級的問題。

4. **規模與資源量級**——Duolingo 單一連勝機制就跑過 600 次以上的 A/B 測試，背後是數千萬 DAU 支撐統計顯著性所需的樣本量；LingoLeap 現階段的使用者規模（台灣國小中高年級至國中的中文閱讀學生）遠小於此，很多 Duolingo 式的「跑實驗找到最佳參數」方法論在樣本量不足的情況下無法直接套用，功能設計上更適合依賴教學專業判斷（如 PRD 中的 CTO／UIUX 審查機制）而非大量線上實驗。

---

## 附：引用來源一覽（存取日期 2026-10-16）

**官方（investors.duolingo.com / sec.gov / blog.duolingo.com / duolingoschools.zendesk.com）**
- [Duolingo 2024 10-K（SEC）](https://www.sec.gov/Archives/edgar/data/1562088/000156208825000042/duol-20241231.htm)
- [Duolingo Q2 2026 新聞稿](https://investors.duolingo.com/static-files/2ef55449-ab04-4902-a5e3-01b13d67122a)
- [Duolingo Q2 FY26 Form 8-K（SEC）](https://www.sec.gov/Archives/edgar/data/0001562088/000162828026053299/q2fy26duolingo6-30x26share.htm)
- [blog.duolingo.com：improving the streak](https://blog.duolingo.com/improving-the-streak)
- [blog.duolingo.com：how streaks keep learners committed](https://blog.duolingo.com/how-streaks-keep-duolingo-learners-committed-to-their-language-goals/)
- [blog.duolingo.com：5 product lessons from building Friend Streak](https://blog.duolingo.com/product-lessons-friend-streak/)
- [blog.duolingo.com：friends & social features](https://blog.duolingo.com/friends-social-features/)
- [Duolingo for Schools：What is it](https://duolingoschools.zendesk.com/hc/en-us/articles/6830454446093-What-is-Duolingo-for-Schools)
- [Duolingo for Schools：Important information regarding sunset](https://duolingoschools.zendesk.com/hc/en-us/articles/44824545841805-Important-information-regarding-Duolingo-for-Schools)
- [Duolingo 效能研究白皮書列表](https://duolingo-papers.s3.amazonaws.com/reports/)

**媒體報導**
- [IEEE Spectrum：How Duolingo's AI Learns What You Need to Learn](https://spectrum.ieee.org/duolingo)
- [Fast Company：Duo the owl's next big act is an animated series](https://www.fastcompany.com/91621113/duo-the-owl-next-big-act-is-an-animated-series)
- [TechLearning：What is Duolingo Max](https://www.techlearning.com/how-to/what-is-duolingo-max-the-gpt-4-powered-learning-tool-explained-by-the-apps-product-manager)
- [Class Central：Duolingo is Shutting Down Its Only Classroom Tool](https://www.classcentral.com/report/duolingo-for-schools-shutting-down/)
- [duolingo.deconstructoroffun.com：Leagues](https://duolingo.deconstructoroffun.com/mechanics/leagues)
- [duoplanet：Duolingo Character Names](https://duoplanet.com/duolingo-character-names/)
- [Lingoly：Energy system guide](https://lingoly.io/energy-duolingo/)

**本 repo 內部文件（LingoLeap 現況對照依據）**
- `docs/BRD.md`（商業模式：B2G + B2B）
- `docs/prd/2026-10-14-chinese-star-league-prd.md`（跨班賽季）
- `docs/prd/2026-10-16-pk-mode-prd.md`（雙人 PK）
- `docs/prd/2026-10-14-class-quiz-prd.md`（課堂搶答／`live_quiz`）
- `backend/app/services/gamification_service.py`（既有 XP／streak／徽章邏輯）

**待查證項目彙總**：Super／Max 確切公開售價（Duolingo 不提供單一價目表，依地區帳號浮動）、「2022 年 1,500 人調查」的原始出處與方法學、DET 應試人次與採認機構數的最新官方確認、Streak Freeze「4.5 倍」留存倍數的官方原始數據、Birdbrain 每日處理量是 10 億還是 12.5 億次練習。
