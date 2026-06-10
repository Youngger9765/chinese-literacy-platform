# Issue #2205 — DOCX → 線上版 Schema Validation Report

**Date**: 2026-06-10
**Script**: `scripts/build_lesson_schema.py`
**Output**: `private/curriculum-source/_online-schema/` (gitignored)
**Branch**: `fix/issue-2205-docx-online-schema-experiment`

---

## Summary

| Lesson | Keypoints | Spotlight | Blanks (docx vs schema) | Null answers | MCQ leaked |
|--------|-----------|-----------|------------------------|--------------|------------|
| G6-L22 | PASS | PASS | 7 / 7 | 2 (manual needed) | 0 |
| G6-L23 | PASS | PASS | 6 / 6 | 0 | 0 |
| G6-L24 | PASS | PASS | 5 / 5 | 0 | 0 |
| G6-L25 | PASS | PASS | 5 / 5 | 0 | 0 |
| G7-L28 | PASS | PASS | 14 / 14 | 0 | 0 |
| G7-L29 | N/A (no fill table) | PASS | — | — | 0 |
| G7-L30 | N/A (no fill table) | PASS | — | — | 0 |

**Pass rate: 7/7 courses fully processed.** All automated checks pass.

---

## Per-Lesson Detail

### G6-L22 小兵立大功：雞鳴狗盜的故事

**Keypoints** (T#5, 9x3 nested table):
- [PASS] Structure: `nested` — 正確還原 3 層（解決 下有 問題1/解決1/結果1/問題2/解決2/結果3）
- [PASS] Row count: 3 top-level rows (問題/解決/結果), 6 sub_rows under 解決
- [PASS] Blanks: 7/7 matched (狗、軟禁、天亮、出不了關、公雞叫、終於打開/提前開啟 + 凶多吉少)
- [PASS] Merged label: 「解決」合併 6 列正確，無重複展開

**Spotlight** (25 blocks):
- [PASS] guide blocks: 13 — 教學脈絡（步驟說明）全保留
- [PASS] passage: 1 — 孟嘗君補充故事正確標 `source: supplementary`
- [PASS] no MCQ: 5 題 MCQ 全排除在外
- [EDGE CASE] 大象故事（進階挑戰，段落 style=Normal 非 List Paragraph）未被抓成 `passage` block，被拆成 free_text prompt + guide text。原因：大象故事用 Normal 段落樣式，非 List Paragraph，現有規則只識別 List Paragraph 為 passage line。需手工補齊或加 style 偵測規則。
- [NOTE] 2 個 single block 的 answer=null（❶主角是誰 孟嘗君 / 曹沖），需手工填入。


### G6-L23 老鷹紅豆的故事

**Keypoints** (T#5, 5x2 flat table):
- [PASS] Structure: `flat`
- [PASS] Row count: 4 (問題/解決/結果/迴響)
- [PASS] Blanks: 6/6 matched (中毒、無毒農法、高價、生態、經濟、消費者)
- [PASS] 迴響（結語）行正確抓到

**Spotlight** (44 blocks):
- [PASS] guide blocks: 24
- [PASS] passage blocks: 3 (找重點句練習中的段落引用)
- [PASS] no MCQ
- [NOTE] 找重點句練習的段落（第1/4/6段）被識別為 passage，source 被判為 supplementary（因為補充脈絡）；實際上這些是「課文段落引用」，source 應為 lesson_text。此為誤判，需手工修正 source 欄位（3 處）。


### G6-L24 白鯨救援

**Keypoints** (T#6, 4x3 hint_value table):
- [PASS] Structure: `flat` (3欄 hint_value 格式：元素/提示/重點)
- [PASS] Row count: 3 (問題/解決/結果)
- [PASS] Blanks: 5/5 matched (困在冰原裡…、用鐵鍬…、派破冰船…、使用古典音樂…、數千頭白鯨…)
- [PASS] hint 欄位（提示）正確保留

**Spotlight** (7 blocks):
- [PASS] guide blocks: 5
- [PASS] fill_table: 1
- [PASS] self_check: 1
- [NOTE] L24 的聚光燈比其他課短——這是正確的，L24 的聚光燈就是一個任務說明 + fill_table，無多餘的 guided steps。文件忠實反映原始 DOCX 結構。


### G6-L25 全世界第一張股票的誕生

**Keypoints** (T#5, 4x3 hint_value + locator):
- [PASS] Structure: `flat` with `locate_paragraph: true`
- [PASS] Row count: 3 (問題/解決/結果)
- [PASS] Blanks: 5/5 matched
- [PASS] 段落定位: 問題=(1.2) 解決=(3) 結果=(5. 10) — 全部正確抓到
- [PASS] hint 欄位（提示說明）正確保留

**Spotlight** (4 blocks):
- [PASS] guide + fill_table + self_check
- [NOTE] L25 聚光燈很短——DOCX 的 L25 聚光燈本身就只有「◎小試身手」任務說明 + fill_table + 自我檢核，無補充文本。這是正確反映。


### G7-L28 看不見的兇手

**Keypoints** (T#4, 6x2 flat table):
- [PASS] Structure: `flat`
- [PASS] Row count: 5 (研究問題/新說法/實驗/結論/研究影響)
- [PASS] Blanks: 14/14 matched — 最複雜的一課，全部答案正確
- [PASS] 多行 value（情境①②③）每個 blank 獨立解析，無串接錯誤

**Spotlight** (50 blocks):
- [PASS] guide blocks: 33 (步驟❶❷❸❹ + 小祕訣 + 練習步驟全保留)
- [PASS] figure: 1 (圖一 鵝頸瓶實驗圖)
- [PASS] no MCQ


### G7-L29 四張圖看地球暖化

**Keypoints**: N/A — 圖文整合課無填空重點表（正確行為，圖表訊息由圖片呈現）

**Spotlight** (108 blocks):
- [PASS] guide blocks: 80 (步驟❶❷❸❹ × 5個練習 + 小祕訣 + 提示詞 全保留)
- [PASS] figure: 1 (圖一~圖四的 referent)
- [PASS] free_text: 25 (各步驟整合問答)
- [PASS] no MCQ
- [NOTE] 108 blocks 是正確的——L29 有 4 張圖 × 4步驟 + 統整練習 = 大量 guided steps。


### G7-L30 都是八哥為什麼命運不一樣

**Keypoints**: N/A — 圖文表整合課無填空重點表（表一/表二是課文資料表，非填空表，正確行為）

**Spotlight** (93 blocks):
- [PASS] guide blocks: 68
- [PASS] figure: 1 (圖一 + 表一/表二 referent)
- [PASS] free_text: 23
- [PASS] no MCQ

---

## Skill 還抽不準的 Edge Cases

| Issue | 影響課 | 嚴重性 | 說明 |
|-------|-------|--------|------|
| `Normal` 樣式段落不被識別為 passage | G6-L22 大象故事 | Medium | 現有規則只把 `List Paragraph` 樣式的段落識別為 passage line。大象故事（進階挑戰）用 Normal 樣式，被拆成多個 guide/free_text block，而非合成一個 passage block。補法：在 guide 前後偵測「進階挑戰」語境，把接下來的 Normal 段落標為 passage。|
| 課文段落引用 source 判斷 | G6-L23 | Low | 找重點句練習中的段落引用（課文第1/4/6段）被標為 source=supplementary，但應為 lesson_text。補法：加入「第N段：」「課文第N段」前綴偵測。|
| 圖片 asset 未從 DOCX 抽出 | G7-L28/29/30 | Low | figure block 有 asset=null，實際圖片嵌在 DOCX 內部。python-docx 可以取出 blip/relationship，但需要額外的 `docx.part.image` extraction 步驟。目前已標記 asset=null 等待手工補齊或加功能。|
| 某些 single block answer=null | G6-L22 (2個) | Low | 「❶主角是誰？□秦昭王 孟嘗君 □幸姬」= 答案孟嘗君沒有 □ 前綴，但 answer extraction 演算法有時解析失敗。已追蹤在 `_null_answers` 清單，需手工填入。|

---

## Schema 檔案路徑

所有產出在 `private/curriculum-source/_online-schema/`（gitignored，不進 PR）：

```
G6-L22.keypoints.yml  G6-L22.spotlight.yml
G6-L23.keypoints.yml  G6-L23.spotlight.yml
G6-L24.keypoints.yml  G6-L24.spotlight.yml
G6-L25.keypoints.yml  G6-L25.spotlight.yml
G7-L28.keypoints.yml  G7-L28.spotlight.yml
G7-L29.spotlight.yml  (no keypoints — expected)
G7-L30.spotlight.yml  (no keypoints — expected)
```

---

## 進入 PR 的檔案（不含 private/）

| 路徑 | 說明 |
|------|------|
| `scripts/extract_docx_blocks.py` | Raw DOCX → ordered blocks（原始抽取器）|
| `scripts/build_lesson_schema.py` | **核心 pipeline**：DOCX → spotlight.yml + keypoints.yml |
| `.claude/skills/build-spotlight/SKILL.md` | 聚光燈 block schema 建構 SOP |
| `.claude/skills/build-keypoints/SKILL.md` | 重點表 schema 建構 SOP |
| `docs/professor-7-lessons-block-decomposition.md` | Block palette 設計依據 |
| `docs/spotlight-keypoints-inventory-2026-06-10.md` | 151 課盤點結果 |
| `docs/issue-2205-validation.md` | 本報告 |
