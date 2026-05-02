# AI 助教 Implementation Spec（閱讀聚光燈 MCQ Rescue）

**Issues**: #1340（語音版完整）/ #1387（文字版 Phase 1）
**Priority**: P0 — 7/1 deadline 必含（文字版至少）
**Date**: 2026-05-02
**Status**: Draft（pre-implementation, awaiting eng review）
**Builds on**: `docs/specs/ai-tutor-prompt-template-2026-05-01.md`（prompt + 5 步驟 SOP，PR #1372 已 merge）
**Refs**: 5/1 會議 §三.4-5、林校長 5 步驟 SOP、CEO doc 60-day plan Week 4-6

---

## 0. TL;DR

**Phase 1（7/1 必達，文字版）**：學生在閱讀聚光燈 MCQ 選錯 → AI 主動 popup 對話框 → 走 5 步驟引導（per-strategy prompt） → 學生重答 → 通過/放棄都記錄。

**Phase 2（7/2+，語音版）**：上面對話改 voice agent（TTS 念 AI 回應 + Web Speech recognize 學生語音轉文字）。本 spec **不**包 Phase 2 細節，只 leave hook。

---

## 1. Why（教學法理據）

### 1.1 林校長：「最想許願的功能」
> 「閱讀聚光燈如果能變成語音交談，會是我最想許願的功能。」 — 林國源校長

5/1 會議引文。AI 助教 + 語音是專家會議認定的 #1 期望。

### 1.2 5 步驟 SOP（林校長 + 陳教授精簡版）
1. **確認題意**：學生說對題目的理解
2. **回課文找線索**：邀請回到課文找對應段落
3. **自己的話復述**：學生用自己的話講
4. **拉回題目**：問選項判斷
5. **直接教學（fallback）**：前 4 步都失敗才直接教

### 1.3 為何不夠用既有 socratic_agent？
- 既有 socratic_agent = **5 題 3 階段（factual / inferential / evaluative）** 引導學生**全篇**理解
- AI 助教 = 答**單一 MCQ** 錯時的 **rescue dialogue**，目標讓學生答對這題
- Scope、target、prompt 形態都不同 → 並行新流程，**不取代** socratic_agent

---

## 2. Architecture

### 2.1 元件樹
```
backend/app/services/
├── socratic_agent.py             (existing, 整篇課文引導)
├── mcq_rescue_agent.py           (NEW, 單題 rescue)
│   ├── class RescueState         (dataclass: step 1-5, attempts, give_up_detected)
│   ├── class RescueSessionStore  (mirror SessionStore, 30min TTL, DB-backed)
│   ├── class MCQRescueAgent      (mirror SocraticAgent, _build_system_prompt + step()
│   └── circuit breaker (沿用 ai_service 既有)
└── strategy_prompts.py           (NEW, prompt loader)
    ├── load(strategy_type) -> dict
    └── fallback to default.yml

backend/data/strategy_prompts/    (NEW dir)
├── default.yml                   (generic 5-step)
├── summary_psr.yml               (摘要-問題.解決.結果)
├── summary_problem_solution.yml  (摘要-問題.解決找重點 — G6-L23/24/25)
├── graphic_text_integration.yml  (圖文整合 — G7-L28/29/30)
├── inference.yml                 (推論策略 — 共 5 個 type，可細分後續)
└── ... (per CEO doc, 7/1 demo focus only summary + graphic_text)

backend/app/routes/
└── learning/mcq_rescue.py        (NEW)
    ├── POST /api/mcq-rescue/start          (lesson_id, question_id, wrong_answer)
    ├── POST /api/mcq-rescue/{session_id}/respond  (user_message)
    └── POST /api/mcq-rescue/{session_id}/give_up

frontend/src/
├── components/reading-steps/
│   └── ComprehensionChat.tsx      (existing) ← 偵測學生答錯 → trigger
└── components/mcq-rescue/         (NEW)
    ├── RescueChatBox.tsx          (modal popup, fixed bottom-right)
    ├── RescueMessage.tsx          (single message bubble)
    ├── RescueGiveUpButton.tsx     ("我放棄這題，看答案")
    └── (Phase 2) RescueVoiceMic.tsx  (語音輸入按鈕)
```

### 2.2 Trigger Flow

```
學生在 ComprehensionChat MCQ 選錯選項
   ↓
ComprehensionChat 元件 detect wrong answer
   ↓
POST /api/mcq-rescue/start
   {
     lesson_id: "G7-L28",
     question_id: "Q3",
     wrong_answer: "B",
     correct_answer: "A",
     question: "巴斯德的研究問題是什麼？",
     options: {"A": "...", "B": "...", "C": "...", "D": "..."}
   }
   ↓
Backend mcq_rescue_agent.start()
   ├─ Look up lesson.reading_strategy → load strategy_prompts/<type>.yml
   ├─ Build system prompt（per-strategy）
   ├─ Call Gemini → get Step 1 question (確認題意)
   └─ Save SessionState to DB + memory cache
   ↓
Response: {session_id, current_step: 1, ai_message: "我看到你選了 B...你覺得這題在問什麼？"}
   ↓
Frontend RescueChatBox popup with AI message
   ↓
學生輸入回應 → POST /api/mcq-rescue/{sid}/respond {user_message: "..."}
   ↓
Backend agent.step(user_message)
   ├─ Append user_message to history
   ├─ Build system prompt 包含當前 step + 過去對話
   ├─ Call Gemini → return: { ai_feedback, should_advance, should_terminate, give_up_detected }
   └─ Save state
   ↓
如果 should_advance → step += 1，next AI message 是 Step 2 prompt
如果 should_terminate → 結束（學生通過 or 放棄），return final score
如果 give_up_detected → 主動詢問「需要我直接告訴你答案嗎？」（學生可選）
   ↓
循環直到 step == 5 finished or give_up
   ↓
記錄到 LearningSession.mcq_rescue_attempts (NEW JSONB column)
   ├─ {question_id, attempts, total_steps, final_step_reached, give_up}
```

### 2.3 Schema 擴充

**Backend `SessionState`** (in mcq_rescue_agent.py):
```python
@dataclass
class RescueState:
    session_id: str
    lesson_id: str
    question_id: str
    wrong_answer: str
    correct_answer: str
    question_text: str
    options: dict  # {"A": "...", ...}
    strategy_type: str  # for prompt selection
    
    current_step: int = 1  # 1-5
    history: list[dict] = field(default_factory=list)  # [{role, content, ts}]
    attempts: int = 0
    give_up_detected: bool = False
    terminated: bool = False
    final_outcome: str | None = None  # "passed" / "gave_up" / "max_steps"
    created_at: float = field(default_factory=time.time)
```

**LLM response schema**（Gemini structured output）:
```python
RESCUE_SCHEMA = {
    "type": "object",
    "properties": {
        "ai_feedback": {"type": "string", "maxLength": 200},  # 對學生的回應，短
        "current_step": {"type": "integer", "minimum": 1, "maximum": 5},
        "should_advance": {"type": "boolean"},  # 進下一步
        "should_terminate": {"type": "boolean"},  # 結束（學生通過）
        "give_up_detected": {"type": "boolean"},  # 偵測到放棄訊號（"我不知道"x3）
        "reasoning": {"type": "string", "maxLength": 100},  # debug + audit (CLAUDE.md memory)
    },
    "required": ["ai_feedback", "current_step", "should_advance",
                 "should_terminate", "give_up_detected", "reasoning"],
}
```

**LearningSession DB**（migration needed）:
```python
# backend/app/models/learning.py
class LearningSession(Base):
    # ... existing fields ...
    mcq_rescue_attempts = Column(
        JSONB, nullable=True,
        server_default=text("'[]'::jsonb")
    )  # list of {question_id, attempts, final_step, outcome}
```

---

## 3. Prompt Engineering（Phase 1 必達 2 strategy）

### 3.1 7/1 必含 strategy prompt files

| Lesson 類型 | Strategy type | Prompt file | 哪些課用 |
|---|---|---|---|
| 摘要-問題.解決.結果 | `summary_psr` | `summary_psr.yml` | G6-L22 |
| 摘要-問題.解決找重點 | `summary_problem_solution` | `summary_problem_solution.yml` | G6-L23/24/25 |
| 圖文整合 | `graphic_text_integration` | `graphic_text_integration.yml` | G7-L28/29/30 |

→ 7 課覆蓋。其他策略 fallback to `default.yml`（後續再補）。

### 3.2 Strategy prompt YAML schema

```yaml
strategy: summary_psr
description: 摘要策略 — 問題.解決.結果結構
opening: |
  我看到你這題有一點卡住，沒關係，我們一起想想看~先告訴我，
  你覺得這個題目在問什麼？

steps:
  - step: 1
    name: confirm_understanding
    prompt: |
      聚焦在「題目本身」。如果學生講不出來或誤解，引導他重讀題幹，
      不要直接給答案。advance 條件：學生能用自己的話複述題目。
    advance_signals: [restated_question_correctly, asks_for_clarification_then_understood]
    fail_signals: [shrug, "不知道", switches_topic]

  - step: 2
    name: locate_in_text
    prompt: |
      引導學生回到課文找「跟題目有關的段落」。問「課文哪裡提到這個？」
      不要替學生指段落，讓他找。advance 條件：學生說出對應段落或關鍵句。
    advance_signals: [refers_to_specific_paragraph, quotes_text]
    fail_signals: [random_guess, "都看過了"]

  - step: 3
    name: paraphrase_in_own_words
    # ... 

  - step: 4
    name: relate_to_question
    # ...

  - step: 5
    name: direct_teach_fallback
    prompt: |
      前 4 步都未通過。直接教：「答案是 X，因為課文 Y 段提到 Z」。
      最後問學生「現在懂了嗎？」結束（terminate）。

terminate_conditions:
  - student_explicitly_passes_test  # answers correctly when re-prompted
  - give_up_after_3_dont_knows
  - max_steps_5_completed

tone:
  - 短句，2-3 句一輪
  - 口語化（「沒關係」「我們一起」「想想看」）
  - 不過度誇獎
  - 不直接給答案直到 step 5
```

### 3.3 Default fallback `default.yml`

per #1372 spec 的通用 5 步驟版本。

---

## 4. Frontend 整合

### 4.1 Trigger 在 ComprehensionChat

```tsx
// frontend/src/components/reading-steps/ComprehensionChat.tsx
function ComprehensionChat({ lesson, session }) {
  const [activeRescue, setActiveRescue] = useState<RescueSession | null>(null);

  async function handleAnswer(qid: string, answer: string) {
    const correct = checkAnswer(qid, answer);
    if (!correct && lesson.images?.length === 0) {  // 文字版優先；圖文題暫不 trigger（待 Phase 2）
      const rescue = await api.startMcqRescue({
        lesson_id: lesson.id,
        question_id: qid,
        wrong_answer: answer,
        // ...
      });
      setActiveRescue(rescue);
    }
  }

  return (
    <>
      <McqQuestionList ... />
      {activeRescue && (
        <RescueChatBox
          session={activeRescue}
          onClose={() => setActiveRescue(null)}
          onComplete={(outcome) => {
            // log to analytics + offer retry MCQ
            setActiveRescue(null);
          }}
        />
      )}
    </>
  );
}
```

### 4.2 RescueChatBox 元件

- Modal popup，desktop 右下角 fixed，mobile 覆蓋全螢幕底部 50%
- Message thread（AI + user 交替氣泡）
- Input 區：text input + send button
- "我放棄這題" button（give_up，跳 step 5 直接教）
- 步驟指示：上方小步驟列「1 ─ 2 ─ 3 ─ 4 ─ 5」，當前 step 高亮
- 載入中：dot dot dot 動畫（AI 思考中）

### 4.3 Phase 2 hook（語音版）

`RescueVoiceMic.tsx`（後續）：
- Web Speech API recognize 學生語音 → 自動填到 input
- TTS API 念 AI 回應（Google Chirp3-HD 既有 stack）

→ Phase 1 留 prop hook，Phase 2 直接接上。

---

## 5. Risk + 緩解

| Risk | 機率 | Impact | 緩解 |
|---|---|---|---|
| AI hallucination 給錯誤引導（誤導學生）| High | High | per-strategy 收緊 prompt + reasoning field 留 audit + 教授抽查 log + circuit breaker |
| 5 步驟太死板，學生失去耐心 | High | Med | LLM 可主動 advance / terminate（schema 有 should_advance / should_terminate）+ "我放棄" button |
| Latency 太久（5s+）學生跑掉 | High | High | 用 gemini-2.5-flash + 不打 Vertex Search + max_output_tokens 控制 200 + 預生成 cache |
| 答錯就 popup 太煩 | Med | Med | 答錯後 2s 才 popup（給學生看選錯感）+ 學生可關閉（不要 modal 強制）|
| 5 步驟 SOP 教學上不適用所有策略 | Med | High | strategy_prompts/ 多檔分流，必要時可有 < 5 步驟的 strategy 變體 |
| Phase 1 文字版若被學生抗拒，Phase 2 語音也救不了 | Low | High | 5 月底先做 5 學生 alpha 測，feedback 進 prompt v2 |
| 教授覺得引導不像真老師 | High | Med | 教授 review 引導 sample log（per CEO doc Week 6 流程）|

---

## 6. Implementation Plan

### CEO doc Week 4-6 (5/23 ~ 6/12)

**Day 1-2**：Backend service skeleton
- `backend/app/services/mcq_rescue_agent.py` — class scaffolds, sit on top of existing socratic_agent pattern
- `backend/app/services/strategy_prompts.py` — yaml loader + fallback chain
- 1 strategy prompt yaml first（`summary_psr.yml` for G6-L22）

**Day 3-4**：Backend route + DB
- `backend/app/routes/learning/mcq_rescue.py` — 3 endpoints
- Alembic migration: `mcq_rescue_attempts JSONB` on LearningSession
- 沿用既有 rate-limit / auth / circuit breaker
- Unit test happy path + give_up + 5-step termination

**Day 5-6**：Frontend RescueChatBox
- `RescueChatBox.tsx` + `RescueMessage.tsx` + `RescueGiveUpButton.tsx`
- 整合進 ComprehensionChat.tsx wrong-answer handler
- E2E：G6-L22 跑通完整 5 步驟

**Day 7-8**：剩下 strategy prompts
- summary_problem_solution, graphic_text_integration（7 課覆蓋）
- default.yml fallback

**Day 9-10**：Polish + alpha
- 5 學生內部 alpha 測（透過林校長）
- bug fix + prompt v2 based on feedback

---

## 7. Acceptance Criteria（7/1 demo gate）

- [ ] 7 課（G6-L22~25, G7-L28~30）MCQ 答錯能 trigger AI 助教
- [ ] 5 步驟 SOP 在每課都可走完（人工測 ≥3 次每課）
- [ ] AI 不直接給答案的比例 ≥ 90%（前 4 步驟）
- [ ] Latency p50 < 3s（gemini-2.5-flash + tight prompt）
- [ ] 給 up button 可中斷且記錄
- [ ] 5 步驟通過後可重答 MCQ（學生有第二機會）
- [ ] mcq_rescue_attempts 寫入 DB，老師後台可看（後續做）
- [ ] 教授抽查 10 個 rescue session log，引導品質 OK ≥ 80%
- [ ] Phase 2 voice hook 留好 props（不擋）

---

## 8. Open Questions（pre-impl 釐清）

1. **觸發 timing**：答錯立刻 popup vs 答錯後 2s vs 答完整題組才 popup？
2. **學生重答 MCQ 機制**：通過 5 步驟後自動回題目重答？還是另開重答 flow？
3. **#1340 vs #1387 issue 範圍切割**：#1387 標 "Phase 1 implementation" 適合切割成本 spec 的 Day 1-8，剩下 Day 9-10 + Phase 2 進 #1340？
4. **mcq_rescue_attempts schema 細節**：要不要記 full conversation history? 還是只 outcome？
5. **Cost 控制**：每次 rescue session ≤ 5 步驟 = 5 次 Gemini call ≈ NT$0.5。150 學生 × 7 課 × 平均 2 題 rescue = 2100 sessions/週 ≈ NT$1000/週 — accept？

---

## 9. Refs

- 既有 spec：`docs/specs/ai-tutor-prompt-template-2026-05-01.md`（PR #1372，prompt + 5 步驟 SOP detail）
- 5/1 會議記錄 §三.4-5
- CEO doc Week 4-6 plan
- Issue #1340（語音版完整 P0）
- Issue #1387（Phase 1 文字版 P0）
- 既有 `backend/app/services/socratic_agent.py`（mirror pattern）
- 既有 `backend/app/services/ai_service.py:generate_*`（reuse Gemini wrapper）
