# Multi-Reading Chars Scan — Lessons Coverage (ref #1111)

Generated: 2026-04-18
Scope: 57 lesson YAML files in `backend/data/lessons/`
Purpose: Identify which 多音字 appear frequently enough to warrant TTS handling in `_TAIWAN_TTS_REPLACEMENTS`

> **Action required**: For each char, Young needs to audit the examples and decide:
> (A) Add a context-aware replacement rule, or
> (B) Accept that Gemini handles the reading correctly via prompt, or
> (C) The char rarely appears in the ambiguous reading (low priority)

---

## Currently handled by `_TAIWAN_TTS_REPLACEMENTS` (37 rules)

None of the 14 chars below are in the existing replacement list. They represent a different class of ambiguity — **context-dependent readings** vs the current list which handles **Taiwan vs Mainland pronunciation differences** (same word, different tonal convention).

---

## 14 Multi-Reading Chars Found in Lessons

### 1. 好 (hǎo / hào) — 501 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| hǎo | adjective: good/well | 好人、好書、最好、很好、好的 |
| hào | verb/noun: hobby/fond of | 愛好、嗜好、好動、好強 |

**Lesson examples (likely reading in brackets)**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 小戴相信攻擊是最好的防禦，總是主動出擊 | hǎo |
| L02 | 讓好不容易站上的國際舞台的他心有不甘 | hǎo |
| L02 | 他想出去玩，沒想到「天壤之別」，颱風來襲，只好在家 | hǎo |
| L08 | 哥哥說：「勇緯勤於訓練，每天都提早三、四十分鐘到校練習，連休息時間也不得閒，總是不斷的精進自己 | hǎo |
| L09 | 追求新鮮感，喜愛嘗試新奇事物 | hǎo |

**Assessment**: 好 in lessons is overwhelmingly hǎo. 愛好/嗜好 not common in these texts. Low risk.

---

### 2. 長 (cháng / zhǎng) — 436 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| cháng | length/duration | 長跑、漫長、長度、長時間 |
| zhǎng | grow/elder/leader | 長大、校長、師長、班長、成長、家長 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 她的每一下揮拍、每一次扣殺，都是在和自己比賽，她沒有因為想贏得比賽而選擇保守，她選擇的是做自己、用自己擅長的方式戰鬥 | zhǎng (擅長) |
| L02 | 他在拿坡里世大運比賽時受傷，開始了漫長的復健 | cháng |
| L03 | 根據研究：「充足的睡眠」、「適當的運動」及「均衡的飲食」才是長高的關鍵 | zhǎng |
| L03 | 同學們嘰嘰喳喳講個不停，有人會開始炫耀自己的身高 | — |
| L04 | 如長跑）與其他訓練肌肉的運動 | cháng |

**Assessment**: HIGH ambiguity. 擅長 (zhǎng), 長大 (zhǎng), 漫長 (cháng), 長跑 (cháng) all appear. Gemini may get this wrong. Consider adding rules for high-confidence compounds (e.g., 漫長→màn cháng mapping via context prompt).

**Recommendation**: Add to prompt guidance for Gemini: "擅長 reads zhǎng, 漫長/長跑 reads cháng".

---

### 3. 重 (zhòng / chóng) — 446 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| zhòng | weight/important | 體重、重要、重量、嚴重 |
| chóng | again/repeat | 重新、重複、重來、重做 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L02 | 終於熬過了這段恢復期，突破困境，在2021年重新回到賽場 | chóng (重新) |
| L03 | 開學後不久，又是到健康中心量身高體重的時候 | zhòng (體重) |
| L03 | 適當的運動也是長高相當重要的一環 | zhòng (重要) |
| L04 | 科學家們了解了人體的特質及各項運動的原理，累積各種知識之後 | — |
| L06 | 陳舊的思想，重新再認識了一遍 | chóng |

**Assessment**: 重新 (chóng) vs 重要/體重 (zhòng) — both common. Gemini likely handles this via context but worth monitoring. 重新 is a very clean compound to replace if needed.

**Recommendation**: Low priority — add 重新→chóng to Gemini system prompt context note if errors are heard.

---

### 4. 行 (xíng / háng) — 338 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| xíng | walk/action/OK | 進行、行走、行動、銀行以外 |
| háng | profession/row | 銀行、行業、行列、同行、一行字 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 對人進行觀念灌輸，以改變其原有的想法和態度 | xíng |
| L02 | 遇到逆境時，可以進行自我對話找尋答案 | xíng |
| L04 | 運動科學是對體育活動進行科學分析的一個綜合性學科 | xíng |
| L08 | 哥哥說：「勇緯勤於訓練，每天都提早三、四十分鐘到校練習 | — |
| L04 | 科學家們了解了人體的特質及各項運動的原理，累積各種知識之後，才能知道如何有效的進行體育訓練 | xíng |

**Assessment**: 進行 (xíng) dominates. 銀行/行業 don't appear commonly in these lesson texts. Low risk.

---

### 5. 為 (wéi / wèi) — 1164 occurrences (most frequent)

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| wéi | do/become/as | 行為、作為、成為、認為、以為 |
| wèi | for/because of | 為了、因為、為何、為什麼 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 她沒有因為想贏得比賽而選擇保守 | wèi (因為) |
| L01 | 只要你沒有輸了自己，比賽就 | — |
| L01 | 形容極為悲憤或悔恨 | wéi |
| L02 | 遇到逆境時，可以進行自我對話找尋答案 | — |
| L04 | 蒼藍鴿醫師（本名吳其穎）從運動科學的角度 | — |

**Assessment**: HIGHEST frequency (1164). Both readings appear constantly. 因為/為了 (wèi), 行為/成為 (wéi). Gemini should handle correctly via context. Too pervasive to replace — would need true NLP context detection.

**Recommendation**: Skip replacement. Monitor via audio audit.

---

### 6. 還 (hái / huán) — 381 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| hái | still/yet/also | 還是、還有、還不錯 |
| huán | return/pay back | 歸還、還清、償還、還債 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 雖然球評都指出小戴打的太精采了，但她最終還是以三分之差不敵對手 | hái |
| L01 | 還要多加練習 | hái |
| L01 | 嗯，還不錯喲 | hái |
| L02 | 這十秒可能還不夠呢 | hái |
| L02 | 他告訴自己：「那代表我還不夠努力 | hái |

**Assessment**: Overwhelmingly hái in lesson texts. 歸還/償還 don't appear. Low risk.

---

### 7. 少 (shǎo / shào) — 258 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| shǎo | small quantity/few | 少數、很少、少了 |
| shào | young | 少年、少女、年少 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L03 | B錯：少了肉類及蔬菜 | shǎo |
| L03 | C錯：少了肉類 | shǎo |
| L03 | D錯：少了蔬菜 | shǎo |
| L06 | 隨著升上不同學校，我們和國小同學之間的聯繫也（　　），很少有機會再見面了 | shǎo |
| L06 | 寒流來那天，小男孩想請阿公吃麵，在攤子旁數有多少【客人】進去吃麵 | shǎo |

**Assessment**: 少 in lessons is mostly shǎo (少了/很少/多少). 少年/年少 may appear in some narratives. Low risk.

---

### 8. 沒 (méi / mò) — 420 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| méi | not have/negation | 沒有、沒關係、沒想到 |
| mò | submerge/disappear | 沒頂、淹沒、出沒 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 她沒有因為想贏得比賽而選擇保守 | méi |
| L01 | 只要你沒有輸了自己 | méi |
| L02 | 壓力並沒有擊垮他 | méi |
| L02 | 他想出去玩，沒想到「天壤之別」 | méi |

**Assessment**: Overwhelmingly méi. 淹沒/出沒 may appear occasionally but 沒 as mò is rare in these texts. Low risk.

---

### 9. 差 (chā / chà / chāi) — 109 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| chā | difference/gap | 差距、差異、差別、三分之差 |
| chà | inferior/almost | 差不多、差勁、差一點 |
| chāi | errand/dispatch | 出差、差事、公差 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 她最終還是以三分之差不敵對手的嚴密防守 | chā |
| L01 | 贏得喝采的輸家 | — (喝采, not 差) |
| L02 | 他以千分之二秒的差距與金牌擦身而過，些微秒數的差距帶來天壤之別的結果 | chā |
| L02 | 比喻差別極大 | chā |

**Assessment**: 差 mostly appears as 差距/差別 (chā). 差不多 (chà) and 出差 (chāi) may appear occasionally. Medium risk for chā vs chà confusion.

---

### 10. 轉 (zhuǎn / zhuàn) — 118 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| zhuǎn | change direction/transfer | 轉身、轉播、轉換、轉眼 |
| zhuàn | rotate continuously | 轉圈、旋轉、打轉 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 小戴在東京奧運金牌賽的轉播收視率創下新高 | zhuǎn |
| L01 | 全臺觀眾守在電視前，目不轉睛 | zhuǎn |
| L02 | 這轉瞬即逝的十秒 | zhuǎn |
| L02 | 快樂的連假時光總是「轉瞬即逝」，令人不捨 | zhuǎn |

**Assessment**: 轉 mostly appears as zhuǎn (轉播/轉眼/目不轉睛). 旋轉/打轉 (zhuàn) less common. Low-medium risk.

---

### 11. 喝 (hē / hè) — 69 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| hē | drink | 喝水、喝茶、喝湯 |
| hè | shout/acclaim | 喝采、大喝一聲、喝令 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L01 | 贏得喝采的輸家 (title) | hè (喝采) |
| L01 | 她，打的漂亮，雖然輸了比賽，卻贏得了人心，贏得全國人民的尊敬及喝采 | hè |
| L01 | 希望獲得人民的喝采 | hè |

**Assessment**: HIGH risk — 喝 in lessons is predominantly 喝采 (hè), NOT drinking (hē). Gemini may default to the more common 喝水 reading.

**Recommendation**: Add `("喝采", "賀采")` or similar to `_TAIWAN_TTS_REPLACEMENTS` — this is the dominant use case in lessons.

---

### 12. 奇 (qí / jī) — 71 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| qí | strange/special | 奇特、新奇、好奇、驚奇 |
| jī | odd number | 奇數、奇偶 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L09 | 追求新鮮感，喜愛嘗試新奇事物 | qí |
| L16 | 百寶袋裡有任意門、時光機或竹蜻蜓等令人驚奇的法寶 | qí |
| L21 | 自我提問－問好奇、疑惑的問題 | qí |

**Assessment**: 奇 is consistently qí (新奇/驚奇/好奇) in lessons. 奇數 (jī) unlikely to appear. Low risk.

---

### 13. 校 (xiào / jiào) — 112 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| xiào | school | 學校、校長、校園、到校 |
| jiào | proofread | 校對、校稿、校正 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L06 | 隨著升上不同學校，我們和國小同學之間的聯繫也（　　） | xiào |
| L07 | 爸媽時常「掛慮」離家住校的小成，擔心他飲食或作息不夠正常 | xiào |
| L08 | 哥哥說：「勇緯勤於訓練，每天都提早三、四十分鐘到校練習 | xiào |

**Assessment**: 校 in lessons is entirely xiào (學校/到校/住校). 校對/校正 (jiào) unlikely. Low risk.

---

### 14. 樂 (lè / yuè) — 90 occurrences

| Reading | Meaning | Context trigger |
|---------|---------|-----------------|
| lè | happy/joy | 快樂、樂趣、歡樂、喜樂 |
| yuè | music | 音樂、樂器、樂團、奏樂 |

**Lesson examples**:

| Lesson | Sentence | Likely reading |
|--------|----------|---------------|
| L02 | 快樂的連假時光總是「轉瞬即逝」 | lè |
| L03 | 研究證實運動、食物都能促進大腦快樂激素「多巴胺」 | lè |
| L04 | 讓自己知道如何運動能更有效、更健康，更能享受運動的快樂 | lè |
| L07 | 一心一意希望能實現的是：讓所有動物能在最美麗的大地上，快快樂樂的生活 | lè |

**Assessment**: 樂 in lessons is predominantly lè (快樂/樂趣). 音樂/樂器 may appear in some lesson YAMLs but less frequently. Low-medium risk. Already handled indirectly: 垃圾→樂色 uses 樂 as a stand-in precisely because Gemini reads 樂 as lè.

---

## Summary: Priority for TTS Rule Addition

| Priority | Char | Reason | Recommended action |
|----------|------|--------|-------------------|
| HIGH | 喝 | 喝采 (hè) dominant in lessons, Gemini likely defaults to hē | Add `("喝采", "賀采")` |
| MEDIUM | 長 | 擅長/長大 (zhǎng) vs 漫長/長跑 (cháng) — both common | Add to Gemini system prompt context |
| MEDIUM | 重 | 重新 (chóng) vs 重要 (zhòng) | Add `("重新", "崇新")` if audio errors found |
| LOW | 為 | Too pervasive and context-dependent to replace | Monitor via audio audit |
| LOW | Others | Context almost always unambiguous in these texts | No action needed |

---

## Characters NOT in `_TAIWAN_TTS_REPLACEMENTS` scope

The existing 37 rules handle **Taiwan vs Mainland tonal convention differences** (e.g., 研究 jiù vs jiū). The 14 chars above are **context-dependent multi-readings** — a different class. They would require either:
1. Compound-level replacements (e.g., `("喝采", "賀采")`) — feasible for HIGH priority cases
2. Gemini system prompt guidance — for medium complexity
3. Audio-level QA monitoring — for low risk chars

Next step: Young audits the HIGH priority case (喝采) by listening to existing Variant C audio.
