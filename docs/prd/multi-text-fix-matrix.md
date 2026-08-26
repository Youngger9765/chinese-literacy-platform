# 一課多篇 · 修復矩陣（#2916 / #2930）

> 這份是**活的**：每修一格就更新這一份，不要另開新檔。
> 每一格只寫「驗過的」——沒驗的寫「未驗」，不要寫成綠的。

## 0. 一句話

`slug` 是身分。**取任何內容都要連 slug 一起帶進去**；
只用 `lesson_id + 模組名` 定址，拿到的永遠是頂層 ＝ 第 1 篇。

## 1. 新舊定址的差異（這是所有 bug 的同一個根）

| | 舊：`lesson_id` + 模組名 | 新：`lesson_id` + **slug** + 模組名 |
|---|---|---|
| 定址到什麼 | 整課頂層（＝第 1 篇） | 指定的那一篇 |
| 單篇課 | 正確 | 正確（slug 為空 → 退回頂層） |
| 多篇課 | **靜默取到第 1 篇** | 正確 |
| 壞掉的樣子 | 沒有錯誤、沒有 404、畫面正常、音檔照播，**只是內容是別篇** | — |
| 為什麼難抓 | 每一層型別都對、每一道格式門都綠 | — |

⛔ 這個形狀已經在四個不同地方各犯一次（轉址表、QR 目標、前端對應、句子對照表）。
判準：**看到 `lesson_id` 跟內容欄位出現在同一個取值式裡，就要問「多篇課會拿到哪一篇」**。

## 2. 十個維度 × 多文本 / 單文本

> 🔴 **2026-08-26 撤回：下表的綠燈有一部分是錯判準量出來的。**
> 擁有者實測找到三類 bug，全部落在被我標綠的格子裡：
> ① 語詞應用三篇同題（已修）② 文章重點表三篇同表（修復中）
> ③ 按「完成標記」直接跳到最後一步（已修待驗）。
> 共同原因：我用 `?p=` 直達網址驗，從沒走過「從第 1 步逐步按完成」的真實路徑；
> 判準只問「三篇是否不同」，沒問「這一篇是不是對的那一篇」。
> **重驗完成前，下表僅供追蹤，不可當交付依據。**

驗證對象：L0063（G6-L22，一份學習單三篇）。單文本對照組：任一單篇課。

| # | 維度 | 多文本 | 單文本 | 鎖在哪 |
|---|---|---|---|---|
| 0 | 帳本 `_manifest.yml` | ✅ 19 列，三篇各有自己的 `full_text_annotate` 列 | ✅ 一列 | `test_row_overlay_spec.py` |
| 1 | yml / 後端資料 | ✅ `repeat_rounds` 三篇段落各不同 | ✅ 無 `repeat_rounds` | `test_repeated_modules_split_spec.py` |
| 2 | slug | ✅ 每一節一個，網址 `?p=` 各不相同（實測 20 個入口） | ✅ 由帳本推導 | `test_qr_addressing_spec.py` |
| 3 | 內容 | ✅ 三輪課文與後端真值逐一相符、別篇未混入（真瀏覽器實測） | ✅ | `realPayloadRoundScope.test.ts`（**真 API payload**） |
| 4 | 元件 active | ✅ **已修**：三輪的 `aria-current` 落在第 2/7/12 顆（間隔 5 ＝ 每輪五個模組） | ✅ 不適用 | `activeStepHighlight.test.ts` + `roundAwareStepNeighbours.test.ts` |
| 5 | HTML | ✅ 三篇截圖逐張看過：0 破圖、0 橫向溢出、0 pageerror。⚠️ 三篇**標題相同**（資料裡每篇沒有自己的 title，前台沿用課名；後台有標「（篇1/2/3）」）——現況不是缺陷 | ✅ | 截圖 + DOM 量測 |
| 6 | QR code | ✅ 六個代號六個不同頁面 | ✅ 170 課都有代號 | `test_slug_redirect_spec.py` |
| 7 | URL | ✅ `?p=` 由 `stepPath` 統一產生 | ✅ | `stepPathIsTheOnlyBuilder.test.ts` |
| 8 | Audio | ✅ **已修並在 staging 驗過**：前台三篇送出各自的首段（3/3）、後台三列各送自己那一篇（3/3） | ✅ 不帶篇次時行為不變 | `test_tts_mapping_round_spec.py`＋`ttsRoundScoped.test.ts`＋`everyLessonAddressedCallCarriesRound.test.ts` |
| 9 | Log / 進度 | ✅ 三篇分開存，裸 key 會塌 | ✅ | 前一輪真 DB round-trip |

## 3. 本次（#2930）修了什麼

句子對照表 `GET /api/tts/mapping/{lesson_id}` 只認課號，回的是頂層（第 1 篇）的句子。
前端拿 `lesson_id + 段落序號` 去對照，於是**第 3 篇的段落被換成第 1 篇的句子**。

- slug 一路帶到底：頁面 → hook → `ttsApi` → 端點
- 前端行程內快取 key 改成含篇次（原本三篇共用一份，誰先到就把另外兩篇釘死）
- **「節的代號 → 它用哪一篇課文」的解析只放後端一處**：呼叫端傳自己的代號就好。
  讓每個呼叫端各自換算 = 漏一處就靜默唸錯篇。
- 順帶修好步驟導覽讀 `currentView`（那裡面沒有篇次）

## 4. 還沒修 / 還沒驗

| 項目 | 狀態 | 說明 |
|---|---|---|
| HTML（維度 5） | 未驗 | 還沒定義要驗什麼 |
| ~~訪客那條路的朗讀~~ | ✅ 已驗 | staging 3/3、prod 3/3：內容對、送字對、Azure 音檔、機器音 0 |
| prod 後台 | ⛔ 驗不了 | 需要真帳號，prod 沒有一鍵登入 → 交辦 Hans |
| 不經過統一 scope 的其他路徑 | 未逐一驗 | 見下 |

**同族風險點**（吃 `lesson_id` 取內容、不經過前端統一 scope 的路徑）：
`testset` / `admin_stories` / `classroom_texts` / `learning_exit_ticket` / `learning_errors`。
掃描顯示後端有 55 處讀輪次型欄位，多數在建構期（安全）；
要逐一回答的是「這條路服務時拿的是哪一篇」。

## 4.5 量測本身踩過的坑（下一個人別重踩）

同一輪 QA 我量錯四次，每次都拿到一個乾淨、可以貼進報告的數字：

| 我量的 | 為什麼是錯的 |
|---|---|
| `<table>/<tr>` 找後台的列 | 那頁根本不用 table，回 0 列 —— 看起來像「後台沒有這一課」 |
| 只等 3.5 秒就判定表格沒出現 | 它要載 175 課 |
| 用 `repeat_rounds` 的 dict 順序對照畫面第 1/2/3 列 | 畫面走帳本順序，兩者不同 → 三篇明明全對卻報全錯 |
| 自己算 active 該在第幾顆 | 漏掉列首那顆非步驟鈕，整排差一 |

**每一個量測都先讓它抓一個已知存在的東西**（總列數 > 0、G6-L22 找得到三列）。
今晚三次是靠這個正向對照才發現量錯的，不是靠更小心。

## 4.8 Production 驗證（2026-08-26，走真入口）

`https://lingoleap-prod.web.app`，全新 context（＝真的沒登入，就是掃 QR 的人看到的）：

| 項目 | 結果 |
|---|---|
| 掃 QR 的三篇 | 3/3 內容對、朗讀送字對、Azure 音檔、機器音 0、pageerror 0 |
| 短代號轉址 | 307 到前端網域的正確頁面；`/q/zzzzz` 與 `/q/nope` 都 404（負向對照） |
| **QR 印出來的值** | `https://lingoleap-prod.web.app/q/7wavn` —— 正式站，不是測試站 |
| 五個重複模組 × 三篇 | 在 staging 驗過 5/5；prod 只驗得到訪客可讀的兩步（無一鍵登入） |

⛔ **未驗**：prod 後台 `/admin/lesson-audio` —— 需要真帳號，prod 沒有一鍵登入。
後台的 QR 與前台共用同一支產生器（前台已證實產出 prod 網域），但沒實測過，不替它背書。
交辦單：`docs/qa/2026-08-26-multi-text-manual-qa.md`。

## 5. 怎麼驗（給下一個人）

```bash
# 後端
cd backend && python -m pytest specs/test_tts_mapping_round_spec.py -q
# 前端
cd frontend && npx vitest run src/services src/config src/hooks
```

真環境抽驗（三篇內容要各不相同、且與後端真值相符）：
拿 `GET /api/stories/20063` 的 `repeat_rounds[slug].paragraphs[0]`
去比對 `/learn/20063/full-text-annotate?p={slug}` 畫面上的文字。
