# PRD — 二修教材全刷重建（Second-Edition Re-ink）

> 2026-08-14 ｜ 決策人：Young ｜ 來源：8/14 團隊會議逐字稿 + 當日實測查證
> 狀態：待啟動

---

## 一、WHY — 為什麼要「全刷」而不是「增量修」

### 1. 內容改動幅度太大，增量不划算

啟翔在 8/14 會議實測後回報：**二修改了 7~8 成的課**。
在這個比例下，「找出一修與二修的差異、只改動到的部分」的成本高於直接重建，
而且每一課都要人工確認差異，等於做了兩次工。

Young 的原話：**「我根本不知道二修跟一修的差別，不如重刷。」**

### 2. 舊資料沒有保留價值

平台**尚未進入真實教學現場**，目前所有資料都是內部測試產生的。
沒有真實學生學習紀錄、沒有已發出的紙本、沒有對外承諾綁定任何一課。
→ **一修資料的保留成本 > 保留價值**。

### 3. 現行資料結構會讓每次改版都重痛一次

啟翔的原話：
> 「全部都在同一份 YAML 裡面，然後就很大份……我請他做某件事，他會一直去抓其他的，
> 有關聯但又不全然有關聯，因為太多東西混在一起了。我人腦去看他給我的 output 也很痛苦。」

現況是**兩種結構並存**：
- 舊：一課一個大 YAML，所有模組混在一起（設計目的是預先全載）
- 新：聚光燈另外獨立成 `catalog/<課號>.spotlight.yml`

而且**聚光燈檔名是綁課號的**，二修重排課號後全部對不到。

### 4. 一個擋了四個月的 bug 剛修好，正好是重建的前提

`backend/Dockerfile` 只 COPY `app/ data/ alembic/`，沒有 COPY `scripts/`
（也複製不到 —— build context 是 `./backend`，`scripts/` 在上一層）。
runtime 動態 import adapter 失敗 → fail-closed → **124 課有素材但只有 7 課吐得出內容**。

已修並 merged（`33b0532c`）。容器內實測：修前 7 課、修後 124 課。
**沒有這個修復，重建出來的內容一樣顯示不出來。**

---

## 二、現況（2026-08-14 實測，非文件推論）

| 項目 | 數字 | 取得方式 |
|---|---|---|
| Drive 新教材（SOT） | **175 課** docx | `rclone lsf` 該資料夾，扣掉 1 個 `~$` 暫存檔 |
| 線上 DB 課數 | **165** | `/api/stories?page_size=300` 的 `total` |
| 聚光燈 catalog 檔 | 113（manifest 列 108） | `ls` + 讀 manifest.json |
| 有 `spotlight_v2` 素材 | 124 | 容器內跑 loader 統計 |
| `assets/worksheets/` | 458 檔，最後更新 **6/16** | `gcloud storage ls -l` |
| `tts-cache` | **1523 MB** | `gcloud storage du` |
| `reading-audio` ×2 | 0 MB（空） | 同上 |

Drive 年級分佈：G4=20 / G5=28 / G6=29 / G7=30 / G8=23 / G9=23 / 文言文=12 / 體育生品格=11

> ⚠️ 這解掉了會議上「159 還是 180 課」的爭議 —— **實際是 175**。
> 比線上多 10 課，代表二修有新增課次。

---

## 三、WHAT — 做什麼 / 不做什麼

### 做

1. 以 Drive 175 課教師版 docx 為唯一來源，**重建全部課文內容**
2. **改資料結構**：一課一個 folder，模組各自獨立 YAML，按需載入
3. 清掉一修的 DB 資料、講義檔、聚光燈 catalog
4. 重跑聚光燈、重點表、重點朗讀
5. 朗讀改用 AI TTS（不再人工錄音）
6. intro 頁移除全文朗讀鈕（全文朗讀統一在第二頁）

### 不做（本次範圍外）

| 不做 | 為什麼 |
|---|---|
| **不刪 `tts-cache`** | 快取鍵是 `sha256(文字)`，與課號、版本無關。二修沒改到的句子會直接命中；刪掉等於重新燒一次 TTS 費用 |
| **不動 prod** | 先在 staging 完成並驗收，prod 待 staging 驗過再複製 |
| **不上學生版/解答版下載** | Hans 還在轉換中，本次只上教師版抽出的**平台內容** |
| **不點亮未檢核的聚光燈** | 機制修好 ≠ 內容驗過。用 manifest 控制，逐批開 |
| **不追教授正式審稿** | 會議已定調：雙方無合約義務，改以「模組完成即上線、未完成先隱藏」 |

---

## 四、資料結構變更

### 現況（會讓每次改版重痛）

```
backend/data/lessons/spotlight/catalog/G4-L11.spotlight.yml   ← 檔名綁課號
backend/data/lessons/<某個大 YAML>                            ← 所有模組混在一起
```

### 目標

```
backend/data/lessons/<story_id>/
  ├── meta.yml            # 課名、年級、課號、策略
  ├── passage.yml         # 課文
  ├── spotlight.yml       # 閱讀聚光燈
  ├── keypoints.yml       # 文章重點表
  ├── key_reading.yml     # 重點朗讀（念順順）
  └── ...                 # 其他模組各自一份
```

**兩個關鍵設計**：

1. **folder 用 `story_id` 不用課號** —— 課號會隨改版重排，`story_id` 不會。
   這樣二修、三修、四修都不會再撞到「檔名對不到」的問題。
2. **按需載入** —— 點到哪個關卡才讀那個模組的 YAML。
   AI 做某個模組時只會看到那個模組的資料，不會再吃到別的模組（直接解掉啟翔的痛點）。

---

## 五、HOW — 手順

> 每個階段都是一張 issue、一個 PR。**上一階段驗收通過才進下一階段。**

### Phase 0 — 前置（已完成）

- [x] adapter 進不了 image 的 bug 修復並 merged（`33b0532c`）
- [x] Drive SOT 建立，175 課教師版就位
- [x] 實習生 GCS 讀取權限開通（`objectViewer` + `legacyBucketReader`）

### Phase 1 — 對照表：175 課 ↔ 線上 165 課

**產出**：`docs/curriculum/second-edition-mapping.csv`

| 欄位 | 說明 |
|---|---|
| `docx_path` | Drive 上的相對路徑 |
| `new_code` | 從檔名解析的二修課號 |
| `title` | 課名 |
| `story_id` | 對應的線上 story_id（**沿用**）；查無對應則標 `NEW` |
| `status` | `matched` / `new` / `online_only` |

**為什麼要先做這張表**：165 → 175 之間有 10 課的差額，
不知道哪些是新增、哪些是改名，就無法判斷「線上那課該保留還是該刪」。

**驗收**：`matched + new` 覆蓋全部 175 課；`online_only` 逐筆有處置決定。

### Phase 2 — 重建腳本（先跑 5 課，不碰線上）

用既有的 `run_lesson_pipeline.py`（已實測可吃二修 DOCX，72 課 `build_ok` 72/72），
輸出改寫成 Phase 4 的新 folder 結構。

**驗收**：5 課在**容器內**能被 loader 讀到並吐出 `lesson_content`。
⛔ 本機綠不算 —— 這次的 adapter bug 就是本機綠、線上壞。

### Phase 3 — 全量抽取 175 課（仍不碰線上）

**驗收**：`build_ok` 175/175；失敗的逐課列出原因，不隱藏。

### Phase 4 — 資料結構切換 + 落地 staging

1. 清掉 `backend/data/lessons/spotlight/catalog/`（113 檔）
2. 寫入新的 `<story_id>/` 結構
3. loader 改讀新結構
4. `assets/worksheets/` 458 檔清掉，改上二修教師版
5. deploy staging

**驗收**：staging 上抽驗 10 課，真瀏覽器走完學習流程、0 console error。

### Phase 5 — 朗讀重生成

AI TTS 重跑。**`tts-cache` 不清** —— 未改動的句子直接命中。

**驗收**：抽驗 10 課有音檔且非瀏覽器機器音（看回應大小，Azure 約 177–197KB）。

### Phase 6 — 聚光燈 / 重點表 QA 與逐批點亮

由啟翔、靖杭 QA。用 `catalog/manifest.json` 控制開關 —— **驗過一批才加一批**。
未通過的先隱藏，會議已定調「模組完成即上線，未完成先隱藏」。

### Phase 7 — prod

staging 驗收通過後複製到 prod。

---

## 六、風險與回退

| 風險 | 處置 |
|---|---|
| 抽取失敗率高於預期 | Phase 2 先跑 5 課即可發現；不進 Phase 3 |
| 新資料結構讓 loader 壞掉 | Phase 4 前先在容器內驗過；staging 先行，prod 不動 |
| 誤刪 tts-cache | **明列為不做事項**；任何刪除指令要先確認 bucket 名 |
| 二修還有課沒給齊 | Hans 向明珠老師確認 175 是否為全部（會議 action item） |
| 線上 10 課在 Drive 找不到對應 | Phase 1 的 `online_only` 逐筆決定：保留舊版 or 下架 |

**回退路徑**：全程只動 staging；一修資料在 git 有完整歷史，隨時可還原。

---

## 七、驗收條件（全部達成才算完成）

1. Drive 175 課全部在 staging 可見且可完成學習流程
2. 資料結構已切換成 `<story_id>/<模組>.yml`，loader 讀得到
3. 容器內（非本機）驗證通過
4. 講義下載指向二修版本，或**明確關閉**（學生版未就位前不得指向一修）
5. 聚光燈/重點表：通過 QA 的已點亮，未通過的已隱藏且列冊
6. `tts-cache` 未被清空

---

## 八、分工

| Phase | 主責 |
|---|---|
| 1–5 | Young（會議決定先自己跑一版，卡住再交接） |
| 6 | 啟翔（聚光燈）、靖杭（重點表 / 朗讀） |
| 學生版 + 解答版 docx | Hans（三版本轉換，8/31 前） |
| 向明珠老師確認 175 是否為全部 | Hans |

---

## 附錄：本文件所有數字的取得方式

- Drive 課數 — `rclone lsf --drive-root-folder-id <id> gdrive: -R --files-only --include "*.docx"`
- 線上課數 — `curl /api/stories?page_size=300` 讀 `total`（⚠️ 參數是 `page_size` 不是 `limit`）
- 容器內行為 — `docker run --rm -i --entrypoint python <prod image digest> - < probe.py`
- GCS 用量 — `gcloud storage du -s gs://<bucket>`
- 一修最後改動 — `git log --since=2026-07-21 -- backend/data/curriculum/`（空 = 未動）

⛔ 本文件不採用狀態檔、舊議程或記憶作為事實來源。
