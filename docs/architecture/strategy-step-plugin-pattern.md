# Plugin Pattern：策略 + Learning Step 雙軸彈性架構

**Issue**: #1404（scaffold this pattern）
**Builds on**: #1374（schema-driven step composition）、#1392（reading_strategy_type canonical types）、#1372（AI tutor prompt spec）
**Date**: 2026-05-02
**Status**: Active — 此架構是 #1387（AI 助教 implementation）+ #1341（圖文介面）+ 任何未來新策略 / 新 step 的共同基礎

---

## 0. TL;DR

平台用兩個正交的 plugin 軸：
- **Strategy axis**（教學法軸）：每個閱讀策略 = 一個 backend 資料夾（prompt + step recommendation）
- **Step axis**（學習活動軸）：每個學習 step = 一個 frontend component（Intro、LiveTutor、ComprehensionChat、...）

新增其中之一**只動單一軸**，另一軸不變。Lesson YAML 只引用 names，動態 dispatch。

```
新增「比較多元觀點」策略  → 加 1 個 backend 資料夾 + lesson yml 改一個 field（frontend 不動）
新增「concept-mapping」step → 加 1 個 frontend component + STEP_REGISTRY 註冊（backend 不動）
```

---

## 1. 兩軸架構

### 1.1 Strategy Axis（backend）

```
backend/data/strategy_prompts/
├── default/                            ← fallback when strategy_type unknown
│   ├── prompt.yml                      ← 5-step SOP (林校長), generic version
│   └── step_sequence.yml               ← recommended steps (intro, comprehension, vocab, full-reading, report)
├── summary_psr/                        ← 摘要-問題.解決.結果（reading_strategy_type=summary_psr）
│   ├── prompt.yml                      ← per-strategy AI tutor prompt
│   └── step_sequence.yml               ← optional override
├── summary/                            ← 摘要-其他變體
├── graphic_text_integration/           ← 圖文整合
├── inference/                          ← 推論策略 (32 課)
├── compare_contrast/                   ← 比較多元觀點
├── problem_solving/                    ← 解決問題-科學探究法
├── classical_chinese/                  ← 文言文
├── self_questioning/                   ← 自我提問
├── writing_technique/                  ← 寫作手法
└── general/                            ← 65 課的 fallback "general" type
```

**Loader**: `backend/app/services/strategy_prompts.py`
```python
def load_strategy_prompt(strategy_type: str) -> dict:
    """
    Resolution chain:
    1. backend/data/strategy_prompts/{strategy_type}/prompt.yml
    2. backend/data/strategy_prompts/default/prompt.yml
    3. raise ValueError if neither exists (shouldn't happen — default is required)
    """
```

新增策略只需 `mkdir backend/data/strategy_prompts/{new_type}/` + 寫 `prompt.yml`。

### 1.2 Step Axis（frontend）

已存在（#1374）：
```
frontend/src/components/reading-steps/
├── Intro.tsx
├── LiveTutor.tsx
├── ComprehensionChat.tsx
├── VocabPractice.tsx
├── ... (25 個 component)

frontend/src/config/stepConfig.ts
└── STEP_REGISTRY: Map<step-id, {component, label, hint, view, dbStepNumber, enabled}>
└── DEFAULT_STEP_SEQUENCE: ['intro', 'reading-annotation', 'live-tutor', ...]
```

**Hook**: `frontend/src/hooks/useStepSequence.ts`
```ts
export function useStepSequence(lesson: Story | null): StepConfig[] {
  // 1. lesson.stepSequence (per-lesson YAML override) if set
  // 2. DEFAULT_STEP_SEQUENCE fallback
  // 3. filter by STEP_REGISTRY.enabled
}
```

新增 step 只需：
1. `mkdir frontend/src/components/reading-steps/{new-step}/` + 寫 component
2. `STEP_REGISTRY` 註冊：`{ id: 'new-step', component: NewStep, label, hint, view, dbStepNumber }`
3. `AppRoutes.tsx` 加 route
4. lesson yml 在 `step_sequence` 加 `'new-step'`（或加進 `DEFAULT_STEP_SEQUENCE` 影響全 lesson）

---

## 2. 兩軸交會點：Lesson YAML

每個課文 yml 用 names 引用兩軸（不寫死實作細節）：

```yaml
# backend/data/lessons/_parsed_2026-05-01/G7-L28.yml
lesson_code: G7-L28
title: 看不見的兇手...
reading_strategy: 圖文整合閱讀策略         # display name (中文，給 UI)
reading_strategy_type: graphic_text_integration  # canonical type → matches strategy_prompts/{}/
step_sequence:                              # optional, override DEFAULT_STEP_SEQUENCE
  - intro
  - reading-annotation
  - comprehension-chat
  - vocab-practice
  - full-reading
  - report
layout_mode: graphic-text                   # ComprehensionChat variant: standard | graphic-text | graphic-chart
# ... data fields ...
```

**Dispatch logic**：
- Backend AI service：`strategy_prompts.load(lesson.reading_strategy_type)` → `prompt.yml`
- Frontend rendering：`useStepSequence(lesson)` → `step_sequence` or DEFAULT_STEP_SEQUENCE
- ComprehensionChat layout: detect `lesson.layout_mode` → render `StandardLayout` | `GraphicTextLayout` | `GraphicChartLayout`

---

## 3. 新增策略 — 5 分鐘流程

範例：教授要新增「對比閱讀」策略

```bash
# 1. 建資料夾
mkdir backend/data/strategy_prompts/contrast_reading/

# 2. 寫 prompt.yml (template 從 default/prompt.yml copy)
cp backend/data/strategy_prompts/default/prompt.yml \
   backend/data/strategy_prompts/contrast_reading/prompt.yml
# 編輯：客製化 5 步驟 SOP 的 step prompts
vim backend/data/strategy_prompts/contrast_reading/prompt.yml

# 3.（optional）寫 step_sequence.yml — 推薦這策略用什麼 step 順序
vim backend/data/strategy_prompts/contrast_reading/step_sequence.yml

# 4. lesson yml 標 strategy_type
vim backend/data/lessons/_parsed_2026-05-01/G8-L99.yml
# reading_strategy_type: contrast_reading

# 5. commit + push + PR
```

**沒動 frontend 任何 code**。

---

## 4. 新增 Learning Step — 30 分鐘流程

範例：要新增「concept mapping」step（學生畫概念圖）

```bash
# 1. 建 component
mkdir frontend/src/components/reading-steps/concept-mapping/
cat > frontend/src/components/reading-steps/concept-mapping/ConceptMapping.tsx <<'EOF'
import { useLearningSession } from '@/hooks/useLearningSession';
export function ConceptMapping() {
  const { lesson } = useLearningSession();
  return <div>...</div>;
}
EOF

# 2. STEP_REGISTRY 註冊
# frontend/src/config/stepConfig.ts:
#   import { ConceptMapping } from '@/components/reading-steps/concept-mapping/ConceptMapping';
#   STEP_REGISTRY['concept-mapping'] = {
#     id: 'concept-mapping', component: ConceptMapping,
#     label: '概念圖', hint: '畫出文章主要概念', view: AppView.LEARNING,
#     dbStepNumber: 13, enabled: true
#   };

# 3. AppRoutes.tsx 加 route
# <Route path="/learn/:storyId/concept-mapping" element={<ConceptMapping />} />

# 4. （optional）lesson yml step_sequence 加 'concept-mapping'
#    若不動 lesson yml，step 永遠不出現（因 DEFAULT_STEP_SEQUENCE 沒列）

# 5. commit + push + PR
```

**沒動 backend 任何 code**。

---

## 5. 兩軸組合範例

### 範例 A：新增「概念圖」step + 把它對應到「圖文整合」策略
- 加 step（步驟 4）
- 改 `backend/data/strategy_prompts/graphic_text_integration/step_sequence.yml`：
  ```yaml
  recommended_steps:
    - intro
    - reading-annotation
    - comprehension-chat
    - concept-mapping       ← NEW
    - full-reading
    - report
  ```
- G7-L28~30 yml 加 `step_sequence` override 也加 `concept-mapping`
- 結果：圖文整合課文有概念圖 step，其他策略沒影響

### 範例 B：新增「對比」策略 + 用既有 ComprehensionChat
- 只做策略部分（步驟 3）
- 不動 frontend
- 結果：對比策略課文走既有 step flow，但 AI 助教用客製 prompt

---

## 6. Test Coverage 要求

| 軸 | 必要測試 |
|---|---|
| Strategy loader | 1) 已知 type 載入正確 2) unknown type fallback to default 3) prompt.yml 缺欄位時 raise |
| Step registry | 1) 所有 component import 成功 2) DEFAULT_STEP_SEQUENCE 全在 STEP_REGISTRY 3) hook resolves per-lesson override |
| Combined | 1) lesson yml `reading_strategy_type` + `step_sequence` 同時設置時都 dispatch 對 |

---

## 7. Anti-pattern（不要做）

❌ 在 `ComprehensionChat.tsx` 寫 `if (lesson.code.startsWith('G7-L28'))` — hardcode lesson ID
❌ 在 frontend hardcode `if (strategyType === 'summary_psr') ... else if ...` — frontend 不該知道策略名
❌ 把 prompt 字串寫在 backend Python code — 改 prompt 要動 code
❌ 新增 step 卻直接改 `DEFAULT_STEP_SEQUENCE` — 影響所有 legacy lesson
❌ 一個 component 處理多種策略的不同 layout — 用 layout_mode dispatch 變體

---

## 8. 7/1 deadline 內必補的 plumbing

### Done by issue #1404 (this PR)
- [x] `backend/app/services/strategy_prompts.py` loader（fallback chain）
- [x] `backend/data/strategy_prompts/default/prompt.yml`
- [x] `backend/data/strategy_prompts/summary_psr/prompt.yml`（G6-L22 用）
- [x] `backend/data/strategy_prompts/graphic_text_integration/prompt.yml`（G7-L28~30 用）
- [x] Unit tests for loader
- [x] This architecture doc

### Follow-up (不擋 #1404 PR，但 7/1 前要做)
- [ ] Layer-1 57 課 reading_strategy_type backfill（人工 classify）
- [ ] 剩 7 個 canonical type 的 prompt.yml（inference/summary/compare_contrast/...）
- [ ] 7 課 step_sequence override（demo schema-driven）
- [ ] `general` (65 課) 重新 audit 細分（可選）

### Out of scope（7/2+）
- 新增 step axis 的 step（concept-mapping、socratic-deep-dive 等）
- 策略可有多個 prompt variant（A/B test）
- Strategy → 推薦的 layout_mode 自動 dispatch（目前 layout_mode 在 lesson yml 手動設）

---

## 9. Refs

- #1374 schema-driven step composition（已 ship）
- #1372 AI tutor prompt spec（已 ship）
- #1387 AI 助教 implementation（基於本架構）
- #1341 圖文整合介面（基於 layout_mode dispatch）
- 5/1 expert meeting record
- CEO doc: `docs/ceo-review-2026-05-02.md`
