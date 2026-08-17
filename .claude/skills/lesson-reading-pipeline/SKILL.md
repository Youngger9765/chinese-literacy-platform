---
name: lesson-reading-pipeline
description: 新課文上線「朗讀」的完整流程 — 從二修 DOCX 抽出教授指定的重點朗讀段落，再預先生成全文朗讀與重點朗讀的 AI 音檔，讓學生按下播放就出聲。當需要「新課文加入朗讀」「重點朗讀抽取」「念順順轉線上」「重跑重點段落」「預生成 AI 朗讀」「批次 TTS」「朗讀音檔補齊」時使用。取代舊的 build-key-reading。
---

# lesson-reading-pipeline — 新課文 → 重點段落 → 預生成朗讀音檔

一課教材進來後，「朗讀」這條線要做兩件事：

```
二修 DOCX ──①──> key_reading.yml（教授指定的那一段）
                      │
                      └──②──> 預生成音檔（全文軌 + 重點軌）→ GCS
```

② 的快取 key 是 **句子原文的 sha256**。

不過因為 ① 的檢查 3 要求「passage 必須是 `body.yml` 的某一段」，重點段的句子**天生就是全文的句子**
（實測：全文 7236 unique、重點 470 unique、聯集 7236）。所以 ② 只要把全文軌生完，
重點軌自動全齊，**而且之後重跑 ① 換了段落也還是齊的**。

這是檢查 3 的附帶效果，值得記著：它讓 #2606 原本估的「重點軌要另外補 210 句」變成 0 句。

---

## 何時用

- 有新課文／新版教材進來，要點亮朗讀
- 重點朗讀段落抓錯，要重跑抽取
- 學生按播放要等 8 秒（= 沒預生成，正在現場合成）

---

## 這份 skill 取代了什麼，以及為什麼（#2712 / #2720）

舊的 `build-key-reading` skill **是 #2712 的成因**，不是它的解法。它寫著：

| 舊 skill | 內容 |
|---|---|
| L8 | 讓學生只朗讀老師挑的重點段（**約 300-400 字**） |
| L22 | 累計字數欄 … **max = 標了字數的可讀範圍** |
| L40 | **範圍長度**：`extent = max(累計字數)` |
| L79 | TDD 斷言：`strip_punct(passage) 長度 ≈ max(累計字數)` |

那條規則被教授否決過（`key_reading_passages.yml` 開頭：「新規則：**只取 ☞ 那一段**」），
但 skill 沒更新，於是抽取器照著做，產出中位 370 字（教授畫的是 153 字）。
**L79 更糟：它把錯誤鎖成一條必須通過的斷言，讓錯誤看起來是驗證過的。**

而且 **字數欄的 max 根本不是範圍長度**。實測 175 課：max 落在 280–520，課文本身 535–1670 字。
它涵蓋的是「一分鐘可讀到哪」的印刷摘錄，與段落邊界無關。這個假設從頭到尾是錯的。

同時舊 skill 只描述**一版**機制（☞ 是一個 `w:drawing` 圖形，直接指著段落），
二版早就改成文字指令 `從指定段落（三）開始朗讀` —— 錨點變成一個**序數**，
而這個轉變沒有寫進任何地方，於是 #2720：序數被套進推導出來的分段，取錯段。

> **這份 skill 的第一條規則**：規則寫在教材上。skill 只記錄「怎麼把它讀出來」和
> 「怎麼證明讀對了」。任何看起來合理的推論（一分鐘要讀幾字、單段太短、下限 40 字）
> 都不可以覆蓋教材上印的東西 —— #2712 就是一次「我量過中位數才決定」的推論覆蓋了標記。

---

## ① 重點朗讀段落抽取

### 資料在哪裡（三個位置，不要搞混）

念順順那一節**不含**段落本文，它只**指名**段落：

```
請用計時器，從指定段落（三　)開始朗讀，計時1分鐘讀的字數…
```

段落本文在第一節「讀全文-做記號」的表格裡，而且**表格自己印著段號**：

```
row: [ 段號欄 ]                    [ 課文欄 ]                        [ 字數欄 ]
      ㄧ⏎二⏎⏎⏎⏎⏎⏎三⏎⏎⏎四…     最近心情起起伏伏…⏎上課時…⏎然而最近…   27⏎57⏎85⏎…
```

**「第三段」指的是課文欄的第 3 個自然段**，不是 `body.yml` 的第 3 個元素。
`body.yml` 是 `extract_lesson_body.py` 用一串啟發式**推導**的（46 字門檻、短段落回收上限 3、
chrome 前綴、指令標記、習題標記、去重、五層標題邊界），少留或多留一段，後面每個序數就位移一格。

### 兩個一定會踩的陷阱

- **段號「ㄧ」是 `U+3127` 注音符號**，不是 CJK `一`（U+4E00）。只認 CJK 的 regex 會判定該課沒有段號。
- **python-docx 會把水平合併的 cell 依 grid 欄數重複回報**，同一 row 裡課文文字出現兩三次。
  取「最長的 cell」之前先去重，否則在段號欄被合併的課會取到段號欄的副本。

### 跑法

```bash
# 0. 取得二修 DOCX（權威來源 = Google Drive，registry 有 drive_file_id）
gcloud auth login --enable-gdrive-access      # 一定要有 Drive scope，純 gcloud auth login 沒有
python3 scripts/fetch_lesson_docx.py --out /tmp/docx-src

#    離線替代：手上有一批學習單檔案時（用內容比對配 uid，不靠檔名）
python3 scripts/stage_lesson_docx.py --source <資料夾> --out /tmp/docx-src

# 1. 課文本體（key_reading 的 anchor 必須套在「將被服務」的那份 body 上）
python3 scripts/build_lesson_body.py --source /tmp/docx-src

# 2. 重點朗讀段落
python3 scripts/build_key_reading.py --source /tmp/docx-src

# 3. 守門（必跑，見下）
cd backend && pytest tests/test_key_reading_numbering_2720.py tests/test_key_reading_extent_2683.py -q
```

### 三道檢查，以及各自的代價

`build_key_reading.py` **只寫入 `ok` / `confirmed`**。其餘一律 withhold，該課 fallback 唸全文，
並列進 `docs/curriculum/key-reading-needs-review.md`。

> **withhold 必須刪掉舊檔，不能只是「不寫」。** 否則上一輪寫錯的課會繼續服務錯誤段落，
> 而報表顯示它被 withheld —— 閘門看起來 fail-closed，行為是 fail-open。

| 檢查 | 條件 | 為什麼是這個數字 |
|---|---|---|
| 1. 段號數 vs 課文段數 | `0 ≤ 課文段數 − 段號數 ≤ 2` | 全 175 課實測，對 33 課可判定樣本：diff 0 → 22對2錯、diff 1 → 5對1錯、diff 2 → 2對0錯、**diff ≥3 → 0對4錯**。一兩個未編號段是作者沒編號的收尾句，落在 anchor 之後；三個以上代表兩邊對「段落從哪裡開始」的看法不同。`課文段數 < 段號數` 也擋（cell 掉了編號段） |
| 2. 一版段落**文字**比對 | 有一版對應段落時，必須是同一段文字 | 這道專門補檢查 1 漏放的（L0030 / L0072 / L0110 三課 diff 小但取錯，全被這道攔下）。⚠️ **比文字，不要比段號** —— 舊版拿一版的段落全文只去查一個「段號」再比兩個數字，結果 48 課標 confirmed 裡 31 課是錯的 |
| 3. 必須是 `body.yml` 的某一段 | 完全相等 | 它是學生實際朗讀的內容、TTS 句表的來源，也是 #2718 斷言的對象。不在裡面代表 Word 在該處手動斷行（《感情小日記1》因此少了結尾 24 字、斷在句中） |

**一版對照表（`backend/data/key_reading_passages.yml`，134 課人工掃描）是 regression golden set，不是答案。**
它是一版的：53 課可比對中 23 課的二版課文已改寫、41 個標題在二版對不上。可以用來擋回歸，不可以整份覆蓋上去。

### 目前實測（175 課，2026-08-17）

```
寫入 86 課    ok 57 / confirmed 29
withheld 89   no_anchor 28（該課本來就沒有念順順）
              numbering_disagrees 28
              disagrees_with_first_edition 23
              no_printed_numbering 4 / not_a_stored_paragraph 4 / implausible_length 2
黃金集可判定 38 課 → 寫入且正確 27，寫入但錯誤 0，withheld 11
```

修正前是 20/34 正確（59%）。**涵蓋率從 146 課降到 86 課是刻意的**：
withhold 的課唸全文（降級但誠實），寫入的課才是對的。要提高涵蓋率的方法是
處理 review 清單，不是放寬閘門。

---

## ② 預生成朗讀音檔（全文軌 + 重點軌）

不必等 ① 定稿 —— 只要 ① 的檢查 3 還在（passage 必須是 `body.yml` 的某一段），
重點軌就恆為全文軌的子集，先生全文即可。**但 ① 若改了 `body.yml` 本身（課文重新抽取），
② 就要重跑**，因為句子變了。

### 兩軌現在是一軌（別再照 #2606 的估算做）

#2606 量到重點段需要另外補約 210 句，因為當時的 passage 起訖落在句中
（107 課只有 30 課能被全文句完整覆蓋，中位 76%）。

**#2720 之後不成立了。** 檢查 3 要求 passage 必須完全等於 `body.yml` 的某一段，
所以它切出來的句子就是全文的句子。實測全文 7236 unique、重點 470 unique、**聯集 7236** ——
重點軌需要額外生的是 **0 句**。

### ⚠️ 快取 key 含發音修正表的指紋 —— 改表 = 整批音檔失效

`_cache_key = sha256(CORRECTIONS_FINGERPRINT + 句子)`。指紋是 `PHONEME_CORRECTIONS`
＋台灣讀音修正表的 digest。這個設計是對的（改了發音，舊音檔變成**不可達**而不是**錯的**），
但代價是**每次改那張表，全庫音檔都要重生**（約 $2、約 70 分鐘）。

**#2605 的根因就是這個。** 實測 2026-08-17：bucket 內 1418 個音檔全部是用舊的
純 `sha256(文字)` 當 key，執行期要的 7236 句**命中 0 句**。不是 blob 被 lifecycle 刪、
不是 Cloud Run SA 沒權限、也不是 `TTS_PROVIDER` 設錯 —— #2605 列的三個猜測都不是。
指紋加進 key 的那次改動，隱含的全量重生沒有跑。

> 改 `normalization.py` 的發音表之後，**必須**接著跑 `generate_reading_audio.py`，
> 否則使用者按播放會退回現場合成（8–24 秒、偶發 503）。

### 句表一定要從執行期的同一個函式來

```
build_lesson_tts_mapping()  →  _clean_for_tts  →  _split_sentences  →  _cache_key = sha256
```

⛔ **不要另外寫一套切句**。#1208 就是這樣壞的：前端自己用 regex 切句，
sha256 與預生成的 blob 對不上，2871 句裡只有 303 句命中，整批音檔生了用不到。

```bash
# 盤點（不呼叫 TTS、不花錢）；同時是 GCS 快取層的診斷工具
python3 scripts/build_reading_audio_manifest.py --report

# 小樣本試跑（確認憑證 + 閉環：跑完再 --report 一次，涵蓋數應該增加）
python3 scripts/generate_reading_audio.py --limit 20

# 全量（7236 句 / 12 workers ≈ 70 分鐘 / 約 $2；可中斷續跑，已有的會跳過）
python3 scripts/generate_reading_audio.py --workers 12
```

`generate_reading_audio.py` **不自己實作任何一步** —— 切句、算 key、合成、編碼、上傳
全部呼叫執行期同一組函式。#1208 與 #2605 都是同一種錯：多寫了一份執行期已經有的實作，
於是產出的東西執行期讀不到。這支腳本沒有第二實作可以漂移。

（Cloud Run Job 版見 `docs/ops/ai-reading-batch.md`；本機跑得動時不需要 Job。）

`TTS_PROVIDER` 決定寫入哪個 GCS prefix，**必須與線上 Cloud Run 的值一致**（目前 `gemini31`）。
設錯 = 音檔寫到執行期不會讀的路徑，白跑一輪。

### 驗收（不是 curl 200，也不是後台顯示 100%）

1. 管理員後台 → AI 朗讀 → 兩軌都 `N/N · 100%`
2. 隨機抽課逐句試聽，**首句 1 秒內出聲**（8 秒 = 沒命中，正在現場合成）
3. 學生端一鍵登入 → 重點朗讀按播放 → 立刻出聲、不 503

---

## 反模式

- ❌ 用推論覆蓋教材上印的東西（「一分鐘要讀 300 字所以取 300 字」）→ #2712
- ❌ 把序數套進推導出來的分段（`body[anchor-1]`）→ #2720
- ❌ 交叉驗證比號碼不比文字 → 64% 誤報，而且錯得很有信心
- ❌ withhold 只是不寫、沒刪舊檔 → 報表 fail-closed、行為 fail-open
- ❌ 把一版對照表當答案整份覆蓋 → 二版半數以上對不上，製造新的張冠李戴
- ❌ 拿字數欄 max 當段落長度或完整性檢查 → 它是一分鐘印刷摘錄，與段落無關
- ❌ 只用「passage 是該課某一段」「長度中位數合理」當守門 → 取到隔壁段時這兩條全綠
- ❌ 改了 `normalization.py` 的發音修正表卻沒重生音檔 → 全庫音檔瞬間不可達（#2605 根因）
- ❌ 自己寫一套切句／算 key／編碼去生音檔 → 對不上執行期，生了命不中（#1208、#2605）
- ❌ 照 #2606 的「重點軌要另外補 210 句」去估 → #2720 之後重點軌是全文軌的子集，補 0 句
- ❌ bucket 列不出來就當成「沒有音檔」→ 那是權限問題，會讓你重生一整批已經存在的東西

---

## 關聯

| 位置 | 內容 |
|---|---|
| `scripts/fetch_lesson_docx.py` | Drive → `<uid>.docx`（權威來源，registry 的 drive_file_id） |
| `scripts/stage_lesson_docx.py` | 本機學習單 → `<uid>.docx`（內容比對配對，離線用） |
| `scripts/extract_key_reading.py` | 錨點解析 + 三道檢查（演算法與量測記錄都在 docstring） |
| `scripts/build_key_reading.py` | 寫入 / withhold / 產 review 清單 |
| `scripts/build_reading_audio_manifest.py` | 兩軌句表 + GCS 覆蓋率盤點（列不出 bucket 時 exit 2，不報數字） |
| `scripts/generate_reading_audio.py` | 全量生成（全走執行期函式，可續跑） |
| `backend/tests/test_key_reading_numbering_2720.py` | 黃金集守門（取錯段會紅） |
| `backend/tests/test_key_reading_extent_2683.py` | 長度守門（#2712 回歸鎖） |
| `docs/curriculum/key-reading-needs-review.md` | 自動產生的待人工確認清單 |
| `docs/ops/ai-reading-batch.md` | ② 的 Cloud Run Job 操作手冊（#2606） |
| issues | #2712 長度、#2720 取錯段、#2605 GCS 快取層、#2606 批次生成 |
