# 國際閱讀素養平台與教學理論研究報告

> 研究日期：2026-03-13
> 研究目的：為 LingoLeap 平台（國語文閱讀學習平台）提供國際理論基礎與功能對標分析
> 適用對象：產品決策、投資人溝通、教學設計參考

---

## 目錄

1. [國際閱讀理論框架](#一國際閱讀理論框架)
2. [理論在中文閱讀的特殊適用性](#二理論在中文閱讀的特殊適用性)
3. [全球領先閱讀平台對標分析](#三全球領先閱讀平台對標分析)
4. [台灣及華語圈閱讀平台](#四台灣及華語圈閱讀平台)
5. [功能缺口與機會分析](#五功能缺口與機會分析)
6. [研究支持的教學功能建議](#六研究支持的教學功能建議)
7. [Beta 版優先級排序](#七beta-版優先級排序)
8. [參考文獻](#八參考文獻)

---

## 一、國際閱讀理論框架

### 1.1 閱讀科學運動（Science of Reading, SoR）

閱讀科學運動源自美國，是過去十年英語系國家最重要的教育改革浪潮。其核心主張是：閱讀教學應基於認知科學、神經科學、語言學的實證研究，而非傳統的「全語言」（Whole Language）直覺教學法。

**核心原則：**
- 閱讀不是自然習得的能力，需要系統性的明確教學（explicit, systematic instruction）
- 語音覺識（phonemic awareness）是閱讀的基礎門檻
- 解碼（decoding）能力必須達到自動化，才能釋放認知資源用於理解
- 結構化識字教學（Structured Literacy）是目前最有效的教學法

**對 LingoLeap 的啟示：**
LingoLeap 目前的注音教學、聽寫練習已部分呼應 SoR 的語音基礎原則。但 SoR 強調的「系統性、明確性、從簡到繁的教學序列」在我們的平台中可以更加強化——例如詞彙教學不應只是個別字的練習，應有從部件到字到詞到句的系統進程。

### 1.2 Scarborough 閱讀繩索模型（Reading Rope）

Hollis Scarborough（2001）提出的閱讀繩索模型，將熟練閱讀比喻為多條繩索交織而成的能力：

**上層繩索——語言理解（Language Comprehension）：**
| 繩索 | 說明 | LingoLeap 現有對應 |
|------|------|-------------------|
| 背景知識（Background Knowledge） | 對世界的認識 | 課文簡介（Intro） |
| 詞彙（Vocabulary） | 字詞意義 | 生字練習（VocabPractice） |
| 語言結構（Language Structures） | 句法、文法 | 造句練習（SentencePractice） |
| 語文推理（Verbal Reasoning） | 推論、批判思考 | 蘇格拉底對話（ComprehensionChat） |
| 文體知識（Literacy Knowledge） | 文類、修辭、敘事結構 | 部分涵蓋於課文簡介 |

**下層繩索——文字辨認（Word Recognition）：**
| 繩索 | 說明 | LingoLeap 現有對應 |
|------|------|-------------------|
| 語音覺識（Phonological Awareness） | 聲韻操弄能力 | 注音教學 |
| 解碼（Decoding） | 字形—語音對應 | 筆順練習 + 注音 |
| 視覺辨識（Sight Recognition） | 自動化認字 | 聽寫練習（DictationPractice） |

**關鍵發現（2024 Kambach & Mesmer）：**
多數教師過度關注下層繩索（解碼、認字），忽略上層繩索（推理、語言結構、文體知識）。這也是許多閱讀平台的通病——練字詞很多，練理解太少。

**對 LingoLeap 的啟示：**
LingoLeap 的蘇格拉底對話（ComprehensionChat）是上層繩索的核心功能，這是我們的差異化優勢。但「文體知識」和「語言結構」的教學目前較薄弱，建議強化。

### 1.3 閱讀簡約觀（Simple View of Reading, SVR）

Gough & Tunmer（1986）提出的經典公式：

```
閱讀理解 = 解碼能力 x 語言理解能力
```

任一項為零，閱讀理解就為零。兩者皆需達到足夠水準。

**SVR 在中文的擴展模型：**
中文研究者發現，標準 SVR 需要擴展兩個額外因素：
- **詞彙切分（Word Segmentation）**：中文沒有空格，讀者必須在連續字流中切分詞彙邊界
- **詞義提取（Word-Meaning Access）**：同一個字在不同詞彙中意義不同（如「花」在「花園」vs.「花費」）

此外，**閱讀流暢性（Reading Fluency）** 被發現是解碼與理解之間的關鍵中介變項——特別是對中文兒童。

**對 LingoLeap 的啟示：**
我們的朗讀功能（LiveTutor、FullReading）已涵蓋流暢性評估。但可以增加「詞彙切分」練習——例如讓學生在連續文字中標出詞彙邊界，這是中文閱讀獨有的能力需求。

### 1.4 Ehri 認字發展四階段（Phases of Word Reading）

Linnea Ehri（1996, 2014）將認字能力發展分為四個階段：

| 階段 | 英文 | 特徵 | 中文對應 |
|------|------|------|---------|
| 前字母期 | Pre-alphabetic | 靠圖片、外形猜字 | 看圖識字、認整體字形 |
| 早期字母期 | Early Alphabetic | 用部分字母-語音對應 | 開始學注音、認識部首 |
| 後期字母期 | Later Alphabetic | 完整解碼能力 | 能拼讀注音、分析字形結構 |
| 合併期 | Consolidated Alphabetic | 自動化認字、正字法映射 | 大量識字、自動化閱讀 |

**對 LingoLeap 的啟示：**
目前平台對所有學生使用相同難度的課文和練習。根據 Ehri 模型，不同階段的學生需要不同類型的教學支持。建議加入「閱讀能力分級診斷」，根據學生所處階段提供不同活動。

### 1.5 RAND 閱讀理解模型（RAND Reading Study Group, 2002）

Catherine Snow 領導的 RAND 研究小組提出閱讀理解的三因素互動模型：

```
        讀者（Reader）
       /              \
      /                \
   文本（Text） ---- 活動（Activity）
      \                /
       \              /
    社會文化脈絡（Sociocultural Context）
```

**三因素互動：**
- **讀者**：先備知識、動機、認知策略、後設認知
- **文本**：難度、結構、文類、語言特徵
- **活動**：閱讀目的（學習、娛樂、搜尋資訊）、任務要求

理解的成功取決於三者的適配（alignment）——文本難度與讀者能力匹配、活動設計與文本特性匹配。

**對 LingoLeap 的啟示：**
這個模型直接支持「適性化」的必要性。我們需要：
1. 診斷讀者能力（目前僅有 CPM 和答對率）
2. 標記文本難度（目前課文沒有分級標註）
3. 根據匹配度調整活動難度

### 1.6 互動教學法（Reciprocal Teaching, Palincsar & Brown, 1984）

四個核心策略：

| 策略 | 說明 | LingoLeap 對應 |
|------|------|---------------|
| 預測（Predicting） | 預測接下來會發生什麼 | 尚未實作 |
| 提問（Questioning） | 對文本內容提出問題 | 蘇格拉底對話（部分） |
| 澄清（Clarifying） | 釐清不理解的部分 | 蘇格拉底對話（部分） |
| 摘要（Summarizing） | 歸納段落或全文要旨 | 尚未實作 |

**研究證據：** 後設分析顯示互動教學法在閱讀理解、策略遷移、長期保留上均有顯著效果。

**對 LingoLeap 的啟示：**
我們的蘇格拉底對話已經涵蓋了「提問」和「澄清」，但缺少「預測」和「摘要」。這兩個策略可以自然融入現有流程——在閱讀前加入預測環節，在閱讀後加入摘要練習。

---

## 二、理論在中文閱讀的特殊適用性

### 2.1 中文閱讀的獨特挑戰

中文與拼音文字（英文、法文等）在閱讀認知上有根本性差異：

| 維度 | 拼音文字 | 中文 |
|------|---------|------|
| 字形—語音對應 | 字母→音素（較規則） | 字形→音節（需記憶，部分可由聲旁推測） |
| 詞彙邊界 | 空格分隔 | 無空格，需讀者自行切分 |
| 基本識字單位 | 字母（26個） | 字（常用3000+個） |
| 形義連結 | 較弱（拼音不帶義） | 較強（部首/義旁帶義） |
| 學習門檻 | 學會26字母即可開始解碼 | 需累積大量識字才能獨立閱讀 |

### 2.2 形態覺識（Morphological Awareness）在中文閱讀的關鍵角色

2025 年的跨文化後設分析（Nature 子刊）確認：形態覺識是中文閱讀理解的獨立預測因子，其影響力甚至超過語音覺識。

**三種形態覺識類型：**
1. **同形異義覺識（Homograph Awareness）**：理解同一個字在不同詞中的不同意義（如「打」在「打球」vs.「打折」vs.「打電話」）
2. **構詞覺識（Compound Awareness）**：理解詞彙的構成方式（如「書包」=「書」+「包」）
3. **部件覺識（Radical Awareness）**：理解字的部首/偏旁與意義的關係（如「氵」與水相關）

**對 LingoLeap 的啟示：**
這是最直接可行動的研究發現。建議新增「字詞家族」功能，讓學生探索：
- 同一個字在不同詞彙中的用法（同形異義）
- 詞彙的組成邏輯（構詞）
- 部首偏旁的意義系統（部件）

### 2.3 閱讀流暢性在中文的特殊地位

2023 年 Frontiers in Psychology 的研究確認：閱讀流暢性是中文兒童解碼能力與閱讀理解之間的橋樑（bridge）。

這意味著：
- 光是會認字（解碼）還不夠
- 必須達到自動化、流暢的程度，才能有效理解
- LingoLeap 的朗讀功能（CPM 追蹤）直接對應這個需求

---

## 三、全球領先閱讀平台對標分析

### 3.1 平台總覽

| 平台 | 國家 | 目標對象 | 核心功能 | 營收模式 |
|------|------|---------|---------|---------|
| Amira Learning | 美國 | K-5 | AI 朗讀聆聽 + 即時診斷 + 教師報告 | B2B 學區訂閱 |
| Lexia Core5 | 美國 | PreK-5 | 結構化識字 + 適性路徑 + 6 大閱讀領域 | B2B 學區訂閱 |
| Raz-Kids / Raz-Plus | 美國 | K-6 | 29 級分級讀本 + 朗讀錄音 + 測驗 | B2B 教師/學區訂閱 |
| ReadWorks | 美國 | K-12 | 5500+ 篇閱讀文本 + 理解練習 + 教師工具 | 免費（非營利） |
| Newsela | 美國 | K-12 | 同主題 5 級難度文本 + 標準對齊評量 | B2B 學區訂閱 |
| Epic! | 美國 | K-6 | 40000+ 電子書/影片 + AI 推薦 | B2C 家庭訂閱 + B2B |
| Lalilo | 法國 | K-2 | AI 適性語音識字 + 即時發音回饋 | B2B 學區訂閱 |
| Squirrel AI | 中國 | K-12 | 超細粒度知識圖譜 + AI + 真人教師混合 | B2C 線下學習中心 |

### 3.2 各平台深度分析

#### Amira Learning（美國）

> ⚠️ **2026-07-26 更正 + 深度研究**：原文寫「HMH 旗下」有誤——HMH 只是投資人之一，Amira 2017 由 Mark Angel / Pete Jung 創立（源自 CMU Project LISTEN 25 年研究），2024/06 與 Istation 合併且 **Amira 為存續主體**。
> 完整深度分析（商業模式 / closed-loop Claude 架構 / 中文為何不能直接移植）→ **[2026-07-26-ichinesereader-amira-study.md](2026-07-26-ichinesereader-amira-study.md)**

**最值得學習的功能：**
- **即時語音分析**：學生朗讀時，AI 即時辨識錯誤類型（省略、替換、倒讀、重複），不僅給分數，還分析錯誤模式
- **Intelligent Growth Engine（2025-2026 新推出）**：AI 自動生成每日「預估掌握度」（Estimated Mastery Level），免去傳統紙筆測驗
- **Assessment Without Testing**：在正常學習互動中持續評估，不打斷學習流程
- **教師 AI 儀表板**：每週回饋循環，AI 自動產生差異化教學建議
- **讀寫障礙篩檢**：作為早期讀寫障礙（dyslexia）的篩檢工具

**與 LingoLeap 的差距：**
- Amira 的錯誤類型分析比我們精細（我們目前主要追蹤 CPM 和正確率）
- Amira 有「在學習中評估」的能力，我們的評估目前是獨立步驟
- Amira 提供教師端的 AI 教學建議，我們的教師端功能較少

#### Lexia Core5 / PowerUp

**最值得學習的功能：**
- **Assessment Without Testing (AWT)**：專利技術，在學生練習過程中持續蒐集評量數據，不需另外考試
- **六大閱讀領域全覆蓋**：語音覺識、語音學、詞彙、結構分析、自動化/流暢性、理解——每個領域都有系統化的活動序列
- **精準適性路徑**：根據每個學生在六個領域的表現，自動調整學習路徑，可能同時在不同領域處於不同難度
- **離線教師資源**：搭配線下的教師面授材料，不是純線上學習

**與 LingoLeap 的差距：**
- Lexia 的學習路徑是多維度適性的（六個領域各自獨立調整），我們目前是線性流程
- Lexia 有離線教師資源配套，我們目前是純線上
- Lexia 的數據報告可以到學區層級，我們目前只到班級

#### Raz-Kids / Raz-Plus（Learning A-Z）

**最值得學習的功能：**
- **29 級分級系統**：從 aa 到 Z2，每級有對應的讀本、測驗、詞彙活動
- **朗讀錄音 + 教師回聽**：學生錄下朗讀，教師可以回聽評分
- **Close Reading 互動工具**：標註、畫線、筆記等批註功能
- **西語雙語支援**：同一本書提供英語和西語版本
- **代幣激勵系統**：閱讀賺代幣，用於自訂角色和太空船

**與 LingoLeap 的差距：**
- 29 級分級系統——我們的課文目前沒有精細分級
- Close Reading 工具——我們沒有文本標註/批註功能
- 朗讀錄音回聽——我們有即時 AI 分析，但教師無法回聽學生錄音

#### Newsela

**最值得學習的功能：**
- **同文 5 級改寫**：同一篇新聞/文章改寫成 5 個難度版本，確保每個學生都能讀到符合自己能力的版本
- **知識建構優先**：所有學生讀同一個主題，但難度不同——確保課堂討論時大家都有參與基礎
- **連續性分級系統**：根據評量表現自動調升難度，學生在「近側發展區」持續成長
- **標準對齊**：每篇文章都標記對應的課綱標準

**與 LingoLeap 的差距：**
- 我們沒有「同主題多難度」的文本系統
- 我們的課文沒有對齊國語文課綱能力指標
- Newsela 的持續性分級比我們更精細

#### Lalilo（法國，Renaissance 旗下）

**最值得學習的功能：**
- **近側發展區（ZPD）導向的適性學習**：AI 持續將學生維持在「不會太難也不會太簡單」的學習甜蜜點
- **即時發音回饋**：語音辨識技術提供發音錯誤的即時糾正
- **師生混合模式**：AI 負責個別化練習，但搭配教師面授的補救教學

**與 LingoLeap 的啟示：**
Lalilo 的 ZPD 概念與我們的蘇格拉底對話的三階段難度調整相呼應，但 Lalilo 是在所有活動中都實施適性化，不僅限於對話。

#### Squirrel AI（松鼠 AI，中國）

**最值得學習的功能：**
- **奈米級知識拆解**：將國中數學拆解為 30,000 個知識點，每個知識點配有文字題、動畫、投影片、短影片
- **知識圖譜**：知識點之間建立圖結構關係，根據學生數據持續迭代關係權重
- **AI + 真人教師混合模式**：AI 負責個別化練習，真人教師負責高品質短課
- **入門診斷測驗**：每位學生入學時進行詳細診斷，生成個人化學習路線圖

**與 LingoLeap 的啟示：**
Squirrel AI 的知識圖譜概念可以應用到國語文——例如將 3000 常用字建立部件關係圖，讓學生從已知字推導未知字。但 Squirrel AI 的模式是線下學習中心，與我們的純線上模式不同。

### 3.3 關鍵功能對標矩陣

| 功能 | Amira | Lexia | Raz-Kids | Newsela | Lalilo | LingoLeap |
|------|-------|-------|---------|---------|--------|-----------|
| AI 朗讀分析 | ★★★ | ★ | ★ | - | ★★ | ★★ |
| 適性難度調整 | ★★★ | ★★★ | ★★ | ★★★ | ★★★ | ★ |
| 分級文本系統 | ★★ | ★★ | ★★★ | ★★★ | ★★ | ★ |
| 理解力對話 | ★ | ★ | ★ | ★ | ★ | ★★★ |
| 詞彙系統化教學 | ★★ | ★★★ | ★★ | ★ | ★★ | ★★ |
| 寫作評估 | - | ★ | - | ★ | - | ★ |
| 教師報告 | ★★★ | ★★★ | ★★ | ★★ | ★★ | ★ |
| 遊戲化 | ★ | ★★ | ★★ | ★ | ★ | ★★ |
| 離線使用 | - | - | ★★ | ★★ | - | - |
| 聽力訓練 | ★ | ★ | ★ | - | ★ | ★★ |
| 聽寫練習 | - | - | - | - | - | ★★★ |
| 筆順/書寫 | - | - | - | - | - | ★★★ |

> ★ = 基本、★★ = 良好、★★★ = 業界領先、- = 無此功能

**LingoLeap 的獨特優勢：**
1. **聽說讀寫四合一**：沒有任何一個國際平台同時涵蓋朗讀、對話、聽寫、筆順、造句
2. **蘇格拉底對話式理解教學**：比 Amira 或 Lexia 的選擇題式理解測驗更深入
3. **聽寫練習**：這是中文教學的剛需，國際平台完全沒有
4. **筆順練習**：針對中文書寫的獨特功能

---

## 四、台灣及華語圈閱讀平台

> 📌 **2026-07-26 補**：本節漏收 **iChineseReader（爱读）**——美國 K-12 中文分級閱讀平台（2,000 讀本 / 20 級 / 對齊 ACTFL+AP），是華語圈目前規模最大的分級閱讀內容庫，深度分析見 **[2026-07-26-ichinesereader-amira-study.md](2026-07-26-ichinesereader-amira-study.md)**

### 4.1 SmartReading 適性閱讀

**開發者：** 國立中央大學學習科技研究中心
**目標對象：** 國小二年級～高中

**核心功能：**
- 動態調整難度的閱讀理解能力診斷系統（DACC）
- 五個維度的閱讀能力測評
- 個人化推薦書單
- 線上閱讀摘要的 AI 自動批改
- 閱讀歷程紀錄

**與 LingoLeap 的關係：**
SmartReading 專注於「診斷」和「推薦」，不做即時教學。LingoLeap 的教學互動性遠強於 SmartReading，但 SmartReading 的閱讀能力診斷架構值得參考。

### 4.2 品學堂閱讀理解數位學習系統

**開發者：** 品學堂（《閱讀理解》雜誌）
**目標對象：** 11-18 歲（國中～高中為主）

**核心功能：**
- 跨域多元文本庫
- 閱讀理解三大指標評量：擷取、統整、省思
- 議題標籤系統（對齊教育部 19 項議題）
- 雲端數據分析與學習歷程
- 數位班級管理

**與 LingoLeap 的關係：**
品學堂的三大指標評量（擷取、統整、省思）與 PISA 閱讀素養架構一致，也是 RAND 模型中「活動」維度的具體實踐。LingoLeap 的蘇格拉底對話可以參考這三個維度來設計問題。

### 4.3 華語圈平台特色比較

| 平台 | 核心定位 | 強項 | 弱項 |
|------|---------|------|------|
| SmartReading | 閱讀能力診斷 | 學術研究基礎紮實、分級精準 | 無教學互動、無聽說寫 |
| 品學堂 | 閱讀素養評量 | 文本品質高、對齊課綱 | 互動性低、無 AI 對話 |
| PaGamO 素養 | 遊戲化素養練習 | 遊戲化做得好 | 非專門閱讀平台 |
| LingoLeap | 聽說讀寫四合一教學 | AI 互動教學、全面性 | 分級系統、適性化待強化 |

---

## 五、功能缺口與機會分析

### 5.1 高優先級缺口（直接影響核心學習成效）

#### 缺口 1：適性難度系統（Adaptive Leveling）

**現況：** 所有學生使用同一組課文，按固定步驟學習。
**國際標準：** Lexia Core5 在六個領域各自獨立調整難度；Newsela 提供同主題五級改寫；Lalilo 持續維持 ZPD。

**建議方案：**
- **短期（Beta）**：為現有 57 篇課文標注難度等級（可參考 SmartReading 的分級方式，或使用字頻統計+句長+生字密度的公式計算）
- **中期**：根據學生的朗讀 CPM、理解答對率、聽寫正確率，自動推薦適合難度的下一篇課文
- **長期**：實現 Newsela 式的「同主題多難度」文本系統

#### 缺口 2：學習中持續評估（Assessment Without Testing）

**現況：** 評估集中在各步驟的獨立測驗中。
**國際標準：** Lexia 的 AWT 專利技術在學習過程中無感評估；Amira 的 Intelligent Growth Engine 每日生成掌握度估計。

**建議方案：**
- 在蘇格拉底對話中追蹤「理解深度指標」（表層回答 vs. 推論回答 vs. 批判回答）
- 在朗讀過程中追蹤「錯誤類型變化」（而非僅追蹤 CPM）
- 綜合所有步驟的數據，生成「六環節診斷報告」的持續更新版本

#### 缺口 3：教師端報告與教學建議

**現況：** 教師可以看到學生的學習進度和分數。
**國際標準：** Amira 每週自動生成差異化教學建議；Lexia 提供線下教師面授資源；ReadWorks 提供配套教案。

**建議方案：**
- **短期（Beta）**：在教師儀表板加入「班級弱點分析」——哪些字/哪些理解面向全班普遍薄弱
- **中期**：AI 自動生成針對班級弱點的教學建議（例如：「您班上 12 位同學在推論題表現偏弱，建議在下節課加入......」）

### 5.2 中優先級缺口（提升使用者體驗與留存率）

#### 缺口 4：摘要與預測策略

**現況：** 蘇格拉底對話涵蓋提問和澄清，但缺少預測和摘要。
**研究支持：** Palincsar & Brown 的互動教學四策略；品學堂的「擷取、統整、省思」三指標。

**建議方案：**
- 在課文閱讀前加入「你覺得這篇文章接下來會說什麼？」的預測活動
- 在蘇格拉底對話後加入「用你自己的話，簡短說明這篇文章在講什麼」的摘要練習
- AI 評估摘要品質（包含主旨、支持細節、個人觀點）

#### 缺口 5：間隔重複（Spaced Repetition）詞彙複習

**現況：** 生字練習在當次學習中完成，無後續複習機制。
**研究支持：** Ebbinghaus 遺忘曲線、Duolingo 的間隔重複演算法（ACL 2016 論文）。

**建議方案：**
- 建立「我的字庫」，追蹤每個字的學習狀態
- 根據遺忘曲線在最佳時間點推送複習
- 複習形式多樣化：聽寫、選義、造詞、造句

#### 缺口 6：重複朗讀（Repeated Reading）流暢性訓練

**現況：** 每篇課文朗讀一次。
**研究支持：** Samuels（1979）的重複朗讀法；Rasinski 的流暢性研究證實重複朗讀對認字、流暢性、理解均有顯著效果。

**建議方案：**
- 允許學生重複朗讀同一段落，追蹤 CPM 和正確率的進步曲線
- 設定「通過門檻」（例如 CPM 達到年級標準的 90%），達標後解鎖下一段
- 顯示歷次朗讀的進步圖表，增強自我效能感

#### 缺口 7：形態覺識（Morphological Awareness）訓練

**現況：** 生字練習以個別字為單位，缺少字族/構詞教學。
**研究支持：** 2025 跨文化後設分析確認形態覺識是中文閱讀理解的獨立預測因子。

**建議方案：**
- 「字族探索」功能：展示同部首的字群（如氵旁：河、海、洋、湖、淚）
- 「拆字遊戲」：將合體字拆解為部件，再用部件組合新字
- 「一字多詞」練習：同一個字在不同詞彙中的不同用法

### 5.3 低優先級缺口（長期差異化方向）

#### 缺口 8：Close Reading 文本標註工具

讓學生直接在文本上畫線、標記、加筆記。Raz-Kids 和 Newsela 都提供此功能。

#### 缺口 9：社交閱讀功能

學生之間的閱讀分享、閱讀挑戰、小組討論。Epic! 和 ReadWorks 有部分社交功能。

#### 缺口 10：家長參與端

Epic! 提供家長儀表板追蹤閱讀進度。LingoLeap 已有家長端 API，可強化報告內容。

#### 缺口 11：離線使用

Raz-Kids 和 Newsela 支援離線下載。對於偏鄉學校或家庭網路不穩定的情境有幫助。

---

## 六、研究支持的教學功能建議

### 6.1 已有理論基礎的功能升級

| 現有功能 | 理論基礎 | 建議升級方向 |
|---------|---------|-------------|
| 蘇格拉底對話 | Reciprocal Teaching (Palincsar & Brown); RAND Model | 加入預測和摘要策略；按「擷取-統整-省思」三維度分類問題 |
| 朗讀分析 | SVR; Reading Fluency as Bridge | 追蹤錯誤類型（省略/替換/倒讀）；支援重複朗讀 |
| 生字練習 | Ehri Phases; Morphological Awareness | 加入字族教學、構詞練習、間隔重複複習 |
| 聽寫練習 | SoR Phonological Awareness | 根據錯誤模式推薦針對性練習（同音字混淆、形近字混淆） |
| 造句練習 | Scarborough's Language Structures Strand | 提供句型鷹架（sentence frames），從引導到獨立 |
| 課文簡介 | RAND Model (Reader-Text-Activity) | 加入先備知識啟動活動、預測任務 |
| 六環節報告 | Scarborough's Reading Rope | 報告維度對齊繩索模型的上下層繩索 |

### 6.2 新增功能的理論依據

| 建議新功能 | 理論依據 | 預期效果 |
|-----------|---------|---------|
| 課文難度分級 | RAND Model + ZPD (Vygotsky) | 確保文本與學生能力適配 |
| 字族探索 | Morphological Awareness Research | 提升構詞能力和閱讀理解 |
| 間隔重複字庫 | Ebbinghaus Forgetting Curve | 長期記憶保持率提升 200%+ |
| 重複朗讀模式 | Samuels (1979); Rasinski | 流暢性和正確率顯著提升 |
| 摘要練習 | Reciprocal Teaching; PISA Framework | 發展文本統整能力 |
| 後設認知提示 | Think-Aloud Strategies | 發展自我監控閱讀能力 |
| 教師 AI 教學建議 | Amira's Intelligent Growth Engine Model | 縮小教師資料判讀到教學行動的落差 |

---

## 七、Beta 版優先級排序

### Tier 1：高影響力 + 低開發成本（Beta 必做）

| 優先序 | 功能 | 影響力 | 開發成本 | 理由 |
|--------|------|--------|---------|------|
| 1 | 課文難度標註 | 高 | 低 | 用公式為 57 篇課文計算難度等級，無需改 UI |
| 2 | 重複朗讀模式 | 高 | 低 | 現有朗讀功能加一個「再讀一次」按鈕 + 進步曲線 |
| 3 | 蘇格拉底對話加入摘要環節 | 高 | 中低 | AI prompt 調整 + 簡單 UI |
| 4 | 聽寫錯誤類型分析 | 中高 | 低 | 後端已有數據，增加分類邏輯即可 |
| 5 | 教師端班級弱點分析 | 高 | 中 | 聚合現有數據，新增報告頁面 |

### Tier 2：高影響力 + 中開發成本（Beta 後第一波）

| 優先序 | 功能 | 影響力 | 開發成本 | 理由 |
|--------|------|--------|---------|------|
| 6 | 間隔重複字庫 | 高 | 中 | 需新建「我的字庫」資料模型 + 複習排程演算法 |
| 7 | 朗讀錯誤類型分析 | 中高 | 中 | 需升級語音分析邏輯 |
| 8 | 適性課文推薦 | 高 | 中 | 基於難度標註 + 學生能力數據的推薦邏輯 |
| 9 | 字族探索功能 | 中 | 中 | 需建立字族資料庫 + 新 UI 元件 |
| 10 | 預測策略活動 | 中 | 中低 | AI prompt + 閱讀前 UI 環節 |

### Tier 3：中影響力 + 高開發成本（長期規劃）

| 優先序 | 功能 | 影響力 | 開發成本 | 理由 |
|--------|------|--------|---------|------|
| 11 | 同主題多難度文本 | 高 | 高 | 需 AI 改寫 + 品質控管 + 大量文本工作 |
| 12 | Close Reading 標註工具 | 中 | 中高 | 全新前端互動元件 |
| 13 | 教師 AI 教學建議 | 中高 | 高 | 需要大量教學知識的 AI 模型 |
| 14 | 離線使用 | 中 | 高 | PWA 重構 + 離線資料同步 |
| 15 | 社交閱讀功能 | 低中 | 高 | 全新社交系統 |

---

## 八、參考文獻

### 閱讀理論

1. Gough, P.B., & Tunmer, W.E. (1986). Decoding, reading, and reading disability. *Remedial and Special Education*, 7, 6-10. [Simple View of Reading]
2. Scarborough, H.S. (2001). Connecting early language and literacy to later reading (dis)abilities: Evidence, theory, and practice. In S. Neuman & D. Dickinson (Eds.), *Handbook for research in early literacy* (pp. 97-110). [Reading Rope Model](https://www.azed.gov/scienceofreading/scarbreadingrope)
3. Ehri, L.C. (2014). Orthographic mapping in the acquisition of sight word reading, spelling memory, and vocabulary learning. *Scientific Studies of Reading*, 18(1), 5-21. [Ehri Phases](https://www.aft.org/ae/fall2023/ehri)
4. RAND Reading Study Group (2002). *Reading for understanding: Toward an R&D program in reading comprehension*. Santa Monica, CA: RAND. [RAND Report](https://www.rand.org/pubs/monograph_reports/MR1465.html)
5. Palincsar, A.S., & Brown, A.L. (1984). Reciprocal teaching of comprehension-fostering and comprehension-monitoring activities. *Cognition and Instruction*, 1(2), 117-175. [Reciprocal Teaching](https://www.readingrockets.org/classroom/classroom-strategies/reciprocal-teaching)
6. Kambach, A., & Mesmer, H. (2024). Comprehension for emergent readers: Revisiting the Reading Rope. *The Reading Teacher*. [Revisiting the Rope](https://ila.onlinelibrary.wiley.com/doi/full/10.1002/trtr.2315)
7. Dehaene, S. (2009). *Reading in the Brain*. Penguin Books.

### 中文閱讀研究

8. 跨文化後設分析 (2025). Chinese morphological awareness assessment and its relation to reading acquisition. *Humanities and Social Sciences Communications*, Nature. [Meta-analysis](https://www.nature.com/articles/s41599-025-04531-6)
9. Reading fluency as the bridge between decoding and reading comprehension in Chinese children (2023). *Frontiers in Psychology*. [Fluency Bridge](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1221396/full)
10. The Extended Simple View of Reading in Adult Learners of Chinese as a Second Language (2022). *Frontiers in Psychology*. [Extended SVR for Chinese](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.846967/full)
11. 部件覺識與構詞覺識對中文閱讀理解的影響 (2019). *Frontiers in Psychology*. [Morphological Awareness](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.00054/full)

### 平台研究

12. Amira Learning — AI-Powered Intelligent Growth Engine (2025). [Amira Learning](https://amiralearning.com/)
13. Lexia Core5 — Structured Literacy Program. [Lexia Core5](https://www.lexialearning.com/core5)
14. Raz-Kids / Learning A-Z — Leveled Reading Platform. [Raz-Kids](https://www.learninga-z.com/site/products/raz-kids/overview)
15. Newsela — Adaptive Content Platform. [Newsela](https://newsela.com/)
16. Lalilo — AI Adaptive Reading (Renaissance). [Lalilo](https://www.lalilo.com/en)
17. ReadWorks — Free Reading Comprehension Platform. [ReadWorks](https://www.readworks.org)
18. Epic! — Digital Library for Kids. [Epic!](https://www.getepic.com/)
19. Squirrel AI — Intelligent Adaptive Learning System. [Squirrel AI](https://squirrelai.com/)
20. SmartReading 適性閱讀. [SmartReading](https://smartreading.net/)
21. 品學堂閱讀理解數位學習系統. [品學堂](https://learning.wisdomhall.com.tw/)

### 教學法研究

22. Samuels, S.J. (1979). The method of repeated readings. *The Reading Teacher*, 32, 403-408.
23. Rasinski, T.V. (2012). Why reading fluency should be hot! *The Reading Teacher*, 65(8), 516-522.
24. Settles, B., & Meeder, B. (2016). A trainable spaced repetition model for language learning. *Proceedings of ACL*. [Duolingo SRS](https://research.duolingo.com/papers/settles.acl16.pdf)
25. Science of Reading Components — Full Breakdown. [Lexia SoR](https://www.lexialearning.com/blog/a-full-breakdown-of-the-science-of-reading-components)

---

> 本報告由 Claude Opus 4.6 於 2026-03-13 基於公開資料研究撰寫。所有市場數據和功能描述基於各平台官方網站及公開研究論文。建議在產品決策前進行進一步的使用者訪談驗證。
