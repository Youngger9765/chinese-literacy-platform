# PBL × AI 研究文獻與方法論

> 用途：親子天下演講、Blog 文章、課程設計的理論支撐
> 整理日期：2026-03-15

---

## 1. Gold Standard PBL 框架（PBLWorks / Buck Institute）

**來源**: [PBLWorks - Gold Standard PBL](https://www.pblworks.org/what-is-pbl/gold-standard-project-design)

PBL 領域最被引用的框架，定義了 7 個 Essential Project Design Elements。

### 7 個設計元素

| # | 元素 | 定義 | LingoLeap 實習生專案對照 |
|---|------|------|------------------------|
| 1 | **Challenging Problem or Question** | 有意義的問題或待回答的挑戰性問題 | 「怎麼讓閱讀困難的孩子學會朗讀？」— 真實社會問題 |
| 2 | **Sustained Inquiry** | 持續的探究過程：提問 → 找資源 → 應用 → 更深的提問 | 6 個月持續開發，不是一次性作業。每週 pick issue → 開發 → review |
| 3 | **Authenticity** | 涉及真實世界情境、工具、品質標準或影響 | 真 GitHub Issue、真用戶（老師+學生）、真 Production 部署 |
| 4 | **Student Voice & Choice** | 學生對專案有決策權，包括如何工作和產出 | 自己選 Issue、自己決定解法、PR 是自己寫的 |
| 5 | **Reflection** | 師生檢視學習過程、探究效果、工作品質 | 每週 weekly meeting 回顧 + Skill Tree 自我追蹤 |
| 6 | **Critique & Revision** | 給予、接受、應用回饋以改善過程和產出 | Code Review = 真實的同儕 + mentor 回饋循環 |
| 7 | **Public Product** | 學生的作品公開展示給教室以外的人 | GitHub contribution graph + 可放備審的作品集 |

### 框架模型

七個元素圍繞核心：**Learning Goals — Key Knowledge, Understanding, and Success Skills**。所有設計元素都服務於學習目標，包括 critical thinking、problem solving、communication、self management、collaboration。

### 公平性四槓桿（Equity Levers）

1. Knowledge of Students（了解學生）
2. Cognitive Demand（認知要求）
3. Literacy（識讀能力）
4. Shared Power（共享權力）

---

## 2. AI-Enhanced PBL 效果研究（MDPI 2025）

**論文**: The Role of Artificial Intelligence in Project-Based Learning: Teacher Perceptions and Pedagogical Implications

**期刊**: Education Sciences (MDPI), 2025-01-26

**DOI**: [10.3390/educsci15020150](https://www.mdpi.com/2227-7102/15/2/150)

### 關鍵數據

| 指標 | 結果 |
|------|------|
| 樣本 | 300 位教師（小學 40%、中學 30%、大學 30%） |
| AI-PBL vs 傳統 PBL | AI-PBL 顯著更高 |
| **效果量 Cohen's d** | **1.30（大效果）** |
| AI 個人化學習 | 學生可依表現自訂內容和難度 |
| AI 回饋機制 | 在專案製作和審查的關鍵階段提供持續回饋和自我評估 |

### 重點結論

- AI 輔助 PBL 被教師評為顯著優於傳統 PBL
- AI 最大價值：**個人化 + 持續回饋**（不是取代老師）
- 適用範圍：小學到大學都有效

### 對 LingoLeap 的啟示

我們的做法正好命中這篇論文的結論：
- AI（Claude Code）提供持續回饋 = Code Review + CI/CD 自動檢查
- 個人化 = Skill Tree 追蹤每個實習生進度，分配適合的 Issue
- 不取代 mentor = AI 寫 code，Young 做 review + 方向指導

---

## 3. AI × PBL × 程式教育效果（Frontiers in Education 2025）

**論文**: Artificial intelligence meets PBL: transforming computer-robotics programming motivation and engagement

**作者**: Christian Basil Omeh & Musa Adekunle Ayanwale

**期刊**: Frontiers in Education, Volume 10, 2025-11-06

**DOI**: [10.3389/feduc.2025.1674320](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2025.1674320/full)

### 研究設計

- **方法**: 準實驗設計（Quasi-experimental），前後測控制組
- **樣本**: 87 名大二學生（實驗組 45、控制組 42）
- **課程**: Computer Robotics Programming
- **分析**: One-way MANCOVA，控制先前程式經驗

### 關鍵數據

| 指標 | 效果量 η² | 解讀 |
|------|----------|------|
| **Engagement（投入度）** | **0.694** | 極大效果 |
| **Intrinsic Motivation（內在動機）** | **0.690** | 極大效果 |
| **Academic Achievement（學業成就）** | **0.519** | 中到大效果 |
| 多變量結果 | Wilks' Λ = 0.134, F(3,82) = 176.93, p < 0.001 | 整體極顯著 |

### 重點結論

- AI 嵌入 PBL 框架，在 engagement、motivation、achievement 三個維度都顯著優於傳統 PBL
- AI 不只是工具，是 **active learning 的催化劑**
- 建議：教育機構應優先投資 AI 增強的教學法 + 教師培訓

### 對 LingoLeap 的啟示

這篇直接支撐我們的做法：
- 程式教育 + PBL + AI = 三重加乘效果
- 實習生的 engagement 確實很高（Ryan一週 merge 2 PR、Sean主動分析 root cause）
- η² > 0.5 = 超過 50% 的變異量可歸因於 AI-PBL 介入

---

## 4. CHI 2024：AI in PBL Co-Design（ACM）

**論文**: Charting the Future of AI in Project-Based Learning: A Co-Design Exploration with Students

**會議**: CHI Conference on Human Factors in Computing Systems, 2024

**DOI**: [10.1145/3613904.3642807](https://dl.acm.org/doi/10.1145/3613904.3642807)

**ArXiv**: [2401.14915](https://arxiv.org/abs/2401.14915)

### 重點

- 學生參與 AI × PBL 的共同設計
- 探索 AI 在 PBL 中的角色：scaffolding、feedback、personalization
- 強調學生 agency（自主性）在 AI-PBL 中的重要性

---

## 5. IEEE 2023：PBL + Agile 教 AI

**論文**: Using PBL and Agile to Teach Artificial Intelligence to Undergraduate Computing Students

**期刊**: IEEE Transactions on Education

**DOI**: [10.1109/TE.2023.3293519](https://ieeexplore.ieee.org/document/10190621/)

### 重點

- 用 Scrum + PBL 教大學生 AI
- Agile 的迭代開發與 PBL 的迭代探究天然契合
- 成功案例：學生在 Sprint 中完成真實 AI 專案

### 對 LingoLeap 的啟示

我們的 weekly rhythm（週一選 Issue → 週二到週四開發 → 週五 PR review + skill tree 更新）本質上就是簡化版的 Sprint。

---

## 6. Springer 2025：AI-Assisted PBL × 程式技能 × 批判思考

**論文**: Fostering programming skill and critical thinking through AI-assisted PBL integration

**期刊**: Journal of New Approaches in Educational Research (Springer Nature)

**DOI**: [10.1007/s44322-025-00041-0](https://link.springer.com/article/10.1007/s44322-025-00041-0)

### 重點

- AI 輔助 PBL 同時提升程式技能和批判思考
- 奈及利亞大學 CS 學生的 Java 程式課程
- AI 在 PBL 中的角色：adaptive support + 理論到實踐的橋樑

---

## 總結：我們的做法在學術上站得住腳

| 學術發現 | 我們怎麼做的 |
|---------|-------------|
| AI-PBL 效果量 Cohen's d = 1.30 | Claude Code + PBL 課程設計 |
| AI 最大價值 = 個人化 + 持續回饋 | Skill Tree 個人化追蹤 + Code Review 持續回饋 |
| Engagement η² = 0.694 | Ryan一週 2 PR、Sean主動 root cause 分析 |
| PBL 需要 Authenticity | 真 GitHub Issue、真 Production、真用戶 |
| PBL 需要 Public Product | GitHub contribution graph、備審作品集 |
| Agile + PBL 天然契合 | 週一選 Issue → 週五 Review = 簡化版 Sprint |
| Student Voice & Choice | 自選 Issue、自決解法 |

**我們的獨特貢獻**：
- 學術研究多是「學生用 AI 工具」，我們是「Mentor 也用 AI 開發，同時帶學生做真專案」
- 雙層 AI-PBL：平台用 AI 教閱讀 × 開發過程用 AI 教程式
- 專案不是模擬的，是真正在 Production 運作的教育產品
