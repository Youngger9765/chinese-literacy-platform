---
date: 2026-07-26
type: competitive-research
title: iChineseReader × Amira Learning 深度研究 — 「中文版 Amira」這句話對在哪、錯在哪
trigger: 冠緯 7/26 Slack 分享 ichinesereader.com + amiralearning.com「這 project 就是在做中文的 Amira」
supersedes-partially: docs/research/international-reading-platforms-analysis.md（2026-03-13，Amira 僅一段、無 iChineseReader）
---

# iChineseReader × Amira Learning 深度研究

**結論一句話**：冠緯的比喻方向對，但 Amira 真正在賣的不是 AI 家教，是**州法規定要做的法定評測**——我們要抄的是它的商業錨點和 closed-loop LLM 架構，不是它的 ORF 量尺（中文根本沒有 WCPM 這個東西，那是我們得自己定義的空白）

---

## 一、兩個平台在做完全不同的生意，別混在一起看

| | iChineseReader（爱读） | Amira Learning |
|---|---|---|
| 本質 | 中文分級**內容庫 + 班級管理** | 英/西文**朗讀評測 + AI 家教** |
| 母體 | Nan Hai (USA) Co. Inc.（出版社美國分支）| CMU Project LISTEN（1990 起 25 年研究）→ 2017 創立 |
| 規模 | ~~2,000 讀本~~ → **1,000–3,000 本區間**（7/26 更正：廠商自己四個來源四個數字，見 feature-map §2.6）/ 20 級 / 每週上新 10-15 本 | 5.5M 學生、4,000+ 學區、~15% K-12 市佔 |
| 錢從哪來 | 學校/個人訂閱（按人數報價，無公開定價）| 學區 outcomes-based 合約（併 Istation 後 1,800+ 學區）|
| 資金 | 出版社自有 | $40M+（Owl Ventures / HMH / Google Assistant Fund / Alexa Fund）|
| AI 的位置 | **加值配件**（AI LessonPlan 自動出教案）| **產品本體**（語音辨識 + Claude 理解對話）|
| 護城河 | 內容產能 + ACTFL 展會/學區通路 | 11B 字兒童朗讀語料 + 州級 screener 認證 + ESSA 證據 |
| 弱點 | App Store 3.2★(133 評)＝軟體體驗差；口說只有錄音沒自動評分 | 只做英/西文；不碰漢字 |

### iChineseReader 該記的細節
- 20 級對齊 **ACTFL proficiency + Common Core + AP Chinese**（不是自己發明的級距，這是它能進學區的門票）
- 評測有 **Level Placement Test / Mandarin Running Record / CAT 適性測驗 / Level-to-Level Test / IB Speaking**——名目齊全，但公開資料查不到任何「自動語音評分」證據，Running Record 極可能仍是**老師人工標記**（它的 running-records 頁面無實質說明）
- 簡繁可切、可開關拼音、專業配音、家長免費帳號
- 客群是**美國 K-12 中文（immersion / heritage / CSL）**，不是台灣國教。它的內容是「用中文學科學社會」，不是課本課文

### Amira 該記的細節
- **20 分鐘掃全班**完成朗讀流暢度 + **讀寫障礙風險篩檢**，自動產生 running record（免除人工評分偏誤）
- 效果證據硬：Columbia CPRE「約 30 次 session ≈ 人類家教」；低收入族群效果量 **1.14–1.82**；ESSA Level II（Louisiana 12 學區）；Michigan 2026 核准為 K-3 screener
- Istation 併入後帶來 **ISIP 電腦適性評測**（PreK-3 / 4-8），直接嵌進 HMH Into Reading 核心教材
- 2025-26 推 **Intelligent Growth Engine**：評測→教學→家教收成一個迴圈，每日更新「預估掌握度」，CEO 定位是「老師的 co-pilot」
- ~~已在 20 國 18 語言~~，2026/01 拿到**約旦教育部國家級**案子
  > **7/26 更正（實機+官方頁推翻）**：「18 語言」出自一則 LinkedIn 二手摘要（E2），且**未經核實**。Amira 官方產品頁與官方介紹影片皆明寫**教學語言只有英文與西班牙文**（"100% bilingual in English and Spanish"，E3）。「20 國」屬市場足跡數字，與教學語言是兩件事，**原始來源仍待核**。國際案（北愛爾蘭、約旦）走的都是英語

---

## 二、最有價值的一條情報：Amira 用 Claude，但**不即時 inference**

Anthropic 官方案例寫得很清楚（值得全隊讀一次）：

> Claude **離線預先生成**幾十條可能的回應路徑 → Amira 人工審過、curate → 學生互動時**只從審過的池子裡挑**，不做即時推論。學生資料不出自家基礎設施、不給外部 AI、不進公開訓練。

分工是：
- **傳統兒童語音辨識**（自研，11B 字語料）→ 聽學生唸
- **Claude** → 只做三件事：出理解對話題、把文本對應到理解技能、生成提示與回應路徑

為什麼這條重要：**我們現在最貴的成本就是「即時 LLM 輸出不可控」**——聚光燈/重點表要 content evidence gate、朗讀要 eval、換 model 要跑 A/B、判斷欄要 reasoning field 才能稽核。Amira 用「離線生成 + 人審 + 池中選」把這個問題**從架構上消掉**，同時順手解掉 FERPA。這是一個成熟團隊在同一個坑裡摸了三年給出的答案，可以直接拿。

Amira 首席 AI 科學家 Ran Liu 的說法也印證我們的路線：他們**字詞辨認（foundational）早就做得很好，卡住的是理解（comprehension）**，LLM 出現才解得開。我們的蘇格拉底對話正好是打這一塊——方向沒錯，只是我們用即時，他們用預生成。

---

## 三、「中文版 Amira」哪裡不能直接搬 — 中文的量尺是一片空白

Amira 整套建立在兩個英文特有的地基上：
1. **WCPM**（words correct per minute）——業界公認的流暢度量尺
2. **音素解碼（phonics）**——字母→音素對應，可拆解、可診斷、可篩 dyslexia

中文兩個都沒有。取而代之的是：字形音義三重對應、破音/多音字、注音（台灣）vs 拼音、聲調、**沒有空格所以詞界要靠讀者切**。

所以「做中文的 Amira」真正的技術題目不是移植，是**定義中文的等價量尺**：

| 英文 Amira | 中文對應（需要我們自己建） | 我們現況 |
|---|---|---|
| WCPM | 每分鐘正確**字**數（不含標點）| ✅ 已有 deterministic DP scorer + CPM |
| 錯誤類型分析（省略/替換/倒讀/重複）| 加上中文獨有：**破音字錯 vs 不認識字** | ❌ 只有正確率 |
| 音素解碼診斷 | **注音↔字雙向診斷**（能唸不能寫 / 能寫不能唸）| 部分（聽寫 + 筆順分開，未交叉診斷）|
| 韻律/停頓 | **斷句/詞界切分**——中文沒空格，斷得對＝真的懂句法 | ❌ 完全空白 |
| Dyslexia screener（州法要求）| 台灣的識字困難篩檢（已有本土研究基礎，docs/research 內有幾篇）| ❌ |

**斷句這一項我認為是最有機會的原創點**：英文評測沒有這個維度（有空格所以不需要），但中文唸得快不代表懂，**斷句錯就是句法沒解析對**——這是一個中文獨有、可自動量測、且直接對應理解力的訊號。全世界沒人做。

還有一塊：我們有 10 課**文言文**。文言文的朗讀量尺（斷句幾乎是唯一指標）零競爭者。

---

## 四、跟我們的關係 — 三層盤點

### L1 已經在做的（別當新發現）
朗讀 deterministic 評分（58%→98% 已修）、蘇格拉底理解對話、DOCX→線上抽取（聚光燈/重點表）、教師班級/作業 CRUD、遊戲化、家長帳號、OMO 紙本線上。

### L2 ~~直接抄 Amira，高 ROI 且不需要新研究~~ → **舊研究早已提出，本次只是補證據**

> **7/26 更正（Gate 0 失敗）**：下列第 2、3、4 項**不是本次的新發現**。`international-reading-platforms-analysis.md`（2026-03-13）`:204-209` 已寫 Amira 的 Estimated Mastery / AWT / 教師 AI 建議 / dyslexia 篩檢，`:363-380` 已把「掌握度估計」與「教師教學建議」明列為我們的缺口，`:353-361` 已提適性難度與課文分級。**我沒先讀自家既有研究就把它們當新發現端出來**（諷刺的是我在同一天寫下「Gate 0 先讀既有研究」這條規則）。
> 本次**真正新增**的只有兩項：① Amira 的 **Claude closed-loop 預生成架構**（來自 Anthropic 案例，舊研究沒有）② **iChineseReader 對照**（舊研究完全沒收這家）。

1. **closed-loop 預生成回應池取代即時 LLM**（先從理解對話這條路試）→ 一次解掉可控性 + QA 成本 + 成本 + 隱私 —— ✅ **本次新增**
2. ~~跨課的掌握度估計~~ → **舊研究已提（`:363-380`），本次只是加上「iChineseReader 也有 Skill Point 報表」這條佐證，且它一直沒被做**
3. ~~老師端從 dashboard 升級成 alert~~ → **舊研究已提（`:371`「每週自動生成差異化教學建議」）**
4. ~~分級/placement~~ → **舊研究已提（`:250`「我們的課文沒有對齊國語文課綱能力指標」），仍未做**

> 這四項的**真實狀態是「舊研究指出的缺口延續 4 個月未動」**，不是「新發現的機會」。當成新發現會低估它已經被擱置多久。

### L3 中文獨有、Amira 做不到（真正的差異化 + 研究題目）
破音字診斷 · 斷句/詞界作為理解指標 · 注音↔字雙向診斷 · 文言文朗讀量尺 · 台灣國語口音通融（曾教授已給清單：前後鼻音/捲舌/兒化）

---

## 五、商業判斷（給 Young）

**1. 兩場戰都不要打**
- 不跟 iChineseReader 打**內容廣度**（出版社 30 年產能 + 每週上新 10-15 本 + ACTFL 通路）
- 不跟 Amira 打**語音模型**（11B 字語料 + $40M + CMU 25 年）

**2. Amira 的模式證明了一件對我們最有用的事：評測 > 練習**
學區買 Amira 不是因為 AI 家教好玩，是因為**州法要求 K-3 做 dyslexia screening**，而人工 running record 一個學生要坐下來測 5-10 分鐘。Amira 把它壓到「全班 20 分鐘」——它賣的是**取代老師手工做、且非做不可的事**。

我們現在的敘事是「AI 幫學生練」（nice to have）。該補上「**AI 幫老師省下 X**」（must have）。我們手上已經有這個素材：老師手工做學習單、手工聽學生朗讀、手工批改——OMO 那條線本來就是這個故事，只是沒被講成商業錨點。

**3. 我們唯一無人競爭的位置是三者交集**
台灣國教課本對齊 × 繁中注音朗讀評測 × 老師學習單 OMO。iChineseReader 有中文沒評測、Amira 有評測沒中文、SmartReading 有台灣沒朗讀。

**4. 時間窗不是無限**
~~Amira 已在 20 國 18 語言、拿到約旦教育部國家級案。它要做中文的話，語料 pipeline 和學區通路都現成。~~

> **7/26 更正**：Amira 教學語言只有英文與西文（E3 官方產品頁 + 官方影片），**連第三個拼音語言都還沒做**，跨到漢字比原判斷遠得多。而且它的核心資產是**音素層級**（phone level）分析——中文沒有這一層等價物，遷移成本高。近程壓力其實來自 **iChineseReader 加語音評分**（它已有 CCRA 15 子技能 + 中文內容庫，只缺語音），不是 Amira 進中文。⚠️「12 個月內不會進繁中」是**推論不是觀察**，不得當證據用

我們的護城河**只能是「繁中台灣國教深度 + 已經在教室裡的老師關係」，不會是技術**。

---

## 六、給實習生的引導問題（不給答案，讓他們自己撞）

Young 出的題是「看到這樣的網站你會思考什麼 + AI 能做什麼」。建議用這幾問逼他們從「做產品」跳到「想產品」：

1. **這網站的錢從哪來？誰簽那張採購單？**（學生？老師？學區？還是州政府的一條法規？）
2. **它最貴的資產是哪一項？如果我有 AI，哪一項會變便宜、哪一項不會？**（提示：內容產能不會、學區通路不會、人工評測會）
3. **Amira 為什麼選「離線預生成 + 人工審」而不是即時 LLM？**（這題答得出來就懂什麼叫工程權衡）
4. **中文的 WCPM 是什麼？誰定義過？如果沒人定義過，那是威脅還是機會？**
5. **同一個功能，老師省下 30 分鐘 vs 學生多練 30 分鐘，哪個比較賣得掉？為什麼？**

---

## 七、行動建議

- [ ] **P0**：拿方大哥的老師帳號實際走一遍 iChineseReader，驗證 Running Record 到底有沒有自動語音評分（本報告最大的未驗證項——公開資料查不到，這決定它是不是真的競品）
- [ ] **P0**：closed-loop 預生成架構做一個 spike（先挑理解對話一課），量「可控性 + 成本 + QA 工時」三個數字對比現在的即時方案
- [ ] **P1**：斷句/詞界作為理解指標 — 開研究 issue，先看 158 課現有朗讀錄音能不能抽出斷句訊號
- [ ] **P1**：跨課掌握度估計（縱貫曲線）— 產品規格，這是老師端最缺的東西
- [ ] **P2**：把「AI 幫老師省下什麼」寫進對外敘事（下次教授會/方大哥會用）
- [ ] **P2**：課文綁台灣國語文課綱能力指標（3/13 研究已提，仍未做）

---

## 八、誠實的驗證邊界

- **未實機驗證**：本報告所有功能描述來自兩家官網、Anthropic 官方案例、App Store、以及一篇第三方評測（alllanguageresources 4.5★）。**沒有登入任何一家實際操作**——iChineseReader 的「Running Record 是否自動評分」「AI LessonPlan 實際輸出品質」都還是推測
- **定價查不到**：iChineseReader 按人數線上報價（`info.ichinesereader.com` 當下 503、憑證過期）；第三方評測提到 $7.99（推測是個人月費）；Amira 完全不公開，走學區合約
- **效果量數字**引自 Amira 自家研究頁與第三方摘要，未讀原始論文
- 帳密提醒：方大哥在 Slack 貼的那組老師帳密**不要寫進任何 repo / 文件**

## 來源

- [iChineseReader 官網](https://ichinesereader.com/) · [功能說明](https://ichinesereader.com/help/en/Features.html) · [App Store](https://apps.apple.com/us/app/ichinesereader/id981086933) · [第三方評測](https://www.alllanguageresources.com/ichinesereader/)
- [Amira Learning 官網](https://amiralearning.com/) · [Amira Tutor](https://amiralearning.com/amira-tutor) · [研究頁](https://amiralearning.com/research) · [Intelligent Growth Engine](https://amiralearning.com/newsroom/amira-learning-unveils-ai-powered-intelligent-growth-engine)
- [Anthropic × Amira 案例（closed-loop 架構）](https://claude.com/customers/amira)
- [HMH Amira 產品頁](https://www.hmhco.com/programs/amira) · [Amira × Istation 併購](https://www.prweb.com/releases/amira-learning-merges-with-istation-establishing-a-dynamic-leader-in-ai-driven-education-302169157.html) · [Forbes 報導](https://www.forbes.com/sites/rayravaglia/2024/06/11/amira-learning-and-istation-merge-expanding-k-12-ai-solutions/)
- [Project LISTEN（CMU 起源）](https://en.wikipedia.org/wiki/Project_LISTEN) · [Evidence for ESSA](https://www.evidenceforessa.org/program/amira/) · [Michigan K-3 screener 核准](https://www.prnewswire.com/news-releases/michigan-department-of-education-approves-amira-learning-as-top-screener-for-k-3-302676119.html) · [約旦教育部案](https://www.prnewswire.com/news-releases/ministry-of-education-of-jordan-begins-transformative-national-literacy-initiative-using-amira-learning-302674057.html)
