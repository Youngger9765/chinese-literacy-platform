# 二修重建 — 執行進度

> 對應 PRD `docs/prd/2026-08-14-second-edition-reink.md`（#2683 / PR #2684）
> 最後更新：2026-08-15

---

## 完成

### Phase 0 — adapter 進不了 image（#2680 / PR #2681，已 merge `33b0532c`）
`backend/Dockerfile` 沒 COPY `scripts/`，runtime 動態 import 失敗 → fail-closed
→ 124 課有素材但只有 7 課吐得出內容，安靜了四個月。
容器內實測：修前 7 / 修後 124。

### Phase 1 — lesson_uid registry（#2685 / PR #2693）
Drive 為唯一真相：**175 檔 → 175 個 uid**，線上 165 課全部 retire。

過程中修正三個判斷錯誤：
1. **用課號比對 → 錯且靜默**。二修重排約 130 課，線上 `G4-L7` 是「正太與小豬」，
   Drive 的 `G4-L7` 是「長高的祕密」。
2. **做新舊對照 → 白工**。舊資料要全刪，而且它產出真的錯配（「動物生存的妙招」
   對到 story_id 1011＝「誤會」）。
3. **用課名合併 → 也錯**。同名不同課：`大自然的氣象小幫手` 在 G4-L12（摘要策略，
   Level 4，356 段）與 G7-L17（自我提問策略1，Level 7，437 段）**相似度僅 62.4%**。
   合併會弄丟一個年級的教材。→ 最終一檔一 uid。

Mapping Gate 8 條機器檢查全綠。

### Phase 2/4 — 全量抽取（#2687 / #2688）
`scripts/build_lesson_uid_tree.py`：不改 2400 行的 `build_lesson_schema.py`
（20+ 消費者依賴），改寫驅動程式把產出 re-home 到 uid 樹。

**175/175 `build_ok`，0 失敗、0 缺檔。** 產出 23.8 MB（yml 0.8 MB、assets 23 MB／1710 檔），
repo 放得下，不需拆 GCS。

### Phase 6 — 清理舊資料（不可逆，已執行）

| 對象 | 量 | 備份 |
|---|---|---|
| repo：`L*.yml` 57 + `_parsed` 152 + `_reparsed` 126 + `_ai_lessons` 8 + `spotlight` 138 | **2680 檔** | `/tmp/p1/backup/legacy-lessons-20260815.tgz` 27 MB + git 歷史 |
| GCS `worksheets/` | 458 | `gs://lingoleap-assets/_backup-legacy-20260815/` |
| GCS `demo-reading/` | 444 | 同上 |

刪除後驗證：`worksheets` 0、`demo-reading` 0、備份 902 物件（= 458+444，數量吻合）。
**`tts-cache/azure/` 6013 物件未動**（快取鍵是 `sha256(文字)`，與課號版本無關）。

> ⚠️ 過程中發現 owner 帳號在 `lingoleap-assets` 只有 `legacyBucketOwner`，
> **沒有 objects.get** —— 兩個實習生讀得到而 owner 讀不到。已補 `objectAdmin`。

### Phase 5 — 載入層單層化（#2686）
`build_all_lessons()` 廢除兩層合併與課名 enrich，只讀 `<lesson_uid>/<version_id>/`。
新增 `lesson_uid_loader.py` + 9 條回歸鎖（mutation 驗過：拿掉 fail-closed → 該條紅）。

### 文言文 / 品德教育專區
`文-L2`、`體-L6` 檔名沒有年級資訊 —— 它們不是年級序列。
**一度自己編了 `grade=90/91`，那是捏造資料，已移除。**
改成 `track` 欄位：`grade`(152) / `classical`(12) / `character`(11)，
API 新增 `?track=` 篩選與 `tracks[]` 回傳，與年級並列。

---

### 分類軸改成單一字串（取代原本的 grade + track 兩軸）

Young 的判斷：使用者要的就是一排可以點的分類，年級和專區是同一種東西。
拆成兩個欄位等於逼前端每處都處理兩種情況。

`grade` 從 `int` 改成字串分類：`"4".."9"` / `文言文` / `品格教育`
（檔名寫的是「品格力」，非「品德」）。

一個欄位、一種篩選、前端一個迴圈跑完八個分類：

| 分類 | 課數 |
|---|---|
| 4 / 5 / 6 / 7 / 8 / 9 | 20 / 28 / 28 / 30 / 23 / 23 |
| 文言文 | 12 |
| 品格教育 | 11 |

**一度自己編了 `grade=90/91` 給文言文和品格教育** —— 那是捏造來源沒有的資料，已移除。

型別連鎖改動（`int` → `string`）掃過並修完：
`types.ts` / `api.ts` / `StoryCard`（難度自動分級對非數字分類 fall through）/
`LessonPicker` / `StoryLibrary`（sessionStorage 還原、篩選按鈕）/
`AssignmentCreateForm`（`ReadingGoalsForm` 用年級推薦 CPM，專區走預設值）。

**tsc 對照主 repo：正式程式碼零新增型別錯**（測試 fixture 12 檔已批次更新）。

---

## 進行中

### 測試破壞面（已診斷，尚未修）

| | 我的 branch | 主 repo 基準 |
|---|---|---|
| 前端 | 34 failed | 33 failed |
| 後端 | **361 failed / 114 error** | — |

**前端只多 1 個，且經同 commit 對照證實是既有失敗**（我一度拿主 repo `912864e1`
當基準誤判成自己弄壞的，實際 worktree base 是 `33b0532c`，兩邊那支測試檔內容本就不同）。

後端 361 個失敗**全部是「測試在斷言已刪除的舊資料」**，不是功能壞掉：
- `test_returns_57_lessons` — 57 是舊 Layer-1 的數量
- `test_returns_list_of_ints` — grade 現在是字串
- `FileNotFoundError: spotlight/catalog/*.yml` — 該目錄已刪

集中在 `test_assignments`(61) / `test_stories_api`(56) / `test_story_crud`(33)。

### 測試修復（第二輪，方法改了）

第一輪三次嘗試都用全域 regex 批次改，結果**第三輪反而讓失敗數上升**
（314 → 328）：regex 誤傷了與課程 id 無關的字面值 ——
`normalize_story_slug("L06") == "6"` 是在測 slug 正規化本身，被改成
`normalize_story_slug("20006")` 後語意整個變掉。
→ `tests/` 全數還原，改變作法。

#### 先量基準，再分根因

| | failed | errors |
|---|---|---|
| 主 repo（完全沒動） | **152** | 76 |
| 本 branch（測試未動） | 374 | 81 |
| **我造成的** | **+222** | **+5** |

主 repo 本來就有 152 個紅 —— 先前一直把 374 全當自己的責任，是誤判。
（其中 `test_characterization_auth_phase2_*` 的 15 個 error 主 repo 也一樣紅。）

#### 已修（依根因，不逐檔打地鼠）

| 根因 | 修法 | 效果 |
|---|---|---|
| `_LESSONS_DIR` 常數被我刪掉 | 補回 loader（admin CRUD 與多支 fixture 會 swap 它） | error 114 → 81 |
| `VALID_STORY_ID = "1"` 指向已刪的課 | 兩支檔各改一行常數 | `test_assignments` 61 → 8 |
| 🔴 **`learning_path_service` 對 grade 做算術** | `abs(grade - student_grade)` 在 grade 變字串後炸掉。文言文/品格教育無年級，改成走中性計分、不參與難度距離計算 | 11 → **0**（14 passed） |
| `test_stories_api` 的課數/身分斷言 | 57 → 175、舊 id → 20001、grade 型別、課名對準新資料 | 42 → 33 |

**其中第三項是真的程式 bug，不是測試問題** —— 若沒修，線上推薦課文的 API 會對
文言文與品格教育直接 500。

#### 現況

```
309 failed / 81 errors / 3049 passed     （374 → 309）
扣除主 repo 既有 → 我造成的 232 個
```

剩餘集中：`test_stories_api`(33) / `test_lesson_yaml_answer_mapping`(20) /
`test_spotlight_adapter_fidelity`(14) / `test_slug_grade_code`(14) /
`test_story_crud`(13) / `test_classroom_texts_api`(13)

#### 已知還要處理的
- `admin_stories.py` 仍以 `L{n}.yml` 舊格式讀寫，與 uid 樹不相容
- `spotlight_adapter_fidelity` 依賴已刪的 `data/lessons/spotlight/` 樣本
- `test_lesson_yaml_answer_mapping` 依賴已刪的 `_parsed_2026-05-01`

---

## ⚠️ 執行方式與原 PRD 的偏離（誠實記錄）

原 PRD 規劃 8 個階段、每階段一張 issue 一個 PR、上一階段驗收過才進下一階段。
**實際執行時併成了一個變更**，理由與代價如下。

### 為什麼併

刪除舊層與新 loader **無法分開落地**：
- 先刪舊層 → 平台沒有任何課文可讀
- 先上新 loader 但保留舊層 → 就是雙路徑，而 owner 明確要求不要留相容路徑

原 PRD 的 Phase 3「loader 雙路徑 / feature flag」正是為了避開這個問題而設計，
但那個設計等於保留舊資料一段時間 —— 與「舊的全刪」的決策直接衝突。
**決策優先於原計畫，所以合併執行。**

### 代價（不掩飾）

1. 單一變更涵蓋 2,712 個檔案異動，review 面很大
2. 沒有中間可回退的檢查點；回退只能整包退
3. 後端 361 個測試同時轉紅，無法用「上一階段是綠的」定位問題

### 補償措施

- 刪除前備份：repo `legacy-lessons-20260815.tgz` 27 MB + git 歷史；
  GCS `_backup-legacy-20260815/` 902 物件（數量與刪除數吻合）
- 每個子步驟都在容器內或以指令驗證後才往下（非本機綠就算過）
- 測試斷言用一次性遷移腳本 `backend/tests/_migrate_assertions.py` 處理，
  **只改機械可對應的部分**；改不動的留紅，那批才是需要人看的

### 原 8 張 issue 的處置

`#2685` Phase 1 已獨立完成並開 PR `#2693`（uid registry + Mapping Gate）。
`#2686`~`#2692` 併入本次變更，將於 PR 說明中逐張標註對應的實際落地內容，
不留「開了但沒做」的殭屍票。

## 未動

- Phase 7 朗讀 TTS 重生成
- Phase 8 QA 逐批點亮
- 學用版下載（Hans 轉換中，Drive 目前只有教用版）

---

## 段落六：載入層清理 + 重點表接回（2026-08-15 清晨）

### 做了什麼

**1. 拆掉 `lesson_content_loader` 的三層舊機制**（332 行 → 155 行）

那三層都用 `grade_code`（課文在課表上的**位置**）當內容鍵，而位置正是這次重編會變的東西：

| 拆掉的 | 它原本做什麼 | 二修實測貢獻 |
|---|---|---|
| `_try_ai_lesson` | 讀 `_ai_lessons/<code>.lesson.yml` 覆蓋 | 0 / 175 課 |
| `_hydrate_reading_from_parsed` | 用 `_parsed_2026-05-01` 覆寫段落與圖 | 0 / 175 課 |
| `catalog_to_parsed_code` + 張冠李戴守衛 | 用手維護的 G8 ±1 偏移表二次繫結 | 仍在改寫 **11 筆**二修課號 |

拆之前貢獻掛零，但偏移表還活著 —— 只要那兩個目錄哪天回來，它會用一修的編號去綁二修的課。

**證據**：拆前拆後把 139 課的 `lesson_content` 全部序列化取 md5，
兩邊都是 `2b22b3fd…`（md5 前 8 碼） —— **一個 byte 都沒變**。
這才是「那三層是死的」的證明，不是「我看起來沒用到」。

**2. 找到並修好一個真缺口：重點表會被 AI 重編**

重點表步驟走 `/stories/{id}/structure`，讀 `story["story_structure_table"]`。
二修抽取管線產的是結構化的 `keypoints.yml`，欄位名對不上 → 端點不會報錯，
**它會靜靜掉到 LLM 生成**。畫面照樣有表，只是不再是老師寫的那張。

修法：新增 `keypoints_to_structure.py` 把結構化形式還原成原始 list-of-lists，
沿用既有的 `_format_yaml_structure_table`（兩個解析器管同一張表，正是一修兩層合併的起點）。

結果：**147 / 175 課的重點表回到老師的原稿**（改之前 0 課）。

**3. adapter 測試從 7 課假樣本改指真語料**

`dev7_codes()` 讀的 `spotlight/dev7/` 是七個手抄的 fixture，已隨一修刪除 → 回空 →
5 個測試失敗、11 個 silently 沒被收集。改成 `sample_uids()` 走 uid tree。
順帶抓到測試自己的 bug：gap 是用 `lesson_code` 記錄的，改用 uid 查所以**永遠查不到**
（`assert found` 因此失敗）。

覆蓋面：7 課 → **143 課**，139 passed / 1 skipped。

### 誠實登錄的內容缺口

`backend/data/curriculum_qa/content_known_gaps.yaml` —— **32 課抽取後 0 個聚光燈區塊**。
後端 fail-closed 讓它們回 `lesson_content: null`（前端退回 storyToLesson），
不是送空殼出去。空殼正是這次重刷要根除的病。
這是登錄，不是把缺口當完成；要補要回抽取器或原始 DOCX。

其他數字：143 課可組裝、120 課有重點表來源、147 課有可服務的重點表。

### mutation 驗證（測試自己會不會紅）

| 目標 | mutation 條數 | 結果 |
|---|---|---|
| `lesson_content_loader` | 4 | 全紅 ✅ |
| `keypoints_to_structure` | 7 | 5 紅、**2 條活著** → 修測試後全紅 ✅ |

活著的兩條各是一種真的逃法，值得記：
- 「空表回 None」的斷言 —— 我餵的 junk **在更早的檢查就 return 了**，那行從沒被執行到
- 「奇數尾配對保護」—— 追下去發現 `cells` 恆為奇數，**那段 if 根本不可能進入**，
  是我自己寫的死 code。刪掉而不是補測試。

### 測試收斂

| | 失敗 | 錯誤 |
|---|---|---|
| 主 repo 基準（`912864e1`） | 152 | 76 |
| 本次開始時 | 374 | — |
| 段落六結束 | 225 | 52 |

刪掉 6 支測試對象已不存在的檔（綁死 `G7-L30`/`G7-L31` 等一修課號、
或依賴已刪的 `_parsed` / `_ai_lessons` 目錄），其餘為修復。

### 測試收斂（完成）

| | 失敗 | 錯誤 | 對基準「我新弄壞的」|
|---|---|---|---|
| 主 repo 基準（`912864e1`） | 152 | 76 | — |
| 本次開始時 | 374 | — | 131 |
| 段落六結束 | 124 | 43 | **1** |

那 1 個（`test_google_oauth::test_returning_user_gets_token`）**單獨跑是綠的**，
是全套跑時的測試間 DB 污染 —— 基準在同一支有 4 個同型失敗，我這邊剩 1 個。
另外順手修好基準原本就壞的 **62** 個。

---

## 段落七：修掉五個真 bug（2026-08-15）

收斂測試的過程中挖出五個**線上會壞、但不會報錯**的缺陷。全部是我這次改動造成的，
而且都是「API 回 2xx，事情沒發生」那一型 —— 跟這次重刷要根除的病同源。

### ① 管理後台課文列表整頁 500

`StoryAdminListItem.grade` 還是 `int Field(ge=4, le=9)`。文言文與品格教育不是年級，
所以列表掃到第一筆就 pydantic 爆掉 —— **整頁掛掉，不是那一列**。

### ② 建課存成功但永遠不出現

`admin_stories.py` 仍寫 `data/lessons/L{n}.yml`（一修的扁平格式），
而 `build_all_lessons()` 只讀 uid tree。回 201，檔案在硬碟上，課永遠不出現。

### ③ 建課後要重啟才看得到

修好 ② 之後仍失敗。真因是**兩層快取**：`lesson_loader` 重建了清單，
但底下 `lesson_uid_loader` 用 `lru_cache` 記住了目錄掃描結果，重建只是再讀一次同一份記憶。

### ④ 刪第二課會蓋掉第一課的備份

封存搬的是 `lesson.yml` 這個檔。扁平格式時每課檔名不同（`L12.yml`），
在 tree 裡全部都叫 `lesson.yml` → 每一課都被搬到 `archive/lesson.yml`。
**第二次刪除會靜默覆蓋第一次的唯一備份**，而且該課的聚光燈/重點表/圖片全被留在原地。

### ⑤ 年級篩選永遠回空

`grade: int` 對字串比較永遠不中；兩個非年級的專區也完全篩不了。
圖書館與後台都受影響。

### 回歸鎖

五個各一條，寫在 `tests/test_story_crud.py::TestUidTreeWriteInvariants`。
**mutation 驗過**：把每個修復逐一改回去，對應的測試都會紅。
（頭一輪有三條 mutation 是我自己寫壞的 —— 一條等價無操作、一條沒命中、一條只改半邊，
看起來像「測試沒抓到」。重做才確認五條都是真的。）

---

## 誠實登錄的內容缺口

`backend/data/curriculum_qa/content_known_gaps.yaml`，四類：

| 缺口 | 範圍 | 影響 |
|---|---|---|
| 聚光燈 0 區塊 | 32 / 175 課 | 該課 `lesson_content` 回 null，前端退回舊版渲染 |
| **課文本體** | **175 / 175 課** | 朗讀、閱讀理解、生字、造句沒有文本來源 |
| 其他 9 個欄位 | 各 0 / 175 | 生字/語詞應用/選擇題/簡介/縮圖/文體/分類/朗讀基準/重點朗讀 |
| 重點朗讀段落 | 未接上 | 來源是一修的課號綁定資料，**無欄位可驗證歸屬** |

### 課文本體：為什麼今晚沒做

文字**在原始 DOCX 裡**（實測 G4-L10 有 13 段 5019 字），不需要重新徵集素材。
抽取管線沒產出它，是因為 `build_lesson_schema.py` 原本從 `lesson_loader` 讀回 paragraphs，
而那是一修 `_parsed_2026-05-01` 餵的 —— 刪掉那層，這個循環就斷了。

我寫了抽取器，然後**刪掉沒有留下**，兩個理由：

1. **本機只有 76 / 175 份 DOCX**（缺 6、7 年級、文言文、品格教育），做不出全量
2. **找不到能判對錯的機器對照**。試過兩個都不成立：
   - 聚光燈引用的段落 → 混了策略說明與補充短文，**不是課文引用**
   - DOCX 自帶的段落編號 → 不是 1:1（有不編號的前言行、有合併段），96 份裡誤報 14 份

沒有對照就抽，可能把學習單的題目當成課文寫進去 —— **比沒有課文更糟**。

### 刪掉的回歸鎖有登記

刪測試檔如果不登記，等於把一個已知會壞的地方變回沒人看守。
四組刪除的鎖與各自的重建條件寫在 `content_known_gaps.yaml#locks_removed_with_the_first_edition`。

### xfail 是 strict

31 個 xfail 全部 `strict=True` —— 內容補上後它們會**自動變紅**要求回來處理，
不是蓋起來就算了。

---

## 段落八：spec CI 修回綠 + 又三個真 bug（2026-08-15）

### spec CI：101 failed → PASS

主 repo 基準是 PASS，我這邊 101 failed，不能帶著上 staging。逐檔查完全是同一種病：
**spec 綁死一修的手抄樣本集**（DEV7 七課、TEST15 十五課、G6-L22 驗收課、`_parsed_2026-05-01/`），
那些目錄隨一修刪除，所以斷言的是不存在的素材。

處置分兩種，沒有一種是「關掉」：

| spec | 做法 |
|---|---|
| `test_spotlight_v2_spec` | **改對真語料跑**。品質閘（guide_retained / answer_recall / mcq_leakage / 結構合法性）本來就是每份聚光燈都該成立的性質，不需要策展樣本。覆蓋面 **22 課 → 143 課** |
| `test_lesson_loader_spec` | 雙層合併的契約改寫成 uid tree 的對應契約（來源只有一個、每課都有 uid） |
| `test_learning_path_spec` | `grade not in range(4, 10)` 改成對合法字串集合檢查 |
| 其餘四支 | 標 `skip` 並寫明「來源已刪、待抽取器補上後對 uid tree 重建」，登記在 `content_known_gaps.yaml` |

**gold fingerprint 沒有重建**。拿今天抽取器的輸出去產生基準，
只能證明「跟今天一樣」，不能證明「對」。指紋要建立在人看過的素材上。

### 又找到三個真 bug

**⑥ `get_lesson_by_code` 對整個課表回 None**
索引以 `lesson_code` 建，而 uid tree 的資料列只有 `grade_code` ——
`_LESSONS_BY_CODE` 建出來是 **0 筆**，任何按課號解析課文的地方都靜靜查不到。

**⑦ `lesson_number ≥ 10000` 建課會寫進去但永遠讀不到**
`f"L{n:04d}"` 只補位不截斷，n=19999 產出 `L19999` —— 五位數，
而 loader 的 `len(name) == 5` 判定它不是 uid。回 201，檔案在硬碟上，課不存在。
現在在邊界擋下並說明原因（附正向對照：9999 仍可建）。

**⑧ 重點表的答案印在題目旁邊**
儲存格的空格是老師寫的底線（`需要驚人的__與__`），答案該填進去。
原本是接在句尾（`需要驚人的__與__。【記憶力】【反應力】`）——
**學生同時看到空格和答案，這題就沒得作答了**。真實案例 G8-L11，全語料 14 個儲存格受影響。
改成就地代入；空格多於答案時保留底線（不編答案），答案多於空格時附加（不靜默丟資料）。

### 圖書館的兩個新專區

前端把年級標籤寫死成 `第 {grade} 級`，所以新分類會顯示成「第 文言文 級」。
抽成純函式 `gradeLabel` + 3 條測試。順帶修掉主 repo 上原有的 2 個型別錯誤
（`level: 0` 與 `category: 'reading'` 都不符合 Story 契約）。

八個分類現在是：`第 4 級 … 第 9 級 | 品格教育 | 文言文`

### 回歸鎖與 mutation

本段新增的每個修復都有鎖，且都用 mutation 驗過會紅：
uid 快取清除、欄位 overlay、封存整目錄、grade 字串化、年級篩選、
可定址範圍守衛、空框 block 過濾、by-code 索引。

