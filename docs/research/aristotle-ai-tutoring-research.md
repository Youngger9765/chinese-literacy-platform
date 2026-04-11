# Aristotle AI Tutoring 研究筆記

> 2026-04-11 | 來源：Edtech Insiders newsletter + 官網 + 5 篇學術論文
> 研究動機：Aristotle 做的事跟 LingoLeap 蘇格拉底對話本質一樣，他們的學術基礎可以佐證我們的方法

---

## 公司概況

| 項目 | 內容 |
|------|------|
| 公司 | JSV AI Inc.（品牌名 Aristotle） |
| 創辦人 | Shan Reddy（SF） |
| 產品 | AI 語音家教 app |
| 核心方法 | 蘇格拉底式語音對話，不給答案 |
| 市場 | 美國中學到大學，全科（數學最強） |
| 客戶 | 20+ 所頂尖學校（Hunter College HS、Stuyvesant HS、Horace Mann） |
| 成效 | 90% 家長第一週看到改善，評分 4.9/5 |
| 定價 | 低於一般家教一小時 → 無限 session |
| 安全 | 每次 session 人工審核，鎖定學術範圍 |

**核心差異化（vs ChatGPT）**：ChatGPT 直接給答案 / Aristotle 用語音蘇格拉底反問 + 白板講解 + 人工審核

---

## 五篇學術論文拆解

### 1. SocraticLM（NeurIPS 2024）

**論文**：SocraticLM: Exploring Socratic Personalized Teaching with Large Language Models
**來源**：https://arxiv.org/html/2407.17349v1

**核心發現**：
- 6B 參數的 SocraticLM **打贏 GPT-4** — Overall +12%, SRR +23%
- 不是模型大就教得好，是**教學策略**決定效果

**方法 — 四步教學框架**：
1. **複習**：回顧學生已知概念
2. **啟發式引導**：提出適度挑戰的問題
3. **糾正**：修正錯誤理解
4. **總結**：統整關鍵學習重點

**數據集 SocraticMATH**：
- 6,846 組對話，513 個數學知識點
- 模擬 6 種不同認知狀態的學生
- 強化 4 種教學能力
- 刪除 23% 低品質對話，修改 18%（品質門檻高）

**關鍵洞見**：
- 注入「解答知識」可以**大幅降低 AI 幻覺**（亂教的問題）
- 蘇格拉底式比 Chain-of-Thought 直接解題更能引發深度思考
- 開源（數據集+程式碼）

**對 LingoLeap 的啟示**：
- 我們的蘇格拉底對話方法是對的，有 NeurIPS 論文佐證
- 可以考慮模擬不同程度的學生來訓練/評估我們的 AI
- 「注入正確答案作為背景知識」這招可以減少 AI 亂教

---

### 2. ICAP 框架（Chi & Wylie, 2014）

**論文**：The ICAP Framework: Linking Cognitive Engagement to Active Learning Outcomes
**來源**：https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chiwylie2014icap_2.pdf

**核心理論 — 四層學習參與度**：

| 層級 | 行為 | 例子 | 學習效果 |
|------|------|------|----------|
| **Passive（被動）** | 接收 | 聽講座、看影片 | 最低 |
| **Active（主動）** | 操作 | 做筆記、畫重點 | 低 |
| **Constructive（建構）** | 產出 | 寫摘要、畫概念圖、解題 | 中高 |
| **Interactive（互動）** | 共創 | 同儕討論、共同建構知識 | **最高** |

**ICAP 假說**：I > C > A > P（互動 > 建構 > 主動 > 被動）

**實證**：225 篇大學課堂研究的 meta-analysis 支持這個排序

**對 LingoLeap 的啟示**：
- 蘇格拉底對話 = Interactive 層級（最高效的學習）
- 傳統閱讀理解測驗 = Active 層級（次等）
- 我們的方法在學術框架裡是**最高層級**，可以這樣跟均一/曾教授講
- 如果加入同儕討論功能，效果理論上更好

---

### 3. MISTAKE / MisstepMath

**相關論文**：
- MisstepMath: A Diverse Student Mistake Dataset（Springer, 2025）
- Algebra Misconceptions Benchmark（Springer, 2025）

**核心概念**：
- AI 教學不是只看「答對答錯」，要看**概念性錯誤**（misconception）
- 概念性錯誤 = 學生有一個**系統性的錯誤理解**，會一直導致同類型的錯

**四類錯誤分類**：
1. **概念性誤解**（最重要，要挖出來修正）
2. **程序性錯誤**（步驟做錯，教步驟就好）
3. **學習障礙相關**（需要特殊處理）
4. **語言相關困難**（看不懂題目）

**數據**：12,000 筆分類錯誤 + 教師回應（K-8 數學）

**對 LingoLeap 的啟示**：
- 中文閱讀也有概念性錯誤（例：混淆「推論」和「直接敘述」）
- 我們的 AI 應該能區分「看錯字」vs「理解錯概念」
- 可以建自己的中文閱讀 misconception 資料庫

---

### 4. Bridge — 專家家教的三步錯誤處理

**核心方法 — 三步驟**：
1. **偵測**：發現學生犯錯
2. **診斷**：問問題找出錯在哪（不是直接說「你錯了」）
3. **修正**：引導學生自己修正

**與蘇格拉底法的關係**：
- Bridge 的第二步（診斷）就是蘇格拉底式提問
- 不直接告訴學生答案，而是問「你是怎麼想的？」

**對 LingoLeap 的啟示**：
- 我們的 AI 在學生答錯時，不該說「錯了，正確答案是 X」
- 應該問「你是怎麼理解這段的？」→ 找到錯誤根源 → 引導修正
- 這三步可以寫進我們的 prompt engineering

---

### 5. TRAVER（ACL 2025）

**論文**：Training Turn-by-Turn Verifiers for Dialogue Tutoring Agents
**來源**：https://arxiv.org/html/2502.13311v3

**核心創新 — 雙引擎架構**：

**引擎 A：知識追蹤（Knowledge Tracing）**
- 把任務拆成多個「知識成分」（KC）
- 每輪對話評估學生掌握了哪些 KC
- 自動調整教學重點，補知識空白

**引擎 B：逐輪驗證器（Turn-by-Turn Verifier）**
- 每次 AI 要回應前，生成 N 個候選回應
- 用獎勵模型打分，選最佳回應
- 越接近學習目標的回應，權重越高

**實驗結果**：
- 基於 GPT-4o，Pass 率從 38.7% → 43.7%（Oracle 上界 51.9%）
- 拿掉驗證器 → Pass 率跌 4.2%，證明驗證器必要
- N（候選數）從 1→20，性能線性提升

**關鍵發現**：
- **大模型 ≠ 好老師** — 72B 模型對高程度學生反而教更差（負 Δ%）
- **適應性是關鍵** — 要能根據學生程度調整，不是一套教法打天下

**三層模擬學生**：
- 初級：零基礎
- 中級：50% 先備知識
- 高級：有部分知識 + context

**對 LingoLeap 的啟示**：
- 「生成多個候選 → 選最佳」這招可以提升我們 AI 對話品質
- 知識追蹤可以讓 AI 記住學生已經會什麼、還不會什麼
- 分級學生模擬可以用來測試/訓練我們的 AI tutor
- 驗證器的概念可以用在品質控制 — 每輪對話都有品質門檻

---

## 綜合分析：Aristotle 的護城河

| 維度 | Aristotle | LingoLeap（我們）|
|------|-----------|-----------------|
| 教學方法 | 蘇格拉底對話 ✅ | 蘇格拉底對話 ✅ |
| 介面 | 語音 + 白板 | 文字（語音未做）|
| 學術背書 | 5 篇論文 | 有曾教授，但未包裝 |
| 人工審核 | 每 session 審 | 未做 |
| 科目 | 全科（英文市場）| 中文閱讀（中文市場）|
| 錯誤處理 | Bridge 三步驟 | 基本回饋 |
| 知識追蹤 | TRAVER 式 | 未做 |
| 學生分級 | 三級模擬 | 未做 |

## 可以立刻用的東西

1. **跟均一/曾教授報告時**：引用 ICAP 框架，說明我們的蘇格拉底對話是 Interactive 層級（最高效）
2. **改進 AI prompt**：加入 Bridge 三步驟（偵測→診斷→修正），不直接說答案
3. **品質控制**：參考 TRAVER 的多候選選擇機制
4. **VCA 課程素材**：這 5 篇論文可以當教學理論基礎
5. **語音功能**：SocraticLM 證實語音教學效果更好，考慮加入 LingoLeap roadmap

## 論文連結

- [SocraticLM (NeurIPS 2024)](https://arxiv.org/html/2407.17349v1)
- [ICAP Framework (Chi & Wylie, 2014)](https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chiwylie2014icap_2.pdf)
- [MisstepMath (Springer 2025)](https://link.springer.com/chapter/10.1007/978-3-031-98414-3_27)
- [TRAVER (ACL 2025)](https://arxiv.org/html/2502.13311v3)
- [Algebra Misconceptions Benchmark](https://link.springer.com/article/10.1007/s44217-025-00742-w)

---

*研究筆記 by Young Job Manager | 2026-04-11*
