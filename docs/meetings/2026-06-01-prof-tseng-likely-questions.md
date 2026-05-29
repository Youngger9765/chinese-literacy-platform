# 曾世杰教授 6/1 Review 預想提問（5 題）

> Brainstorm by Claude per 議程 Action #10。涵蓋 pedagogy / privacy / scale / cost / vs 方大哥原版差異。會議當下調整、補充。

---

## 1. Pedagogy — 鷹架時機

**問**：學生在蘇格拉底對話卡住，AI 怎麼決定 (a) 立刻給提示（避免挫折） vs (b) 等學生再想 30 秒 vs (c) 換更簡單的問法？這跟教學鷹架理論的 ZPD 對齊嗎？

**準備**：
- 現況：socratic_agent 5 題 3 階段 + circuit breaker（連 3 次 AI error → fail-closed）
- Bridge 三步驟（detect / 診斷 / 修正）已 4/11 上線
- Limitation：目前是 prompt-driven，沒有「等多久」這個 dimension。閾值由 model 隱式決定
- 誠實回答：這就是 7/1 launch 後我們真實學生試用要學的，不是憑空設計

---

## 2. Privacy — 學生 data 怎麼用

**問**：學生對話 / 朗讀音檔 / OMO 紙本拍照上傳，這些 data 用來訓練 AI 嗎？跟均一既有平台 user data 怎麼隔離？家長同意流程？

**準備**：
- AI 呼叫走 Vertex AI（service account），Google 端不留 train data（Vertex AI default policy）
- 我們 DB 存學生互動 → 留我們自己分析用，不外傳第三方
- staging / prod 環境隔離（Cloud SQL + GCS + JWT 從 prod 拆，#1579/#1576/#1580/#1604）
- OMO 紙本上傳的影像存 `gs://lingoleap-omo-uploads`，目前是 educator/student own access
- 家長同意：跟均一 onboarding 流程嫁接（方大哥流程細節）
- 誠實 gap：跨機構 onboarding 完整 data governance policy 還沒寫死，7/1 launch 前要補

---

## 3. Scale — 1 個 AI 帶 30 個 vs 1 個學生

**問**：AI tutor 一對一 vs 一對多的 pedagogical effectiveness 會 degrade 嗎？怎麼驗？

**準備**：
- 技術 scale 上 stateless（每 session 獨立），系統面沒問題
- Pedagogical degradation 風險：學生 cohort 同時用、AI 沒看到 class-level pattern → 老師目前看 dashboard 補
- Teacher dashboard 是這個問題的答案 — 老師看跨學生模式做決策
- 未驗證：沒有 controlled study 比過。誠實說 7/1 launch 學校試用就是要 generate this evidence
- 平台不取代老師，是 augment 老師

---

## 4. Cost — 全國規模的 economics

**問**：1000 學生一年用下來，總成本？跟方大哥原版（單一 prompt）比 trade-off？

**準備數字**：
- OMO 紙本批改：~$0.0027/張（#1730 實測）— 100 學生 × 30 課 = $8.1；50000 張 = $135
- 數位課（socratic / vocab / reading 等）：用 gemini-2.5-flash-lite，cost -78% vs 原 baseline（#1744）
- 整年單一學生估算：~$2-5 USD（含 socratic chat / OMO / reading assessment）
- 跟方大哥原版（單一大 prompt）比：我們的 per-task config 用便宜 model 跑 8 個 task，總 cost 更省
- 主要 cost：vision call（OMO grader）+ socratic agent（互動次數多）

---

## 5. vs 方大哥原版的差異 — 為什麼變這樣？

**問**：方大哥原版（[github.com/Shinjou/lingoleap-ai-reading-tutor](https://github.com/Shinjou/lingoleap-ai-reading-tutor)）是單一 prompt 跑全流程。為什麼改成 multi-step pipeline + per-step Tool？這個架構決定背後的 pedagogical rationale？

**準備**：
- 方大哥原版 single-prompt 證明「AI 能教閱讀」這個假設，cost / quality / 適合做 PoC
- 我們的 multi-step 架構不是技術秀，是因為 **教學情境分化** 需要：
  - 朗讀（需要 STT、評估精確度、紅標漏字）— 沒辦法跟 socratic 對話混
  - 生字練習（筆順、注音）— 完全 deterministic
  - 蘇格拉底對話（需要 5 題 3 階段、bridge 拆解）— 需要 stateful agent
  - 紙本上傳 OMO（vision + cross-page consistency）— 完全不同 pipeline
- Pedagogy：每個 step 對應一個明確 reading literacy sub-skill，老師可單獨派發
- Code/maintenance：拆 step 讓改一個 feature 不會 break 其他
- Cost：per-task 選 model（cheap for text, expensive for vision）省 78%

---

## 教授可能 follow-up 風險題（先想好）

| 議題 | 我們的位置 |
|------|----------|
| 「AI 會不會誤導學生答錯也說對」 | grader fail-closed（understood=False on error，不是 True，#1730 之後三層 guard）|
| 「學生不寫字直接念 AI 寫」 | 朗讀 + 寫字筆順分離；造句練習偵測 paste（#969）|
| 「對 SEN 學生（特教）怎麼處理」 | 目前未特化，誠實說這是後續路線 |
| 「老師不會用怎麼辦」 | Teacher onboarding flow 還沒成型，5/29 議程 § 四討論 |
| 「跟均一平台關係」 | 目前是均一旗下試驗品，方大哥是 product owner |
