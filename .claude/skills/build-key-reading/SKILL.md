---
name: build-key-reading
description: 【已停用，請改用 lesson-reading-pipeline】舊版重點朗讀抽取規格。其內容是 issue #2712（朗讀範圍比教授畫的多一倍）的成因，已被取代。當看到「建重點朗讀」「念順順轉線上」「docx 抽朗讀段」時請改讀 .claude/skills/lesson-reading-pipeline/SKILL.md。
---

# build-key-reading —— 已停用

**改用 [`lesson-reading-pipeline`](../lesson-reading-pipeline/SKILL.md)。**

## 為什麼停用（不是搬家，是這份內容會讓人做錯）

這份 skill 明文要求朗讀段落取「約 300-400 字」，方法是
`extent = max(累計字數)`，並在 QA 章節把它鎖成一條 TDD 斷言
（`strip_punct(passage) 長度 ≈ max(累計字數)`）。

那條規則在 2026-07-20 教授審查時就被否決了，`backend/data/key_reading_passages.yml`
開頭寫得很清楚：

> 新規則：**只取 ☞ 那一段**，非全文、非舊 pilot 的「☞→結尾」

但這份 skill 沒有跟著更新。抽取器照著它做，產出中位 370 字（教授畫的是 153 字），
67 課可比對有 60 課超過 1.5 倍 —— 這就是 **#2712**。
其中 L79 那條斷言最有害：它把錯誤鎖成「必須通過」的驗證，讓錯誤看起來是驗證過的。

另外三件事也已被實測推翻：

- **字數欄的 max 不是段落長度**。全 175 課實測 max 落在 280–520，課文本身 535–1670 字；
  它是「一分鐘可讀到哪」的印刷摘錄，與段落邊界無關。
- **☞ 手指圖形只存在於一版**。二版改成文字指令 `從指定段落（三）開始朗讀`，
  錨點變成序數。這份 skill 只描述一版，二版機制沒有寫進任何地方 → **#2720**。
- **「取第一個 `w:drawing`」會被裝飾圖騙**（本檔 L91 自己記錄過這個 suspected 根因）。
  同一類錯誤在二版以「取第一個數字並套錯座標」的形式重演了一次。

## 這裡曾經有兩支參考實作

`extract_key_reading.py` 與 `batch_key_reading.py` 已刪除。它們實作的是上述被否決的規則，
留著等於留一份可以直接執行的錯誤範本。現行實作在 repo 主線：

- `scripts/extract_key_reading.py` — 錨點解析 + 三道 fail-closed 檢查
- `scripts/build_key_reading.py` — 寫入 / withhold / 產待人工確認清單

歷史內容可從 git 取得：`git show 7567483e:.claude/skills/build-key-reading/SKILL.md`
