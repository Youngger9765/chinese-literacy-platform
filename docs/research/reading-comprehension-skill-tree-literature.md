# 閱讀理解技能樹與進程框架研究報告

> 研究目的：為 LingoLeap 國語文閱讀學習平台的技能樹設計提供學術依據
> 研究範圍：國際英文文獻 + 台灣中文文獻
> 研究日期：2026-04-11

---

## 目錄

1. [國際閱讀理解框架](#1-國際閱讀理解框架)
2. [台灣閱讀理解框架](#2-台灣閱讀理解框架)
3. [LingoLeap 策略序列對應分析](#3-lingoLeap-策略序列對應分析)
4. [關鍵發現與建議](#4-關鍵發現與建議)
5. [參考文獻](#5-參考文獻)

---

## 1. 國際閱讀理解框架

### 1.1 Simple View of Reading（閱讀簡單觀）

**提出者**：Philip Gough & William Tunmer（1986），Wesley Hoover & Philip Gough（1990）
**核心公式**：解碼（Decoding）× 語言理解（Language Comprehension）= 閱讀理解（Reading Comprehension）

**技能層次結構**：

| 維度 | 子技能 | 說明 |
|------|--------|------|
| 解碼（Decoding） | 字母音素對應 | 看字音讀，國語為形音對應 |
| 解碼 | 視覺識字 | 立即識別常見字詞 |
| 語言理解（LC） | 詞彙知識 | 詞義廣度與深度 |
| 語言理解 | 背景知識 | 先備知識啟用 |
| 語言理解 | 語言結構 | 句法理解 |
| 語言理解 | 語言推理 | 推論、類比 |
| 語言理解 | 文學知識 | 文體、體裁知識 |

**對 LingoLeap 的意義**：D=0 或 LC=0 都會導致 RC=0。前四個步驟（朗讀、識字、生字練習）處理解碼側；ComprehensionChat、策略練習處理語言理解側。

**來源**：[Simple View of Reading - Wikipedia](https://en.wikipedia.org/wiki/Simple_view_of_reading) | [Gough & Tunmer 1986 原文](https://link.springer.com/article/10.1007/BF00401799)

---

### 1.2 Scarborough's Reading Rope（斯卡伯勒閱讀繩索模型）

**提出者**：Hollis Scarborough 博士（2001）
**核心隱喻**：閱讀如繩索，由兩組多股細繩互相纏繞而成

**繩索結構**：

```
【上方繩股：語言理解 — 越來越策略性】
  ├── 背景知識（Background Knowledge）
  ├── 詞彙知識（Vocabulary）
  ├── 語言結構（Language Structures）
  ├── 語言推理（Verbal Reasoning）
  └── 文學知識（Literacy Knowledge）

【下方繩股：字詞辨識 — 越來越自動化】
  ├── 音韻覺識（Phonological Awareness）
  ├── 解碼（Decoding）
  └── 視覺識字（Sight Recognition）

【兩股合一 → 熟練閱讀（Skilled Reading）】
```

**進程原則**：字詞辨識從「有意識努力」→「自動化」；語言理解從「個別技能」→「策略性整合」。兩股相互依存，缺一不可。

**對 LingoLeap 的意義**：
- 注音 + 筆順練習 → 強化下方繩股
- 詞彙練習 + ComprehensionChat → 強化上方繩股
- 策略練習（10 種 strategy_type）→ 整合兩股形成熟練閱讀

**來源**：[Arizona Dept of Education - Scarborough's Rope](https://www.azed.gov/scienceofreading/scarbreadingrope) | [Really Great Reading 詳解](https://www.reallygreatreading.com/blog/scarboroughs-reading-rope)

---

### 1.3 RAND 閱讀理解框架（RAND Reading Study Group, 2002）

**提出者**：Catherine Snow 主持的 RAND 閱讀研究小組（2002）
**定義**：閱讀理解 = 「透過與書面語言的互動與參與，同時提取並建構意義的歷程」

**三角框架**：

```
         ┌─────────────────┐
         │   讀者（Reader）  │
         │ 先備知識、動機    │
         │ 認知能力         │
         └────────┬────────┘
                  │ 交互作用
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
 文本          活動          社會文化脈絡
（Text）      （Activity）     （Context）
難度、文類    任務目的        教室環境
文章結構      閱讀目標        家庭背景
```

**研究優先議題**：教學（如何促進理解）、師資培育、評量設計（自我調節的策略性閱讀）

**對 LingoLeap 的意義**：
- LingoLeap 的 7 步驟學習流程完整覆蓋了「活動」維度（有目的的朗讀、練習、提問）
- 策略練習考量了文本多樣性（記敘文、說明文、文言文、數位文本）

**來源**：[RAND 2002 完整報告](https://www.rand.org/pubs/monograph_reports/MR1465.html) | [ERIC - ED463559](https://eric.ed.gov/?id=ED463559)

---

### 1.4 Barrett's Taxonomy（巴瑞特閱讀理解分類法）

**提出者**：Thomas C. Barrett（1968，引用自 Clymer, 1979）
**特色**：同時包含認知（Cognitive）與情意（Affective）兩個維度

**五個層次**：

| 層次 | 名稱 | 說明 | 示例問題類型 |
|------|------|------|-------------|
| 1 | **字面理解**（Literal Comprehension）| 直接從文本提取資訊 | 誰？什麼？何時？何地？ |
| 2 | **重組**（Reorganization）| 分析、分類、大意歸納 | 用自己的話說出大意 |
| 3 | **推論**（Inferential Comprehension）| 運用先備知識推論 | 為什麼？接下來會？ |
| 4 | **評估**（Evaluation）| 事實vs意見、真實性判斷 | 作者說的是事實嗎？ |
| 5 | **欣賞**（Appreciation）| 情感反應、文學鑑賞 | 你喜歡這個角色嗎？ |

**對 LingoLeap 的意義**：LingoLeap 的蘇格拉底對話（ComprehensionChat）設計了 5 題，應涵蓋層次 1-4；策略練習中的品格力、自我提問對應層次 4-5。

**來源**：[Barrett Taxonomy 原文](http://www.joebyrne.net/Curriculum/barrett.pdf) | [ResearchGate 圖示](https://www.researchgate.net/figure/Barretts-taxonomy-of-reading-comprehension-levels_tbl1_370516926)

---

### 1.5 Bloom's Taxonomy 與閱讀的對應

**提出者**：Benjamin Bloom（1956）；修訂版 Anderson & Krathwohl（2001）

**六層次與閱讀理解的對應**：

| Bloom 層次 | 閱讀理解對應技能 | LingoLeap 對應 |
|-----------|----------------|---------------|
| 1. 記憶（Remember）| 提取字面訊息、識字 | 識字練習、聽寫 |
| 2. 理解（Understand）| 理解詞義、主旨大意 | 詞彙練習、ComprehensionChat |
| 3. 應用（Apply）| 運用策略解讀新文本 | 策略練習（guided_steps） |
| 4. 分析（Analyze）| 分析文章結構、因果關係 | 說明文結構、推論主旨 |
| 5. 評估（Evaluate）| 批判性思考、評估觀點 | 數位素養、假新聞思辨 |
| 6. 創造（Create）| 整合多文本、創生新意 | 多文本比較（L56, L58） |

**重要原則**：Bloom 強調層次是漸進累積的，高層次需要以低層次為基礎。

**來源**：[Bloom's Taxonomy - Wikipedia](https://en.wikipedia.org/wiki/Bloom's_taxonomy) | [PMC 完整分析](https://pmc.ncbi.nlm.nih.gov/articles/PMC4511057/)

---

### 1.6 PIRLS 閱讀理解四歷程框架

**提出者**：IEA 國際教育成就評量協會，每五年一次針對 4 年級學生（約 9-10 歲）
**兩種閱讀目的**：文學閱讀（Literary Experience）× 資訊閱讀（Acquire and Use Information）

**四個理解歷程**（由低到高）：

| 歷程 | 英文 | 台灣常用譯名 | 評量比重 | 認知要求 |
|------|------|------------|---------|---------|
| 1 | Focus and Retrieve | 直接提取 | 20% | 在文本中找到明確訊息 |
| 2 | Make Straightforward Inferences | 直接推論 | 30% | 連結多個線索做簡單推論 |
| 3 | Interpret and Integrate | 詮釋整合 | 30% | 整合全文歸納主題 |
| 4 | Evaluate and Critique | 比較評估 | 20% | 以個人/客觀角度批判文本 |

**成就水準**（PIRLS 2021）：
- **Advanced（625+）**：能比較評估複雜文本，解釋作者意圖
- **High（550+）**：能推論整合，理解較複雜說明文
- **Intermediate（475+）**：能做直接推論，理解故事架構
- **Low（400+）**：能提取明確陳述的事實

**台灣 PIRLS 表現**：台灣自 2006 年參與 PIRLS，2016 年成績因「閱讀 101」計畫顯著提升；2021 年因新冠肺炎影響略有下滑。

**對 LingoLeap 的意義**：PIRLS 四歷程是最直接對應課文本位教學的國際框架。策略練習的 10 個類別基本覆蓋四個歷程：
- 歷程 1：推論人物特質（找文本線索）
- 歷程 2：推論主旨、說明文結構（找隱含意義）
- 歷程 3：用表格整理訊息、自我提問（整合全文）
- 歷程 4：數位素養、解決問題（批判評估）

**來源**：[PIRLS 2021 Framework](https://pirls2021.org/frameworks/home/reading-assessment-framework/processes-of-comprehension/index.html) | [PIRLS 2026](https://timssandpirls.bc.edu/pirls2026/) | [台灣 PIRLS 中心](https://pisa.irels.ntnu.edu.tw/project.html)

---

### 1.7 三層次閱讀理解分類（字面 / 推論 / 評估）

**廣泛使用**的教學實踐框架，非單一提出者，整合自多位研究者

**三層次定義**：

```
層次 3：評估性理解（Evaluative Comprehension）
  → 批判性思考，形成個人觀點
  → 問：你同意嗎？作者的立場合理嗎？

層次 2：推論性理解（Inferential Comprehension）
  → 讀字句之外，用脈絡推論隱含意義
  → 問：為什麼？可能發生什麼？他的感受是？

層次 1：字面理解（Literal Comprehension）
  → 直接從文本提取明確資訊
  → 問：誰？什麼？何時？何地？
```

**來源**：[Lexia - Three Types of Comprehension](https://www.lexialearning.com/blog/3-types-of-reading-comprehension-compared-inferential-literal-and-evaluative) | [ReadLite 三層次解析](https://readlite.in/concepts/three-levels-comprehension/)

---

### 1.8 Common Core 閱讀標準進程

**機構**：美國共同核心課程標準（CCSS, 2010）
**結構**：K-12 年級螺旋式進程，設有 10 個錨定標準（Anchor Standards）

**K-6 閱讀進程摘要**（與 LingoLeap 相關部分）：

| 年級段 | 重點技能 | 對應台灣年級段 |
|--------|---------|--------------|
| K-2 | 字詞辨識、基本字面理解、故事結構（角色/場景/事件）| 一、二年級 |
| 3-4 | 推論、主旨大意、資訊文本結構、作者觀點入門 | 三、四年級 |
| 5-6 | 文章結構分析、多元文本比較、評估論點 | 五、六年級 |
| 7-9 | 批判思辨、跨文本整合、分析文學技巧 | 七至九年級 |

**標準 10（文本複雜度階梯）**：每年級提升文本難度，從基礎讀者到大學/職涯準備。

**來源**：[CCSS 官網](https://www.thecorestandards.org/ELA-Literacy/) | [CCSS 完整文件](https://learning.ccsso.org/wp-content/uploads/2022/11/ELA_Standards1.pdf)

---

### 1.9 P. David Pearson 閱讀理解進程研究

**提出者**：P. David Pearson（加州大學柏克萊分校）& David Liben
**核心發現**：閱讀理解的發展並非線性，而是透過文本複雜度的提升來驅動能力增長

**Pearson 的關鍵主張**：
- 即使是 1 年級學生也能做推論（如讀到「Henry 挖了一個洞」就能推論他用了鏟子）
- 推論能力不是高年級才開始，而是從一開始就應訓練，隨年齡增加「深度」
- 文本結構（text structure）教學是最有效的理解策略之一，研究歷史超過 40 年

**來源**：[Pearson & Liben 閱讀理解進程](https://docs.gatesfoundation.org/documents/literacyconveningprogressionofcomprehension.pdf) | [Duke & Pearson 有效實踐](https://faculty.washington.edu/smithant/DukeandPearson.pdf)

---

### 1.10 螺旋課程與策略教學序列

**理論基礎**：Jerome Bruner（1960）提出的螺旋課程（Spiral Curriculum）
**核心原則**：任何主題都可以在任何年齡以誠實的方式教授，隨年齡增長提升深度與複雜性

**閱讀策略教學的黃金序列（科學閱讀共識）**：

```
低年級（K-2）：
  └── 以字詞辨識為主，理解策略為輔
  └── 讓學生自動化解碼，認知資源才能用於理解

中年級（3-4）：
  └── 正式引入閱讀策略教學（Research 支持從 3 年級開始）
  └── 找大意、連結先備知識、預測、文章結構基礎

高年級（5-6）：
  └── 複合策略整合、自我監控（Metacognitive Monitoring）
  └── 說明文結構、多文本比較、批判性問題

國中（7-9）：
  └── 跨文類、跨學科閱讀
  └── 論證、評估、批判性思考
```

**「我做、我們做、你做」鷹架教學**（Gradual Release of Responsibility）：
1. 直接解釋策略（I Do - 教師建模）
2. 引導練習（We Do - 師生共同）
3. 獨立練習（You Do - 學生自主）

**來源**：[Keys to Literacy 策略序列](https://keystoliteracy.com/wp-content/pdfs/orc-writing/Key%20Comp%20Scope%20&%20Sequence%20v2.pdf) | [Read Naturally 理解策略](https://www.readnaturally.com/research/5-components-of-reading/comprehension)

---

## 2. 台灣閱讀理解框架

### 2.1 課文本位閱讀理解教學（CIRN/PAIR 計畫）

**主持者**：柯華葳教授（國立中央大學，後至國立臺灣師範大學）
**起始時間**：民國 101 年（2012）
**主要合作者**：曾世杰（臺東大學）、辜玉旻等
**執行機構**：全台四區閱讀教學研發中心
  - 北區：國立臺灣師範大學
  - 中北區：國立臺北市立大學
  - 中南區：國立中正大學
  - 南區：國立臺南大學

**核心理念**：以各版本教科書課文為文本，針對識字、詞彙、閱讀理解三大成分，依年齡發展設計漸進式策略教學。

**策略成分架構（四大階段）**：

```
第一階段：課文大意（低年級開始）
  ├── 刪除、歸納、主題句
  └── 以文章結構寫大意（中年級認識，高年級運用）

第二階段：推論（中年級開始）
  ├── 連結文本線索（指示詞/轉折詞）
  ├── 因果推論
  ├── 由文本找支持的理由
  └── 找不同觀點

第三階段：自我提問（四年級開始認識，高年級精熟）
  ├── 有層次的提問（事實→推論→評論）
  ├── 六何法（5W1H）
  ├── 問好奇的問題
  └── 詰問作者

第四階段：理解監控（高年級）
  ├── 偵測理解失敗
  ├── 修復策略（重讀、查找、調整速度）
  └── 後設認知覺察
```

**識字詞彙策略（一至六年級）**：

| 策略成分 | 一年級 | 二年級 | 三年級 | 四年級 | 五年級 | 六年級 |
|---------|-------|-------|-------|-------|-------|-------|
| 形音連結 | ● | ● | ○ | | | |
| 部件辨識 | | ● | ● | ○ | | |
| 組字規則 | | | ● | ● | ○ | |
| 流暢性 | ● | ● | ● | ● | ● | ● |
| 單一詞義 | | ● | ● | ● | ● | ● |
| 擴展詞彙 | | | ● | ● | ● | ● |
| 由文推詞義 | | | | ● | ● | ● |

*凡例：● 主要教學，○ 開始認識*

**自我提問的年級說明**：
- 四年級：認識「有層次的提問」，包含事實、推論、評論，但**評論層次**應在高年級學習
- 五六年級：精熟自我提問，加入理解監控

**重要說明**：教育部課文本位閱讀理解教學資料庫已於民國 111 年（2022）2 月遷移至 CIRN 平台。

**來源**：[CIRN 課文本位閱讀理解教學](https://cirn.moe.edu.tw/Module/index.aspx?sid=1198) | [PAIR 教學策略資料庫](https://pair.nknu.edu.tw/pair_system/Search_index.aspx?PN=Reader) | [ATER Journal 研究](http://www.ater.org.tw/journal/article/9-5/free/07.pdf)

---

### 2.2 柯華葳教授的閱讀理解框架

**著作**：
- 《教出閱讀力》（天下文化，2006，2017 年增修版）
- 《閱讀理解策略教學手冊》（教育部）

**閱讀歷程三大成分**：

```
┌─────────────────────────────┐
│         閱讀理解              │
│  ┌───────┐ ┌──────┐ ┌─────┐ │
│  │ 認字  │×│ 理解 │×│自我 │ │
│  │       │ │      │ │監督 │ │
│  └───────┘ └──────┘ └─────┘ │
└─────────────────────────────┘
```

**學習閱讀的兩大階段**：
1. **學習如何讀**（Learning to Read）：低年級，解碼自動化
2. **透過閱讀學習**（Reading to Learn）：中高年級，利用閱讀獲取知識

**常用策略清單**：找大意、比較自己的經驗、比較過去讀過的材料、預測、歸納和推論、描述風格和結構

**來源**：[柯華葳教授閱讀研究中心](https://www.hwaweiko.tw/) | [博客來-閱讀理解策略教學手冊](https://www.books.com.tw/products/0010478653) | [Readmoo-教出閱讀力](https://readmoo.com/book/210102822000101)

---

### 2.3 十二年國教國語文課綱閱讀學習表現

**頒布時間**：中華民國 107 年 1 月（2018）
**學習階段對照**：

| 階段 | 年級 | 閱讀學習表現代號格式 |
|------|------|-------------------|
| 第一學習階段 | 1-2 年級 | 5-I-x |
| 第二學習階段 | 3-4 年級 | 5-II-x |
| 第三學習階段 | 5-6 年級 | 5-III-x |
| 第四學習階段 | 7-9 年級 | 5-IV-x |
| 第五學習階段 | 10-12 年級 | 5-V-x |

**各學習階段閱讀重點**（依課綱）：

**第一階段（1-2 年級，5-I）**：
- 認識基本文體（故事、兒歌、童詩）
- 識字與詞義理解
- 文本中明確訊息的擷取

**第二階段（3-4 年級，5-II）**：
- 5-II-3：理解文本、圖表的重要訊息，能摘取文章大意
- 推論文章中的訊息關係（因果、時序）
- 認識說明文結構

**第三學習階段（5-6 年級，5-III）**：
- 5-III-4：理解不同文類的寫作形式及其閱讀方法
- 能分析文章架構、論點與論據
- 能跨文本整合訊息
- 開始自我監控閱讀理解

**第四學習階段（7-9 年級，5-IV）**：
- 5-IV-2：廣泛運用閱讀策略、整合不同閱讀材料
- 5-IV-4：應用閱讀策略增進學習效能，整合跨領域知識
- 5-IV-5：大量閱讀多元文本，理解議題內涵
- 批判性閱讀，評鑑文本論點

**學習內容文本類型**（跨階段）：
- 記敘文（含故事體、議題記敘）
- 抒情文
- 說明文（含圖表資料文）
- 議論文（中高年級開始）
- 應用文
- 文言文（國中階段比重增加）

**從「能力指標」到「學習表現」的轉變**：
十二年國教課綱不再使用舊課綱的「能力指標」，改以「學習表現」（認知歷程、行動能力、態度展現）+ 「學習內容」（知識材料）描述學習目標。

**來源**：[十二年國教課綱官方文件](https://www.k12ea.gov.tw/files/class_schema/%E8%AA%B2%E7%B6%B1/3-%E5%9C%8B%E8%AA%9E%E6%96%87/3-1/%E5%8D%81%E4%BA%8C%E5%B9%B4%E5%9C%8B%E6%B0%91%E5%9F%BA%E6%9C%AC%E6%95%99%E8%82%B2%E8%AA%B2%E7%A8%8B%E7%B6%B1%E8%A6%81%E5%9C%8B%E6%B0%91%E4%B8%AD%E5%B0%8F%E5%AD%B8%E6%9A%A8%E6%99%AE%E9%80%9A%E5%9E%8B%E9%AB%98%E7%B4%9A%E4%B8%AD%E7%AD%89%E5%AD%B8%E6%A0%A1%E8%AA%9E%E6%96%87%E9%A0%98%E5%9F%9F-%E5%9C%8B%E8%AA%9E%E6%96%87.pdf) | [CIRN 學習重點](https://cirn.moe.edu.tw/WebContent/index.aspx?sid=11&mid=5737)

---

### 2.4 PISA 閱讀素養三歷程

**組織**：OECD，針對 15 歲學生
**台灣參與**：自 2006 年起，由國立臺灣師範大學主持台灣 PISA 國家研究中心

**PISA 閱讀三大歷程（Process）**：

| 歷程 | 台灣常用名 | 說明 |
|------|-----------|------|
| 1 | 擷取與檢索 | 在文本中找到需要或重要的資訊 |
| 2 | 統整與解讀 | 掌握全文，正確歸納、解讀文章帶出的資訊 |
| 3 | 省思與評鑑 | 結合個人知識、經驗，以文本訊息舉證，提出自身觀點 |

**PISA vs PIRLS 的差異**：
- PIRLS：4 年級（約 9-10 歲），四歷程
- PISA：15 歲，三歷程（更強調批判與評鑑）

**2018 年 PISA 新增「互動文本閱讀」**：反映數位閱讀能力評量趨勢

**來源**：[PISA 台灣研究中心](https://pisa.irels.ntnu.edu.tw/project.html) | [品學堂 PISA 解析](https://wisdomhall.com.tw/tw/about_02.php) | [PISA 閱讀歷程](http://pisa.nutn.edu.tw/sample_tw.htm)

---

### 2.5 台灣 PIRLS 四層次提問教學實踐

**在台灣的應用**：PIRLS 四層次被廣泛轉化為教師提問策略，在台灣教學現場常見標準：

| PIRLS 層次 | 台灣教學名稱 | 問題特徵 |
|-----------|------------|---------|
| 直接提取 | 找線索 | 「文章中說…」「根據課文…」 |
| 直接推論 | 推理 | 「你覺得為什麼…」「可以推斷…」 |
| 詮釋整合 | 整合 | 「文章的主旨是…」「這篇文章想告訴我們…」 |
| 比較評估 | 評鑑 | 「你同意作者的說法嗎…」「你會怎麼做…」 |

**來源**：[翻轉教育 PIRLS 完整解析](https://flipedu.parenting.com.tw/article/009002) | [小壁虎老師的 PIRLS 提問四層次](https://2blog.ilc.edu.tw/1003/2020/04/08/pirls%E6%8F%90%E5%95%8F%E7%9A%84%E5%9B%9B%E5%80%8B%E5%B1%A4%E6%AC%A12012%E5%B9%B4%E8%88%8A%E6%96%87/)

---

### 2.6 閱讀 101 計畫與後續

**時期**：2008-2017
**主辦**：台灣教育部
**成效**：2016 年 PIRLS 成績顯著提升
**成果**：四個全國閱讀教學研發中心，大量教師培訓

**2021-2026 閱讀教育計畫**：
以「人人善用紙本與數位工具」為核心，加強數位閱讀課程，引導學生透過獨立閱讀學習，增加數位閱讀資源。

**對 LingoLeap 的意義**：LingoLeap 的數位素養策略（L39-L48）正對應台灣政策方向。

**來源**：[Chinese Taipei PIRLS 2021 Encyclopedia](https://pirls2021.org/wp-content/uploads/2022/10/Chinese-Taipei.pdf)

---

### 2.7 漢語閱讀理解的特殊性

**漢語閱讀的獨特因素**（英文無法直接套用的部分）：

1. **字形-音-義三角關係**：漢字同時攜帶形、音、義三種資訊，識字比英文更複雜
2. **詞素覺知**（Morphological Awareness）：是漢語閱讀理解的核心變數，英文研究者 Shu Hua 等人發現其重要性超過英語
3. **詞彙知識與閱讀理解的關係**：Meta 分析顯示漢語詞彙知識貢獻度與英文相似，但機制不同（語義推論路徑不同）
4. **文言文**：台灣國中課程引入文言文，增加了「閱讀距離」的技能需求

**來源**：[PMC - Chinese Reading Comprehension Meta-Analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC7013083/) | [Frontiers - Vocabulary and Chinese Reading](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.525369/full)

---

## 3. LingoLeap 策略序列對應分析

### 3.1 LingoLeap 現有策略（57 篇，55 有 strategy_exercise）

根據 YAML 資料統計，LingoLeap 的策略分佈如下：

| 策略類別 | 篇數 | 課文 |
|---------|------|------|
| 推論人物特質 | 4 篇 | L08-L11 |
| 推論主旨（文章/段落）| 3 篇 | L15-L17 |
| 說明文結構（含記敘文/倒反法/順敘法）| 7 篇 | L02, L07, L13, L14, L18-L20 |
| 自我提問 | 3 篇 | L21-L23 |
| 解決問題（含科學方法/推理/4F/PERT）| 9 篇 | L24, L32-L33, L35-L37, L49, L51, L56 |
| 用表格整理訊息 | 3 篇 | L29-L31 |
| 品格力（含換位思考/時間管理）| 6 篇 | L06, L12, L25-L28 |
| 文言文 | 3 篇 | L45-L47 |
| 數位素養（含假新聞思辨）| 5 篇 | L39-L41, L44, L48 |
| 圖表素養 | 4 篇 | L38, L52-L54 |
| 其他（複句/指稱詞/多義詞/多文本）| 8 篇 | L03-L05, L34, L42-L43, L50, L58 |

### 3.2 各策略序列的學術對應

#### 策略 1：推論人物特質（4 levels，L08-L11）

**學術對應**：
- PIRLS 歷程 2（直接推論）→ 歷程 3（詮釋整合）
- Bloom 層次 4（分析）
- Barrett 層次 3（推論性理解）
- 課文本位：推論成分第 2 階段

**四個漸進 levels 的建議進程設計**：

| Level | 難度定義 | PIRLS 對應 |
|-------|---------|-----------|
| L1 | 文本中有直接描述的特質詞 | 歷程 1（直接提取）|
| L2 | 由行為描述推論特質（一個線索）| 歷程 2（直接推論）|
| L3 | 由多個事件整合推論特質 | 歷程 3（詮釋整合）|
| L4 | 與自身/社會連結，評估特質的意義 | 歷程 4（比較評估）|

**對應課綱**：5-III（5-6 年級）核心技能

---

#### 策略 2：推論主旨（3 levels，L15-L17）

**學術對應**：
- PIRLS 歷程 3（詮釋整合）— 「整合全文歸納主題」是 PIRLS 重點
- Bloom 層次 4-5（分析→評估）
- 課文本位：大意策略 + 推論策略整合
- PISA 歷程 2（統整與解讀）

**三個漸進 levels 的建議進程**：

| Level | 難度定義 |
|-------|---------|
| L1 | 段落主旨（有主題句輔助）|
| L2 | 段落主旨（需自行歸納）|
| L3 | 全文主旨（整合多段落）|

**說明**：現行 YAML 中 L17（推論段落主旨）與 L15/L16（推論文章主旨）的排序在學術上應倒置，段落主旨應先於文章主旨。

---

#### 策略 3：說明文結構（4 levels，L13, L18-L20；含記敘文L02, L07, L14）

**學術對應**：
- PIRLS 歷程 2-3
- Bloom 層次 4（分析）
- 課文本位：「認識文章結構」→「以文章結構寫大意」
- Common Core：RI.4-6（資訊文本結構）

**常見說明文結構類型**（國際與台灣共識）：
1. 描述型（Description）
2. 序列型（Sequence）
3. 比較對照型（Compare/Contrast）
4. 因果型（Cause/Effect）
5. 問題解決型（Problem/Solution）

**四個漸進 levels 的建議進程**（基於 Wijekumar & Beerwinkle 研究）：

| Level | 說明文結構類型 | 難度原因 |
|-------|--------------|---------|
| L1 | 描述型、序列型 | 學生最熟悉，日常生活就有 |
| L2 | 比較對照型 | 需要處理兩組資訊 |
| L3 | 因果型 | 需理解隱含的邏輯關係 |
| L4 | 問題解決型 / 複合結構 | 多層次結構，需全文整合 |

---

#### 策略 4：自我提問（3 levels，L21-L23）

**學術對應**：
- 課文本位第三階段策略
- Bloom 層次 5（評估）
- PIRLS 全四歷程（視提問層次而定）
- Reciprocal Teaching（相互教學法）的核心策略之一

**三個漸進 levels（YAML 現行設計）**：

| Level | LingoLeap 策略名 | 認知要求 |
|-------|----------------|---------|
| L1 | 問好奇的問題（L21）| 啟發興趣，無認知層次限制 |
| L2 | 問重要的問題（L22）| 識別關鍵資訊 |
| L3 | 事實、感受、反思、行動（L23）| 4F 框架，四層次整合 |

**學術建議**：可考慮加入「詰問作者」（Questioning the Author）作為第 4 level，讓學生與作者對話。

---

#### 策略 5：解決問題（6 levels，L24, L32, L33, L35-L37）

**學術對應**：
- Bloom 全六層次（從記憶到創造）
- PIRLS 歷程 4（比較評估）
- PISA 歷程 3（省思與評鑑）
- 課文本位：理解監控的延伸

**YAML 現行 6 個 levels 的對應**：

| 課文 | 策略名 | Bloom 層次 |
|------|--------|-----------|
| L24 | 解決問題－用觀察證據回答科學問題 | 3 應用 |
| L35 | 推理三要素 | 4 分析 |
| L36 | 問題解決流程 | 3-4 應用/分析 |
| L37 | 科學方法思考歷程 | 4 分析 |
| L32 | PERT 表達看法 | 5 評估 |
| L33 | 4F 反思法 | 5-6 評估/創造 |

---

#### 策略 6：用表格整理訊息（3 levels，L29-L31）

**學術對應**：
- PIRLS 歷程 3（詮釋整合）
- Bloom 層次 3-4（應用/分析）
- 課文本位：組織策略

**三個漸進 levels**：

| Level | LingoLeap 策略名 | 進程設計原則 |
|-------|----------------|------------|
| L1 | 比較兩組對象（L29）| 二維表格，單一比較維度 |
| L2 | 比較後推論上位概念（L30）| 從具體比較到抽象類別 |
| L3 | 整合型表格（L31）| 複雜資訊的組織與整合 |

---

#### 策略 7：品格力（4 topics，L06, L12, L25-L28）

**學術對應**：
- Barrett 層次 5（欣賞/情意）
- PIRLS 歷程 4（批判評估的情意面向）
- 十二年國教：核心素養「道德實踐與公民意識」

**4 個主題**：
1. 換位思考（Perspective Taking）— 社會情緒學習（SEL）
2. 時間管理（Self-Regulation）— 自律能力
3. 跨文化接納（Cultural Competence）— 文化素養
4. 正向思考（Positive Psychology）— 心理韌性

**學術建議**：品格力主題更偏向「閱讀的情意目標」（Affective Domain），可參考 Mary Helen Immordino-Yang 的情感與學習研究。

---

#### 策略 8：文言文（4 levels，L45-L47）

**學術對應**：
- 課文本位：識字與詞彙延伸至古文
- 十二年國教第四學習階段（7-9 年級）的重點
- 漢語閱讀的「垂直層次」延伸（跨越時代的文本理解）

**4 個漸進 levels**：

| Level | LingoLeap 策略名 | 技能要求 |
|-------|----------------|---------|
| L1 | 文言文閱讀方法（L45）| 入門方法：斷句、對照語感 |
| L2 | 文言文判讀主語（L46）| 句法分析：省略主語的推論 |
| L3 | 文言文斷句與判讀主語（L47）| 複合技能 |
| L4 | （待設計）| 文言文主旨推論、評論 |

---

#### 策略 9：數位素養（4 topics，L39-L41, L44, L48）

**學術對應**：
- PISA 2018 新增「互動文本閱讀」能力
- 台灣 2021-2026 閱讀計畫核心目標
- Bloom 層次 5（評估）

**4 個主題**：
1. 辨別網路訊息真偽（Media Literacy）
2. 辨識誘餌式標題（Critical Reading）
3. 建立思辨超能力（Critical Thinking）
4. 假新聞思辨（Fact-Checking）

---

#### 策略 10：圖表素養（3 levels，L38, L52-L54）

**學術對應**：
- PIRLS 資訊文本閱讀（Informational Text）
- 十二年國教：「圖表文本」閱讀素養
- Common Core：RI.7（整合文字與視覺資訊）

**3 個漸進 levels**：

| Level | LingoLeap 策略名 | 技能要求 |
|-------|----------------|---------|
| L1 | 認識折線圖（L38）| 辨識圖表類型、讀取數值 |
| L2 | 認識統計圖表（L52）| 多種圖表比較、趨勢判讀 |
| L3 | 判讀統計圖（L53）/ 摘要與組織圖表（L54）| 圖文整合、批判判讀 |

---

## 4. 關鍵發現與建議

### 4.1 「課文本位閱讀理解教學」有官方技能進程文件嗎？

**結論**：**有**。CIRN 平台提供官方的「識字與詞彙策略成分與年級對照表」和「閱讀理解策略成分與年級對照表」，但這些是表格形式的對照工具，不是完整的技能樹文件。

完整文件需至 CIRN（https://cirn.moe.edu.tw/Module/index.aspx?sid=1198）下載教師手冊，或參考 PAIR 系統（已遷移至 CIRN）。

### 4.2 是否有針對漢語/國語文的閱讀理解分類法？

**結論**：**無獨立分類法**。台灣使用 PIRLS 四歷程框架最為主流，課文本位計畫的四階段策略（大意→推論→自我提問→理解監控）是台灣最接近完整分類法的本土框架，但學術文件散落於各研究者著作中，沒有單一發布的「漢語閱讀理解分類法」。

### 4.3 十二年國教如何跨年級（4-9 年級）組織閱讀能力？

**結論**：
- 4-6 年級（第二、三學習階段）：閱讀策略的建立期，重點在推論、主旨、文章結構
- 7-9 年級（第四學習階段）：批判性閱讀、跨文本整合、多元文類（含文言文）

課綱以「學習表現」而非「能力指標」描述，語言更傾向整體素養，而非離散技能。

### 4.4 LingoLeap 策略序列的學術強度評估

**優勢**：
- 完整覆蓋 PIRLS 四歷程（歷程 1-4 均有對應策略）
- 與課文本位四階段框架高度吻合
- 數位素養、圖表素養對應台灣政策方向
- 螺旋式設計（各策略類別都有 3-4 個漸進 levels）

**可強化之處**：
1. **理解監控**（Metacognitive Monitoring）未有獨立策略序列，目前散落在自我提問中
2. **詞彙深化**策略（由文推詞義、詞素覺知）可更系統化
3. **多文本整合**僅有 L56, L58 兩篇，可增加（PISA 重點能力）
4. **評估與批判**在品格力策略中有涉及，但可與數位素養更系統連結

### 4.5 建議的統一技能層次分類（供 LingoLeap 技能樹設計參考）

整合 PIRLS × Bloom × 課文本位框架，建議統一為五個主層次：

```
層次 A：基礎解碼與識字（Decoding）
  → 識字、注音、詞彙基礎
  → 對應 LingoLeap：LiveTutor, VocabPractice, WriteCharacter

層次 B：字面提取（Literal Retrieval）
  → PIRLS 歷程 1；Bloom 層次 1-2
  → 明確事實、細節提取
  → 對應 LingoLeap：ComprehensionChat（5 題中的直接題）

層次 C：直接推論（Straightforward Inference）
  → PIRLS 歷程 2；Bloom 層次 3-4
  → 因果、時序、人物特質初階、段落主旨
  → 對應 LingoLeap：推論人物特質 L1-L2、說明文結構 L1-L2

層次 D：詮釋整合（Interpretation & Integration）
  → PIRLS 歷程 3；Bloom 層次 4-5
  → 全文主旨、文章結構分析、表格整合、自我提問
  → 對應 LingoLeap：推論主旨、推論人物特質 L3-L4、說明文結構 L3-L4、表格整理

層次 E：批判評估（Critical Evaluation）
  → PIRLS 歷程 4；Bloom 層次 5-6；PISA 歷程 3
  → 數位素養、假新聞思辨、多文本比較、解決問題
  → 對應 LingoLeap：數位素養、4F 反思法、PERT、多文本比較
```

---

## 5. 參考文獻

### 國際英文來源

- Gough, P. B., & Tunmer, W. E. (1986). Decoding, reading, and reading disability. *Remedial and Special Education, 7*(1), 6-10. [Springer](https://link.springer.com/article/10.1007/BF00401799)
- Scarborough, H. S. (2001). Connecting early language and literacy to later reading (dis)abilities: Evidence, theory, and practice. In S. Neuman & D. Dickinson (Eds.), *Handbook for research in early literacy.* [Arizona DOE](https://www.azed.gov/scienceofreading/scarbreadingrope)
- RAND Reading Study Group / Snow, C. (2002). *Reading for understanding: Toward an R&D program in reading comprehension.* RAND. [完整報告](https://www.rand.org/pubs/monograph_reports/MR1465.html)
- Barrett, T. C. (1968). Taxonomy of cognitive and affective dimensions of reading comprehension. In T. Clymer (Ed.), *What is reading?* [Barrett Taxonomy PDF](http://www.joebyrne.net/Curriculum/barrett.pdf)
- Anderson, L. W., & Krathwohl, D. R. (Eds.). (2001). *A taxonomy for learning, teaching, and assessing.* [PMC 分析](https://pmc.ncbi.nlm.nih.gov/articles/PMC4511057/)
- Mullis, I. V. S., & Martin, M. O. (2019). *PIRLS 2021 assessment frameworks.* TIMSS & PIRLS International Study Center. [PIRLS 2021](https://pirls2021.org/frameworks/home/reading-assessment-framework/overview/index.html)
- Pearson, P. D., & Liben, D. (2013). *The progression of reading comprehension.* Gates Foundation. [PDF](https://docs.gatesfoundation.org/documents/literacyconveningprogressionofcomprehension.pdf)
- Common Core State Standards Initiative. (2010). *English language arts & literacy standards.* [CCSS 官網](https://www.thecorestandards.org/ELA-Literacy/)
- Chinese Taipei PIRLS 2021 Encyclopedia. [PDF](https://pirls2021.org/wp-content/uploads/2022/10/Chinese-Taipei.pdf)

### 台灣中文來源

- 柯華葳（主編）. (2010). *閱讀理解策略教學手冊.* 教育部. [博客來](https://www.books.com.tw/products/0010478653)
- 柯華葳. (2017). *教出閱讀力（增修版）.* 天下文化. [Readmoo](https://readmoo.com/book/210102822000101)
- 教育部（2018）. 十二年國民基本教育課程綱要語文領域－國語文. [官方文件](https://www.k12ea.gov.tw/files/class_schema/%E8%AA%B2%E7%B6%B1/3-%E5%9C%8B%E8%AA%9E%E6%96%87/3-1/%E5%8D%81%E4%BA%8C%E5%B9%B4%E5%9C%8B%E6%B0%91%E5%9F%BA%E6%9C%AC%E6%95%99%E8%82%B2%E8%AA%B2%E7%A8%8B%E7%B6%B1%E8%A6%81%E5%9C%8B%E6%B0%91%E4%B8%AD%E5%B0%8F%E5%AD%B8%E6%9A%A8%E6%99%AE%E9%80%9A%E5%9E%8B%E9%AB%98%E7%B4%9A%E4%B8%AD%E7%AD%89%E5%AD%B8%E6%A0%A1%E8%AA%9E%E6%96%87%E9%A0%98%E5%9F%9F-%E5%9C%8B%E8%AA%9E%E6%96%87.pdf)
- CIRN 課文本位閱讀理解教學. [CIRN 平台](https://cirn.moe.edu.tw/Module/index.aspx?sid=1198)
- PAIR 課文本位閱讀理解與教學資料庫. [PAIR（已遷至 CIRN）](https://pair.nknu.edu.tw/pair_system/Search_index.aspx?PN=Reader)
- 台灣 PISA 國家研究中心. [NTNU PISA](https://pisa.irels.ntnu.edu.tw/project.html)
- 翻轉教育（2022）. PIRLS 最完整解析：用四層次提問掌握閱讀理解關鍵. [翻轉教育](https://flipedu.parenting.com.tw/article/009002)

---

*本文件由 LingoLeap 技術團隊依學術文獻整理，僅供內部設計參考。*
*最後更新：2026-04-11*
