# 第一次用新分派架構完整抽完一課（L0011，2026-08-23）

在這之前，這套架構（23 支 `extract-*` skill、派工單、10 道門）**產出過 0 課** ——
現有 175 課的 `source.extracted_by` 全部寫著 `extract-lesson-multimodal`，
那是二修的整包抽取器，正是 #2843 要離開的做法。

這個目錄是那一次的產出，**刻意不覆蓋 `backend/data/lessons/`**（理由見下）。

## 怎麼跑的

```bash
python3 scripts/run_extraction_pipeline.py plan --uid L0011 --refresh-pages --json
# → 8 架飛機、PDF 路徑。把那份 PDF 釘住，全程只用它。
# → 逐架照 extract-<module> skill 抽，逐字內容一律回 DOCX 的 <w:t> 流取
```

## 結果：8 / 8 schema ✅ + 逐字門 ✅

| 模組 | 跟現有 yml 比 |
|---|---|
| `keypoints` | **完全相同**（含巢狀勾選題、整數選項鍵） |
| `vocab_review` | 100 格找字遊戲**逐字重建、格子完全相同** |
| `comprehension` | 完全相同（只差我多寫了 `notes`） |
| `vocab_definitions` | 完全相同（只差我沒寫 `notes`） |
| `vocab_application` | 只差空格寫法 —— **而那個差異挖出一個真 bug**（見下） |
| `resources` | 🔴 我用 `items`，現有用 `videos` |
| `key_reading` | 🔴 我只抽了計時表，**沒抽 `passage`** |
| `full_text_annotate` | 🔴 缺 `reading_tip` / `inline_marked_terms` / `marking_instruction` |

## 🔴 三個我抽錯 / 抽漏的

**① `resources` 用錯載體鍵。** 現有用 `videos`（帶 `url` 與 `url_source`），
我寫成 `items`。**skill 明文警告過這個陷阱**（「載體不只一種，沿用該課原本的鍵」）
—— 我還是踩了。⇒ 抽之前要**先讀該課現有的 yml 看它用哪個鍵**，
不能只讀 skill 正文。

**② `key_reading` 只抽了一半。** 計時表、量尺都對，但**課文段落本身沒抽** ——
而 `passage` 正是這個模組存在的理由。⇒ 派工單只說「這支讀 p2-3」，
沒說「這一節有哪幾個欄位是必要的」。schema 的 `required` 也沒擋（它不要求 `passage`）。

**③ `full_text_annotate` 漏了三個欄位。** 版面上看得到但我沒收：
文章上方的提示語、句中被標記的語詞、做記號的指示。

⚠️ **這三個都是「抽得比現有薄」而不是「抽錯」** —— schema 過、逐字過、
兩道門都是綠的。**現有的門看不出「少抽了東西」**，這正是 ⑦d 涵蓋率棘輪
存在的理由，但那道門是逐課比對總量，抓不到單一模組少一欄。

## ✅ 一個真 bug 是這次跑出來的

`vocab_application` 的空格寫法差異（我照原稿寫 `(  )`、現有寫 `（　）`）
引出去查全庫慣例，才發現前端 `FillInBlankExercise` 的 regex 要求
**兩個全形空格**，而 1198 題裡符合的有 **0 題** ——
結果頁「把答案填回句子」對每一題都是空轉。已修（0 → 1196/1198）。

## ⛔ 為什麼不覆蓋語料庫

我這一份在三個模組上**比現有薄**。蓋上去是退步。
真正該做的是把上面那三點寫回 skill（已做），下次抽才不會再犯。
