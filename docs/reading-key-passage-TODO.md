# 重點朗讀（Key-Passage Reading）實作 TODO

> 來源：2026-07-20 教授審查會議（曾世傑教授）。決策：朗讀簡化為只練老師指定的「重點段落」（約 300-350 字），
> 逐段/全文從 nav 隱藏。完整脈絡見 `docs/meetings/2026-07-20-record.md` + `docs/PRD.md` §重點朗讀。

## 背景（會議定調）

- 朗讀**只看流暢率**（每分鐘字數 / 最終秒數），不看逐字正確率
- 只練**老師指定的重點段落**（紙本課文旁**手指頭符號 ☞** 標起點、**右欄累計字數**標長度，約 300-350 字），不練全文
- repeated reading 練 3 次最有效；自我校正念對算對
- 逐段/全文朗讀**保留功能、只從 StepperNav 隱藏**（ToolPicker 仍可進）

## Scope（2026-07-20 校正 — 用真資料，非年級）

- **scope = worksheet_section_order 有 `reading_timer`(念順順) 的課 = 有重點朗讀**，跟年級無關（Young 校正：戴資穎那課也有）
- 實數：`grep -rln reading_timer backend/data/lessons/_parsed_2026-05-01/` = **132 課**（橫跨 G4/G5/G6/G8/G9）
- ⛔ 舊 memory「七年級無朗讀、只六年級幾課」= **錯（stale，已作廢）**

## 抽取可行性 + 正確性驗證（2026-07-20 實測 G6-L22 教師版 DOCX，已跑真資料）

課文在 **table[0]**：col1=課文、col3=累計字數（`28,58,87,117,147,177,206,216,244,273,301`）。

| 錨點 | 在 DOCX 的形式 | 抽法 | 驗證結果 |
|------|---------------|------|---------|
| 手指頭 ☞（起點） | `drawing/pict` 內嵌圖形（非文字） | render→vision（多模態 Claude） | ✅ vision 抓對「這下孟嘗君頭大了」|
| 累計字數（長度） | col3 文字層抓得到 | grep col3 取 max | ✅ max=301 |

**已驗證事實（真 DOCX 跑出來）**：
- ✅ **max 累計字數 = ground truth**：重點段**不含標點字數=300** vs 老師 max=**301**，差 1 字 → **累計字數算的是「不含標點」的字數**。TDD checksum = `抽出不含標點字數 ≈ max(累計字數)`（±few 容差）
- ⚠️ **邊界會斷在句中**：raw max=301 落在「…為孟嘗君說好話」**句子中間**（下一句被切）→ **抽取後必須 snap 到下一個句尾（。」！？）**
- ✅ **vision vs DOCX 比對**：page-02 渲染的 ☞→301 區域文字，與 col1 文字層抽出的段落**完全一致**
- ⚠️ **兩欄不能逐行對齊**（課文 9 段落 vs 累計字數 29 視覺行）→ 用「☞ 起點 + max 字數」抽，不用行對齊

**抽取演算法（驗證後定案）**：
1. vision 定 ☞ 起點段（col1 中該句起點）
2. col3 grep 取 max 累計字數 = 目標長度（不含標點）
3. 從起點取字，到不含標點字數 ≈ max，**再 snap 到下一句尾** → 顯示段落（不斷句）
4. **計分 benchmark 用原始 max（301）**，顯示段落 snap 到句尾 → 兩者分開
5. TDD lock：`抽出段(不含標點) ≈ max(累計字數)` 先紅後綠

**⚠️ 仍未證明全體**：僅 G6-L22 一課全驗；需跑 golden set（5-10 課，含不同年級/排版）量命中率，不可 N=1 推 132 課
- **架構（Young 定調）**：抓取用文字 grep（col3 累計字數）+ QA 用穩定 render→vision（☞ 起點 + 邊界）；手指頭用 coding 抓到就好、vision 用多模態 Claude

## TDD 標準（Young 提案，核心）

- **`抽出重點段字數 ≈ max(累計字數欄)`** = 老師親自標的長度 = **現成 ground truth**（老師寫的、非 AI 自產 → 過「驗收標準不可 AI 自閉環」）
- 取 **max** 比抓整串序列穩（不需順序，只要最大值；但要先把累計字數欄的數字從頁碼/日期等雜訊隔離）
- sanity：`300 <= max(累計字數) <= 350`
- 起點驗證：累計字數從第一個數字（如 28）那行開始 = ☞ 那行 → 起點也可由「數字序列從哪開始」交叉驗證
- 這是決定性斷言（regression lock）：抽取器改動先讓它紅過再綠，禁 special-case

---

## Phase 0 — nav 簡化（✅ 本次已做，feature/key-passage-reading-nav）

> ⚠️ **做法定案（2026-07-20 code review 校正）**：**改造既有 `full-reading` step 成「重點朗讀」，不新增 step**。
> 第一版原本新增 `key-reading` step 複用 FullReadingPage → code review 抓到 CRITICAL bug：FullReadingPage 把
> stepId 寫死 `'full-reading'`（`FullReadingPage.tsx:22-24,39` + `useLearningStepNavigation.ts` + `stepHandlerUtils.ts`），
> 學生完成 key-reading 會記成 full-reading → key-reading 進了 assignment 必要步驟卻永遠 not-completed →
> **作業無法提交**（打到所有 default-sequence 課、靜默無 error）。改成保留 `full-reading` id → 完成/進度/作業 gate 全沿用現成佈線，零 bug。

- [x] `stepConfig.ts`：`tutor`(逐段) 設 `enabled: false`（ToolPicker 仍可進）
- [x] `stepConfig.ts`：**`full-reading` 改造** → label「重點朗讀」、displayChar **「朗」**、hint 改朗讀指定段落、**id/enabled/view/dbStepNumber 不變**（保留現成完成佈線）
- [x] `stepConfig.ts`：`WORKSHEET_TYPE_ALIASES` `reading_timer → full-reading`（念順順→重點朗讀）；`KNOWN_UNMAPPED_WORKSHEET_TYPES` 清空
- [x] `learningRoutes.tsx`：`'full-reading' → FullReadingPage`（不動，只加註解）
- [x] spec 同步：`test_step_sequence_spec.py` + `test_content_schema_spec.py`（**16 valid / 11 enabled / 5 disabled / 16 sequence**）
- [x] gate：spec 17 passed / stepConfig.test 14 passed / ESLint 0 errors / render-smoke 15 passed
- [x] code review（code-reviewer agent）：抓到並修掉 assignment-gate CRITICAL；view 無碰撞、無 #2279 TDZ 風險
- [ ] **視覺 QA**：挑一課 **DEFAULT-sequence** 課確認 nav 逐段消失、朗讀步顯示「朗 重點朗讀」、點得進去、FullReadingPage render 正常、**跑一次 assignment 提交確認不卡**（PR preview，本機被 CORS 擋）

### Phase 0 現況說明
- 「重點朗讀」step 現在**仍唸全文**（FullReadingPage 未改內容來源）——Phase 1 接 `key_reading` 欄位後才真正「只唸指定段」
- 全文朗讀不再是獨立可選項（改造掉了）；逐段走 ToolPicker

### Phase 0 follow-up（code review 提的非阻擋項）
- [ ] `FullReadingPage.tsx:37` back 鈕寫死指向 `/learn/{id}/tutor`，tutor 現 enabled:false → StepEnabledGuard 會 redirect 到第一個 enabled step（非 bug、UX 小驚訝）。改指向真正前一步（reading-annotation）

---

## Phase 1 — 重點段抽取 + 真正只唸指定段（跟啟翔 DOCX pipeline + 教材二修合流）

> SOP 已固化成 skill：**`.claude/skills/build-key-reading/`**（extract 演算法 + 三層 QA SPEC/TDD/EDD + reference `extract_key_reading.py`）。抽取器已對 G6-L22 / G4-L10 vision 驗證、G6-L23/24 結構驗證。

- [ ] 擴充 DOCX→schema 抽取器（啟翔 `build_lesson_schema.py` 那條 pipeline）：加「重點朗讀段」欄位
  - vision 認 ☞ 起點 + 文字 grep 累計字數 → 段落範圍（`key_reading: {start_para, end_para}` 或 char range）
  - 寫進 lesson schema（content 來源，非純 metadata 的 `G*-L*.yml`）
- [ ] **TDD lock**：`抽出段字數 ≈ max(累計字數)`（±標點容差，先校準計數定義：301 有沒有含標點）先紅後綠
- [ ] golden set 5-10 課量命中率（含有朗讀段 + 沒朗讀段兩類）→ 命中率報告，不 N=1
- [ ] 沒朗讀段的課：extractor 要優雅處理「無重點段」→ key-reading fallback 或該課不排 key-reading
- [ ] `FullReading` 元件：有 `key_reading` 欄位就唸該段（slice `story.content`），沒有 fallback 唸全文
- [ ] key-reading 專屬 localStorage key（解 Phase 0 技術債）
- [ ] 前提確認（跟啟翔/淑麗）：手指頭符號在**二修後的** DOCX 是否仍為 drawing（vision 可抓）；若某些課只有印刷版面沒編碼 → 老師直接給段落範圍當資料（一欄 sheet）

## Phase 2 — 評分對齊會議（可跟 Phase 1 併）

- [ ] 朗讀結果**主指標收斂成流暢率**（每分鐘字數/秒數），弱化逐字正確率呈現（世傑：回饋太多降低學習效率）
- [ ] 口音通融清單：接曾世傑教授要傳的「台灣人最常念錯的音」清單
- [ ] 自我校正念對算對（現行邏輯確認）
- [ ] 決定是否保留紙本式自評（加油/還不錯/非常順暢）
