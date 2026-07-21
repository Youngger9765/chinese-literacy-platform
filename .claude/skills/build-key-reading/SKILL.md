---
name: build-key-reading
description: 從教師版 DOCX 抽「重點朗讀」（念順順）指定段落並轉成 JSON/YML schema，供學生只朗讀老師指定的重點段（非全文）。含 extract 演算法 + 三層 QA（SPEC / coding TDD / vision EDD）+ 前後端/API/content 驗證。當需要「建重點朗讀」「念順順轉線上」「docx 抽朗讀段」「key reading from docx」「重點段抽取」時使用。來源：2026-07-20 教授審查會議。
---

# build-key-reading — DOCX 念順順 → 重點朗讀段 schema

把一課教師版 DOCX 裡「念順順」活動的**指定朗讀段**忠實抽成 schema，讓線上學生只朗讀老師挑的重點段（約 300-400 字），不朗讀全文。**絕不**用整篇 `story.content` 當朗讀段——那是全文朗讀（已從 nav 隱藏）。

## 何時用
- 把某課的念順順（重點朗讀）做成線上版
- 教材二修後重跑重點段抽取
- 132 課（worksheet 有 `reading_timer` 的）批量點亮重點朗讀

## 背景：重點朗讀的真實設計（2026-07-20 教授審查 + vision 驗證）
紙本念順順說明原文（G4-L10 實拍確認）：
> 「請用計時器，**從指定段落（☞）開始朗讀**，計時 **1 分鐘**讀的字數，並記錄在表格中。」
> 我的表現：□<190字 □191~220字 □>221字

三個資料錨點：
- **☞ 手指頭** = 指定起點段落（DOCX 內是 `w:drawing`/`w:pict` 圖形，非文字）
- **累計字數欄** = 課文每視覺行的累計字數（如 28,58,…301），**max = 標了字數的可讀範圍**（1 分鐘最快讀到哪），**不含標點**
- **我的表現門檻**（<190/191~220/>221）= **CPM 流暢度 benchmark** → 走既有 `reading_benchmark` 欄位，**不是** max 累計字數

> ⚠️ 關鍵區分：`max 累計字數` = 朗讀段的**顯示範圍長度**（要有夠多字讓學生讀 1 分鐘）；CPM 計分門檻是**另一組數字**（我的表現表），兩者分開，別混。

## Scope（用真資料，非年級）
- scope = `worksheet_section_order` 有 `reading_timer`（念順順）的課 = **132 課**（`grep -rln reading_timer backend/data/lessons/_parsed_2026-05-01/`），橫跨 G4/G5/G6/G8/G9
- ⛔ 別用年級判斷（舊 memory「七年級無朗讀、只六年級」= 錯，已作廢）；有 reading_timer 就有重點朗讀

---

## 1. Extract：DOCX → JSON/YML（演算法，已對 G6-L22 / G4-L10 vision 驗證）

參考實作：`extract_key_reading.py`（本 skill 目錄）。正式整合進 `scripts/build_lesson_schema.py`（跟 spotlight/keypoints 同 pipeline）。

**步驟**：
1. **找朗讀表格**：某 table 的某 cell 是「累計字數欄」= 一串遞增數字、末值 150-600（`nums == sorted(nums)`）。同 row 中**去標點後文字最長的 cell = 課文欄**。
2. **☞ 起點**：課文欄中**第一個含 `w:drawing`/`w:pict`/`w:object` 的段落** = 起點段（手指頭圖形所在）。char offset = 之前段落文字長度和。
3. **範圍長度**：`extent = max(累計字數)`（不含標點字數）。
4. **切段 + snap 句尾**：從起點取字，到**不含標點**字數 ≈ extent，**再往後 snap 到下一個句尾（。」！？）** → 不斷在句中。
5. 輸出 schema（見下）。

**輸出 schema**（釘死；寫進 lesson content YML/JSON，與 `story.content` 同源，供 `FullReadingPage` 讀）：
```yaml
key_reading:
  start_text: "下班時刻，262路公車上有點擠"   # ☞ 起點錨（QA/比對用）
  passage: "下班時刻…我說個話也不行了嗎？"      # snap 到句尾的顯示朗讀段
  extent_chars: 371                            # max 累計字數 = 老師標的範圍長度（不含標點）
  source: docx-extract                         # docx-extract / manual / fallback
  needs_review: false                          # 抽不到/tail case → true
  # CPM 流暢度 benchmark 不寫這裡 → 走既有 reading_benchmark 欄位（我的表現 <190/191~220/>221）
```
- 抽不到（無 reading table / 無 ☞）→ **不寫 passage + 標 `needs_review: true`**，FullReadingPage fallback 唸全文，**絕不 block**。

---

## 2. QA：SPEC → coding TDD → vision EDD（三層，缺一不可）

對齊 `docs/qa/layer-verification-framework.md`。**用能忠實抓到 failure 的最低層驗**，別過度上 e2e。

### 2a. QA SPEC（人寫的驗收契約 = SOT，不可 AI 自產）
BDD Given/When/Then，落在 `backend/specs/` 或 `docs/qa/`：
```
Given 一課教師版 DOCX 有念順順（reading_timer）
When  跑 build-key-reading extract
Then  產出 key_reading，且：
  - start_text 對應 ☞ 手指頭所在段落（人/vision 校過的 golden）
  - passage 不含標點字數 ∈ [extent, extent+40]（snap 容差）
  - passage 結尾 ∈ {。」！？}（不斷句）
  - passage ⊂ story.content（是課文子集，非幻覺）
```
驗收答案接地到**人校過的 golden set**（每課正解起點+範圍），不是抽取器自產自驗。

### 2b. Coding TDD（決定性，先紅後綠，禁 special-case）
真實 case 來自壞過的課。deterministic 斷言：
| 斷言 | 說明 |
|------|------|
| `strip_punct(passage) 長度 ≈ max(累計字數)`（±few） | 老師寫的字數 = ground-truth checksum（G6-L22: 300 vs 301） |
| `passage[-1] in "。」！？"` | 不斷在句中（raw max 常落句中，snap 修掉） |
| `passage in "".join(story.content)` | 是課文子集，非幻覺/竄改 |
| `start_paragraph 是含 drawing 的段落` | ☞ 起點偵測正確 |
| 抽取器 idempotent | 同 DOCX 兩次跑結果一致 |
regression lock：修任何抽取 bug → 先加一條會紅的斷言再修。

### 2c. Vision EDD（機率性，golden set 量命中率，禁 N=1 推全體）
- render DOCX 該頁 PNG → 多模態 Claude 看，比對：☞ 起點位置、累計字數 max、passage 邊界，是否與 coding 抽出一致
- golden set：**5-10 課跨年級/排版**（G4/G5/G6/G8/G9 各抽樣），標正解 → 量命中率
- ⚠️ 比對「真 render vs 真 DOCX」，別拿 source YAML 當 render（見 [[feedback-content-fidelity-compare-real-not-proxy]]）
- 已驗：G6-L22（☞=這下孟嘗君,max301）、G4-L10（☞=下班時刻262路,max307）、**G4-L14 二修確認版（☞=下班時刻262路,max371,抽出377）** vision 命中；G6-L23/24 結構命中
- **Golden-set（132 舊課真跑，2026-07-20）**：extract ok 123/132(93%)、**端到端全乾淨 114/132 ≈ 86%**。tail：6 no ☞/table、9 字數偏離、3 no DOCX。suspected 根因=挑錯 ☞ 起點（DOCX ~25 圖，取第一個 drawing 被裝飾圖騙）→ 修法：累計欄首數字行↔drawing 交叉定位或走 vision。dump `/tmp/key_reading_batch.json`
- **二修確認版**（`private/curriculum-source/2026-07-21-二修確認版/`，G4/G5/G8/G9 共 73 課，65 課有念順順）結構與舊版一致，抽取器適用

---

## 3. QA 前後端 / API / content（層層驗，evidence 不認口頭）

| 層 | 驗什麼 | 怎麼驗（最低忠實層） |
|----|--------|---------------------|
| **content yml** | key_reading 欄位存在且合法（schema）；passage 是課文子集 | content evidence gate（`scripts/content_evidence_gate.py` 式，fail_cells=0） |
| **API** | story-detail 回傳含 `key_reading`；缺時明確 null（非 500） | contract test：curl → JSON schema 斷言 |
| **backend/元件** | 有 key_reading → FullReadingPage 唸 **passage**（非全文）；無 → fallback 全文；**不動 stepId 佈線** | 前端 unit / render-smoke（餵有/無 key_reading 兩 story） |
| **前端 nav** | 念順順課顯示「重點朗讀」「朗」（= 改造後的 full-reading step）；逐段不在 nav | `stepConfig.test.ts`（reading_timer→full-reading resolve）+ /qa 真瀏覽器 |
| **作業提交** | 完成重點朗讀 → `steps_completed` 記 `full-reading` → assignment gate 認得 → 可提交 | e2e assignment 模式跑一次（不可只信 nav 顯示對） |
| **e2e（最後）** | 學生從真入口進重點朗讀 → 讀 passage → CPM 計分 | gstack /qa 學生一鍵登入走完；⛔ 導覽入口看得到才算 pass |

**完成定義**：真 user（學生小明一鍵登入）從 StepperNav 點「重點朗讀」→ 看到的是**指定段落**（非全文）→ 朗讀 → 得 CPM 分。curl 200 / 截圖對 mockup / 測試綠都是 proxy，不是完成。

---

## 反模式（不要做）
- ❌ 用整篇 story.content 當朗讀段（那是全文朗讀，已隱藏）
- ❌ 拿 max 累計字數 當 CPM 計分門檻（它是顯示範圍長度；CPM 走 reading_benchmark）
- ❌ raw max 直接切（會斷在句中）→ 一定 snap 句尾
- ❌ hardcode 300-350 範圍（G6-L23 是 387）→ 用真 max
- ❌ N=1 一課對就宣稱 132 課都行 → 跑 golden set 量命中率
- ❌ 抽不到就硬塞/幻覺 → 標 needs_review + fallback 全文，誠實不 block
- ❌ 只讀 code / curl 200 就說 QA 過 → 真瀏覽器走學生入口才算

## 現況（2026-07-20）
- Phase 0 已上：**改造既有 `full-reading` step 成「重點朗讀」「朗」**（不新增 step）+ 隱藏逐段(tutor) + `reading_timer→full-reading`。目前仍唸全文（內容來源未改）。
  - ⚠️ **為何不新增 step**：code review 抓到——FullReadingPage 把 stepId 寫死 `'full-reading'`（含完成/進度/作業 gate 佈線），新增 key-reading step 複用它會讓完成記錯 step → 作業永遠無法提交（靜默無 error）。**保留 full-reading id = 沿用現成佈線 = 零 bug**。
- Phase 1（本 skill）：extract 演算法驗證完（G6-L22/G4-L10 vision + G6-L23/24 結構）；待做：整合進 `build_lesson_schema.py` + 跑 golden set + 寫 `key_reading` 進 content + **FullReadingPage 有 key_reading 就唸 passage、無則 fallback 全文**（改內容來源，不動 stepId 佈線）
- 關聯：`docs/reading-key-passage-TODO.md`、`docs/reading-pronunciation-tolerance.md`（口音通融）、`docs/PRD.md` §重點朗讀
