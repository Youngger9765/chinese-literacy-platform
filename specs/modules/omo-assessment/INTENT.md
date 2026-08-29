---
spec_id: omo.grader.letter_mapping
module: omo-assessment
title: OMO 語詞應用 — 字母作答的對應來源 (vocab_bank as SOT)
stability: active
canonical_source: vocab_bank
owns_code:
  - backend/app/services/omo_question_schema.py
owns_data: []  # 一修的 _parsed_2026-05-01/ 已封存（#2683）。二修抽取器補齊對應欄位前，
               # 這個 module 不擁有任何資料檔 —— 跟它的 spec 契約現況一致，
               # 登記在 data/curriculum_qa/content_known_gaps.yaml#locks_removed_with_the_first_edition
spec_tests:
  - backend/specs/test_omo_assessment_spec.py
  - backend/specs/test_omo_grading_corpus.py
fixtures:
  - specs/modules/omo-assessment/fixtures/grading-corpus.yaml
probes:
  - specs/modules/omo-assessment/probes
related_issues: [2015, 2027, 2028]
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-01
owner: young
---

# OMO 語詞應用：字母作答的對應來源

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_omo_assessment_spec.py`。AI 改 grader / 改 L22~ 學習單前先讀這份。

## 1. 這個 module 在管什麼

OMO（紙本 → 掃描 → AI 批改）學習單的「四、語詞應用」題型：學生在句子的空格填入
**字母**（A、B、C…），字母對應到一張印在學習單上的「語詞庫」。AI grader 要把學生圈的
字母換回正確的語詞，再判對錯。

## 2. 唯一真相（canonical source）

**`vocab_bank` 才是字母 → 語詞的對應表。** 它是 dict，例如 G6-L25：

```yaml
vocab_bank: {A: 揚帆啟航, B: 股票, C: 節衣縮食, D: 滿手老繭, E: 集資, ...}
fill_in_blank:
  - {sentence: "公司今年（　）大增…", answer: E}   # E → 集資
```

學習單 PDF 印給學生看的就是這張 `vocab_bank`。**字母的意義由 `vocab_bank` 決定，
不由任何其他欄位決定。**

## 3. 允許 / 禁止的改動

✅ **允許**
- 在 `vocab_bank` 增刪字母（同步 PDF）
- 改 `fill_in_blank[].answer` 的字母（前提：該字母存在於 `vocab_bank`）

⛔ **禁止（會破壞契約）**
- 用 `vocabulary` 清單的**排列順序**去推字母（A=vocabulary[0]、B=vocabulary[1]…）。
  `vocabulary` 是「課文生詞表」，順序跟 `vocab_bank` **不一樣**，拿它當字母來源 = 對錯誤的詞批改
- 讓 `fill_in_blank[].answer` 出現 `vocab_bank` 沒有的字母（學生永遠選不到 → 必錯）

## 4. 目前已知的 drift（#2015，2026-06-01 量測）

`_resolve_letter_answer()` 現在用 `vocabulary[index]` 推字母，**違反**第 2 節契約：

| 量測 | 數字 |
|------|------|
| 有 `vocab_bank` 的 lesson | 51（G6+G7 全部） |
| grader 把字母解成**錯誤語詞** | 364 / 398（**91%**） |
| `fill_in_blank.answer` 落在 `vocab_bank` 外 | 5 |
| 受影響 lesson | **51 / 51** |

→ `test_grader_resolves_letter_via_vocab_bank_not_vocabulary_index` 與
`test_every_fb_answer_letter_exists_in_vocab_bank` 目前標 `xfail`（記錄 drift、不擋 CI）。
修好後（grader 改讀 `vocab_bank` + 修 5 個越界答案）會變 XPASS，屆時把 xfail 拿掉、轉成硬性斷言。

## 5. 教學 / 產品脈絡（pytest 寫不進去、但 AI 要知道）

- 字母作答是配合**紙本學習單**設計的（學生在紙上圈字母），不是純數位互動。
- 批改回饋對國小高年級～國中生要**warm、給鷹架**，不能因為填錯就只說「錯」。
- 「填空答案」屬**語詞應用**評量，不是生字書寫；改它是 grading 改動，不是 UX 改動。

## 6. Open questions

- `vocabulary` 清單未來是否要直接由 `vocab_bank` 衍生（消除雙來源）？
- 字母範圍要不要硬性限制（目前 grader 只認 A–G，但 `vocab_bank` 常到 I–K）？
- 修 grader 時是否一併修 5 個越界 `answer`，還是先擋資料、後改 code？

## 7. 怎麼維護這份 spec（meeting-to-spec capture）

這份 spec 的更新觸發點是**會議**：當 5/1 專家會議這類討論改動了語詞應用題型的規則，
看完會議記錄的人要回來更新本檔的 `last_reviewed` + 對應 `spec_tests`。
（這是 critic 指出「真正會 rot 的地方」— spec 不是被 code 改壞，是會議講了沒人寫回來。）
