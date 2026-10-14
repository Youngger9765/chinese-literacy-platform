---
spec_id: zhuyin_challenge.question_generation
module: zhuyin-challenge
title: 注音挑戰出題 — 獨立模組，給課文產生破音字讀音選擇題
stability: active
canonical_source: backend/app/services/zhuyin_challenge.py
owns_code:
  - backend/app/services/zhuyin_challenge.py
  - backend/scripts/report_zhuyin_challenge.py
owns_data: []
spec_tests:
  - backend/tests/test_zhuyin_challenge_3551.py
related_issues:
  - 3551
source_meetings: []
last_reviewed: 2026-10-14
owner: young
---

# 注音挑戰出題模組（zhuyin_challenge）

> 這份是給人讀的 spec。機器可驗的契約在
> backend/tests/test_zhuyin_challenge_3551.py。
> 改動 zhuyin_challenge.py 前先讀這份。

## 1. 這個 module 在管什麼

generate_zhuyin_questions(lesson_uid, limit, seed) 是唯一公開入口，給一課
吐出一批「這句話裡這個破音字怎麼讀」的多選題。純函數、不碰 DB、不寫任何
資料、不 import 任何 quiz/contest 模組。

課堂挑戰（issue #3551 的主功能，class_quiz 模組）透過這支函式取題，但這支
完全不知道呼叫端是誰 —— 依賴只能單向：刪掉課堂挑戰，這個模組照常運作；
反過來這個模組壞了，只有「注音挑戰」這一種題型抽不到題，不影響詞語理解、
語詞應用、閱讀理解那幾種既有題型。

## 2. 真值來源（讀，不擁有）

這個模組只讀兩類既有、已經被 zhuyin module 登記為 owns_data 的檔案（見
specs/modules/zhuyin/INTENT.md），自己不擁有任何資料：

- 逐課的 texts.ssz（backend/data/lessons/uid/v/zhuyin.json）：每一個字的
  位置對到一個槽位代碼，點號是預設槽 0000，數字 1 到 9 是 ss01 到 ss09。
- 槽位到注音的對照（backend/data/zhuyin/font_slot_readings.json 的
  slots）：給定字跟槽位名稱，查出教育部注音字串。
- 誘答池（backend/data/zhuyin/font_readings.json 的 poly）：每個破音字
  真實存在的所有讀音（d 是預設讀音，v 是完整清單）。驗證過：全庫 2037
  個破音字，font_slot_readings.json 算出的每個讀音都是 font_readings.json
  那個字的 v 清單的子集，零例外 —— 所以「正解一定找得到誘答池」不是假
  設，是驗過的事實。

## 3. 收哪些 section、為什麼

只收 full_text_annotate、classical_text、modern_translation 三種 ——
它們合計覆蓋 178 / 179 課（唯一例外 L0136，三個 section 都沒有內容，回
空清單）。

key_reading 刻意不收：抽樣確認它幾乎總是 full_text_annotate 的子字串，
收了只是重複出題。self_challenge 跟 served 開頭那些（答案、選項、題幹等
消費端重組出來的字串）也不收 —— 它們不是學生在讀的課文本體。

## 4. 停用字清單（STOP_LIST）

對全庫 179 課、上面三個 section，逐字數「這個字出現幾次」跟「幾次的正解
不是預設讀音」。occurrence 至少 100 次且非預設比例低於 2% 的字收進
STOP_LIST（65 個字，實測數字見 PR 說明與 report_zhuyin_challenge.py 的
輸出）。

只在「這個位置剛好是預設讀音」時才跳過 —— 同一個字落在非預設讀音的位置
不會被擋掉，因為那個位置的正解根本不是預設讀音，不滿足跳過條件。

## 5. 選項怎麼挑

正解固定是 ssz 指到的那個槽位算出來的讀音。誘答從 font_readings.json 的
v 清單裡抽，去掉正解本身，最多抽 3 個（選項總數上限 4，真實讀音不足 4 個
就用全部）。選項順序跟誘答挑選順序都由 random.Random(seed) 決定，同樣的
lesson_uid 加同樣的 seed 永遠得到同樣的結果；沒給 seed 用 0 當預設值。

## 6. 題幹句子怎麼抓

抓 pos 附近、長度不超過 40（UTF-16 單位）的一段文字：整句（句號／驚嘆號／
問號界定）夠短就整句照用；太長就抓單一子句（再加逗號、頓號、分號、冒號當
邊界）；子句本身還是太長（罕見）才用硬窗口，在句子邊界內以 pos 為中心
裁切。

## 7. 報告腳本

backend/scripts/report_zhuyin_challenge.py 印出每一課的題數跟總計，PR 說明
附一次實跑結果（179 課、26,000 題、平均每課約 145 題）。
