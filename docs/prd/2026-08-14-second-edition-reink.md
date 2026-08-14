# PRD — 教材重建與課文身份架構重整

> 2026-08-14 ｜ 決策人：Young ｜ 來源：8/14 會議逐字稿 + 當日實測
> 取代目標：一次解決「每次改版都會亂」的結構問題，不只是這次的二修

---

## 一、WHY

### 1. 二修改了 7~8 成，增量修不划算

啟翔實測回報。Young：「我根本不知道二修跟一修的差別，不如重刷。」

### 2. 舊資料沒有保留價值

平台**尚未進真實現場**，無學生紀錄、無已發紙本、無對外承諾綁課。

### 3. 🔴 真正的病根：現在沒有任何可靠的「這是哪一課」的鍵

載入層是**兩層合併**，而且是歷史意外不是設計：

```
2026-02-26  Layer-1  backend/data/lessons/L*.yml            57 課，手工建
2026-05-01  Layer-2  backend/data/lessons/_parsed_2026-05-01/  152 檔，DOCX 批次 parse
```

5/1 批次 parse 了 158 課，**沒有把舊的 57 課退役**，改寫一段「用課名去重 + enrich」
把兩層黏起來（`lesson_indexes.py: build_all_lessons()`）。

**實測後果**：

| 用什麼當鍵 | 撞鍵組數 | 涉及課數 |
|---|---|---|
| 課名（正規化後） | 10 組 | 20 課 |
| 正規化課號 | **13 組** | **26 課** |

```
G4-L1   → ids=[1, 1001]      贏得喝采的輸家
G5-L11  → ids=[11, 1038]     「拳」力出擊 vs 拳力出擊     ← 引號差異
G6-L1   → ids=[14, 1055]     運動傷害，怎麼辦？ vs 怎麼辦  ← 問號差異
文-L1   → ids=[44, 1149]
```

每一組都是「Layer-1 低 id」對上「Layer-2 的 1000+ id」。
課名差一個標點 → enrich 失敗 → **Layer-1 那筆變空殼**。
這就是 165 課裡有 20 課沒有聚光燈素材的真因（不是內容缺，是對應斷）。

**課名會變、課號會變，兩個都不能當身份。** 不解掉這件事，三修四修還會再亂一次。

### 4. adapter 進不了 image 的 bug 剛修好，是重建的前提

`backend/Dockerfile` 只 COPY `app/ data/ alembic/`，沒 COPY `scripts/`（也複製不到，
build context 是 `./backend`）→ runtime import 失敗 → fail-closed → **124 課有素材只有 7 課吐得出內容**。
已 merged `33b0532c`；容器內實測：修前 7、修後 124。

---

## 二、現況（2026-08-14 實測，非文件推論）

| 項目 | 數字 | 取得方式 |
|---|---|---|
| Drive 新教材（SOT） | **175 課** | `rclone lsf`，扣 1 個 `~$` 暫存檔 |
| 線上 DB | **165**（= L1 57 + L2 108） | `/api/stories?page_size=300` |
| 其中重複空殼 | **20~26 課** | 課名/課號撞鍵實測 |
| 聚光燈 catalog | 113 檔（manifest 列 108） | `ls` + manifest |
| 有 `spotlight_v2` 素材 | 124 | 容器內跑 loader |
| `assets/worksheets/` | 458 檔，最後更新 **6/16** | `gcloud storage ls -l` |
| `tts-cache` | **1523 MB** | `gcloud storage du` |

Drive 分佈：G4=20 / G5=28 / G6=29 / G7=30 / G8=23 / G9=23 / 文言文=12 / 體育生品格=11
→ 解掉會議上「159 還是 180」的爭議：**是 175**。

---

## 三、WHAT — 新的身份架構

### 核心原則：身份跟編號、名稱、內容全部脫鉤

| 候選鍵 | 課號重排 | 課名改標點 | 新增課文 | 同課出新版 |
|---|---|---|---|---|
| 課名 | ✅ | 🔴 | ✅ | 🔴 |
| 課號 `G4-L1` | 🔴 | ✅ | ✅ | ✅ |
| 年級+課次複合鍵 | 🔴 | ✅ | ✅ | ✅ |
| 內容雜湊 | ✅ | ✅ | ✅ | 🔴 |
| **不可變流水號** | ✅ | ✅ | ✅ | ✅ |

**只有「發一次就不再改的號碼」四種情況全過。**

### 四個要分開的概念（codex 審查後修正）

第一版只有 `lesson_uid` 一層，**分不出一修/二修** —— `<uid>/spotlight.yml`
沒有版本資訊。四個概念必須分開：

| 概念 | 是什麼 | 會不會變 |
|---|---|---|
| `lesson_uid` | 這是哪一篇課文 | **永不變** |
| `version_id` | 教材版本（一修/二修/三修） | 每次改版新增 |
| `catalog_slot` | 當期排在哪（`G4-L10`） | 每次重排都變 |
| `published_version` | 目前預設出哪一版 | 可切換、可回退 |

**`catalog_slot` 不是身份** —— 它住在 manifest 裡，指向 `uid + version`，
不可以變成資料夾名。

### 資料形狀

```
backend/data/lessons/<lesson_uid>/<version_id>/
  ├── lesson.yml        # 屬性
  ├── passage.yml       # 課文
  ├── spotlight.yml     # 閱讀聚光燈
  ├── keypoints.yml     # 文章重點表
  ├── key_reading.yml   # 重點朗讀
  └── assets/

backend/data/catalog_manifest.yml     # catalog_slot → uid + version + 各模組狀態
```

`catalog_manifest.yml` 同時承擔 **partial publish** —— 一課可能課文已上、
聚光燈未過 QA、講義待補，要能逐模組標狀態，不是整課全開或全關。

**schema contract（fail-closed）**：合法狀態只有 `on` / `qa_pending` / `missing` / `off`。
**只有 `on` 會被 loader 供應**；`qa_pending` 與 `missing` 一律當關閉，
未知值也當關閉。⛔ 不可把 `qa_pending` 當 `on` 處理。

`lesson.yml`：

```yaml
lesson_uid: L0042          # 🔴 registry 分配，永不改、永不重用。QR 綁這個
version_id: v2             # 這個資料夾是哪一版
title: 救援大隊的好幫手      # 屬性，可變
grade: 5                   # 屬性，可變
```

`catalog_manifest.yml`：

```yaml
lessons:
  L0042:
    published_version: v2  # 🔴 目前預設出哪版，切換與回退改這裡
    versions: [v1, v2]

published:
  G5-L11:                  # catalog_slot（每次重排都變）
    lesson_uid: L0042
    version_id: v2         # 通常 == published_version，可刻意釘舊版
    modules:               # partial publish — 逐模組狀態
      passage:    on
      spotlight:  qa_pending
      keypoints:  on
      worksheet:  missing
```

**課號、課名、年級、策略標籤 → 全部降級成屬性。**

### 三個直接後果

1. **課號重排 = 改屬性** —— 不搬檔、不改 folder、不動 QR
2. **新增課文 = 發一個新 uid** —— 不影響任何既有課
3. **同課出新版 = 同一個 uid 換 edition** —— 學習紀錄與 QR 都不斷

### 為什麼 folder 用 uid 而不是課號

現在聚光燈是 `catalog/G4-L11.spotlight.yml` —— 課號一改，113 個檔全部對不到。
改用 uid 之後，**任何改版都不需要動檔名**。

### 順帶解掉啟翔的痛點

他的原話：「全部都在同一份 YAML 裡面……我請他做某件事，他會一直去抓其他的，
太多東西混在一起了。」

模組各自一檔 + 按需載入 → 做聚光燈時只看得到 `spotlight.yml`。

---

## 三之二、清理清單（全部實測盤過，逐項標明刪或留）

> 原則：**舊資料不要了 → 該刪就刪，不留半條相容路徑。**
> 唯一例外是與課文版本無關的快取。

### repo 內

| 對象 | 量 | 動作 | 理由 |
|---|---|---|---|
| `backend/data/lessons/L*.yml`（Layer-1） | 57 檔 | 🔴 **刪** | 2026-02 手工建，5/1 就該退役 |
| `backend/data/lessons/_parsed_2026-05-01/`（Layer-2） | 152 檔 | 🔴 **刪** | 一修 parse 產物 |
| `backend/data/lessons/_reparsed_2026-05-02/` | 3 檔 | 🔴 **刪** | 同上（被 4 處引用，要一起清） |
| `backend/data/lessons/_ai_lessons/` | 8 檔 | 🔴 **刪** | 早期 AI 產物（被 2 處引用，要一起清） |
| `backend/data/lessons/spotlight/catalog/` | 113 檔 | 🔴 **刪** | 檔名綁舊課號，重抽 |
| `backend/data/lessons/spotlight/dev7/` | 8 檔 | 🔴 **刪** | 早期手工策展 7 課，二修後無意義 |
| `backend/data/lessons/spotlight/test15/` | 15 檔 | 🔴 **刪** | 同上 |
| `backend/data/curriculum/manifest.yml` | 158 筆 | 🔴 **重建** | 改成 `catalog_manifest.yml`（slot → uid+version） |
| `backend/data/key_reading_passages.yml` | 134 條 | 🔴 **重建** | by 舊課號，且 32 條已是孤兒 |
| `docs/lesson-schema-registry.yaml` | — | 🔴 **重建** | 由新 pipeline 產 |

⚠️ `_ai_lessons` 與 `_reparsed_2026-05-02` 各有引用點（2 處 / 4 處），
**刪之前要先跑反向依賴掃描**，不能直接 `rm -rf`。

### GCS

| 對象 | 量 | 動作 | 理由 |
|---|---|---|---|
| `gs://lingoleap-assets/worksheets/` | **458 物件** | 🔴 **清空重上** | 全一修，最後更新 6/16，檔名綁舊課號 |
| `gs://lingoleap-assets/demo-reading/` | **444 物件** | 🔴 **清空重產** | 綁舊 story_id 的音檔 + QR |
| `gs://lingoleap-assets/lessons-images/` | — | 🟡 **盤點後再定** | 圖片可能與課文版本無關，先查引用 |
| `gs://lingoleap-assets/stories/` | — | 🟡 **盤點後再定** | 同上 |
| `gs://lingoleap-assets/qa/`、`pr-screenshots/` | — | ⚪ **不動** | 與教材無關 |
| **`gs://lingoleap-tts-cache/azure/`** | — | ✅ **保留** | 快取鍵是 `sha256(文字)`，與課號版本無關；刪＝重燒錢 |
| `gs://lingoleap-tts-cache/gemini31-prompt-only-v2/` | — | 🟡 **可刪** | 已切 Azure，非現行 provider |
| `gs://lingoleap-tts-cache/tts-cache/` | — | 🔴 **刪** | 中國腔 fallback 的來源，留著會被回讀汙染 |
| `gs://lingoleap-tts-cache/_backup-*` ×3 | 22 / 340 / 235 物件 | 🟡 **可刪** | 8/10 修音時的備份，已無用 |

### DB

| 對象 | 動作 |
|---|---|
| 課文相關資料表（stories / lesson content） | 🔴 **清空重建** |
| 學習紀錄（learning session / reading history） | 🔴 **清空** —— 都是內部測試資料，且舊紀錄綁舊 `lesson_id`，留著只會污染新版統計 |
| 使用者 / 班級 / 作業 | ⚪ **不動** —— 與教材版本無關 |

### 清理順序（不可顛倒）

```
1. 先掃反向依賴（_ai_lessons / _reparsed / dev7 / test15 的引用點）
2. 先在 staging 清 + 重建 + 驗收
3. 驗收過才動 prod
4. tts-cache/azure/ 全程不碰
```

---

## 四、不做（本次範圍外）

| 不做 | 為什麼 |
|---|---|
| **不刪 `tts-cache/azure/`** | 快取鍵是 `sha256(文字)`，與課號版本無關。刪掉等於重燒一次 TTS 費用（其餘 prefix 見清理清單） |
| **不動 prod** | staging 驗完才複製 |
| **不上學生版下載** | Hans 轉換中，本次只上教師版抽出的平台內容 |
| **不點亮未檢核的聚光燈** | 機制修好 ≠ 內容驗過，用 manifest 逐批開 |
| **不追教授正式審稿** | 會議定調：雙方無合約義務，改「模組完成即上線、未完成先隱藏」 |

---

## 五、HOW — 手順

> 每階段一張 issue、一個 PR。**上一階段驗收過才進下一階段。**
> 驗收一律以**容器內**行為為準 —— adapter 那個 bug 就是本機綠、線上壞。

### Phase 0 — 前置（已完成）
- [x] adapter 修復 merged（`33b0532c`）
- [x] Drive SOT 就位，175 課
- [x] 實習生 GCS 讀取權限開通

### Phase 1 — 發 uid + 建對照表 + **Mapping Gate**

產出 `docs/curriculum/lesson-uid-registry.yml`。

#### 🔴 Mapping Gate（可機器驗，CI 擋）

「逐筆人工確認」**不是 gate** —— 175 課做不完，而且無法驗證有沒有真的看過。
改成下列機器檢查，任一不過就 fail：

| # | 檢查 | 為什麼 |
|---|---|---|
| 1 | `lesson_uid` 全域唯一、格式固定、**永不重用**（比對歷史 registry） | 重用＝把兩課混成一課 |
| 2 | 175 個 Drive 檔各有且僅有一筆 registry | 漏課 / 重複建 |
| 3 | registry 存 **`drive_file_id`**（不是只有路徑） | 路徑會改名，file_id 不會 |
| 4 | 每筆舊 `story_id` **exactly one of** `maps_to` / `retire` / `duplicate_of` | 沒對到或對兩次都會爆 |
| 5 | 同一個 `old_story_id` **不可對多個 uid** | 學生紀錄會分裂 |
| 6 | 同一個 `catalog_slot` **不可對多個 published uid+version** | 同一課號指到兩課 |
| 7 | 課名／課號／normalized title／grade／舊正文 hash／新 DOCX fingerprint **任一不一致** → 自動進 `ambiguous_report` | 自動抓出需人工看的少數 |
| 8 | 所有 ambiguous row 必須有 `reviewed_by` / `reviewed_at` / `reason` | 人工確認要留痕，CI 檢查 |

**人工只看第 7 條篩出來的少數，不是 175 課全看。**

**驗收**：上表 8 條全綠；撞鍵組數 = 0（現在 13，26 筆重複課須合併成單一 uid）。

### Phase 2 — 抽取 5 課到新結構（先產生結構，還不動 loader）
`run_lesson_pipeline.py` 已實測可吃二修 DOCX（72 課 `build_ok` 72/72），
但 `process_lesson()` **輸出路徑是寫死的扁平結構**（`{lesson_id}.spotlight.yml`）
→ 改成寫進 `<lesson_uid>/<version_id>/`。

⚠️ **順序理由**（codex 審查修正）：原本排「先改 loader 再抽內容」是錯的 ——
抽內容才會產生新結構，先改 loader 等於切到一個不存在的目錄。

**驗收**：5 課的 `<uid>/<version_id>/` 目錄實際產生且結構正確。

### Phase 3 — loader 支援新結構（雙路徑 / feature flag）
loader **同時**讀舊的兩層與新的 `<uid>/<version_id>/`，用 flag 控制哪些課走新路徑。
先只讓 Phase 2 那 5 課走新路。**此時不移除舊路徑。**

**驗收**：容器內那 5 課走新路徑讀得到並吐出 `lesson_content`；其餘 165 課行為不變。

### Phase 4 — 全量抽取 175 課
**驗收**：`build_ok` 175/175；失敗逐課列原因，不隱藏、不 fake pass。

### Phase 5 — 切單層化，移除 Layer-1/Layer-2
- 廢除兩層合併與課名 enrich
- 舊的 57 個 `L*.yml` 退役
- 移除雙路徑，只留新結構

**驗收**：容器內 loader 讀得到；**撞鍵組數 = 0**（現在 13）。

### Phase 6 — 🔴 清理舊資料（不可逆）+ 落地 staging
照「三之二 清理清單」執行：repo 356 檔 + GCS 902 物件 + DB 課文與學習紀錄。

**⛔ 每一個刪除動作執行前必須具備四件，缺一不得執行**：

| | |
|---|---|
| **backup artifact** | 刪除對象的完整備份（GCS 用 `cp` 到 `_backup-<date>/`，repo 靠 git，DB 用 dump） |
| **dry-run manifest** | 先列出「將要刪哪些」的清單檔，人看過才執行 |
| **object count match** | 刪除後的數量 == 預期數量，不符就停 |
| **restore plan** | 寫下「怎麼還原」的確切指令 |

**清理前先跑反向依賴掃描**（`_ai_lessons` 2 處、`_reparsed_2026-05-02` 4 處引用）。

**驗收**：staging 抽 10 課真瀏覽器走完流程、0 console error；
`tts-cache/azure/` 物件數未減少。

### Phase 7 — 朗讀 TTS
**`tts-cache/azure/` 不清**，未改動的句子直接命中。
**驗收**：抽 10 課有音檔且非瀏覽器機器音（回應約 177–197KB）。

### Phase 8 — QA 逐批點亮 → prod
啟翔（聚光燈）、靖杭（重點表/朗讀）。用 manifest 控制，驗過一批開一批。

---

## 六、風險

| 風險 | 處置 |
|---|---|
| 🔴 **舊 `lesson_id` → 新 `uid/version` 的對照回填** | **最危險的一步，不是搬檔案。** 公開 URL、slug normalization、學習紀錄、OMO、TTS 都已把 integer `lesson_id` 當成事實（`lesson_loader.py:97`、`slug.py:73`、`stories.py:436`、`learning_reading_history.py:92`）。mapping 錯一筆，**API 照樣 200**，但學生紀錄、QR、音檔會接到錯課 —— 資料忠實度錯，一般測試抓不到。→ 對照表逐筆人工確認 + 寫回歸鎖 |
| 🔴 **學習紀錄沒有版本欄位** | `learning_reading_history.py:92` 只存 `lesson_id`，查詢也只用 `student_id + lesson_id`（:135）。二修後舊紀錄會被新課文語意覆蓋，成績比較失真。→ 存紀錄時要一併寫入 **`lesson_uid` + `version_id`**（只寫 version_id 無法識別是哪一課） |
| **Phase 2 改載入層是全域影響** | 先在容器內驗，staging 先行，prod 不動 |
| **uid 不可自行推導** | 必須由 registry 分配。若有人從檔名生 uid，就又回到「檔名即身份」的老錯 |
| pipeline 輸出格式要改 code | 已確認 `process_lesson()` 寫死扁平路徑，Phase 3 含這項改動 |
| 二修課名/課號對不到舊課 | Phase 1 的 uid registry 逐筆人工確認，不自動猜 |
| 誤刪 tts-cache | 明列不做；刪除指令先確認 bucket 名 |
| 175 課不是全部 | Hans 向明珠老師確認（會議 action item） |

**回退**：全程只動 staging；一修資料 git 有完整歷史。

---

## 七、驗收條件

1. 175 課在 staging 可見且可完成學習流程
2. 資料結構為 `<lesson_uid>/<version_id>/<模組>.yml`，loader 讀得到
3. **撞鍵組數 = 0**（現在 13）
4. 容器內（非本機）驗證通過
5. 講義下載指向二修版，或**明確關閉**（學生版未就位前不得指向一修）
6. 聚光燈/重點表：過 QA 的已點亮，未過的已隱藏且列冊
7. `tts-cache` 未被清空
8. **學習紀錄寫入時帶 `lesson_uid` + `version_id`**（只帶 version_id 沒意義 —— 每課都叫 `v2`）

---

## 八、分工

| Phase | 主責 |
|---|---|
| 1–6 | Young（先自己跑一版，卡住再交接） |
| 7 | 啟翔（聚光燈）、靖杭（重點表/朗讀） |
| 學生版 + 解答版 docx | Hans，8/31 前 |
| 確認 175 是否為全部 | Hans |

---

## 附錄：本文所有數字的取得方式

- Drive — `rclone lsf --drive-root-folder-id <id> gdrive: -R --files-only --include "*.docx"`
- 線上課數 — `curl /api/stories?page_size=300` 讀 `total`（參數是 `page_size` 不是 `limit`）
- 撞鍵統計 — 載入 `_ALL_LESSONS` 後用課名正規化 / `normalize_manifest_code` 分別分組
- 容器內行為 — `docker run --rm -i --entrypoint python <image digest> - < probe.py`
- GCS — `gcloud storage du -s gs://<bucket>`
- 兩層何時生的 — `git log --reverse -- backend/data/lessons/L01.yml` 與 `_parsed_2026-05-01/`

⛔ 不採用狀態檔、舊議程或記憶作為事實來源。
