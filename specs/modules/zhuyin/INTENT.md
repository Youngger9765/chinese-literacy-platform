---
spec_id: zhuyin.readings.taiwan_authority
module: zhuyin
title: 注音讀音 — 出貨字型是台灣讀音的唯一真值，三個表面各自是它的投影
stability: active
canonical_source: backend/app/services/zhuyin_readings.py
owns_code:
  - backend/app/services/zhuyin_readings.py
  - backend/app/services/lesson_zhuyin.py
  - backend/scripts/generate_lesson_zhuyin.py
  - frontend/scripts/zhuyinAnswers.ts
  - frontend/src/context/ZhuyinContext.tsx
  - backend/app/services/he_conjunction.py
  - backend/scripts/extract_font_readings.py
  - backend/scripts/generate_taiwan_zhuyin_table.py
  - frontend/src/components/zhuyin/polyphonicProcessor.ts
  - frontend/src/components/zhuyin/polyphonicPatternMatcher.ts
  - frontend/src/components/zhuyin/styleSetMapper.ts
  - frontend/src/components/zhuyin/bopomoConstants.ts
  - frontend/src/components/zhuyin/zhuyinStringBuilder.ts
  - frontend/src/components/zhuyin/toneData.ts
  - frontend/src/components/zhuyin/toneSandhi.ts
  - frontend/src/utils/zhuyinUtils.ts
owns_data:
  - backend/data/zhuyin/font_readings.json
  # #3230：破音字的 槽位→注音。逐課表只存槽位，注音由這一份推 ——
  # 以前每課的表把注音存 321,733 份副本（15 MB），會各自過期。
  - backend/data/zhuyin/font_slot_readings.json
  - backend/data/lessons/*/v*/zhuyin.json
  - backend/data/zhuyin/lesson_corrections.json
  - frontend/public/data/poyin_db.json
  - frontend/public/fonts/BpmfZihiSerif-Regular.ttf
  - frontend/src/components/zhuyin/__fixtures__/fontReadings.generated.json
spec_tests:
  # #3218 的逐課鎖（1,093 條）。⛔ 沒掛在這裡的話 `specs/run-ci.sh` 的 Gate 2 跑不到 ——
  # 只改產生器／processor 而沒碰 `backend/**` 的 PR 會讓這 1,093 條整組睡著
  # （pytest.yml 是按路徑觸發的）。
  - backend/tests/test_lesson_zhuyin_3218.py
  - backend/tests/test_lesson_zhuyin_all_lessons_3218.py
  - backend/tests/test_font_is_taiwan_reading_authority_3173.py
  - backend/tests/test_font_readings_match_shipped_font_3177.py
  - backend/tests/test_taiwan_zhuyin_readings_3202.py
  - backend/tests/test_he_conjunction.py
  - backend/tests/test_he_conjunction_zhuyin_3204.py
  - backend/tests/test_zhuyin_module_owns_its_code_3203.py
  # #3230 端到端窮舉鎖：服務端送出去的每一個中文字串都必須在表裡
  - backend/tests/test_served_text_all_in_table_3230.py
  # #3236 「相」全庫鎖（教育部：ㄒㄧㄤˋ 是封閉集，交互義一律 ㄒㄧㄤ）
  - backend/tests/test_xiang_reading_3236.py
  # #3237 fallback 是查表不是選擇器（pypinyin 已移除）
  - backend/tests/test_fallback_is_lookup_not_selector_3237.py
  # #3237 退休紀錄（不是還在跑的鎖）—— 檔案留著，因為 CI 具名清單與
  # `test_every_backend_test_named_in_ci_exists` 都會找這兩個路徑。
  # 它們現在各有兩條「接手的鎖必須存在」+「舊選擇器真的沒回來」的斷言。
  - backend/tests/test_zhuyin_map_alignment_3175.py
  - backend/tests/test_zhuyin_cross_surface_drift_3202.py
  # #3238 「和」的詞界全庫鎖（jieba HMM 對繁體會把「和」黏進鄰詞）
  - backend/tests/test_he_word_boundary_3238.py
related_issues: []
source_meetings: []
last_reviewed: 2026-09-14
owner: young
---

# 注音讀音：一個真值，三個投影

> 給**人**讀的 spec。機器契約在上面 `spec_tests` 列的那幾支。
> **動任何跟注音有關的 code 或資料之前先讀這份。**

## 1. 為什麼這個 module 存在（而且是 2026-09-14 才建的）

半年內同一塊出了四張票，四張都不是獨立的 bug：

| 票 | 症狀 | 真正的病 |
|---|---|---|
| #3173 | 「功夫**了**得」讀成 ㄌㄜ˙、「有多**難**」讀成 ㄋㄢˋ | 資料表缺詞樣式 |
| #3175 | 朗讀回饋的注音**整段位移**，136/152 課、69.9% 的字拿到隔壁字的注音 | 索引假設錯 |
| #3177 | `行`／`著` 最常用的兩個讀音在正式站是**反的**，44 條測試綠著幫那個錯誤信念背書半年 | 斷言打在變體索引上，不是讀音上 |
| #3202 | 朗讀診斷報告用**大陸讀音**（研究 ㄐㄧㄡ、血 ㄒㄩㄝˋ、垃圾 ㄌㄚㄐㄧ） | 沒人接已宣告的真值 |
| #3204 | 「和」當連接詞標成 ㄏㄜˊ，語料 780 處 | 判斷只有語音那條路在吃 |

共同根因：**「讀音」這件事橫跨四個表面、四份資料、兩個 repo 目錄，而
`specs/registry.yaml` 全文 `zhuyin` 出現 0 次** ——
產生注音的 `learning_reading.py` 掛在 `reading-transcription`（管 webm 轉碼的 module）名下。
27 個 spec module 沒有一個擁有「讀音」，所以沒有人在看這一塊的整體。

這份 INTENT.md 本身就是那個修復。它不改任何行為。

## 2. 真值：出貨的那支字型

```
frontend/public/fonts/BpmfZihiSerif-Regular.ttf
```

它的 cmap format 14 把「基字 + U+E01Ex」對到 `uniXXXX.ssNN`，而那些 glyph 是複合字元，
第一個元件就叫 `z_<拼音><聲調>`：

```
難  0000→z_nan2   ss01→z_nan4   ss02→z_nuo2
行  0000→z_xing2  ss01→z_hang2  ss02→z_xing4  ss03→z_hang4
```

**選字型而不選教育部辭典，有三個理由**：
1. 字型就是**畫面上實際會畫出來的那個讀音** —— 其他任何來源都只是「應該」
2. 它已經在出貨，不是新增依賴
3. 不受教育部辭典 CC BY-ND 的授權限制

⚠️ **字型不是完美的**。已知缺口逐條記在
`backend/tests/test_font_is_taiwan_reading_authority_3173.py` 的 `KNOWN_FONT_GAPS`
（`液`、`癌`）與 `TABLE_IS_WRONG_FONT_IS_RIGHT`。
**發現新缺口就加進那兩張表，不要繞過字型。**

## 3. 四個表面，各自是同一個讀音的投影

| 表面 | 需要的形狀 | 誰供給 |
|---|---|---|
| 課文頁 ruby | **(字, styleSet)** → PUA 變體選擇器 → 字型畫 | `polyphonicProcessor.ts` + `poyin_db.json` |
| 朗讀診斷 ruby | **注音字串** | `zhuyin_readings.py` + `font_readings.json` |
| 語音（TTS） | **SSML `<sub alias>`** | `tts/normalization.py` + `taiwan_pronunciation.json` |
| 字典頁 | 注音字串，**不看語境** | `dictionary_service.py` → 萌典 |

**形狀不同是對的**（渲染方式不同），**讀音必須一致**。

兩個方向的橋都已經在 repo 出貨，**互為反函數**：

```
(字, styleSet) ──extract_font_readings.py──► 讀音        13087 字
讀音 ──poyin_db.json 的 `ruby` 鍵──► PUA 碼位            1386 筆
```

→ **所以「前端要字形、後端要字串」不註定要兩套資料。讀音是正則形式。**

⚠️ `poyin_db.json` 的 `ruby` 那 1386 筆**零消費者**，`bopomoConstants.ts` 的
`PolyphonicData` 介面連這個鍵都沒宣告 —— 而每個 client 都在下載它。

## 4. 機制的大小要隨「決策數」長，不隨「語料長度」長

2026-09-14 的架構複審原本建議「在 content build 時把讀音烘進 lesson 樹，
讓答案進 git、diff 看得見」，量完之後**自己撤回**：

```
全服務端 lesson 樹所有中文位置   1,066,105 個 → 約 11.5 MB
現在 committed 的表              582 KB，且與課數無關
```

體積不是殺手，**review 成本才是**：烘進去之後，`poyin_db` 改一條 pattern
（例如 #3173 補 `了` 的 `*得`）會產生**橫跨上千個 lesson 檔的 diff**，
那種 PR 沒有人 review 得動 —— 它會變成「大到只能信任、不能檢查」。

**要的性質（答案進 git、diff 看得懂）是對的，機制錯了。**
正確機制是**只 commit「相異的決策」**：
⚠️ #3237：`test_zhuyin_cross_surface_drift_3202.py` 已退休 —— 前後端只剩一個讀音來源，
它凍結的那個「漂移」不存在了。以下這段留作歷史紀錄。它凍結的是「哪幾句兩個表面挑不同音」，
「這一輪 19 條變 17 條」比一萬行 lesson diff 有資訊量得多。
repo 已有同形狀前例：`spotlight_fingerprints.py` 的結構棘輪。

## 5. 今天已知還對不起來的地方

```
前端 committed 斷言 31 條，同樣句子餵後端 → 19 條對不起來
  銀行裡的行員  課文 ㄏㄤˊ   診斷 ㄒㄧㄥˊ
  他看著遠方    課文 ㄓㄜ˙   診斷 ㄓㄨˋ
  災難         課文 ㄋㄢˋ   診斷 ㄋㄢˊ
  他跑得快      課文 ㄉㄜ˙   診斷 ㄉㄜˊ
```

~~**已凍結成棘輪**（`test_zhuyin_cross_surface_drift_3202.py`）：多了紅、少了也紅。~~
⚠️ #3237 退休（只剩一個來源，漂移不存在）。接手：`test_fallback_is_lookup_not_selector_3237.py`
（fallback 是查表不是選擇器）＋ 前端 `noRuntimeSelector3237.test.tsx`。

分兩類：**破音字選擇**（pypinyin 是大陸語料，結構上給不出「銀行 = ㄏㄤˊ」）與
**一/不變調**（前端做、後端不做）。真正的修法是讓後端也讀 `poyin_db.json` 的詞樣式表，
但它住 `frontend/public/`、backend 的 Dockerfile 沒有 COPY 它。

## 6. 動手前的紀律

- ⛔ **不要新增第五個真值來源。** 要一個字的台灣讀音 → 走 `zhuyin_readings.py`；
  要判斷「這個『和』是不是連接詞」→ 走 `he_conjunction.py`
- ⛔ **不要把斷言打在 styleSet 字串上**（`expect(...).toBe('ss01')`）—— #3177 就是這樣
  讓 44 條測試綠著背書一個錯誤信念半年。**斷言打在字型會畫出來的讀音上**
- ⛔ **不要重新實作 pattern matching。** 前端的 `polyphonicPatternMatcher.ts` 曾被移植到
  Python 去量跨表面差異，漏了一/不變調分支與 `skipPrev` 狀態，量出來的數字是錯的
  （而且看起來很合理）。要跨語言比對就**解析對方 committed 的斷言**，不要移植邏輯
- ⚠️ **後端測試讀前端檔，那條路徑必須進 `.github/workflows/pytest.yml` 的 paths-filter**，
  否則改那個前端檔的 PR 不會跑後端套件 —— 漂移會從前端那側偷長。
  `backend/tests/test_lesson_uid_loader.py::test_cross_language_paths_are_in_the_ci_filter` 在守

## 7. 待辦（不在這份 spec 的範圍，但屬於這個 module）

- **`poyin_db.json` 沒有出處宣告。** 上游是方大哥自己的 `learning-to-read-chinese`
  （`gh repo view` → `licenseInfo: null`），而同一顆 commit 進來的字型有一整個
  `frontend/public/fonts/licenses/`（ButTaiwan/bpmfvs，Apache-2.0 + OFL 1.1）。
  「無授權宣告」預設保留所有權利 → 要一句書面同意 + 補 `_source`／NOTICE
- **兩支產生器該合併**（`generate_taiwan_zhuyin_table.py` → `extract_font_readings.py`），
  現在做最便宜。值的一致性已由「兩份各自重讀 TTF 比對」遞移保證，所以不急
- **字典頁不看語境** —— `dictionary_service.py` 直接取萌典的第一個讀音
