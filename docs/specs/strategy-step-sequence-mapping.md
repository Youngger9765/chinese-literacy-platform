# Strategy → Step Sequence Mapping

> Per Path A schema-driven architecture (PR #1375). Maps each major strategy to recommended
> step_sequence. Add `step_sequence:` to any lesson YAML to override DEFAULT_STEP_SEQUENCE.
> Lessons without this field continue to use the 11-step default (zero change to existing behavior).

## How it works

```
lesson YAML
  step_sequence: [list of step IDs]   ← present  → StepperNav uses this list
  step_sequence: null (or absent)     ← absent   → StepperNav uses DEFAULT_STEP_SEQUENCE
```

`resolveActiveSteps()` in `stepConfig.ts` filters out steps with `enabled: false` regardless of source.

## DEFAULT_STEP_SEQUENCE (11 enabled steps)

For reference — the fallback used by all lessons without an override:

```
reading-annotation → tutor → full-reading → vocab-definition → vocab-application
→ story-structure → reading-strategy → comprehension → vocab-word-search
→ knowledge-station → report
```

(Steps with `enabled: false` — `listening`, `vocab`, `sentence-practice`, `dictation` — are excluded at runtime.)

---

## 12 大策略 推薦 step_sequence

### 1. 摘要策略 (PSR: 問題-解決-結果)

**核心**：訓練學生辨識文章的問題→解決方案→結果三段式結構，填入文章重點表。

**推薦 sequence** — `story-structure` 提前至第 4 步（策略核心）:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - story-structure      # ⭐ 策略重點：填入 PSR 三欄結構
  - reading-strategy
  - comprehension
  - vocab-definition
  - vocab-application
  - vocab-word-search
  - knowledge-station
  - report
```

**Rationale**: PSR 是「邊讀邊填結構表」的策略，提前至全文朗讀後立即做，印象最新鮮。
**Demo lesson**: G6-L22 (小兵立大功：雞鳴狗盜的故事)

---

### 2. 推論策略 (從標題及首尾段推論主旨)

**核心**：訓練學生用標題和首尾段快速推理全文主旨，而非逐字讀完。

**推薦 sequence** — `reading-strategy` 提前至第 4 步:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - reading-strategy     # ⭐ 策略重點：練習「從標題及首尾段推論」
  - story-structure
  - comprehension
  - vocab-definition
  - vocab-application
  - vocab-word-search
  - knowledge-station
  - report
```

**Rationale**: 推論策略的練習應在全文理解後立即上手，趁學生剛讀完有感覺時操作閱讀聚光燈。
**Demo lesson**: G6-L04 (兩千五百歲的酷老師)

---

### 3. 多文本閱讀 (跨文本比較)

**核心**：閱讀兩篇以上互補或對立文本，比較觀點、推論作者立場。

**推薦 sequence** — 省略 `full-reading`（多文本通常分段讀），強化 `comprehension`:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - reading-strategy     # ⭐ 策略重點：比較多文本視角
  - comprehension
  - vocab-definition
  - vocab-application
  - knowledge-station
  - report
```

**Rationale**: 多文本課文通常已由 tutor 分篇處理，`full-reading` 重複性低；`story-structure` 省略（單一 PSR 結構不適用多文本）。
**Example lessons**: G7-L23, G9-L56 系列

---

### 4. 解決問題策略

**核心**：學生識別文章中的問題情境、嘗試方案及結果評估。

**推薦 sequence** — 保持 DEFAULT，強調 `story-structure` + `comprehension` 配合:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - story-structure      # ⭐ 策略重點：填寫問題→方案→評估
  - comprehension
  - vocab-definition
  - vocab-application
  - vocab-word-search
  - knowledge-station
  - report
```

**Rationale**: 與摘要策略類似，但省略 `reading-strategy`（推論聚光燈對「解題流程」課文 ROI 較低）。

---

### 5. 圖文整合策略

**核心**：整合圖表、地圖、數據圖與文字說明。

**推薦 sequence** — 需要新的 `graphic-text` step（#1341 未完成）:

```yaml
# BLOCKED by #1341 — graphic-text step not yet implemented
# Interim: use DEFAULT_STEP_SEQUENCE
step_sequence: null
```

**Note**: 圖文整合需要專屬的圖文對照元件。待 #1341 完成後補入 `graphic-text` step。

---

### 6. 用表格整理資訊策略

**核心**：從說明文中提取關鍵資訊，填入比較表格或分類表格。

**推薦 sequence** — `story-structure` 提前，省略 `reading-strategy`:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - story-structure      # ⭐ 策略重點：填比較/分類表格
  - comprehension
  - vocab-definition
  - vocab-application
  - vocab-word-search
  - knowledge-station
  - report
```

---

### 7. 自我提問策略

**核心**：學生在閱讀中自己提問，再從文本中找答案（SQ3R 變體）。

**推薦 sequence** — `reading-strategy` 放在第 3 步（標題預測），`story-structure` 放後:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - reading-strategy     # ⭐ 策略重點：先提問再讀 → 帶問題閱讀
  - full-reading
  - story-structure
  - comprehension
  - vocab-definition
  - vocab-application
  - knowledge-station
  - report
```

**Rationale**: 自我提問策略的「提問」發生在全文閱讀前，與其他策略的序位不同。

---

### 8. 寫作手法策略 (順敘/倒敘/插敘)

**核心**：識別文章的敘事手法，分析作者鋪排方式。

**推薦 sequence** — 保持 DEFAULT，`reading-strategy` 在第 8 步（讀完後分析手法）:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - story-structure
  - reading-strategy     # ⭐ 策略重點：分析敘事手法
  - comprehension
  - vocab-definition
  - vocab-application
  - vocab-word-search
  - knowledge-station
  - report
```

---

### 9. 媒體素養策略

**核心**：辨識新聞/廣告中的說服策略、辨別真假訊息。

**推薦 sequence** — `comprehension` 提前（媒體判讀需要快速理解全文立場），省略 `vocab-word-search`:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - comprehension        # ⭐ 策略重點：辨識立場與說服手法
  - reading-strategy
  - vocab-definition
  - vocab-application
  - knowledge-station
  - report
```

---

### 10. 品格力策略 (品德教育)

**核心**：從文本中提煉品格主題，應用到生活情境。

**推薦 sequence** — 保持 DEFAULT，重點在 `comprehension` 的蘇格拉底對話帶出品格討論:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - story-structure
  - comprehension        # ⭐ 策略重點：AI 蘇格拉底對話討論品格主題
  - vocab-definition
  - vocab-application
  - vocab-word-search
  - knowledge-station
  - report
```

---

### 11. 議論文策略

**核心**：辨識論點→論據→論證結構，評估說理是否有效。

**推薦 sequence** — `story-structure` 提前（填論點/論據表格），`reading-strategy` 跟進:

```yaml
step_sequence:
  - reading-annotation
  - tutor
  - full-reading
  - story-structure      # ⭐ 策略重點：論點-論據-論證三欄表格
  - reading-strategy
  - comprehension
  - vocab-definition
  - vocab-application
  - knowledge-station
  - report
```

---

### 12. 文言文策略

**核心**：文白對照、詞義推論、文言句式辨識。

**推薦 sequence** — 需要新的 `classical-chinese` step（#1365 未完成）:

```yaml
# BLOCKED by #1365 — classical-chinese step not yet implemented
# Interim: use DEFAULT_STEP_SEQUENCE
step_sequence: null
```

**Note**: 文言文需要專屬的字詞白話翻譯元件。待 #1365 完成後補入 `classical-chinese` step。

---

## Demo Lessons (PR #1384)

以下 3 課已寫入 `step_sequence`，可在 StepperNav 看到明顯不同的圓點數量/順序：

| Lesson | Strategy | 顯著差異 | 圓點數 |
|--------|----------|---------|--------|
| G6-L22 | 摘要策略 | `story-structure` 在第 4 步 | 11 |
| G6-L04 | 推論策略 | `reading-strategy` 在第 4 步 | 11 |
| G7-L23 | 多文本/跳過卡關 | 省略 `full-reading` + `story-structure` + `vocab-*` | 5 |

其餘 162 課 `step_sequence: null` → 使用 DEFAULT，行為完全不變。
