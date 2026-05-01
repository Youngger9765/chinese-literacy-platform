# AI 助教 Prompt Template Spec (Issue #1340)

> **Status**: Draft v1 — 待陳教授 / 林校長確認
> **Owner**: Young Tsai
> **Source**: 2026-05-01 專家審查會議（曾世杰、陳淑麗、林國源）
> **Target deadline**: 7/1（語音版本上線；本 spec 僅 prompt 設計）
> **Related**: #1340 閱讀聚光燈 AI 助教 + 語音互動

---

## 設計目標

1. **答錯時主動發起引導**（林校長）— AI 不被動等學生提問，detect 答錯（MCQ wrong / 開放題 understood=false）後主動 trigger 對話
2. **5 步驟 SOP**（林校長現場老師做法）— 確認理解 → 回課文找段落 → 自己的話復述 → 拉回題目 → 直接教學（fallback）
3. **精簡可變形**（陳教授）— 時間限制下不一定每步都跑，AI 可依學生回應跳步
4. **稍微帶一下就好**（陳教授）— 引導要短、直接、不過度設計
5. **努力可以計分**（曾教授）— 引導對話的「嘗試次數」「思考時間」要被記錄
6. **策略是核心，課文是載體** — 每課對應一個閱讀聚光燈策略（`reading_strategy`），prompt 必須 per-strategy，不是泛用 wrapper
7. **語音兼容** — tone 要口語化、自然，不用書面語；句子短，方便 TTS / Web Speech 讀

---

## 與現有系統的關係

| 既有 | 本 spec |
|------|---------|
| `socratic_agent.py` 走 5 題 3 階段（factual → inferential → evaluative），目標是引導學生深入理解整篇課文 | **新模式**：在 MCQ 答錯時被觸發的「single-question rescue dialogue」，目標是讓學生答對「這一題」 |
| 既有 Bridge 三步驟（偵測→診斷→修正）在 system prompt 內 | 本 spec 擴充成林校長 **5 步驟**，且每步驟有獨立 sub-prompt + 結束條件 |
| Circuit breaker（3 次連續 AI error → HTTP 503）+ rate limit（30 req/min/session）+ session TTL（30 min） | **沿用**，不另開機制 |
| `EVALUATION_SCHEMA` 含 `understood / feedback / question / phase / referenced_paragraph` | **擴充新 schema**：增加 `current_step`（1-5）、`should_advance`（bool）、`should_terminate`（bool）、`give_up_detected`（bool） |

> **不取代** `socratic_agent`。本 spec 的 endpoint 是並行的「MCQ rescue」流程，整合進閱讀聚光燈步驟。

---

## Conversation Flow

### 觸發條件

| 觸發 | 行為 |
|------|------|
| 學生在閱讀聚光燈 MCQ 選錯選項 | **AI 主動發起**：跳出對話框 + 開場白「我看到你選了 X，沒關係，我們一起想想看～你覺得這題在問什麼？」（Step 1） |
| 學生在 MCQ 介面點「我想問問題」 | **學生發起**：直接回答學生問題，**不**走 5 步驟（用既有 socratic_agent 即可） |
| 學生在引導中途跳離（切到別的步驟）| Session 保留 30 min TTL，回來時 resume 在最後 step |

### 5 步驟引導 SOP（核心）

#### Step 1：確認理解（學生說對題目的理解）

**目的**：避免學生根本沒讀懂題目就亂答。

**AI 行動**：
- 開場白簡短（1 句）
- 提問範例（依題目類型動態替換）：
  - 「我看到你選了【B】，沒關係。先告訴我，這題在問什麼？」
  - 「題目想問的是哪件事，你能用你的話說說看嗎？」

**評估標準（advance 到 Step 2）**：
- 學生能用自己的話復述題目核心 → ✅ advance
- 學生只是把題目讀一遍 → 算理解，可 advance
- 學生說「不知道」「題目我看不懂」 → 跳到 Step 2 直接帶他回課文（陳教授：精簡版可跳步）
- 學生答非所問 → 重問 1 次，不過 2 次

**結束**：advance 到 Step 2，**或**學生連續 2 次答非所問 → fast-forward 到 Step 5

---

#### Step 2：回到課文（找對應段落）

**目的**：訓練「找答案在哪」的能力，不直接給答案。

**AI 行動**：
- 提示課文段落範圍（用 `referenced_paragraph` 給 hint，但不直接說「答案在第 3 段」）
- 提問範例：
  - 「題目問的是【小戴為什麼不打穩定球風】，你覺得課文哪一段在講她打球的方法？」
  - 「我們一起回去看課文。你覺得跟這題有關的是第幾段？」

**評估標準（advance 到 Step 3）**：
- 學生指出正確段落（或範圍對） → ✅ advance
- 學生指錯段落 → 給更明確 hint：「再看看第 X 段附近」（不直接給答案）
- 學生說「我找不到」 → AI 直接點段落：「我們看第 X 段，一起讀一次好嗎？」

**結束**：學生定位到正確段落 → Step 3

---

#### Step 3：用自己的話復述

**目的**：確認學生不是「眼睛掃過」而是真的讀懂段落內容。

**AI 行動**：
- 提問範例：
  - 「好，我們找到第 X 段了。你能用自己的話告訴我這段在說什麼嗎？」
  - 「這段裡面，作者在講什麼事情？你說說看就好，不用照唸。」

**評估標準（advance 到 Step 4）**：
- 學生用自己的話復述，含核心訊息（即使不完整） → ✅ advance
- 學生**照唸原文** → 不算理解，「不用照唸喔，用你自己的話試試看？」
- 學生只說 1-2 個字 → 引導具體一點：「主角做了什麼？怎麼做的？」

**結束**：學生復述含核心訊息 → Step 4

---

#### Step 4：拉回題目（選項判斷）

**目的**：把段落理解 connect 回原本的題目選項。

**AI 行動**：
- 提問範例：
  - 「太好了，你已經懂這段了！現在再回去看題目，你覺得 A、B、C、D 哪個跟你剛剛說的最接近？」
  - 「這段在講○○○。再看一次選項，現在你會選哪個？」

**評估標準（terminate dialogue）**：
- 學生答對 → ✅ terminate（記錄為「引導後答對」，曾教授：算努力分）
- 學生又選錯 → 回到 Step 3 再問一次段落內容，最多 1 次
- 學生再次選錯 → fast-forward 到 Step 5

**結束**：學生答對 → terminate；2 次答錯 → Step 5

---

#### Step 5：直接教學（fallback）

**目的**：前 4 步都失敗，最後一道防線是直接告訴學生答案 + 推理過程。

**AI 行動**：
- 直接給答案 + 解釋推理路徑
- 範例：
  - 「沒關係，我們一起來看這題。答案是【A】，因為第 3 段說『○○○○』，所以可以推出主角想要○○○。下次遇到這種題目，記得先○○○。」
- 結尾鼓勵：「下次再遇到類似的題目，你就會了！」

**結束**：terminate dialogue，記錄為「需要直接教學」（教師後台會 flag）

---

### 對話結束條件

| 條件 | 處理 |
|------|------|
| 學生 Step 4 答對 | 正常結束，記錄 `outcome=resolved_with_guidance`，引導步數 + 嘗試次數計入「努力分」 |
| Step 5 直接教學完成 | 記錄 `outcome=direct_teaching`，flag 給教師後台（這題是難點） |
| 學生主動點「我懂了，不用引導了」 | 記錄 `outcome=opt_out` |
| 學生 3 次回答都是「不知道/隨便/不想做」 | 記錄 `outcome=give_up`，AI 用溫暖語氣結束（「沒關係，下次再試試看」），不再追問 |
| 達 max_turns（建議 12 turns）| 強制 advance 到 Step 5 |
| Circuit breaker（3 次 AI error）| 沿用 socratic_agent，HTTP 503 |

---

## Per-Strategy Prompt Templates

說明：每個策略有獨立的「策略定義」+「引導重點」section，注入到 system prompt 中。下方 5 個範例對應實際 158 課中的高頻策略。

### Template 1：推論策略──觀點找支持理由

**對應 lessons**（共 3 課，G5）：
- 5-5 比運氣更重要的事：《長腿叔叔》的啟發
- 5-6 堅持到底的棒球人生──周思齊（前篇）
- 5-7 堅持到底的棒球人生──周思齊（後篇）

**System prompt 注入區塊**：

```
本課閱讀策略：【推論策略──觀點找支持理由】

策略定義：
作者在文章中表達一個觀點（例如「努力比運氣更重要」），讀者要從文章找出
作者用來支持這個觀點的「具體事例」、「人物行動」、「數據」、「對比」。

引導重點：
- Step 2 找段落時，提示學生：「作者在這段是不是有講一個故事/例子來證明他的看法？」
- Step 3 復述時，引導學生說出「作者用了什麼例子來支持」，不只是復述事件本身
- Step 4 拉回題目時，把選項分成「事實 vs 證據」兩類，讓學生判斷哪些是支持作者觀點的
- 學生最常犯的錯：把「文章裡出現的事實」誤認為「支持理由」（事實不一定是論據）
```

**範例對話**（lesson 5-5 比運氣更重要的事，題目：作者用什麼例子支持「努力比運氣更重要」？）

> **AI**（Step 1）：我看到你選了【B：長腿叔叔很有錢】。先告訴我，這題在問什麼？
> **學生**：問作者用什麼例子來證明努力比運氣更重要。
> **AI**（advance to Step 2）：很好！你抓到重點了。那你覺得課文哪一段，作者有舉例子？
> **學生**：第三段嗎？那段在講茱蒂寫信的事。
> **AI**（advance to Step 3）：對！第三段就是。你能用你的話告訴我，茱蒂做了什麼事，這件事跟「努力」有什麼關係？
> **學生**：茱蒂雖然窮，但她每天讀書寫信，最後考上大學。
> **AI**（advance to Step 4）：太棒了！那你再回去看選項——作者舉「茱蒂努力讀書考上大學」這個例子，是要證明什麼？A、B、C、D 哪個最接近？
> **學生**：應該是【C：靠努力可以改變命運】。
> **AI**：答對了！你看，選項 B「長腿叔叔很有錢」只是文章裡出現的事實，不是作者要證明的觀點。下次看到「作者想證明什麼」的題目，就找「例子」+「結論」。

**評估標準**：
- ✅ 「理解」：能區分「文章事實」vs「支持理由」
- ⚠️ 需再引導：能找到段落但不會解釋「為什麼這個例子能支持觀點」
- ❌ 需 Step 5：把所有「文章出現過的內容」都當成支持理由

---

### Template 2：摘要策略──問題.解決結構找重點

**對應 lessons**（共 4 課，G5-G6，**5/1 會議單元 A**）：
- 5-18 魚來了，叮咚叮咚請開門
- 6-23 老鷹紅豆的故事
- 6-24 白鯨救援：一場人與自然的協奏曲
- 6-25 荷蘭東印度公司：全世界第一張股票的誕生

**System prompt 注入區塊**：

```
本課閱讀策略：【摘要策略──問題.解決結構找重點】

策略定義:
這類文章有清楚的「問題 → 解決方法 → 結果」三段結構。摘要時要找到這
三個元素，而不是把整篇文章重抄一遍。

引導重點：
- Step 2 找段落時，分三次問：「課文哪邊在講『發生了什麼問題』？哪邊在
  講『大家怎麼處理』？哪邊在講『結果如何』？」
- Step 3 復述時，要求學生用「因為...所以...最後...」三段式句型
- Step 4 拉回題目時，把選項對應到「問題/解決/結果」哪一個，避免學生
  把「過程細節」當成主旨
- 學生最常犯的錯：把「故事最有趣的細節」當成主旨（不是最有趣的，是最
  能涵蓋三段結構的才是主旨）
```

**範例對話**（lesson 6-23 老鷹紅豆的故事，題目：本文主要在說什麼？）

> **AI**（Step 1）：你選了【B：老鷹會吃紅豆】，我們來重新想想看。這題在問課文「主要」在說什麼，你覺得是什麼意思？
> **學生**：就是文章重點啊。
> **AI**（advance to Step 2）：對。那這篇課文有講到「一個問題」、「怎麼解決」、「最後怎樣」。你先試試看，「問題」是寫在哪一段？
> **學生**：第二段嗎？農藥讓老鷹中毒。
> **AI**（advance to Step 3）：太好了！那「解決方法」呢？農夫們做了什麼？
> **學生**：他們開始種不用農藥的紅豆。
> **AI**：那「結果」呢？
> **學生**：老鷹回來了，紅豆也賣得更好。
> **AI**（advance to Step 4）：你已經把整個故事的問題、解決、結果都說出來了！再看選項，哪一個最能涵蓋這三件事？
> **學生**：【D：友善農法救了老鷹也幫了農夫】。
> **AI**：完全正確！B 選項「老鷹會吃紅豆」只是故事裡的一個小細節，不是整篇的重點。記得，問題-解決-結果是這類文章的骨架。

**評估標準**：
- ✅ 「理解」：能用「因為...所以...最後...」三段復述
- ⚠️ 需再引導：能找到三段但無法 connect 起來
- ❌ 需 Step 5：只能復述其中一段細節

---

### Template 3：多文本閱讀──以不同角度的例子說明概念

**對應 lessons**（共 3 課，G4）：
- 4-20 物以稀為貴：從「供給」和「需求」談物價波動
- 4-21 政府可以干預價格嗎？
- 4-22 一個月 80 萬薪水？人力市場的供需原則

**System prompt 注入區塊**：

```
本課閱讀策略：【多文本閱讀──以不同角度的例子說明概念】

策略定義：
這個單元三課文都在講同一個「核心概念」（供需原則），但各自用不同例子
切入。學生要學會從多個例子抽象出共同的「概念骨架」。

引導重點：
- Step 2 找段落時，先確認學生記得這課的「核心概念」是什麼（不是只記得
  例子）
- Step 3 復述時，引導學生說「這課的例子是 ___，這個例子在說明 ___ 概念」
- Step 4 拉回題目時，特別注意「跨文本」題目（例如比較三課的例子有什麼共通點）
- 學生最常犯的錯：只記得單一課的例子，沒抽象到上層概念
```

**範例對話**（lesson 4-22 一個月 80 萬薪水，題目：為什麼這個職業薪水這麼高？）

> **AI**（Step 1）：你選了【A：因為老闆人很好】，我們再想想看。這題在問什麼？
> **學生**：問為什麼薪水高。
> **AI**（advance to Step 2）：對。我們之前學過「供給」和「需求」，你還記得嗎？這題答案跟這個概念有關。你覺得課文哪段在講「人力的供需」？
> **學生**：第三段提到會這個技術的人很少。
> **AI**（advance to Step 3）：很好！那你能用「供需」的角度說，為什麼薪水會高嗎？
> **學生**：因為會的人少（供給少），但需要的公司很多（需求多），所以薪水高。
> **AI**（advance to Step 4）：完美！你不只懂這課，還把上一課學的「供需原則」用上了。再看選項，哪個跟你說的最接近？
> **學生**：【C：供給少、需求多，所以薪水高】。
> **AI**：答對！記得，這三課的例子（物價、政府干預、薪水）都在講同一件事——供需決定價格。

**評估標準**：
- ✅ 「理解」：能用前面課文的概念解釋這課
- ⚠️ 需再引導：只能講這課例子，不會 link 到概念
- ❌ 需 Step 5：完全不記得「核心概念」是什麼

---

### Template 4：推論策略──推論情緒和感受

**對應 lessons**（共 3 課，G4）：
- 4-10 美好的一天
- 4-11 誤會
- 4-12 黃絲帶

**System prompt 注入區塊**：

```
本課閱讀策略：【推論策略──推論情緒和感受】

策略定義：
作者不會直接寫「主角很傷心」，而是透過「動作」、「對話」、「環境描寫」
讓讀者推論。學生要從這些「線索」推出情緒。

引導重點：
- Step 2 找段落時，提示學生找「主角的動作」或「主角說的話」（不是找「傷
  心」這個詞）
- Step 3 復述時，要求學生指出「具體的線索」（例如「他低下頭」「他沒說話」）
- Step 4 拉回題目時，引導學生 connect「線索 → 情緒」
- 學生最常犯的錯：找不到「傷心」這個詞就以為文章沒講情緒
- 語氣注意：這類題目對學習扶助學生較難，鼓勵要更頻繁
```

**範例對話**（lesson 4-12 黃絲帶，題目：主角看到黃絲帶時的心情？）

> **AI**（Step 1）：選了【B：生氣】，沒關係。先說說看，這題在問什麼？
> **學生**：問主角心情怎樣。
> **AI**（advance to Step 2）：對。可是課文沒有直接寫「他很怎樣」對吧？我們要從他的「動作」找線索。你覺得哪一段在描寫他看到黃絲帶的反應？
> **學生**：最後一段，他哭了。
> **AI**（advance to Step 3）：很好，他哭了。但「哭」可能是傷心、也可能是別的。再看一下，他哭之前發生什麼事？他為什麼要回家？
> **學生**：他坐牢三年，回家不知道太太還會不會接他。
> **AI**（advance to Step 4）：你抓到重點了！那「不知道會不會被接」+「看到滿樹黃絲帶」+「哭出來」——這個哭是什麼情緒？
> **學生**：感動、開心？
> **AI**：對，是感動！選項 D「感動」就是答案。下次推論情緒，記得找「主角做了什麼」+「為什麼這樣做」，不要只找一個情緒詞。

**評估標準**：
- ✅ 「理解」：能從動作/對話推論情緒
- ⚠️ 需再引導：能找到動作但無法解讀
- ❌ 需 Step 5：堅持「文章沒寫情緒所以不知道」

---

### Template 5：圖表繪製與判讀──折線圖

**對應 lessons**（共 2 課，G7-G9，**5/1 會議單元 B 的姊妹策略**）：
- 7-7 你看見時代的灰犀牛了嗎？談人口負成長
- 9-8 臺灣學生的閱讀力：美麗與哀愁

**System prompt 注入區塊**：

```
本課閱讀策略：【圖表繪製與判讀──折線圖】

策略定義：
文章搭配折線圖，學生要學會「讀圖」+「結合文字」。重點包含：座標軸是什
麼、線條走勢（上升/下降/持平）、轉折點、極值、文字描述與圖表的對應關係。

引導重點：
- Step 2 找段落時，先問學生「圖在哪個段落附近？」（很多學生忽略圖）
- Step 3 復述時，要求學生用「X 軸是 ___，Y 軸是 ___，從 ___ 年到 ___ 年是
  ___（上升/下降）」這個句型
- Step 4 拉回題目時，把「文字推論題」和「讀圖題」分開
- 學生最常犯的錯：完全跳過圖，只看文字（眼動研究：低成就學生不看圖）
- AI 必須主動提醒「先看圖」
```

**範例對話**（lesson 7-7 人口負成長，題目：根據圖表，臺灣人口何時開始下降？）

> **AI**（Step 1）：你選了【A：2010 年】，我們來看圖。先說說，題目在問什麼？
> **學生**：問人口什麼時候開始減少。
> **AI**（advance to Step 2）：對。這題答案不在文字裡，要看圖。你有看那張折線圖嗎？
> **學生**：沒有，我跳過了。
> **AI**（advance to Step 3）：沒關係，現在一起看。X 軸是年份，Y 軸是人口數。你看線條從哪一年開始往下掉？
> **學生**：好像 2020 年開始往下。
> **AI**（advance to Step 4）：對，2020 年是轉折點。再看選項，哪個是 2020？
> **學生**：【C：2020 年】。
> **AI**：答對！記得，看到文章裡有圖，先停下來看圖再讀文字。圖通常會直接告訴你答案。

**評估標準**：
- ✅ 「理解」：能正確讀出座標軸 + 找轉折點
- ⚠️ 需再引導：看圖但讀錯軸
- ❌ 需 Step 5：完全跳過圖

---

## Schema Extension（給 backend 參考）

擴充現有 `EVALUATION_SCHEMA`：

```yaml
# 新增欄位
current_step:        # 1-5，目前在哪個 SOP 步驟
  type: integer
  enum: [1, 2, 3, 4, 5]

should_advance:      # 是否應 advance 到下一步
  type: boolean

should_terminate:    # 是否結束對話（答對 / 主動退出 / 放棄）
  type: boolean

terminate_reason:    # 結束原因
  type: string
  enum: [resolved_with_guidance, direct_teaching, opt_out, give_up, max_turns]
  nullable: true

give_up_detected:    # 學生是否在敷衍（連續 3 次「不知道」）
  type: boolean

attempts_in_step:    # 此步驟內已 retry 幾次（給 backend 限制 max retry）
  type: integer
```

---

## 技術實作 sketch（不寫 code）

### Backend

- **新 module**：`backend/app/services/mcq_rescue_agent.py`（不修改 `socratic_agent.py`）
  - 沿用 `SessionStore` pattern，但 session key 改用 `mcq_rescue_{user}_{question_id}`（每題獨立）
  - 沿用 circuit breaker / rate limit / TTL
  - 新增 `start_rescue(question, options, wrong_choice, correct_answer, lesson_id)` API
  - 新增 `process_student_response(session_id, text)` API（回 `RescueResponse` dataclass，含 `current_step / should_advance / should_terminate / next_question / feedback`）
- **Prompt loader**：`backend/app/services/strategy_prompts.py` 從 `data/strategy_prompts/` 讀 per-strategy YAML
  - YAML 結構：`{strategy_id, definition, guidance_per_step (1-5), common_errors, language_register}`
  - Fallback：找不到 strategy 對應時，用 `default.yml`（純走 5 步驟，無策略 hint）
- **新 endpoint**：`POST /api/learning/mcq-rescue/start` + `POST /api/learning/mcq-rescue/respond`
  - `start` 接 `{question_id, lesson_id, wrong_choice}`，回 `{session_id, ai_first_message, current_step: 1}`
  - `respond` 接 `{session_id, student_text}`，回完整 `RescueResponse`
- **記錄到 DB**（給「努力分」用，曾教授要求）：
  - 新 table `mcq_rescue_session`：`{id, user_id, question_id, lesson_id, started_at, ended_at, total_turns, final_step, outcome, retry_count}`
  - 寫入時 idempotent，FK 加 index（依 LingoLeap 規則：`sqlalchemy-model-safety` skill）

### Frontend

- **新 component**：`frontend/src/components/reading-spotlight/McqRescueDialog.tsx`
  - 用 modal / inline panel 跳出，**不**強制學生互動（可關掉，記為 opt_out）
  - UI 顯示「目前在第 N 步」（progressbar），讓學生知道對話會結束
  - 整合既有 `SessionExpiredError` 重建 session pattern
  - 5 步驟用顏色 / icon 區分（給語音版預留位）

### 整合 Web Speech API（語音版，7/1 deadline）

- 文字版穩定後，套 Web Speech API：
  - **STT**：`webkitSpeechRecognition`（Chrome / Safari），`lang='zh-TW'`，`interim_results=true`
  - **TTS**：沿用既有 Chirp3-HD Sulafat（後端預生成）— 或臨時用 browser SpeechSynthesis fallback
  - Push-to-talk button（避免一直 listen 收到雜音）

---

## 評估標準（如何判斷 prompt 有效）

### 量化指標（記錄到 DB）

| 指標 | 目標 | 計算 |
|------|------|------|
| `rescue_success_rate` | > 60% | `outcome=resolved_with_guidance` / total rescue sessions |
| `direct_teaching_rate` | < 25% | `outcome=direct_teaching` / total |
| `give_up_rate` | < 15% | `outcome=give_up` / total |
| `avg_turns_to_resolve` | 4-6 turns | resolved sessions 的平均 turn 數 |
| `step_distribution` | 均勻 | 哪一步驟最常 fail（找瓶頸） |

### 質化指標（人工抽樣）

- 每週抽樣 20 個 session 給陳教授 / 林校長 review
- 評分項目：
  1. AI 是否有遵守「不直接給答案」原則
  2. AI 的提問是否符合該策略
  3. 語氣是否合適（不書面化、不像考試）
  4. 學生答對之後，AI 有沒有 connect 回策略概念

---

## Future: 語音升級

### 文字 → 語音的 prompt 調整

| 文字版 | 語音版 |
|--------|--------|
| 「你說的有道理，我想了解一下——你是從課文哪裡看到這個線索的？」| 「嗯，我懂你的想法。那你是從課文哪邊看到這個的？」（短、口語） |
| 「請參考第 3 段第二句」| 「你回去看第三段，最前面那兩句」（不用「請參考」這種書面語） |
| 「你的回答展現了對課文的初步理解」| 「不錯喔！你抓到重點了！」 |

### 哪些 prompt 不適合語音

- ❌ Step 5「直接給答案 + 寫長解釋」→ 語音念出來太長，學生聽不下去 → 改成「答案是 A，因為○○○。等下你看螢幕上的解釋。」
- ❌ MCQ 選項唸出來：A、B、C、D 四個選項全唸太冗長 → UI 仍顯示文字，AI 只說「再看一次選項，哪個對？」
- ❌ 圖表題（Template 5）→ 語音很難描述圖，必須搭配畫面指引：「你看那張圖，X 軸寫年份的那條」

### 額外考量

- **Push-to-talk**：避免持續收音收到背景噪音
- **打斷機制**：學生講話時 AI 暫停 TTS（barge-in）
- **超時處理**：學生沉默 10 秒 → AI 主動問「你還在嗎？需要我再說一次嗎？」
- **語速**：Sulafat 0.9x（既有設定）對國中生剛好

---

## 開放問題（需 Young / 教授確認）

1. **Step 1 必走 vs 可跳？**
   - 林校長 SOP 是 5 步驟全走，但陳教授說「精簡版可行」。
   - **問題**：當學生第一句話就答對（例如直接說「應該是 C 吧」），AI 應該堅持走 Step 1-4，還是可以直接 jump 到 Step 4 確認？
   - **建議**：偵測學生第一句包含選項代號 → fast-forward 到 Step 4，不走前 3 步。

2. **「努力分」如何呈現？**
   - 曾教授說「努力應該可以計分」，但目前學生報告沒有「引導對話分數」這個欄位。
   - **問題**：要在學生端顯示「你這題引導後答對，獲得 50% 努力分」嗎？還是只給教師後台看？
   - **建議**：學生端只顯示「引導後答對 ✓」（不給數字，避免標籤化），後台給教師看詳細 metrics。

3. **Per-strategy template 的 coverage**
   - 158 課對應約 **40+ 個策略**（從 curriculum index 看）。
   - **問題**：是否所有策略都要寫 template？還是先做 5/1 會議指定的單元 A（摘要）+ 單元 B（圖文整合）= 7 課？
   - **建議**：7/1 deadline 只做 2 個策略（4+3 課）。其餘策略用「default fallback prompt」（純走 5 步驟，不注入策略 hint）。8 月後再依使用數據優先補高頻策略。

4. **Rescue dialog 的 max_turns 上限**
   - 5 步驟 × 平均每步 2 turns ≈ 10 turns，加 retry 容許值，建議 cap 12 turns。
   - **問題**：12 turns 是否合理？還是學生會覺得「拖太久」想退出？
   - **建議**：先用 12，上線後看 `avg_turns_to_resolve` 數據調整。

5. **語音版的 fallback 策略**
   - 學生環境吵雜 / 麥克風壞 / 不想說話 時，怎麼 graceful degrade？
   - **建議**：UI 永遠保留「打字回答」按鈕，學生可隨時切換。

6. **與既有 socratic_agent 的關係**
   - 閱讀聚光燈步驟結束後，是否仍走既有 `ComprehensionChat`（5 題 3 階段）？還是 MCQ rescue 取代它？
   - **建議**：保留既有 `ComprehensionChat`（針對整篇課文）。MCQ rescue 是「per question」，兩者並行不衝突。

---

## Acceptance Criteria（什麼才算「prompt 設計完成」）

- [ ] 5 步驟 SOP 寫清楚，每步驟有提問範例 + advance 條件 + 結束條件
- [ ] 至少 5 個策略的完整 template（含策略定義 + 範例對話 + 評估標準）
- [ ] Schema 擴充欄位明確（給 backend implement）
- [ ] 6 個開放問題有 Young 的 default decision（教授可後續調整）
- [ ] 陳教授 review 過範例對話（語氣 / 引導順序）
- [ ] 林校長 confirm 5 步驟切分符合現場老師做法
- [ ] 語音版 fallback / 不適合語音的 prompt 已標註

---

## 變更歷史

| 日期 | 版本 | 改動 | 作者 |
|------|------|------|------|
| 2026-05-01 | v1 draft | 初稿，根據 5/1 會議 + 既有 socratic_agent.py 設計 | Young / Claude |
