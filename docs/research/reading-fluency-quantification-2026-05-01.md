# 閱讀流暢度量化研究 — 平台實作指南

> **Per Young's directive 2026-05-01**：
> 「念順順 4 次計時」要提供流暢度啊！要量化啊！

> **Scope**：把「念順順 4 次計時」紙本流程升級為平台量化系統。對齊曾世杰教授（國立臺東大學特教系）+ Science of Reading（NRP 2000 / Hasbrouck-Tindal 2017 / LaBerge-Samuels 1974）的實證框架。

---

## TL;DR — 5 個結論（可直接給陳教授看）

1. **流暢度 = 速度 × 準確度 × 韻律**（NRP 2000 三要素）。平台目前只有 `cpm` + `accuracy`，缺**韻律（prosody）**和**自我修正率（self-correction）**。
2. **計算公式對齊國際**：`CWPM = (總字數 − 錯字 − 漏字 − 替換字) / 朗讀秒數 × 60`。平台 `fluencyAnalyzer.ts` 已用 `correctCount/durationSec*60`，公式一致；但 `correctCount` 沒扣 self-correction（學生唸錯後自己改回來算對還算錯？目前沒明確規則）。
3. **Grade-aware threshold 已存在 lesson YAML**（`reading_benchmark.levels`），但**前端 hardcode 了 `FULLREADING_CPM_PASS = 120`** 在 `personaConfig.ts`，**完全沒用 lesson 自帶的三級門檻**（G4: 190/220/221、G5: 200/230/231、G6: 210/240/241、G7-G9: 220/250/251）。這是最大缺口。
4. **曾世杰的「重複計時 + 自我紀錄」是平台「念順順 4 次」的學理依據**（晨讀 10 分鐘練習本設計）。但目前平台**沒儲存「第幾次練習」+「進步曲線」**，學生看不到自己跑了幾次、進步多少。
5. **Tseng et al. (2011) 結構方程模式驗證**：聲韻覺識 + 唸名速度 + 流暢性 → 共同預測中文閱讀理解。流暢性是最強的單一預測因子（中譯：要提升閱讀理解，先提升流暢度）。這支撐 Young 的核心設計：先把流暢度量化做扎實。

---

## 一、研究文獻（6 篇，按重要性排序）

### 1. Tseng, Chien, & Lin (2011) — 中文流暢性對閱讀理解的影響

- **論文**：聲韻覺識、唸名速度和流暢性對中文閱讀理解的影響：結構方程模式與增益效度之探究
- **作者**：曾世杰（臺東大學特教系）等
- **URL**：https://nccur.lib.nccu.edu.tw/bitstream/140.119/99725/1/34(1)-1-28.pdf
- **被引**：Google Scholar 12+
- **核心**：用 SEM 證明「聲韻覺識 + 唸名速度 + 流暢性」三者共同預測中文閱讀理解，**流暢性是最強路徑係數**。增益效度顯示流暢性對理解的解釋力超越識字量本身。
- **平台應用**：閱讀理解差的學生，先回去練流暢度（不是直接做 ComprehensionChat）。

### 2. 曾世杰《有效讀寫》/《晨讀 10 分鐘：漫畫語文故事集》

- **URL**：https://readmoo.com/book/210151436000101 ｜ https://www.books.com.tw/products/0010863262
- **核心**：每課練習本內含「**重複計時、自我紀錄進步**」流程 — 學生自己拿碼錶讀，記錄第 1/2/3/4 次秒數或字/分，畫進步曲線。
- **平台應用**：「念順順 4 次計時」就是這個設計的數位版。**必須**把每次秒數/CPM 存下來，畫成進步圖給學生看。

### 3. NRP (2000) National Reading Panel — 流暢度三要素

- **URL**：https://www.nichd.nih.gov/sites/default/files/publications/pubs/nrp/Documents/ch3.pdf
- **核心**：流暢度 = **速度（rate）+ 準確度（accuracy）+ 韻律（prosody）** 三要素。Prosody 包含語調、停頓自然度、句子重音。平台目前只量化前兩個。
- **平台應用**：第二期可加 prosody 評分（Vertex AI Gemini 2.5 已能聽 prosody）。

### 4. Hasbrouck & Tindal (2017) — 英文 ORF 國際常模

- **URL**：https://www.readingrockets.org/topics/fluency/articles/fluency-norms-chart-2017-update
- **常模 50th percentile WCPM**：G1=29-60、G2=50-100、G3=83-112、G4=94-133、G5=121-146、G6=132-146（Fall→Spring）
- **判定規則**：學生**比 50th percentile 低 10 個字以上** → 需要流暢度介入。
- **平台應用**：英文 norm 不可直接用於中文（中文一字一音節、英文一詞多音節），但「低 50th percentile 10 字以上 = 介入」這個判讀邏輯可移植。

### 5. 大腦與學習實驗室（臺師大）— 中文流暢性測驗常模

- **URL**：https://sites.google.com/view/brainlearninglab/%E6%B5%81%E6%9A%A2%E6%80%A7
- **中文 G2+ 門檻**：脈絡版（有故事情境）≥ 120 字/分、隨機版（字隨機排列）≥ 80 字/分
- **工具**：「小豆子」測驗 — 配對脈絡版 vs 隨機版測流暢度
- **平台應用**：120 字/分 是「**最低底線**」（G2 以上若達不到 = 高風險），不是優秀標準。平台 hardcode 的 `FULLREADING_CPM_PASS = 120` 等同於「不能更低」，但對 G6/G7 學生來說 120 字/分過低（lesson YAML 寫 210-241 才算優）。

### 6. 洪儷瑜《常見字流暢性測驗》(2007)

- **URL**：https://www.airitilibrary.com/Publication/alDetailedMesh?docid=16094905-201206-201208240003-201208240003-247-276
- **核心**：5 個版本（B1/B2/B34/B57/B89）對應一年級到九年級，每版 60 字。識字量百分等級 25 以下 = 識字困難高危險群。
- **平台應用**：可作為 G1-G3 低年級流暢度入口診斷工具（目前平台只有 G4+）。

### 7. LaBerge & Samuels (1974) — 自動化理論

- **URL**：https://psycnet.apa.org/record/1974-29172-001
- **核心**：流暢度 = 解碼自動化釋放認知資源 → 留給理解。讀得不夠快 → 認知資源全花在認字 → 沒餘力理解。
- **平台應用**：理論支撐「念順順 4 次」的存在意義 — 不是為了快，是為了**自動化**，讓 ComprehensionChat 真的能聚焦理解。

### 8. Scarborough's Reading Rope (2001)

- **URL**：https://dyslexiaida.org/scarboroughs-reading-rope-a-groundbreaking-infographic/
- **核心**：閱讀 = 字詞辨識（聲韻、解碼、視知）× 語言理解（背景知識、詞彙、句法、推論、文體）兩股繩交織。流暢度是字詞辨識三股**自動化**後的產物。
- **平台應用**：平台架構的學理大圖。Young 可放教授簡介。

---

## 二、曾教授的 fluency framework（platform-relevant 部分）

### 2.1 量化指標（平台應該收集）

| 指標 | 公式 | 平台目前 | 缺口 |
|------|------|---------|------|
| **CWPM**（正確字/分） | (總字 − 錯 − 漏 − 替) / sec × 60 | ✅ `fluencyAnalyzer.cpm` | self-correction 沒區分 |
| **Accuracy %** | 正確字 / 總字 × 100 | ✅ `fluencyAnalyzer.accuracy` | — |
| **Self-correction rate** | (學生唸錯後自己改回的字 / 總錯字) | ❌ 無 | LiveTutor 可加，從 transcript 序列檢測 |
| **Pause patterns** | 卡頓位置、長度（停頓 >500ms） | ❌ 無 | Speech timestamps 已有，可分析 |
| **Prosody（韻律）** | 語調、停頓自然、句末降調 | ❌ 無 | Gemini 2.5 audio 可評（Phase 2） |
| **練習次數 + 進步曲線** | 第 N 次的 CPM + accuracy | ❌ 無（state 存 sessionStorage 但沒回傳後端） | **最重要缺口** |
| **努力分**（曾教授概念）| 總練習秒數 / 該課內容字數 | ❌ 無 | 計算簡單 |

### 2.2 Grade-aware threshold（lesson YAML 已有，但 UI 沒用）

從 `backend/data/lessons/L*.yml` audit：

| 年級 | 低（需多練） | 中（不錯）| 高（超棒）| 來源 |
|------|------------|-----------|---------|------|
| G4 | < 190 字/分 | 191-220 | > 221 | L01-L06 學習單 |
| G5 | < 200 字/分 | 201-230 | > 231 | L07-L13 |
| G6 | < 210 字/分 | 211-240 | > 241 | L14-L28 |
| G7 | < 220 字/分 | 221-250 | > 251 | L29-L41 |
| G8 文言文 | **用秒數** | 例 L42: <20s / 20-30s / >30s | — | L42-L47 |
| G9 | < 220 字/分 | 221-250 | > 251 | L48-L58 |

**為什麼 G8 文言文用「秒」不用「字/分」？**：文言文段落短（如「夸父逐日」全文約 80 字），用 CPM 容易飆破 300+ 失真；改用「讀完全文需幾秒」更直觀。**平台目前 `parseReadingBenchmark()` 直接 `if (raw.includes('秒')) return [];`** — 等於 G8 4 篇課文沒做任何 fluency feedback，是 bug。

### 2.3 三級自我檢核（曾教授練習本設計）

- **設計理由**：低年級學生不擅長解讀數字百分位，給三級顏色（綠/黃/紅）+ 文字 emoji 自我評估，**內在動機 > 外在分數**。曾教授刻意不用 100 分制（避免被當作成績）。
- **平台對應**：lesson YAML 已有 `feedback` 欄位（「還要多加練習」/「嗯，還不錯喲！」/「哇嗚，超級厲害！」），但**前端 AssessmentReport 在某些路徑沒顯示**（待 audit）。

---

## 三、平台現況 audit

### 3.1 已實作

| 元件 | 收集的 metric | 怎麼回饋 |
|------|--------------|---------|
| `LiveTutor`（逐段朗讀）| 逐句 cpm、matchRate、durationMs、diffTokens | 即時 toast「很好過關！/ 重唸看看」、retry cap = 2 次自動進關 |
| `FullReading`（全文朗讀）| 全文 cpm、accuracy、errorBreakdown、diffTokens | `analyzeFluency()` 回 feedback 字串、4 級顏色（紅/黃/綠/翠）|
| `AssessmentReport`（報告）| 從 fullReadingResult 讀 cpm | 顯示 4 級 emoji 標籤 + lesson `reading_benchmark` feedback |
| 後端 `reading_benchmark` schema | YAML levels (字 or 秒) → DB JSON | `/api/stories/{id}` 帶出 levels |

### 3.2 跟學習單紙本的差距

| 紙本流程 | 平台目前 | 缺口 |
|---------|---------|------|
| **念順順 4 次計時** | 全文朗讀只算 1 次 | ❌ 沒「第 N 次」概念，沒進步曲線 |
| **三級自我檢核** | YAML levels 有，但 hardcode `CPM_PASS=120` 蓋過 | ⚠️ Grade-aware threshold 沒接上 |
| **G8 文言文用秒** | `parseReadingBenchmark` 直接 return `[]` | 🐛 等於沒 feedback |
| **進步紀錄表** | 後端 `LearningSession.full_reading_result` 只存最後一次 | ❌ 歷史 attempts 沒留 |
| **教師端追蹤** | `TeacherSessionReportPage` 顯示 fluency 數字 | ⚠️ 看不到 4 次進步、看不到班級分布 |

### 3.3 程式碼級具體問題

```text
frontend/src/utils/personaConfig.ts:13
  export const FULLREADING_CPM_PASS = 120;  ← 對 G7 學生過低
  export const FULLREADING_ACCURACY_PASS = 0.80;
  export const CPM_VERY_FAST = 180;  ← 4 級切點寫死，沒 grade-aware
  export const CPM_FAST = 130;
  export const CPM_MEDIUM = 90;
  export const CPM_SLOW = 50;

frontend/src/utils/fluencyAnalyzer.ts:116
  if (raw.includes('秒')) return [];   ← G8 文言文沒 feedback (bug)

frontend/src/components/reading-steps/FullReading.tsx:172
  cpm: result.cpm || 0,   ← 單次結果，沒 attempt index
```

---

## 四、建議實作 spec（4 個 PR-sized chunks）

### Spec A：Grade-aware threshold ingestion（高優先，1-2 天）

**目標**：把 lesson YAML 的三級門檻接上前端 4 級 UI。

- **改 `personaConfig.ts`**：把 `FULLREADING_CPM_PASS / CPM_VERY_FAST / CPM_FAST / CPM_MEDIUM / CPM_SLOW` 改為 fallback default。**優先順序**：lesson `reading_benchmark.levels` > grade default > global hardcode。
- **改 `fluencyAnalyzer.analyzeFluency()`**：接受 `readingBenchmark` 參數，動態算 `cpmPass`。
- **改 `parseReadingBenchmark()`**：支援秒數格式 `□20秒以下 / 20~30秒 / 30秒以上`，回 `BenchmarkLevel` 用 `maxSec/minSec`，不要 return `[]`。
- **改 `AssessmentReport.tsx`**：4 級顏色帶根據該 lesson grade 動態切（不是寫死 50/90/130/180）。
- **驗證**：G4 一篇 + G6 一篇 + G8 文言文一篇都顯示正確 feedback。

### Spec B：朗讀 attempt 歷史紀錄 + 進步曲線（最重要，2-3 天）

**目標**：對應「念順順 4 次計時」紙本。

- **後端 schema 新增**：`LearningSession.full_reading_attempts: list[dict]`（每筆 `{attemptNo, cpm, accuracy, durationMs, timestamp}`）。或新建 `ReadingAttempt` table（`session_id`, `text_id`, `attempt_no`, `cpm`, `accuracy`, `created_at`）— **建表前必先讀 sqlalchemy-model-safety skill** + Young 同意（依 CLAUDE.md DB migration rule）。
- **前端 FullReading.tsx**：每次「再讀一次」按鈕後 `POST /api/learning/full-reading-attempt`，附 `attemptNo`。
- **AssessmentReport 新增「進步曲線」區塊**：
  - 折線圖（4 點 = 4 次）顯示 CPM 進步
  - 「你今天 4 次：120 → 145 → 170 → 195 字/分，比第 1 次進步 75 字！👏」
  - 「努力分」= 總練習秒數 / 課文字數
- **驗證**：4 次練習後 reload，曲線仍在；教師端能看每個學生 4 次數據。

### Spec C：Self-correction + pause pattern 偵測（中優先，2-3 天）

**目標**：把 Phase 1 的 NRP 三要素中的「自我修正」+「停頓模式」量化。

- **Self-correction**：LiveTutor 已有 transcript stream。在 `analyzeFluency` 加邏輯：若同一字位置出現「先錯後對」序列，標記為 self-correction（不算錯）。新增 `selfCorrectionCount` 欄位。
- **Pause pattern**：從 audio timestamp 抓停頓 > 500ms 的位置。回傳 `pauses: [{position, durationMs}]`。
- **UI**：報告顯示「你自己修正了 3 個字 — 很棒，這代表你在思考！」（曾教授 self-correction 是正向訊號）。
- **驗證**：模擬「我我」「妳/你/妳」唸法都正確被 self-correction 抓到。

### Spec D：Prosody 評分（低優先，3-5 天，Phase 2）

**目標**：補完 NRP 三要素第三項「韻律」。

- **後端**：用 Gemini 2.5 audio multimodal `evaluate_prosody(audio_url, text)` → 回 `{intonation: 0-1, pause_naturalness: 0-1, sentence_stress: 0-1}`。
- **Prompt schema**：判斷類 prompt 必帶 `reasoning` 欄位（依 LingoLeap memory `feedback_llm_reasoning_field.md`）。
- **rate-limit + auth**：依 `llm-endpoint-hardening` skill。
- **UI**：在報告新增「韻律評分」+ AI 評語「你的句末降調很自然！但第二段中間有 3 個地方停頓太久。」
- **驗證**：人工標註 10 段 audio + AI 評分對照，r > 0.6。

---

## 五、與既有功能關係

| 既有功能 | Spec A | Spec B | Spec C | Spec D |
|---------|--------|--------|--------|--------|
| `LiveTutor` 逐段朗讀 | grade-aware 也適用 | — | self-correction 主戰場 | prosody 適用 |
| `FullReading` 全文朗讀 | 主戰場 | 主戰場（4 次重練）| 適用 | 適用 |
| `AssessmentReport` | 4 級顏色更新 | 進步曲線新增區塊 | 「自我修正 X 個字」 | 「韻律評分」新區塊 |
| `fluencyAnalyzer.ts` | `parseReadingBenchmark` 修 bug | 不動 | `analyzeFluency` 加 selfCorrection | 後端 endpoint，不動前端 |
| 後端 `reading_benchmark` | schema 不變 | schema 變動（新 attempts table）| schema 不變 | schema 不變 |
| `#1340` AI 助教 prompt | — | 「我看到你練了 4 次，第 4 次最好！」 | 「你自己修正了 X 個字 — 厲害」| 「你的韻律有進步」 |

---

## 六、AI 助教（#1340）流暢度引導 vs 內容引導 怎麼分

依據 Tseng et al. (2011) SEM 結果 + Scarborough's Rope：

| 學生狀態 | AI 助教應該引導 |
|---------|---------------|
| CPM < grade 低門檻（如 G4 < 190）+ accuracy < 70% | **流暢度引導** — 「再練 1 次，這次先慢慢讀準確就好」（不要進 ComprehensionChat） |
| CPM 在中等 + accuracy ≥ 80% | **內容引導** — ComprehensionChat 蘇格拉底對話 |
| CPM 高 + accuracy ≥ 90% | **進階引導** — 推論、批判性問題、跨課文 |
| Self-correction count > 5 | **正向激勵** — 「你會自己改錯，這是很高階的閱讀能力！」 |
| 練習次數 < 2 + CPM 低 | **建議重練**（不要直接做後續關卡）|

---

## 七、7/1 Priority — 可做 vs 後續

| 優先級 | Spec | 預估時間 | 為什麼 |
|-------|------|---------|--------|
| **P0** | Spec A：Grade-aware threshold | 1-2 天 | 修 bug（G8 沒 feedback）+ 接上學習單紙本邏輯，不需新 schema |
| **P0** | Spec B：4 次 attempts + 進步曲線 | 2-3 天 | 直接回應 Young「念順順 4 次計時要量化」+ 給陳教授看的 demo killer feature |
| **P1** | Spec C：Self-correction + pause | 2-3 天 | 提升 NRP 完整度，但不在 7/1 critical path |
| **P2 (Phase 2)** | Spec D：Prosody | 3-5 天 | 需 Gemini audio + 人工 baseline，技術風險較高 |

---

## 八、Open questions（Young + 教授）

1. **G8 文言文「秒數」UI 怎麼設計？** — 4 級 emoji 還是 3 級？秒數倒過來（越短越好）UI 怎麼直觀？
2. **Self-correction 算對還算錯？** — 曾教授立場：正向訊號（=讀者在監控）。但目前 `analyzeFluency` 視為錯字。要不要分別計算？
3. **練習次數要 cap 在 4 嗎？** — 紙本是 4 次。平台無限次練習會不會稀釋訊號（後幾次只是背起來）？建議：cap 在 4 次後，第 5 次標記「已熟練」不再進 CPM 平均。

---

## 引用清單（給陳教授 / 教育研究合作者）

1. Tseng, S.-J. et al. (2011). 聲韻覺識、唸名速度和流暢性對中文閱讀理解的影響. https://nccur.lib.nccu.edu.tw/bitstream/140.119/99725/1/34(1)-1-28.pdf
2. 曾世杰 (2020). 有效讀寫. 親子天下. https://readmoo.com/book/210151436000101
3. NRP (2000). Report of the National Reading Panel — Ch. 3 Fluency. https://www.nichd.nih.gov/sites/default/files/publications/pubs/nrp/Documents/ch3.pdf
4. Hasbrouck, J., & Tindal, G. (2017). An Update to Compiled ORF Norms. https://files.eric.ed.gov/fulltext/ED594994.pdf
5. 臺師大大腦與學習實驗室 — 流暢性測驗. https://sites.google.com/view/brainlearninglab/%E6%B5%81%E6%9A%A2%E6%80%A7
6. 洪儷瑜 (2007). 常見字流暢性測驗編製研究. https://www.airitilibrary.com/Publication/alDetailedMesh?docid=16094905-201206-201208240003-201208240003-247-276
7. LaBerge, D., & Samuels, S. J. (1974). Toward a theory of automatic information processing in reading. https://psycnet.apa.org/record/1974-29172-001
8. Scarborough, H. (2001). Reading Rope. https://dyslexiaida.org/scarboroughs-reading-rope-a-groundbreaking-infographic/
9. 曾世杰專訪：人文．島嶼. https://humanityisland.nccu.edu.tw/zengshijie_01/

---

**Author**: Young
**Date**: 2026-05-01
**Related**: #1340 (AI tutor prompt), `frontend/src/utils/fluencyAnalyzer.ts`, `backend/data/lessons/L*.yml`
**Tag**: 7/1-deadline
