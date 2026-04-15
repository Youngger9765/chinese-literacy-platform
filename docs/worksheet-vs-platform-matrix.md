# 學習單功能 vs 平台功能對照表

> 57 篇學習單的所有功能機制，逐一比對平台覆蓋狀態
> 更新日期：2026-04-15

| 大類 | # | 功能機制 | 學習單 | 平台 | 差距 |
|---|---|---|---|---|---|
| **閱讀輸入** | A1 | 標記閱讀（?/❤/— 做記號） | 57/57 | 步驟①：ReadingAnnotation（學生點選文字標記「不懂」或「重要」） | ✅ |
| | A4 | 多文本閱讀（同主題 2~3 篇） | 2組 | 無 | ⚠️ 進階功能 |
| **朗讀流暢度** | B1 | 計時朗讀（字/分鐘） | 53/57 | 步驟②：LiveTutor + 步驟③：FullReading（AI 語音辨識即時計算 CPM） | ✅ |
| | B2 | 計時朗讀（秒，文言文） | 4/57 | 無 | ⚠️ 文言文特有 |
| | B3 | 4 次練習記錄表 | 57/57 | 步驟③：FullReading（每次朗讀自動存入 DB，不限次數，LineChart 顯示進步曲線） | ✅ |
| | B4 | 同學互評/裁判簽名 | 57/57 | 步驟②：LiveTutor（AI 語音辨識比對原文，即時顯示正確/錯誤/漏字） | ✅ |
| | B5 | 三級自我檢核（勾選） | 57/57 | 步驟③：FullReading（後端有 reading_benchmark YAML 資料 + fluencyAnalyzer.ts 解析，前端無自評 UI） | ⚠️ 缺自評 UI |
| **語詞學習** | C1 | 語詞定義配對（看定義填詞） | 53/57 | 步驟⑤：VocabDefinitionMatch（顯示定義，學生從選項中配對正確語詞） | ✅ |
| | C2 | 語詞代號填空（選代號填句子） | 53/57 | 步驟⑥：VocabApplication（從詞彙庫選代號填入句子，AI 批改） | ✅ |
| | C3 | 字海找詞（word search grid） | 53/57 | 步驟⑧：VocabWordSearch（互動式字海 grid，學生拖曳圈選語詞） | ✅ |
| | C4 | 古今詞彙對照（勾選白話意思） | 4/57 | 無 | ⚠️ 文言文特有 |
| | C5 | 一字多義辨析 | 2/57 | 無 | ⚠️ 文言文特有 |
| **文章理解** | D1 | 記敘文重點表（填空+勾選） | ~20/57 | 步驟⑦：ComprehensionChat 內嵌 StoryStructureTable（AI 生成記敘文結構表，目前僅顯示） | 🔴 有但被動 |
| | D2 | 說明文重點表（填空） | ~26/57 | 步驟⑦：ComprehensionChat 內嵌 StoryStructureTable（AI 生成說明文結構表，目前僅顯示） | 🔴 有但被動 |
| | D3 | 應用文重點表（書評格式） | 1/57 | 步驟⑦：ComprehensionChat 內嵌 StoryStructureTable（AI 生成應用文結構表，目前僅顯示） | 🔴 有但被動 |
| | D5 | 多文本比較表（跨文章比較） | 2組 | 無 | ⚠️ 進階功能 |
| **閱讀策略** | E1 | 句型/修辭（圈關聯詞、寫句子） | ~3/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（guided_steps 類型，多步驟引導填寫） | ✅ |
| | E2 | 推論（人物特質、指稱詞、主旨） | ~10/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（trait_inference 類型，從線索選正確特質） | ✅ |
| | E3 | 文章結構（故事體、主題描述） | ~8/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（guided_steps 類型，逐步拆解結構） | ✅ |
| | E4 | 表達/論證（PREP、4F、自我提問） | ~6/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（guided_steps 類型，PREP 四欄填寫） | ✅ |
| | E5 | 科學方法（假設→驗證→結論） | ~5/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（guided_steps 類型，科學方法流程表） | ✅ |
| | E6 | 圖表判讀（折線/長條/圓形/統計） | ~4/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（guided_steps 類型） | ⚠️ 學習單含會考真題 |
| | E7 | 思辨/媒體素養（假新聞、誘餌標題） | ~5/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（guided_steps 類型，判斷真偽練習） | ✅ |
| | E8 | 品格/生活（正向思考、環保、時間管理） | ~6/57 | 步驟⑦：ComprehensionChat 內嵌 StrategyExercise（guided_steps 類型，情境練習） | ✅ |
| **文言文特有** | F0 | 文白對照（閱讀排版 + 句子/語詞比對練習） | 4/57 | 無 | ⚠️ |
| | F1 | 用故事情節推測文意 | 4/57 | 無 | ⚠️ |
| | F2 | 讀懂代名詞（畫螢光筆配對） | 4/57 | 無 | ⚠️ |
| | F3 | 猜詞意（上下文推測） | 4/57 | 無 | ⚠️ |
| | F4 | 全句翻譯（選正確白話翻譯） | 4/57 | 無 | ⚠️ |
| | F5 | 讀出作者意圖 | 4/57 | 無 | ⚠️ |
| | F6 | 小試身手（另一篇短文練習） | 4/57 | 無 | ⚠️ |
| **評量** | G1 | 四選一選擇題（5題） | 57/57 | 步驟⑦：ComprehensionChat（AI 蘇格拉底式對話，5 題 3 階段引導，答錯有 Bridge 三步驟修正） | ✅ |
| | G2 | YouTube 影片延伸 | 57/57 | 步驟⑨：KnowledgeStation（嵌入 YouTube 影片播放） | ✅ |

## 統計

| 狀態 | 數量 | 說明 |
|---|---|---|
| ✅ 覆蓋或更好 | 19 | 核心功能全到位 |
| 🔴 有但需升級 | 3 | D1/D2/D3 重點表：改成互動填空+勾選，AI 批改 |
| ⚠️ 小缺口 | 11 | 文言文 6 + 多文本 2 + 自評 UI + 行字數計 + 圖表含會考真題 |

## 升級方向

### 🔴 P0：重點表互動化（D1/D2/D3）
- 現有：AI 生成答案直接顯示（StoryStructureTable）
- 改成：前端做填空+勾選 UI，AI 答案作為 reference，學生填完後 AI 批改
- 影響：53/57 篇白話文課文

### ⚠️ P1：朗讀自評 UI（B5）
- 現有：後端有 reading_benchmark YAML 資料 + fluencyAnalyzer.ts
- 缺的：前端沒有「你覺得自己讀得如何？」的三級勾選 UI
- 加在 FullReading 完成後，AI 可比對實際 CPM 給後設認知回饋

### ⚠️ P2：文言文流程（A3/B2/C4/C5/D4/F1-F6）
- 4 篇文言文課文需要完全不同的學習流程
- 短期可跳過（僅佔 7%），5/1 跟曾教授確認優先級

### ⚠️ P3：多文本比較（A4/D5）
- 2 組多文本課文需要跨文章比較功能
- 短期可跳過（僅佔 3.5%），屬進階功能
