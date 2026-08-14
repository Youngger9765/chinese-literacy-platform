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

### 資料形狀

```
backend/data/lessons/<lesson_uid>/
  ├── lesson.yml        # 身份 + 屬性（見下）
  ├── passage.yml       # 課文
  ├── spotlight.yml     # 閱讀聚光燈
  ├── keypoints.yml     # 文章重點表
  ├── key_reading.yml   # 重點朗讀
  └── assets/           # 圖片等
```

`lesson.yml`：

```yaml
lesson_uid: L0042          # 🔴 發一次，永不改、永不重用。QR 綁這個
title: 救援大隊的好幫手      # 屬性，可變
codes:                     # 歷次課號，保留歷史
  - {code: G4-L19, edition: 1}
  - {code: G5-L11, edition: 2}   # 二修搬到五年級
grade: 5                   # 屬性，可變
edition: 2                 # 目前版本
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

## 四、不做（本次範圍外）

| 不做 | 為什麼 |
|---|---|
| **不刪 `tts-cache`** | 快取鍵是 `sha256(文字)`，與課號版本無關。刪掉等於重燒一次 TTS 費用 |
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

### Phase 1 — 發 uid + 建對照表
產出 `docs/curriculum/lesson-uid-registry.yml`：
每課一個 `lesson_uid`，記錄 `舊 story_id / 舊課號 / 二修課號 / 課名 / Drive 路徑`。

**驗收**：175 課全部有 uid；線上 165 課逐筆對到 uid 或標 `retire`；
uid 無重複、無重用。

### Phase 2 — 改載入層，單層化
- 廢除 Layer-1/Layer-2 合併與課名 enrich
- loader 改讀 `<lesson_uid>/` 單層
- 舊的 57 個 `L*.yml` 退役

**驗收**：容器內 loader 讀得到；撞鍵組數 = **0**（現在是 13）。

### Phase 3 — 抽取 5 課試跑
`run_lesson_pipeline.py` 已實測可吃二修 DOCX（72 課 `build_ok` 72/72），
但**輸出路徑是寫死的扁平結構**（`{lesson_id}.spotlight.yml`）→ 要改成寫進 `<uid>/`。

**驗收**：5 課在容器內能被讀到並吐出 `lesson_content`。

### Phase 4 — 全量 175 課
**驗收**：`build_ok` 175/175；失敗逐課列原因，不隱藏。

### Phase 5 — 落地 staging
清 `catalog/` 113 檔、清 `assets/worksheets/` 458 檔、寫入新結構、deploy。

**驗收**：staging 抽 10 課真瀏覽器走完流程、0 console error。

### Phase 6 — 朗讀 TTS
**`tts-cache` 不清**，未改動的句子直接命中。
**驗收**：抽 10 課有音檔且非瀏覽器機器音（回應約 177–197KB）。

### Phase 7 — QA 逐批點亮 → prod
啟翔（聚光燈）、靖杭（重點表/朗讀）。用 manifest 控制，驗過一批開一批。

---

## 六、風險

| 風險 | 處置 |
|---|---|
| 🔴 **Phase 2 改載入層是全域影響** | 最危險的一步。先在容器內驗，staging 先行，prod 不動 |
| pipeline 輸出格式要改 code | 已確認 `process_lesson()` 寫死扁平路徑，Phase 3 含這項改動 |
| 二修課名/課號對不到舊課 | Phase 1 的 uid registry 逐筆人工確認，不自動猜 |
| 誤刪 tts-cache | 明列不做；刪除指令先確認 bucket 名 |
| 175 課不是全部 | Hans 向明珠老師確認（會議 action item） |

**回退**：全程只動 staging；一修資料 git 有完整歷史。

---

## 七、驗收條件

1. 175 課在 staging 可見且可完成學習流程
2. 資料結構為 `<lesson_uid>/<模組>.yml`，loader 讀得到
3. **撞鍵組數 = 0**（現在 13）
4. 容器內（非本機）驗證通過
5. 講義下載指向二修版，或**明確關閉**（學生版未就位前不得指向一修）
6. 聚光燈/重點表：過 QA 的已點亮，未過的已隱藏且列冊
7. `tts-cache` 未被清空

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
