---
spec_id: content.schema.lesson_fields
module: content-schema
title: Content Schema — lesson_intro / learning_goal / step_sequence 欄位定義
stability: active
canonical_source: content-schema-2026-05-09.md
owns_code:
  - backend/app/schemas/story.py
  - frontend/src/components/reading-steps/Intro.tsx
  - frontend/src/config/stepConfig.ts
owns_data:
  - backend/data/lessons/_parsed_2026-05-01/**/*.yml
spec_tests:
  - backend/specs/test_content_schema_spec.py
related_issues: [1509]
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-01
owner: young
---

# Content Schema：lesson_intro / learning_goal / step_sequence 欄位定義

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。它記錄了 Intro 頁面三個欄位的
> 設計意圖、格式規範、允許/禁止的改動，以及已知的 drift。
> 機器可驗的契約在 `backend/specs/test_content_schema_spec.py`。
> 改動 lesson YAML schema 或 Intro.tsx 顯示邏輯前先讀這份。

## 1. 這個 module 在管什麼

Intro 頁面（`frontend/src/components/reading-steps/Intro.tsx`）顯示三類課文後設資料：

| 顯示位置 | 對應欄位 | 說明 |
|---------|---------|------|
| "學習目標" banner | `learning_goal` | 教師自填，描述學生將學到什麼 |
| "課文簡介" 區塊 | `lesson_intro.text` | 自動從 docx/Excel 解析，描述這課在講什麼 |
| "本課 N 個學習步驟" 標籤 | 由 `resolveActiveSteps()` 計算 | 數位學習步驟數，**不是**紙本學習單的章節數 |

這三個欄位在 5/8 weekly walkthrough 中發現混淆問題，本 spec 記錄 Young 的設計決定：
**「我們自己把它定下來，而不是被 PDF 左右。」**

## 2. 唯一真相（canonical source）

**欄位規範以本 INTENT.md 為準，Python Pydantic schema 在
`backend/app/schemas/story.py` 的 `StoryDetail` class 中實作。**

## 3. 三個欄位的規範

### Field A: `learning_goal`（新欄位）

| 屬性 | 值 |
|------|-----|
| YAML key | `learning_goal` |
| YAML type | `string` 或 `null` |
| 必填 | 否（nullable） |
| 最大長度 | 100 字元 |
| 來源 | 教師自填（**不是** AI 自動生成，不是從 docx 解析） |
| 顯示位置 | Intro 頁 "學習目標" banner |

**5/8 決定**：`learning_goal` 是教師填的，不是工程自動產生。它現在對全部 151 課都是 `null`
（因為 field 本身是新的），老師透過未來的 admin UI 填入。Pydantic default = `None`。

**render priority**：`learning_goal` → `worksheetIntro.target_strategy`（fallback）

**好的 example**：
```yaml
learning_goal: 學習透過「圖文比對」策略，整合文字與圖表資訊，精確回答說明文問題
```

**壞的 example**（5/8 walkthrough 發現的問題）：
```yaml
# BAD: image caption 被誤讀成 learning_goal
learning_goal: "巴斯德鵝頸瓶實驗的設計與程序"  # 這是圖說，不是學習目標
```

### Field B: `lesson_intro`（既有欄位，規範化）

| 屬性 | 值 |
|------|-----|
| YAML key | `lesson_intro` |
| YAML type | `object` 或 `null` |
| 必填 | 否（nullable） |
| 來源 | Docx parser 自動抽（`docx_explanation` / `docx_guide`）或 Excel 策略表 |
| 顯示位置 | Intro 頁 "課文簡介" 區塊 |

**subfield schema**：

| subfield | 型別 | 必填 | 最大長度 | 說明 |
|----------|------|------|---------|------|
| `source` | string enum | 是 | — | `docx_explanation` / `docx_guide` / `excel` |
| `text` | string | 是 | 300 字元 | 呈現給學生的課文簡介本文 |
| `unit_topic` | string | 否 | 50 字元 | Excel 來源的主題標籤 |
| `strategy_title` | string | 否 | 80 字元 | 策略名稱 |

**`learning_goal` vs `lesson_intro.text` 的區分**：

| | `learning_goal` | `lesson_intro.text` |
|--|-----------------|---------------------|
| 誰寫 | 教師 | Docx/Excel 自動解析 |
| 描述 | 學生將學到什麼技能（How-to）| 這課在講什麼（What-about）|
| 長度 | ≤ 100 字 | 50–300 字 |
| example | `學習透過圖文比對策略，整合文字與圖表資訊` | `圖文題在近年會考國文科的比重大幅增加……` |

**好的 example**（G7-L28，`docx_explanation` source）：
```yaml
lesson_intro:
  source: docx_explanation
  text: >
    圖文題在近年會考國文科的比重大幅增加——114年會考圖文題有9題，
    但十年前（105年）的會考卻只有1題。圖文題就是「文字帶著插圖」的題目……
```

**壞的 example**（Excel source 質量問題）：
```yaml
lesson_intro:
  source: excel
  text: 本課探討「運動+運動家精神」主題。  # 太短、讀起來像 learning_goal，不像簡介
```

**品質現況**：
- Excel source（~29 課）：公式化短句，acceptable 但 suboptimal
- `docx_explanation` source（~10 課，G7-L28/29/30）：最佳品質
- 完全缺失（~110 課）：目前顯示 placeholder；7/1 後規劃 AI batch 補全

### Field C: `step_sequence` 與 Intro 頁數字顯示

**`step_sequence`**（既有，已正確）：

| 屬性 | 值 |
|------|-----|
| YAML key | `step_sequence` |
| YAML type | `array[string]` 或 `null` |
| 值範圍 | `STEP_REGISTRY` 的 step ID（例：`reading-annotation`, `tutor`, `comprehension`）|
| 來源 | 工程決定，只在課程偏離 `DEFAULT_STEP_SEQUENCE` 時設定 |

151 課中只有 G7-L23 有 `step_sequence`（且已正確運作）。其餘使用 `DEFAULT_STEP_SEQUENCE`（11 個 digital step）。

**Intro 頁 "本課 N 個學習步驟" 顯示邏輯（bug 已修）**：

5/8 發現 Intro.tsx 原本顯示 `worksheetSectionOrder.length`（紙本學習單章節數，通常 3–6），
但這跟數位 step 數（11）根本不是同一件事。5/8 決定：「Intro 頁面的步驟應該講的是
數位的學習步驟，不是紙本的。」

正確做法（`resolveActiveSteps()` 計算）：
```tsx
// Intro.tsx — 正確的數位 step count
const digitalSteps = resolveActiveSteps(story.stepSequence).filter(s => s.id !== 'intro');
// 顯示: 本課 {digitalSteps.length} 個學習步驟
```

`intro_step_count` YAML override 欄位（escape hatch）：預設 `null`，代表用計算值。**不應該
把紙本章節數填進這個欄位**（那是 5/8 的原始 bug）。

## 4. 允許 / 禁止的改動

✅ **允許**
- 在 Pydantic `StoryDetail` 新增 `learning_goal: Optional[str] = Field(default=None, max_length=100)`
- 改 Intro.tsx render priority（`learning_goal` → `worksheetIntro.target_strategy` fallback）
- 用 AI batch job 補全 110 課缺失的 `lesson_intro`（post-7/1，需標 `source: ai_generated`）
- 教師透過 admin UI 填 `learning_goal`（7/1 後功能）
- 調整 `lesson_intro.text` 的最大字元限制（跟教授確認後）

⛔ **禁止（會破壞 content schema 或 UX）**
- 讓 `step_sequence` 控制 Intro 頁的「N 個步驟」label（兩個邏輯互相獨立）
- 把 `worksheetSectionOrder.length`（紙本章節數）顯示為數位步驟數（已知 bug，已修）
- AI 自動生成 `learning_goal` 寫進 YAML（這個欄位的 SOT 是教師，不是 AI）
- 讓 `lesson_intro.text` 超過 300 字元而不更新 Pydantic validation

## 5. 目前已知的 drift（2026-06-01 量測）

> 注意：`content-schema-2026-05-09.md` 原始 spec 的 audit 數字是 151 課（2026-05-09 時間點）。
> 2026-06-01 實測 `_parsed_2026-05-01/` 目錄共有 141 個 G4-G9 yml（不含 L 前綴的低年級課文）。
> `step_sequence` 的覆蓋率在 spec 寫成後大幅提升（現已對多數課文設定）。

| 量測 | 數字（2026-06-01 實測）|
|------|------|
| corpus 中有 `lesson_intro` 的課 | 41 課（spec 5/9 audit）；`_parsed_2026-05-01/` 目錄確認 |
| corpus 中完全缺失 `lesson_intro` 的課 | ~100 課 |
| `learning_goal` 已在 corpus 中的課 | 0（欄位尚未加進任何 YAML，目前透過 Pydantic `None` default 處理）|
| 有 `step_sequence` 的 G4-G9 課文 | 132 / 141（93%）— 比 spec 5/9 audit 時的 1/151 大幅增加（課文擴張後系統性填入）|
| 7 堂 demo 課（G6-L22~25, G7-L28~30）有 `lesson_intro` | 7 / 7（100%）|

→ `test_lesson_intro_present_in_7_demo_lessons` 驗證 7 堂 demo 課的 `lesson_intro` 已存在。
→ `test_learning_goal_field_is_null_or_string` 驗證如果 `learning_goal` 存在則必須是 string（不是 dict / list）。
→ `test_step_sequence_values_are_valid_step_ids` 驗證所有有 `step_sequence` 的課，每個值都在 `STEP_REGISTRY` 中。

## 6. 教學 / 產品脈絡（pytest 寫不進去、但 AI 要知道）

- `learning_goal` 設計讓老師有主控感（教師決定這課要教什麼，不靠 AI 或 PDF 決定）
- `lesson_intro` 的目標讀者是學生：「這課我們將讀什麼」，不是「你要學到哪個技能」
- Excel source 的 `lesson_intro` 短句在品質上 acceptable 但非理想，將來要改善
- 7/1 demo 的 7 課全部有 `lesson_intro`（G6-L22~25 excel source；G7-L28~30 docx source）

## 7. Open questions

1. `learning_goal` 未來要不要支援結構化格式（`{strategy: str, target: str}`）？若要，現在就應該用 `object` type 而不是 `string`
2. 29 課 Excel source 的公式化簡介，7/1 前需要補強嗎？還是 placeholder 就好？
3. AI auto-generation（batch job）的 `source: ai_generated` 要不要加 review flag，讓教師審核後才顯示？
4. `intro_step_count` override 欄位如果實際上沒有任何課用到，要不要乾脆拿掉？

## 8. 怎麼維護這份 spec（meeting-to-spec capture）

更新觸發點：
1. **有新課文被 parse 進 corpus** → 更新 §5 的量測數字（自動 spec test 會 fail 提醒）
2. **教授或方大哥改變 `learning_goal` 的設計（誰填、幾字）** → 更新 §3 Field A
3. **7/1 後 AI batch 補全 `lesson_intro`** → 更新 §5 + 確認 §4 允許清單的 `source: ai_generated` 規則
