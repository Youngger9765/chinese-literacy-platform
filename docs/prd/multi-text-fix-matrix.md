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

驗證對象：L0063（G6-L22，一份學習單三篇）。單文本對照組：任一單篇課。

| # | 維度 | 多文本 | 單文本 | 鎖在哪 |
|---|---|---|---|---|
| 0 | 帳本 `_manifest.yml` | ✅ 19 列，三篇各有自己的 `full_text_annotate` 列 | ✅ 一列 | `test_row_overlay_spec.py` |
| 1 | yml / 後端資料 | ✅ `repeat_rounds` 三篇段落各不同 | ✅ 無 `repeat_rounds` | `test_repeated_modules_split_spec.py` |
| 2 | slug | ✅ 每一節一個，網址 `?p=` 各不相同（實測 20 個入口） | ✅ 由帳本推導 | `test_qr_addressing_spec.py` |
| 3 | 內容 | ✅ 三輪課文與後端真值逐一相符、別篇未混入（真瀏覽器實測） | ✅ | `realPayloadRoundScope.test.ts`（**真 API payload**） |
| 4 | 元件 active | ❌ **圓圈永遠停在第一個同名步驟** | ✅ 不適用 | 未鎖 → 下一項工作 |
| 5 | HTML | 未驗 | 未驗 | 無 |
| 6 | QR code | ✅ 六個代號六個不同頁面 | ✅ 170 課都有代號 | `test_slug_redirect_spec.py` |
| 7 | URL | ✅ `?p=` 由 `stepPath` 統一產生 | ✅ | `stepPathIsTheOnlyBuilder.test.ts` |
| 8 | Audio | ✅ **本次修好**：曾經畫面第 3 篇、聲音第 1 篇 | ✅ 不帶篇次時行為不變 | `test_tts_mapping_round_spec.py` + `ttsRoundScoped.test.ts` |
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
| 圓圈 active | ❌ 已確認壞 | 同名步驟出現三次時，高亮永遠在第一個 |
| HTML（維度 5） | 未驗 | 還沒定義要驗什麼 |
| 不經過統一 scope 的其他路徑 | 未逐一驗 | 見下 |

**同族風險點**（吃 `lesson_id` 取內容、不經過前端統一 scope 的路徑）：
`testset` / `admin_stories` / `classroom_texts` / `learning_exit_ticket` / `learning_errors`。
掃描顯示後端有 55 處讀輪次型欄位，多數在建構期（安全）；
要逐一回答的是「這條路服務時拿的是哪一篇」。

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
