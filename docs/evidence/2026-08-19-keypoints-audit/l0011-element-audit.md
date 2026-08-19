# L0011（story 20011）重點表逐元素盤點

來源：`/api/stories/20011/structure`（staging，一鍵登入「學生 小明」），Playwright 逐格填寫復現，
**逐格點擊、每次都重讀畫面上的「已填 N / M」實測分子變化**（不是讀 code 推論）。
截圖：`l0011-before-01-initial.png`、`l0011-before-02-all-filled-stuck-at-5-6.png`、
`l0011-before-03-result-row-sentence-missing.png`（修前，staging）；
`l0011-after-01-full-7-of-7.png`、`l0011-after-02-graded-result.png`（修後，PR #2783 preview，真實部署非 localhost）。

> 2026-08-20 補：Young 直接回報「主角」那格「第一個空格答案沒有被 count」——這正是下表第一列
> 修前分子欄「+0」那格。原始五欄盤點表只有「分母算了幾個」，沒有「分子（已填數字）實際變化」，
> 補上第五欄後這個症狀才被明確標出來，不再只是隱含在文字說明裡。

## 每一列的五個數字（含逐格點擊實測的分子變化）

「填了之後分子加幾」一欄的做法：**逐一點擊/填寫每個元件，每次動作後立刻重讀畫面上的
「已填 N / M」文字，記錄這一步讓分子動了幾**。不是讀程式碼推論會不會動。

修前（staging，真實瀏覽器逐步操作記錄）：

| 列 | 來源形狀 | 該有幾個可作答元素 | 畫面上實際有幾個 | **填了之後分子加幾**（逐格實測） | 分母算了幾個 | 判定 |
|---|---|---|---|---|---|---|
| 主角 | 單一空格 `【戴資穎】` | 1 | 1（文字框） | 填了 → **+0**（分子完全不動：0/6 → 0/6） | 1 | **BUG A**：元件畫得出來、點得到，但填了對分子零效果，且送出的答案是空字串 |
| 主題 | 純文字 display | 0 | 0 | n/a | 0 | 正確，非互動元素 |
| 球風 | 雙空格 `追求【邊角球】和【難以預測】` | 2 | 2（文字框） | 填第一格 → **+1**（0/6→1/6）；填第二格 → **+1**（1/6→2/6） | 2 | 正確：雙空格恰好落在「有 blank 後綴」分支，key 對得上 |
| 事例／背景 | checkbox，3 選項，指示語「多選」 | 1（一整組） | 3 個可勾選框 | 勾第一個 → **+1**（2/6→3/6）；再勾其餘兩個 → **各 +0**（已算過這個欄位） | 1 | 正確：多選本來就允許複選，一欄只計一次 |
| 事例／經過 | checkbox，2 選項，指示語**「單選」** | 1 | 2 個可勾選框，**兩個都能同時勾** | 勾第一個 → **+1**（3/6→4/6）；再勾第二個 → **+0**（但兩個框**同時顯示已勾**） | 1 | **BUG C**：分子數字沒錯（本來就只算一次），但畫面上兩個選項可以同時亮，指示語「單選」形同虛設 |
| 事例／結果 | 一句話 2 個空格，各配一組 2 選項（"第N個空格") | 應為 2（各自一題） | **句子完全消失**，只剩 4 個扁平勾選框（贏了/輸了/贏得/失去） | 勾任一個 → **+1**（4/6→5/6）；再勾其餘三個 → **各 +0** | 1（被歸類成一個 checkbox 欄位，**應為 2**） | **BUG B + 分母少算 1**：句子 context 遺失、4 選項混一組分不出哪兩個一組、且這兩個空格只被算成 1 題不是 2 題 |

**加總（修前）**：可互動元素 9 個（3 文字框 + 3+2+4 checkbox），分母顯示 **6**，逐格填完所有元素後
分子卡在 **5**（`主角` 那 1 加不上去），提交鈕永遠灰色。

修後（PR #2783 preview，真實部署逐格實測）：

| 列 | 填了之後分子加幾（逐格實測，PR preview） |
|---|---|
| 主角 | 單獨只填這一格 → **+1**（0/7 → 1/7）✅ 已修好，Young 回報的症狀消失 |
| 球風 | 兩格各 **+1** |
| 背景 | 勾一個 → **+1**，其餘同組 **+0** |
| 經過 | 勾「忠於自己的球風」→ **+1**；再勾「保守地打安全球」→ **+0** 且**畫面上第一個選項會被換掉**（radio 語意，兩個不會同時亮） |
| 結果 | 句子完整保留，勾「輸了」→ **+1**；勾「贏得」→ **+1**（兩個空格各自獨立計分） |

**加總（修後）**：分母 = 1(主角) + 2(球風) + 1(背景) + 1(經過) + 2(結果) = **7**，逐格填完分子精準到 **7**，
可送出並拿到 AI 逐格批改結果（見 `l0011-after-02-graded-result.png`）。

## 重點表模組元素類型總表（每種元素：查了什麼 / 結論 / 證據在哪；沒查的老實寫沒查）

| 元素類型 | 查了什麼 | 結論 | 證據在哪 |
|---|---|---|---|
| 單一空格 fill_blank | 全庫掃描 + 逐格瀏覽器實測分子變化（修前/修後） | **BUG A，已修**：128 課/400+ 處受影響，key 慣例統一後全部修好 | 本文件、`audit-raw.json`/`audit-after-fix.json`、`StoryStructureTable.singleBlankDenominator.test.tsx`（mutation-verified）、live PR preview 逐格實測 |
| 多空格 fill_blank | 全庫掃描 + 逐格實測 | 正常，不受 BUG A 影響（key 本來就對得上） | 同上 audit script；既有 `renders every fill_blank context sentence` 測試持續綠 |
| 行內選擇（句子多空格各配選項組，"第N個空格"寫法） | 全庫掃描 `_INLINE_SLOT_RE` 訊號 + 逐一手動確認每一課的實際形狀 | **BUG B，2 課中 1 課已修**（L0011）；L0102 為複合形狀，已知缺口，本 PR 未修 | `test_story_structure_cell_parser_2776.py`、`test_inline_choice_grading_2776.py`、`l0011-element-audit.md` 本節上方 |
| 行內選擇（句子多空格寫在同一括號內，"【□①多②少】"寫法，L0072） | **只查到存在、沒有修**：抽查 L0072 served rows 發現 options 陣列被壓成含重複值的破碎陣列 | 是第三種形狀，不符合本 issue 掃描鎖定的訊號，**建議另開 issue**，本 PR 不動 | 本文件「已知缺口」段；未寫自動化測試鎖住（因為不修） |
| 單選指示語（checkbox 只能選一個） | 全庫掃描「單選」字樣 + `select_mode` 標記 + 前端 radio 語意逐格實測 | **BUG C，已修**：15 課/22 處全部補上 `select_mode=single` 並在畫面上生效 | `test_story_structure_cell_parser_2776.py::TestDetectSelectMode`、corpus-wide `test_single_select_instruction_always_carries_select_mode_single`、`StoryStructureTable.selectMode.test.tsx`（mutation-verified）、live PR preview 逐格實測（經過欄兩個選項不會同時亮） |
| 多選指示語（checkbox 可選多個） | 確認未受 BUG C 修復影響（`select_mode=multi` 時維持原行為） | 正常，向下相容 | `test_ordinary_checkbox_is_unaffected`、`StoryStructureTable.selectMode.test.tsx` 的多選對照測試 |
| 干擾項標記（□ 不外洩給學生） | **沿用既有機制，未重新測試**：`_strip_distractor_marks` 是 #2736 既有修復，本 PR 沒有改動它的邏輯，只是把它也套用在新的 `blanks[].options` 上（防禦性，非必要因為來源已經乾淨） | 既有機制持續生效（既有回歸測試持續通過），新欄位比照辦理 | `test_choice_rows_carry_options_2736.py` 全綠（未改動其斷言邏輯，只加了 inline_choice 例外分支） |
| 指示語本身（單選/多選/複選/勾選/打勾 不算進空格數） | **沿用既有機制**（`isInstructionBlank`/`_INSTRUCTION_WORDS`），本 PR 沒有改動判斷邏輯本身，只是在後端新增 `detect_select_mode` 讀同一段文字做額外用途 | 既有機制未變動，我在此基礎上疊加新功能 | `TestNumberedListMarkersAreNotBlanks`（新增，驗證附帶修復不影響指示語判斷）；既有前端 `isInstructionBlank` 測試持續綠 |
| 分母計算（`totalInteractive`） | 全庫掃描 + 單元測試 + 逐格實測 | BUG A 的直接後果之一，已修（見上） | 同 BUG A 各項證據 |
| 分子計算 / 送出條件（`totalAnswered`、`buildAnswerPayload`） | 全庫結構掃描（哪些欄位會被錯誤 key 影響）+ 逐格瀏覽器實測分子變化（修前/修後，本文件核心）+ 送出 payload 內容檢查（vitest 斷言 fetch body） | BUG A 的另一半後果（送出空字串），已修 | `StoryStructureTable.singleBlankDenominator.test.tsx` 第二個測試（斷言 fetch payload 的 `value` 欄位）、live PR preview 提交成功並拿到正確批改 |
| 選項五種寫法（list/dict/sub_items/inline_choices/option_bank，於 `keypoints_to_structure.py`） | **沒查，本 PR 未動這個檔案**。這五種寫法的抽取邏輯不在本次盤點/修復範圍內 | 未驗證，沿用既有（今天稍早其他工作階段已修復並記錄在 `build-keypoints` skill） | 老實標示：無新證據，僅讀過程式碼確認本 PR 沒有動它 |
| 答案不外洩給學生端（checkbox `correct_options`、新 `blanks[].correct_option`） | 白名單掃描整個 served payload（含巢狀 `blanks[]`） + 正向對照（伺服器端快取仍保有答案供判分） | 通過：新欄位比照既有 `correct_options` 規則，白名單 + 巢狀掃描皆綠 | `test_structure_answer_key_not_served_2736.py`（新增 `test_inline_choice_blank_options_but_not_correct_option`，含正向對照 `assert found_inline_choice`） |
| `(N)` 段落編號誤判成填空格 | 全庫掃描 `(N)` paren pattern | **附帶缺陷，已修**：25 課/93 處 | `TestNumberedListMarkersAreNotBlanks`、audit script 前後對照（BUG A 欄位數 400→405 的歸因） |

## 三個判定準則（畫得出來 / 學生點得到 / 算得進分母）

| 列 | 畫得出來 | 學生點得到 | 算得進分母 |
|---|---|---|---|
| 主角（修前） | ✅ | ✅（能打字） | ❌ **BUG A** |
| 經過（修前） | ✅ | ⚠️ 點得到但不該讓點兩個 | ✅ |
| 結果（修前） | ⚠️ 句子不見，選項無context | ⚠️ 能點但不知道在選什麼、能複選2個不同空格的選項 | ❌ 分母少 1 |

三者缺一即為缺陷，「結果」一列三個條件全部不完整。

## 全庫掃描（`backend/scripts/audit_keypoints_table_defects.py`）

| | 修前 | 修後 |
|---|---|---|
| 有 `story_structure_table` 的課 | 150 / 175 | 150 / 175 |
| BUG A：單一空格欄位（key 慣例不一致，永遠算不進分母＋送出空字串） | 128 課 / 400 處 | 128 課 / **405** 處（見下方說明；已修好，這是「受影響欄位數」不是「未修欄位數」） |
| BUG B：一句話兩空格被攤平成一組扁平 checkbox | 2 課 / 2 處 | **1 課 / 1 處**（L0011 已轉成 `inline_choice`；L0102 為已知缺口，見下） |
| BUG C：指示語「單選」卻能複選 | 15 課 / 22 處 | **0 課 / 0 處** |

BUG A 的欄位數從 400 → 405：附帶修掉的「`(1)`/`(2)` 段落編號被誤判成填空格」（見下）讓 25 課裡幾個原本被計入「多空格」的欄位，拿掉編號雜訊後正確地變成「單一空格」，因此**歸類**移動，不是新增缺陷。BUG A 本身是純前端 key 慣例問題（`StoryStructureTable.tsx`），已在 `tallyCell`／`pushFillBlankAnswers` 統一為「一律帶 blank index」；驗證見 vitest `StoryStructureTable.singleBlankDenominator.test.tsx`（含 mutation：改回舊寫法會讓分母卡住，測試變紅）。

### 全庫維度：「填滿所有可見元素之後，分子 ≠ 分母」有幾課

**修前：128 課**（跟 BUG A 欄位數同一份掃描）。理由不是猜測，是這個機制本身的性質：

- 寫入端 `InlineWorksheetContent` 對**每一個**匹配到的真空格都寫入帶 blank index 的 key（`{row}[-{sub}]-b{N}`），不分空格數是 1 還是多個。
- 讀取端（修前）只有在**同一欄空格數 > 1** 時才用一樣的帶索引 key；空格數剛好 1 時改用不帶索引的 key。
- 這兩件事合起來的推論：**任何一課，只要有 1 個空格的 fill_blank 欄位，填了那格 100% 不會讓分子動**——這不是機率性的、也不因課而異，是同一段程式碼對每一課套用同一條規則的必然結果。
- 因此「有幾課會出現分子≠分母」等於「有幾課至少有 1 個單一空格 fill_blank 欄位」，就是 BUG A 的 128 課這個數字，兩者是同一件事的兩種問法。

**不是只靠這個推論就交差**：額外在 PR preview 用瀏覽器**逐格實測兩課**（L0011 story 20011、L0013 story 20013，兩課的重點表模板不同——前者是 theme_facts 主角/球風/事例，後者是起因/經過/結果類型）驗證修好後兩課都能填滿到分母、逐格分子都精準 +1：

```
L0011：0/7 → 逐格填完 → 7/7（含單一空格「主角」單獨測試 0/7→1/7）
L0013：0/4 → 逐格填完 → 4/4（4 個全是單一空格的 fill_blank，全部逐格 +1）
```

修好後兩課都精準到底，沒有卡住的欄位。128 課的機制修復是同一段程式碼、同一個 if 分支，不是逐課個別修，所以這兩課能代表其餘 126 課的行為（都是同一組 `tallyCell`/`pushFillBlankAnswers` 程式碼在跑）。

**修後：0 課**（理由同上，機制對所有課一致生效，非逐課修補）。

### 附帶修復：`(N)` 段落編號被誤判成填空格（25 課 / 93 處）

在追查 L0102 為何無法被判成 `inline_choice` 時發現：`normalize_paren_blanks_to_brackets` 把 `(1)棉花肺實驗的問題` 這種段落編號也當成空格轉換，導致畫面上出現一個預先填好「1」的輸入框，而且同一個 row 的多個小題常常共用同一個（被抹成空白的）標籤文字，例如 L0132「研究一(1)」與「研究一(2)」修前都顯示成無法分辨的「研究一【　　　】」。已加排除規則：paren 內是 1-2 位純數字時視為段落編號，不轉換。回歸鎖：`test_story_structure_cell_parser_2776.py::TestNumberedListMarkersAreNotBlanks`。

### 已知缺口（本 PR 不修，記錄供追蹤）

**L0102「對網紅實驗的批判」**：句子裡有 3 個空格，其中 2 個屬於乾淨的「第N個空格」配對形狀（吸/吃），但**第 1 個空格是獨立的自由文字填空**（「很多有害物質...根本【　】」），且該空格在來源 `keypoints.yml` 裡沒有標準答案可用來評分。這是「1 個自由文字空格 + 2 個選擇題空格混在同一個 cell」的複合形狀，跟 L0011 的「全部空格都是選擇題」形狀不同，直接套用會產生錯誤的空格-選項對應。維持現況（checkbox，選項被攤平但不會顯示不存在的答案），需要回頭確認來源真值後再處理，不在本 PR 硬套一個可能錯的形狀。

另外在盤點中發現 L0072「工作記憶與閱讀速度的關係」有第三種、更早的行內選擇寫法（`【□①多 ②少】`，選項寫在同一個中括號內，不是「第N個空格」的行），現行消毒器會把它的 4 個空格對應的選項壓成含重複值的破碎陣列（`['多','多','好']`）。這不符合本 issue 掃描鎖定的「第N個空格」訊號，是另一種形狀，建議另開 issue 處理，本 PR 不動它。
