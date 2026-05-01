# CEO Review — 7/1 Deadline 60 天路線圖

**日期**：2026-05-02（5/1 專家會議 +1 天）
**分支**：`docs/issue-1378-fluency-research`
**Mode**：SCOPE REDUCTION（建議）
**Reviewer**：plan-ceo-review skill (gstack)
**Source of truth**：[`docs/meetings/2026-05-01-experts-review.md`](meetings/2026-05-01-experts-review.md)

---

## 一、5/1 同日衝刺成果（事實校正）

| 維度 | 5/1 凌晨 | 5/1 22:00 | 變化 |
|---|---|---|---|
| Merged PRs（5/1）| 0 | **25** | +25 |
| Open issues 總數 | ~30 | ~28 | -11 close +9 new |
| 7/1-deadline label | 16 | **9** | -7（多數已實作） |
| 158 課 docx → YAML | 0% | **96%**（151/158 parsed） | 全新管線 |
| YAML fast path | 0% | **6.7%**（14/208） | 邏輯通了，coverage 待擴 |
| 設計 token 採用 | partial | tightened | #1360 |
| 流暢度量化 | 無 backend | **CWPM + 三級門檻** | #1378 + #1382 backend；UI 待做 |
| AI 助教 spec | 無 | **完整 SOP + 5 prompts** | #1372；0 行 code |
| 圖文整合 | 無 | 無 | **未動** |
| ComprehensionChat 單肥組件 | 1 個 | **3 個獨立 step** | #1349 |

> **結論**：基礎建設層做掉 80%。剩下都是 user-facing 的 P0 + 兩個 hidden gap。

---

## 二、Premise challenge — 我們在解對的問題嗎？

### 「2 單元 7 課做到極致」是對的框架

✅ **對**。專家拍板，避免 60 天功能蔓延，符合 wartime 紀律。

### 但「極致」沒定義 = 失控風險

⚠️ **必須立刻定義可量化 KPI**（見第六節）。否則 60 天會在「再打磨一下」中被吃掉，尤其 Young 一個人主力。

### 7/1 demo 給誰看？這直接決定砍多少

| Demo 對象 | 隱含 KPI | 砍誰可活 |
|---|---|---|
| **教授團隊**（曾世杰、陳淑麗、林校長） | UI/UX 完整、AI 助教引導合教學法、紙本對照清晰 | 砍 OMO、教師後台、遊戲化、Layer-1 57 課 |
| **真實學生**（8 校 100 人） | 穩定不爆、能自主完成、有進步可見 | 砍 AI 助教語音（先文字）、砍進階儀表板 |
| **方大哥募資/招生** | Wow factor、現場 5 分鐘看完震撼 | 砍 7 課中的 5 課（只展 G6-L22 + G7-L28）|

> **CEO 建議**：**先答「給誰看」再規劃**。我假設是教授+校長 = 教學法正確性 > UI 炫技 > 規模。

---

## 三、Dream state delta

```
今天 (5/1)                7/1 milestone              12-MONTH IDEAL
────────────              ─────────────              ──────────────
158 課資料齊        →     7 課世界級展示            →  158 課全可教
AI 助教 0 行 code   →     AI 助教文字版可用          →  AI 助教語音 + 個別化
圖文整合 = 上下     →     左右並陳 + 滾動同步        →  紙本 OMO 雙向
YAML 6.7%           →     7 課 100% YAML            →  全 YAML，AI 只診斷
教授看 demo         →     教授+校長+真實學生用       →  體育班取代教科書
```

**60 天可達**：左欄 → 中欄
**60 天不可達**：中欄 → 右欄（不要嘗試）

---

## 四、Implementation alternatives

### Approach A：全廣度（拒絕）
**Summary**：158 課全填 step_sequence + AI 助教覆蓋 12 策略 + OMO + 教師後台
**Effort**：XL（人類 6 個月，CC+Young 仍需 12 週）
**Risk**：High — 60 天根本不可能，每樣都半成品
**結論**：**砍**

### Approach B：7 課專修（推薦）⭐
**Summary**：
- 7 課做到世界級（教授指定 G6-L22~25 + G7-L28~30）
- AI 助教只訓練 2 套 prompt（摘要 PSR + 圖文整合），覆蓋這 7 課
- 圖文整合介面只解這 7 課的圖
- 其他 201 課照舊運作（不引入新功能、不破壞）

**Effort**：CC+Young 約 4-5 週實作 + 2 週 polish + 1 週緩衝 = **57 天**（含 5/1）
**Risk**：Medium — bottleneck 在 AI 助教 + 圖文介面（兩者都有 design sketch 但 0 行 code）
**Reuses**：今天 5/1 全部 25 PR、socratic_agent.py pattern、ComprehensionChat 拆分後的容器

### Approach C：Demo only（保底）
**Summary**：7 課全部 happy path，不上學生 → 教授會議能看，但無真實 traction
**Effort**：CC+Young 3 週
**Risk**：Low 但浪費教授團隊已交付的 158 課寶藏

**RECOMMENDATION：Approach B**。理由：時間夠（緊但不爆），保留學生實測機會，且基礎建設今天已就位。

---

## 五、SCOPE REDUCTION — 砍誰可活

### ✂️ 60 天內**不做**（已 confirmed 砍）

| 項目 | 原狀 | 砍的理由 |
|---|---|---|
| Layer-1 原始 57 課跑 parser | 從沒跑 → 全打 AI | 7/1 不演這些課 |
| OMO Cold Start（紙本拍照）| #1343 | 教授肯定但不是 demo 必含 |
| 教師後台儀表板 | #1364 | 學期實際只 10 節，數據量不足 demo 用 |
| 努力計分（不只看對錯）| #1363 | 沒 KPI 直接做 = 加料無效 |
| 年級代號 ABCDE | #1362 | 命名可後改 |
| 文言文模組 | #1365 已標 P3 暫緩 | 5/1 共識 |
| 158 課全填 step_sequence | #1384 改 demo 3 課 | scope creep |
| AI 助教覆蓋 12 策略 | #1372 spec 已有 5 套 | demo 只用 2 套（PSR + 圖文）|
| AI 助教**語音版** | #1340 spec 含語音 | 7/1 demo 用文字版即可，語音 7/2 後 |
| 老師批改 UI | 5/1 共識 | 陳教授說系統批即可 |

### ✅ 必做（7/1 不可砍）

| 優先 | 項目 | issue | 預估 effort |
|---|---|---|---|
| **P0-1** | 圖文整合左右並陳介面（單元 B 核心）| #1341 | 1 週 |
| **P0-2** | AI 助教文字版實作（PSR 摘要 + 圖文整合 2 策略）| #1340 → #1387 | 2 週 |
| **P0-3** | 7 課全部走 YAML fast path（修 parser + 補資料）| 無 issue（agent 修中）| 3-4 天 |
| **P0-4** | data gap：parsed lessons 暴露於 stories list | #1383 | 1-2 天 |
| **P1-1** | 流暢度 UI 折線圖（學生看見進步）| #1386 | 3-5 天 |
| **P1-2** | 7 課 step_sequence demo（schema-driven 證明）| #1384 | 2-3 天 |
| **P1-3** | 詞彙流程結束重排（理解→應用→造句）| #1336 verify | 1 天（可能已 done） |
| **P1-4** | 字距行距 / 非黑體 / 注音僅難字 | done | ✅ 都 merged |

### 🟡 機會主義（有空才做）

- 第三階段 L123-L157 教師版（陳教授還沒交，外部 blocker）
- 閱讀聚光燈引導語音腳本錄製（曾教授會錄，外部 blocker）
- AI 助教延伸到推論策略 / 比較觀點 / 覺察策略
- Layer-1 57 課跑 parser 補 YAML

---

## 六、Success KPIs（7/1 demo 通過標準）

**必須在 5/8 之前敲定這份 KPI 表，否則整個 60 天沒有北極星。**

### A. 7 課覆蓋

| KPI | 目標 | 現況 | 量測 |
|---|---|---|---|
| 7 課可從 stories list 訪問 | 7/7 | 0/7（僅 backend 載入但 list 沒暴露）| `curl /api/stories \| jq` |
| 7 課走 YAML fast path（latency < 500ms）| 7/7 | 2/7 | `curl /structure/{id}` 計時 |
| 7 課圖文整合介面正確顯示 | 3/3 單元 B | 0/3 | 視覺驗證 |
| 7 課 AI 助教引導正確（per strategy）| 7/7 | 0/7 | 手測 + 錯答觸發引導 |

### B. 教學法品質（教授驗收）

| KPI | 目標 | 量測 |
|---|---|---|
| 林校長 5 步驟 SOP 命中率 | ≥ 80% 引導符合 | 教授看 10 個學生答錯實況 |
| 摘要 PSR 引導引出「問題/解決/結果」三段 | 3/3 | 學生口述含三段 |
| 圖文整合引導引出「圖↔文對應」 | 3/3 | 學生會在圖上指對應段落 |
| AI 不直接給答案的比例 | ≥ 90% | rescue session log 抽查 |

### C. 系統穩定（學生實測）

| KPI | 目標 | 量測 |
|---|---|---|
| 7 課 e2e 完成率 | ≥ 90% | session 完成 step ≥ 5 |
| AI 助教平均回應 latency | < 6s p50 | log timing |
| Crash / 500 / session lost rate | < 1% | Cloud Run logs |

> 沒過上面 KPI = 不能說「7 課做到極致」，等於沒交差。

---

## 七、60 天路線（5/2 → 7/1）

### Week 1（5/2 - 5/8）：Hidden gap 修 + KPI 敲定
- ⏳ Parser fix（agent 跑中）— 7 課全走 YAML
- 🆕 #1383 data gap fix — list endpoint 暴露 151 課
- 🆕 把上面 KPI 表跟方大哥+教授確認（5/8 視訊）
- 🆕 確定「demo 給誰看」（決定砍/留）
- ✅ 詞彙流程驗收 #1336

### Week 2-3（5/9 - 5/22）：圖文整合介面
- 🆕 #1341 左右並陳 + 獨立滾動 + 圖↔文錨點
- 真實圖片素材（從教授交付的 G7-L28~30 docx 提取）
- E2E 測 3 課單元 B 視覺正確

### Week 4-6（5/23 - 6/12）：AI 助教文字版
- 🆕 #1387 backend mcq_rescue_agent.py（沿用 socratic_agent pattern）
- 🆕 PSR + 圖文整合兩套 strategy_prompts.yml
- 🆕 frontend RescueChatBox component
- E2E 測 5 步驟 SOP 在 7 課全跑通
- 真實學生 alpha 測（5 人，內部）

### Week 7（6/13 - 6/19）：流暢度 UI + schema demo
- 🆕 #1386 折線圖（4 次練習 + 三級自評）
- 🆕 #1384 7 課 step_sequence 設定（證明 schema-driven）

### Week 8（6/20 - 6/26）：Polish + 真實學生 beta
- 全平台 design review pass
- 邀 5-10 真實學生（透過林校長）跑完 7 課
- bug fix 衝刺

### Week 9（6/27 - 7/1）：Demo 準備 + 最終驗收
- 教授團隊 dry run
- 錄 demo video（萬一現場 demo 出包）
- 7/1 正式 demo

---

## 八、Risk register（CEO 角度）

| Risk | 機率 | Impact | 緩解 |
|---|---|---|---|
| AI 助教 latency 太慢學生放棄 | High | High | 用 gemini-2.5-flash + 預先 cache 常見錯答；< 6s p50 為硬門檻 |
| 圖文整合介面在小螢幕不可用 | Med | High | 7 課固定用 iPad / desktop 演示；mobile 後做 |
| 教授團隊增加新需求拖時程 | High | Med | 5/8 凍結 KPI；新增需求一律進 7/2+ backlog |
| Young 一人主力過勞 | High | High | 把 P1 切給敬行/啟翔；Young 守 P0 |
| Parser fix 失敗或延宕 | Low | High | agent 跑中；fallback 是 7 課手動補 yaml |
| 第三階段教師版 docx 卡陳教授 | Med | Low | 7/1 demo 不依賴 L123-157，所以可接受 |
| Cloud Run 突發費用爆衝 | Low | Med | YAML fast path 已上、AI 配額 5/min/user 限制 |

---

## 九、Team allocation（who does what）

| 人 | 7/1 主責 | 為什麼 |
|---|---|---|
| **Young** | #1340/#1387 AI 助教 backend + 整合 | 唯一掌握全棧 + ai_service pattern |
| **敬行** | #1341 圖文整合介面（state 管理）+ #1386 流暢度 UI | 強項是 data flow + state management |
| **啟翔** | 7 課 visual polish + design tokens 全平台 audit + #1384 demo 設定 | 強項是 UI/UX 視覺 |
| **方大哥** | KPI 敲定 + 教授協調（曾教授錄音腳本、陳教授補教師版）| 對外溝通 |
| **教授團隊** | 5/8 KPI 確認、5/15 中期 review、6/15 alpha 測試陪同 | 教學法把關 |

---

## 十、What I'd push back on

如果你問我「CEO 角度有什麼要挑戰」：

1. **「7 課做到極致」必須 7/1 demo 才有意義**。如果延到 7/8 或 8/1 並沒有外部成本，今天的 wartime 沒必要。確認硬 deadline 是真的（教授會議？募資 milestone？）— 如果是軟的，B 方案還能再緩一週多顯得從容。

2. **AI 助教文字版可能不夠 wow**。林校長許願的是語音對話。如果 7/1 demo 給校長看而拿出文字版 → 失焦。建議在 6/20 alpha beta 時實測一個簡化版「TTS 念出 AI 引導 + 學生語音輸入轉文字」，至少模擬語音感受。

3. **真實學生實測太晚**。Week 8 才上 5-10 學生 → 6/27 之前我們不知道學生會不會卡關。建議週 6 第二週（6/8 起）就邀 2-3 學生跑單一課（不必全 7 課），早期收 feedback。

4. **流暢度 UI #1386 不是 P0**。學生看到自己進步固然好，但不影響教授驗收教學法。可降到 P1 / 機會主義。

5. **沒有人在管 marketing / 招生 / 募資對接**。如果 7/1 demo 後沒有「下一步該怎麼推」的 plan，60 天衝刺的成果就會卡在 demo room 裡。建議 5/15 開始想 7/2-9/1 推廣 plan。

---

## 十一、Decisions waiting

| # | 問題 | 為什麼這時要答 | 我的建議 |
|---|---|---|---|
| Q1 | 7/1 demo 給誰看？（教授 / 校長 / 真實學生 / 方大哥募資）| 影響砍誰可活 | 教授+校長為主，學生實測作旁證 |
| Q2 | AI 助教 7/1 必須語音版嗎？ | 影響 effort 2 倍 | 文字版即可，語音延 7/2+ |
| Q3 | 7/1 deadline 是硬的嗎？ | 影響整個節奏 | 假設硬，若軟則放鬆 1 週 |
| Q4 | 真實學生實測哪一週開始？ | 影響 feedback loop | 6/8（早 2 週）|
| Q5 | 是否同意把 #1386 降為 P1？ | 影響 sequencing | 同意 |

---

## 十二、Completion summary

```
+====================================================================+
|            CEO PLAN REVIEW — 7/1 DEADLINE 60-DAY ROADMAP            |
+====================================================================+
| Mode             | SCOPE REDUCTION                                  |
| Approach         | B — 7 課專修                                      |
| 5/1 sprint       | 25 PRs merged, 80% 基礎建設完成                   |
| 真 blocker       | 4（圖文介面、AI 助教、parser、data gap）          |
| 砍掉             | 10 項（OMO、158 全課、語音、教師後台、12 策略）    |
| 必做             | 4 P0 + 4 P1                                       |
| Hidden risk      | parser 6.7% coverage、AI 助教 0 行 code           |
| Team load        | Young P0、敬行 P1、啟翔 polish                    |
| Outside blocker  | 教師版 L123-157、AI 助教語音腳本                  |
| KPI 鎖定截止     | 5/8（demo 對象 + 量化指標）                       |
+====================================================================+
```

**VERDICT — 60 天可達 Approach B（7 課世界級），條件是：(1) 5/8 前敲定 KPI (2) AI 助教守文字版 (3) 圖文介面 5/22 前 ship。任何延遲必須立刻砍 P1。**
