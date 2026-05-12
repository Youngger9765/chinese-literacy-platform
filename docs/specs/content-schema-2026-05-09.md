# Content Standardization Schema Spec
# 學習目標 / 課文簡介 / 學習步驟 欄位定義

**Version**: 1.0 (draft for review)
**Date**: 2026-05-09
**Issue**: #1509
**Status**: DRAFT — awaiting Young + 教授 review before implementation
**Related**: #1374 (step_sequence schema-driven), #1508 (Intro 數位流程), #1517, #1518

---

## Background

5/8 weekly walkthrough of 7 demo lessons revealed three content data problems:

1. **學習目標混淆**: A strategy diagram image caption was being rendered as `learning_goal` for some lessons — the field did not exist as a canonical YAML key; the platform was misreading other fields.
2. **課文簡介混淆**: Some lessons had `lesson_intro.text` that read like a learning goal rather than a lesson introduction (e.g. a very short topic tag `「運動+運動家精神」` rather than a narrative intro).
3. **學習步驟誤植**: The Intro page was rendering `worksheet_section_order` (paper-form step count) as "本課 N 個學習步驟", but the paper step count does not match the digital platform step sequence.

Young's 5/8 conclusion (verbatim): "我們自己把它定下來，而不是被 PDF 左右。"

---

## Audit Counts (parsed YAML corpus: 151 lessons)

| Field | Present | Missing | Empty text | Notes |
|-------|---------|---------|------------|-------|
| `lesson_intro` | 41 (27%) | **110 (73%)** | 0 | 41 with valid text; quality varies by source |
| `learning_goal` | 0 (0%) | **151 (100%)** | — | Field does not exist in corpus — rendered via misreading other fields |
| `step_sequence` | 1 (1%) | 150 (99%) | — | Only G7-L23 has it; all others use `DEFAULT_STEP_SEQUENCE` |
| `worksheet_section_order` | 147 (97%) | 4 | — | Paper form steps, currently displayed as digital step count (wrong) |

**Summary**: `learning_goal` needs to be defined as a new field. `lesson_intro` exists in 41/151 lessons and has three source types (`excel`, `docx_explanation`, `docx_guide`). 110 lessons are missing it entirely and currently show a fallback placeholder. `step_sequence` works correctly for G7-L23; the 150 remaining lessons use `DEFAULT_STEP_SEQUENCE` which is correct behavior — the Intro page bug is that it displays `worksheet_section_order.length` (paper step count) as the step label instead.

### lesson_intro Source Breakdown

| Source type | Count | Quality |
|-------------|-------|---------|
| `excel` | ~29 | Short topic tag (e.g. `本課探討「運動+運動家精神」主題，學習「自我提問」的閱讀方法。`) — concise but formulaic |
| `docx_explanation` | ~10 | Full paragraph — best quality (e.g. G7-L28/29/30 have rich 100-150 char paragraphs) |
| `docx_guide` | ~2 | Medium (文言文 lessons) |

### 7 Demo Lessons Status

| Lesson | lesson_intro | learning_goal | step_sequence |
|--------|-------------|---------------|---------------|
| G6-L22 | excel (present) | MISSING | uses default |
| G6-L23 | excel (present) | MISSING | uses default |
| G6-L24 | excel (present) | MISSING | uses default |
| G6-L25 | excel (present) | MISSING | uses default |
| G7-L28 | docx_explanation (present, rich) | MISSING | uses default |
| G7-L29 | docx_explanation (present, rich) | MISSING | uses default |
| G7-L30 | docx_explanation (present, rich) | MISSING | uses default |

All 7 demo lessons already have `lesson_intro`. The `learning_goal` field is absent from all 151 lessons. The Intro page bug for "本課 N 個步驟" is a display logic issue, not a data issue.

---

## Field A: `learning_goal` (新欄位)

### Definition

| Attribute | Value |
|-----------|-------|
| **YAML key** | `learning_goal` |
| **YAML type** | `string` or `null` |
| **Required** | Optional (nullable) |
| **Max length** | 100 characters |
| **Source of truth** | Educator-edited (教師自填) — NOT AI-generated, NOT auto-parsed from docx |
| **Display location** | Intro page — "學習目標" banner (currently renders `worksheetIntro.target_strategy`) |

### Rationale

5/8 decision: 教授原意是讓老師自填。This means:
- The field ships as `null` for all 151 existing lessons.
- Teachers fill it in via the future admin/teacher-assignment UI.
- The Intro page already has a "學習目標" banner component that reads `worksheetIntro.target_strategy`. After this spec is implemented, the render priority becomes: `learning_goal` → `worksheetIntro.target_strategy` (fallback).

### Format Constraint: Simple String (chosen)

Two options were considered:

| Option | Format | Verdict |
|--------|--------|---------|
| A (chosen) | Plain string ≤ 100 chars | Simpler, no structured parsing needed, matches how educators think |
| B (rejected) | `{strategy: str, target: str}` | Over-engineered for current use; can evolve later |

**Chosen format**: plain string, max 100 characters.

### YAML Example (good)

```yaml
learning_goal: 學習透過「圖文比對」策略，整合文字與圖表資訊，精確回答說明文問題
```

### YAML Counter-Example (bad — what was wrong in 5/8 walkthrough)

```yaml
# BAD: image caption text being misread as learning goal
learning_goal: "巴斯德鵝頸瓶實驗的設計與程序"  # This is a figure caption, not a goal
```

```yaml
# BAD: null because the field didn't exist, but the platform was pulling
# worksheetIntro.target_strategy as a substitute (which is a strategy tag, not a learning goal)
# 例: worksheetIntro.target_strategy = "摘要策略-問題.解決.結果結構"
# displayed as "學習目標" banner — confusing because it's a strategy code, not a learner-facing statement
```

### Pydantic Schema Addition

Add to `StoryDetail` in `backend/app/schemas/story.py`:

```python
# Per-lesson learning goal — educator-filled, nullable (Refs #1509)
# None means teacher has not yet filled; front-end shows no banner or placeholder
learning_goal: Optional[str] = Field(default=None, max_length=100)
```

---

## Field B: `lesson_intro` (既有欄位，規範化)

### Current State

`lesson_intro` already exists in `StoryDetail` (added in #1443) as `Optional[dict]`. It is present in 41/151 parsed lessons. The Intro page renders it as "課文簡介" with a fallback chain:

```
lessonIntro.text → worksheetIntro.target_strategy → intro.background
```

### Canonical Structure

| Attribute | Value |
|-----------|-------|
| **YAML key** | `lesson_intro` |
| **YAML type** | `object` with subfields, or `null` |
| **Required** | Optional (nullable) |
| **Source of truth** | Docx parser (auto-extracted from `docx_explanation` / `docx_guide` sections) OR Excel strategy table |
| **Display location** | Intro page — "課文簡介" section (below 學習目標 banner) |

### Subfield Schema

```yaml
lesson_intro:
  source: "docx_explanation"   # Required: 'docx_explanation' | 'docx_guide' | 'excel'
  text: "..."                   # Required: the actual intro text shown to students
  unit_topic: "..."             # Optional: topic tag from Excel (e.g. "運動+運動家精神")
  strategy_title: "..."         # Optional: strategy name (e.g. "自我提問")
```

| Subfield | Type | Required | Max length | Notes |
|----------|------|----------|------------|-------|
| `source` | string (enum) | Yes | — | `docx_explanation`, `docx_guide`, `excel` |
| `text` | string | Yes | 300 characters | The narrative shown to students |
| `unit_topic` | string | No | 50 chars | From Excel; e.g. `運動+運動家精神` |
| `strategy_title` | string | No | 80 chars | Strategy name from Excel |

### Distinction from `learning_goal`

| | `learning_goal` | `lesson_intro.text` |
|--|-----------------|---------------------|
| Who writes it | Teacher | Auto-parsed from docx / Excel |
| Audience | Student (what they will learn) | Student (what the lesson is about) |
| Length | ≤ 100 chars | 50–300 chars |
| Example | `學習透過圖文比對策略，整合文字與圖表資訊` | `圖文題在近年會考國文科的比重大幅增加⋯這一課我們用一個科學史上有名的實驗，來學習如何閱讀、解答圖文題。` |
| Nullable | Yes (teacher hasn't filled yet) | Yes (not parsed from docx yet) |

### YAML Example (good — G7-L28)

```yaml
lesson_intro:
  source: docx_explanation
  text: 圖文題在近年會考國文科的比重大幅增加——114年會考圖文題有9題，但十年前（105年）的會考卻只有1題。圖文題就是「文字帶著插圖」的題目，你不能只看文字，也不能只看插圖，眼睛必須在文字和插圖中來回移動，把文圖之間的關係弄清楚，才能又快又正確地答題。這一課我們就用一個科學史上有名的實驗，來學習如何閱讀、解答圖文題。
```

### YAML Counter-Example (bad — what was wrong in 5/8 walkthrough)

```yaml
# BAD: lesson_intro.text is identical to learning_goal text — mixed up roles
lesson_intro:
  source: excel
  text: 本課探討「運動+運動家精神」主題。
  # This is a topic tag, not an introductory paragraph.
  # It reads like a learning_goal statement, not a lesson introduction.
  # Student sees "課文簡介: 本課探討運動+運動家精神主題" — not informative.
```

### Quality Flag for Audit

Excel-sourced `lesson_intro.text` entries are formulaic (`本課探討「X」主題，學習「Y」的閱讀方法。`) and contain minimal information for the student. These 29 entries should be flagged for enrichment — either by re-parsing the docx for an explanation section, or by educator manual edit.

---

## Field C: `step_sequence` + Intro Page Step Count Display

### Current Behavior (post #1518)

`step_sequence` is optional. When present in YAML, it overrides `DEFAULT_STEP_SEQUENCE` via `resolveActiveSteps()`. When absent, the frontend uses `DEFAULT_STEP_SEQUENCE` (11 enabled steps). This is correct and working.

The **bug** identified in 5/8 walkthrough is in the Intro page display:

```tsx
// Current (Intro.tsx line 281) — WRONG
本課 {story.worksheetSectionOrder.length} 個學習步驟
```

`worksheetSectionOrder` is the paper learning sheet's section list (e.g. 3–6 steps from the PDF). It does not represent the digital platform step count. The Intro page was showing "本課 3 個學習步驟" when the platform actually has 11 digital steps.

5/8 decision: "Intro 頁面的步驟應該講的是數位的學習步驟，不是紙本的。"

### Spec: `intro_step_count` Override Field

This is a **display-only** label field. It does not affect routing or `resolveActiveSteps()`.

| Attribute | Value |
|-----------|-------|
| **YAML key** | `intro_step_count` |
| **YAML type** | `integer` or `null` |
| **Required** | Optional (nullable) |
| **Range** | 1–20 |
| **Source of truth** | Auto-computed from `resolveActiveSteps()` — this field is only needed if a lesson wants to OVERRIDE the computed count for display purposes |
| **Display location** | Intro page — "本課 N 個學習步驟" label |

**Default behavior** (recommended): Compute `N` from `resolveActiveSteps(lessonStepSequence)` in the frontend, not from YAML. The display label shows the actual digital step count. `intro_step_count` override is only needed for edge cases where the count label must differ from the resolved sequence.

### Recommended Fix for Existing Bug

Rather than adding a new YAML field, fix the Intro.tsx display logic:

```tsx
// Proposed (Intro.tsx) — derive count from digital step sequence, not paper worksheet
const digitalStepCount = resolveActiveSteps(story.stepSequence ?? null).length;
// Only show this section if there are active steps
{digitalStepCount > 0 && (
  <span className="...">本課 {story.introStepCount ?? digitalStepCount} 個學習步驟</span>
)}
```

`story.introStepCount` (from `intro_step_count` YAML) is an override escape hatch. Default: compute from digital sequence.

### `step_sequence` Field (existing, documented here for completeness)

| Attribute | Value |
|-----------|-------|
| **YAML key** | `step_sequence` |
| **YAML type** | `array[string]` or `null` |
| **Required** | Optional (nullable) |
| **Values** | Step IDs from `STEP_REGISTRY` (e.g. `reading-annotation`, `tutor`, `comprehension`, `knowledge-station`, `report`) |
| **Source of truth** | Engineering decision — set when a lesson deviates from `DEFAULT_STEP_SEQUENCE` |
| **Display location** | Controls which steps appear in the StepperNav |

### YAML Example (good — G7-L23, only lesson with step_sequence)

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - comprehension
  - knowledge-station
  - report
```

### YAML Counter-Example (bad)

```yaml
# BAD: intro_step_count set to paper worksheet step count
intro_step_count: 3   # The PDF has 3 sections, but the platform has 11 digital steps
                      # This was the bug — paper count ≠ digital count
```

---

## Reference YAML: Complete Demo Lesson (G7-L28)

The following is the complete canonical YAML with all three fields correctly filled. Other 6 demo lessons can copy the pattern.

```yaml
lesson_code: G7-L28
grade: 7
grade_code: G7-L28
reading_strategy: 圖文整合閱讀策略
reading_strategy_type: graphic_text_integration
layout_mode: graphic-text
genre: 說明文
title: 看不見的兇手：以實驗破解肉湯腐敗之謎

# ── Field A: learning_goal ───────────────────────────────────────────
# Teacher-filled, nullable. Currently null — will be filled by educator.
learning_goal: null

# ── Field B: lesson_intro ────────────────────────────────────────────
# Source: docx_explanation section. Rich narrative paragraph.
# Distinction from learning_goal: describes what the lesson IS ABOUT,
# not what the student will LEARN TO DO.
lesson_intro:
  source: docx_explanation
  text: >
    圖文題在近年會考國文科的比重大幅增加——114年會考圖文題有9題，
    但十年前（105年）的會考卻只有1題。圖文題就是「文字帶著插圖」的題目，
    你不能只看文字，也不能只看插圖，眼睛必須在文字和插圖中來回移動，
    把文圖之間的關係弄清楚，才能又快又正確地答題。
    這一課我們就用一個科學史上有名的實驗，來學習如何閱讀、解答圖文題。

# ── Field C: step_sequence + intro_step_count ────────────────────────
# step_sequence: null → uses DEFAULT_STEP_SEQUENCE (all 11 digital steps)
# intro_step_count: null → Intro page computes from resolveActiveSteps()
# Do NOT set intro_step_count to the paper worksheet section count (3–6).
step_sequence: null
intro_step_count: null

# ── Existing fields (not changed by this spec) ───────────────────────
authors: 課文：曾世杰 學習單：陳淑麗
worksheet_pdf_url: https://storage.googleapis.com/lingoleap-assets/worksheets/G7-L28.pdf
worksheet_intro:
  step_label: 讀全文-做記號
  target_strategy: 圖文整合閱讀策略
  level_label: Level 4・說明文
  lesson_label: 第28課 看不見的兇手
  authors: 課文：曾世杰  學習單：陳淑麗
```

### Mapping for Other 6 Demo Lessons

| Lesson | learning_goal | lesson_intro status | step_sequence |
|--------|---------------|---------------------|---------------|
| G6-L22 | null (educator to fill) | excel source, acceptable quality | null (default) |
| G6-L23 | null (educator to fill) | excel source, acceptable quality | null (default) |
| G6-L24 | null (educator to fill) | excel source, acceptable quality | null (default) |
| G6-L25 | null (educator to fill) | excel source, acceptable quality | null (default) |
| G7-L28 | null (educator to fill) | docx_explanation, rich — **reference** | null (default) |
| G7-L29 | null (educator to fill) | docx_explanation, rich | null (default) |
| G7-L30 | null (educator to fill) | docx_explanation, rich | null (default) |

---

## Migration Plan: 158 Lessons

> Note: The parsed YAML corpus has 151 files. The MEMORY.md states 158 total lessons (including unparsed / in-progress). The delta of 7 lessons likely reflects lessons parsed after 5/1 or not yet added to the corpus.

### Field A: `learning_goal` — All 151 lessons missing

**Recommendation: Do nothing in code — field is teacher-filled.**

- Add `learning_goal: null` to YAML schema defaults (it will be `None` in Pydantic if absent).
- The Intro page already has a "學習目標" banner that only renders when `worksheetIntro.target_strategy` exists. Change render priority to: `learning_goal` first → `worksheetIntro.target_strategy` fallback.
- No bulk data migration needed. Teachers fill it via admin UI (future feature).
- **Estimated effort**: 1–2 hours (Pydantic field addition + Intro.tsx render priority update).

### Field B: `lesson_intro` — 110 lessons missing

| Segment | Count | Action | Owner |
|---------|-------|--------|-------|
| Has `docx_explanation` source | ~10 | Already good — no action | — |
| Has `excel` source (formulaic) | ~29 | Flag for enrichment; acceptable for now | Educator batch edit (future) |
| Missing entirely (no source) | **~110** | Three sub-options (see below) | |

**Sub-options for 110 missing lessons:**

| Option | Method | Quality | Effort |
|--------|--------|---------|--------|
| A. AI auto-generate | Feed lesson text to Gemini, generate 2-sentence intro | Medium | ~2 days engineering |
| B. Leave blank | Show "目前沒有簡介資料" placeholder | Low | 0 (already implemented) |
| C. Educator manual | Admin UI input per lesson | High | Ongoing |

**Recommendation**: Use Option B for now (placeholder already exists). Schedule AI auto-generation (Option A) as a batch job after 7/1 launch — it is a 1-time operation and can be educator-reviewed post-generation.

**7/1 deadline impact**: The 7 demo lessons already have `lesson_intro`. No migration needed before 7/1 for the demo set.

### Field C: `step_sequence` / `intro_step_count` — Display bug fix

**Recommendation: Fix Intro.tsx display logic (no YAML migration needed).**

The `worksheetSectionOrder.length` label is the bug. Fix: compute digital step count from `resolveActiveSteps()`. No YAML changes required for existing lessons.

- `step_sequence` is correct for the 1 lesson that has it (G7-L23).
- `intro_step_count` should not be set in YAML for any lesson (default `null` is correct everywhere).

**Estimated effort**: 30 minutes (Intro.tsx single-line fix).

---

## Summary Table

| Field | YAML type | Required | Who fills | Display | Migration needed |
|-------|-----------|----------|-----------|---------|-----------------|
| `learning_goal` | `string \| null` | Optional | Teacher | Intro "學習目標" banner | No — ships null |
| `lesson_intro` | `object \| null` | Optional | Docx parser / Excel / Teacher | Intro "課文簡介" body | 110 lessons missing — defer to post-launch AI batch |
| `step_sequence` | `array[string] \| null` | Optional | Engineering | Controls StepperNav | 1 lesson has it; correct |
| `intro_step_count` | `integer \| null` | Optional (escape hatch) | Engineering | Intro "本課 N 個步驟" label | None — fix display logic instead |

---

## Open Questions for Young + 教授 Review

1. **`learning_goal` format**: Should it allow multi-line / structured `{strategy, target}` later? If so, should we start with `object` type now to avoid a breaking schema change?

2. **`lesson_intro` quality bar**: Are the 29 Excel-sourced formulaic intros (e.g. `本課探討「運動+運動家精神」主題，學習「自我提問」的閱讀方法。`) acceptable for launch, or do they need enrichment before showing to students?

3. **`intro_step_count` override**: Is there any lesson where the display count should deliberately differ from the resolved digital step count? If not, we can drop this field entirely and just fix the Intro.tsx line.

4. **AI auto-generation for missing `lesson_intro`**: Approved to run as a batch job post-7/1? Should the AI-generated text be marked with `source: ai_generated` for educator review?

5. **`learning_goal` admin UI**: Is the teacher-facing admin UI for filling `learning_goal` in scope for 7/1, or is it a post-launch teacher feature?
