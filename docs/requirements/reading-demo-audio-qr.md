---
title: 示範朗讀音檔 + QR code 導向平台
status: 需求已確認，實作中（#2622 Phase 1 = 批次腳本 + QR 表）
last-updated: 2026-08-08
requested-by: 教材端（紙本學習單製作方）
date: 2026-08-04
---

# 示範朗讀音檔 + QR code 導向平台

## 為什麼需要

紙本學習單上印 QR code，學生掃碼聽「示範朗讀」（標準讀音範例），再自己跟著念。

**現行做法（教材端手工，要取代掉）**：
1. 把課文分段貼進外部 TTS 工具生成語音
2. 逐段聽過檢查
3. 上傳影音平台、生封面圖
4. 產 QR code、貼回 Word

一課約 30 分鐘 × 全部課數 → 教材端估 100–180 小時人工
教材內容改版時，全部音檔要重製 → 這是要自動化的核心理由

**平台側已有的另一半**：學生朗讀評分（錄音 → 比對原文 → 標出錯字/漏字 → 語速 + 歷史曲線）
缺的是前半段「示範」→ 補上後形成閉環：**平台示範（聽）→ 學生跟讀（練）→ 平台比對評分（評）**

## 需求

### R1 每課產出示範朗讀音檔

| 範圍 | 說明 |
|---|---|
| 全文 | 整課課文朗讀 |
| 段落 | 學習單指定的目標段落（「念順順」那段） |

⚠️ **年級差異（不要一律產兩份）**：

| 年級 | 需要的音檔 | QR code 數 |
|---|---|---|
| 4–7 年級 | 全文 **+** 段落 | 2 |
| 8–9 年級 | **只有段落** | 1 |

### R2 平台播放頁

- 學生掃 QR code 直接落到該課的示範朗讀播放頁，不需轉平台
- 播放頁旁接「開始朗讀」→ 直接進現有朗讀評分流程
- **防呆優先**：使用端的老師不一定熟電子產品，操作要「按了就出結果」，不要多層設定

#### ⚠️ 免登入播放的架構限制（實作前必讀）

紙本 QR code 的使用情境是**學生掃碼即聽**，不可能先登入。但**現有的 TTS endpoint 明確拒絕匿名請求**：

- `backend/app/routes/tts.py` 的 `POST /api/tts/synthesize` 有 `current_user: User = Depends(get_current_user)`
- 該處註解寫明理由：`Anonymous requests are rejected with 401 to prevent bill-washing attacks on the Azure/GCP TTS quota`
- 前端 `frontend/src/services/ttsApi.ts` 也是帶 auth header 呼叫

**所以這個播放頁不可以打 `/api/tts/synthesize`。** 免登入播放只能走：

1. **播放預先產生好的音檔**（批次產出時就寫進 GCS，播放頁只讀已存在的物件）
2. 音檔的取得方式二選一：**同源 `/assets` proxy**（已有的做法，見 `#2486` 收 public bucket 那條路）或**簽名 URL**
3. ⛔ 不要為了免登入而把 `synthesize` 的 auth 拿掉 —— 那正是它存在的理由（防止有人用我們的 quota 燒錢）

換句話說：**示範朗讀是「批次預生成 + 靜態播放」，不是「即時合成」**。這個區分決定整個實作方向，別做成即時呼叫。

### R3 QR code 批次交付

教材端要把 QR code 貼回 Word 紙本，所以需要**批次產出**而非逐課手動：
- 每課（依年級）產對應的 QR code
- 輸出成表格（course id / 年級 / 類型 / URL / QR 圖檔路徑），讓教材端一次貼完

### R4 學習軌跡統計圖表

對齊教材端紙本監測表的設計：

| 指標 | 平台現況 |
|---|---|
| 流暢度 | ✅ 已有 |
| 字數統計 | ✅ 已有 |
| 語詞（每課固定 8 題） | ❌ 要加 |

- ⚠️ 呈現單位是**區段**不是單課：以 5 課或 10 課為一組看成長曲線

## 技術現況（實作前先讀，別重造）

平台**已有**完整 TTS 基礎設施 —— `backend/app/services/tts/`：

| 已存在 | 位置 |
|---|---|
| 三個 provider：Google Cloud TTS / Azure / Gemini TTS | `tts/providers/{google,azure,gemini}.py` |
| GCS 快取（產過的音檔不重跑） | `TTS_GCS_BUCKET` + `tts/cache.py` |
| 句級切分 | `_split_sentences`、`data/sentences.v2.jsonl` |
| 多音字校正 | `PHONEME_CORRECTIONS` @ `tts/normalization.py` |
| 整課 TTS mapping | `build_lesson_tts_mapping` |

**三個 provider 全是雲端 API，不是本機模型** → 批次產出全部課數的音檔是「寫腳本 + 付 API 費」等級（依公開牌價粗算，全文部分約個位數美金一次性，且有快取不重跑），**不需要 GPU 或專用機器**。

#### 實際跑哪個 provider：**Azure（`azure`）** — 2026-08-08 更新

⚠️ **本節在 2026-08-04 寫的時候是 `gemini31`，2026-08-08 全面切換到 Azure。** 下表是切換後的現況。

| 來源 | 現值 | 查證 |
|---|---|---|
| prod serving revision | `azure` | `lingoleap-backend-00107-lrr`（`status.traffic` percent 100 那筆）|
| staging serving revision | `azure` | `lingoleap-backend-staging-01126-ddv` |
| `.github/workflows/{deploy,staging-deploy,preview-deploy}.yml` | `TTS_PROVIDER=azure` | 三份都改了 |
| `backend/app/services/tts/__init__.py:11` | default `azure` | 現在 default 與部署值一致 |
| `.github/workflows/{pytest,keypoints-manifest-gate}.yml` | `TTS_PROVIDER=google` | 測試環境專用，非部署值 |

voice = `zh-TW-HsiaoChenNeural`，192kbps 48kHz。實測快取命中延遲 146–237ms、回應 177–197KB
（Gemini 時代約 83KB）。

⚠️ **判斷現況一律查 serving revision 的 env，不要讀文件**——這一節自己就是「文件過時」的例子。

#### 🔴 Azure 失敗會 fallback 到中國腔，且會被永久快取（已知缺陷，未修）

`azure` 模式失敗時自動改用 Google `cmn-CN-Chirp3-HD-Sulafat`（**中國大陸腔**，2026-04 盲聽已否決），
產物寫進 `tts-cache/`；而讀取路徑在 azure prefix miss 時**會回讀 `tts-cache/`**
（`tts/__init__.py` 約 281–285 行）→ 一次短暫失敗就把那句永久釘在中國腔。

**批次產出示範朗讀時特別危險**：一次跑 222 個音檔，中途 Azure 抖一下就會有幾個檔是中國腔，
而且不會有 exception。**批次腳本必須記錄每個檔實際用的 provider，收工核對全部都是 azure。**

⚠️ **不要拿 `backend/specs/test_tts_spec.py` 的 Contract 1（"default is azure"）當作「跑 azure」的依據** —— 它測的是「env 不存在時的 code default」這個契約，不是實際部署行為。這個區別害我一開始判斷相反。

驗 runtime 實際值（需要 gcloud token 有效；**別用 `cmd | grep X || echo "沒有"` 的寫法**，gcloud 失敗時 stdout 空、grep exit 1、fallback 會印出「沒有」，看起來跟「真的沒設」一模一樣）：

```bash
OUT=$(gcloud run services describe lingoleap-backend --region asia-east1 \
  --project lingoleap-dev --format='value(spec.template.spec.containers[0].env[].name)' 2>&1); RC=$?
[ $RC -ne 0 ] && { echo "查詢失敗（不是「沒設」）: $OUT" | head -2; exit 1; }
echo "$OUT" | tr ';,' '\n\n' | grep -c ENVIRONMENT   # positive control：先證明抓得到已知存在的 env
echo "$OUT" | tr ';,' '\n\n' | grep TTS
```

#### ~~`gemini31` 的 `ffmpeg` 依賴~~ —— 已隨 provider 切換失效（2026-08-08）

~~gemini 用 `subprocess` 呼叫 `ffmpeg` 把 PCM 轉 MP3，缺 `ffmpeg` 會靜默降級回傳 WAV bytes 卻仍宣稱 `audio/mpeg`。~~

Azure 直接回 MP3，**沒有 ffmpeg 依賴**，這個風險不再適用。

但「驗實際 bytes」那條**仍然要做，而且理由更硬**：Azure 曾出現 **HTTP 200 但 body 0 bytes**，
直接寫進快取就是永久靜音。批次上傳前必驗：

```
非空  AND  ≥2000 bytes  AND  開頭是 b"ID3" 或 mp3 frame sync (b"\xff\xfb" / b"\xff\xf3" / b"\xff\xf2")
```

⚠️ **另一個 Azure 專屬地雷**：SSML 的 `<phoneme>` 元素**整個被 Azure 拒收**（HTTP 400，
zhuyin / sapi / ipa / ups 四種 alphabet 全部失敗）。多音字校正要改用 `<sub alias="X">Y</sub>`。
詳見 `backend/app/services/tts/normalization.py` 與 `PHONEME_CORRECTIONS`。

## 驗收條件（BDD）

```
Given 一課 4–7 年級的課文
When 執行示範朗讀批次產出
Then 產出「全文」與「段落」兩個音檔，各有對應的播放頁 URL 與 QR code

Given 一課 8–9 年級的課文
When 執行示範朗讀批次產出
Then 只產出「段落」一個音檔（不產全文）

Given 學生掃描紙本上的 QR code（未登入）
When 落到示範朗讀播放頁
Then 可直接播放，且頁面能接續進入朗讀評分流程

Given 同一課重跑批次
When 音檔內容未變更
Then 命中 GCS 快取，不重複呼叫 TTS API

Given 學生掃描 QR code 抵達播放頁且未登入
When 播放頁取得音檔
Then 不得呼叫 /api/tts/synthesize（該端點對匿名回 401），必須讀取已預生成的音檔物件
```

⚠️ **R4 的統計圖表沒有寫成 BDD**，因為它現在還不可機器驗證 —— 「5 課或 10 課」到底哪個、bucket 怎麼切、尾段不足一組怎麼算、語詞分數的資料來源是什麼，全部未定（語詞資料來源本身還列在下方開放問題裡）。
**拿到教材端的紙本監測表之後才補這段驗收條件**，在那之前不要寫測試去猜規則。

## 開放問題

- 播放頁的 URL 形式（要短到適合 QR code，且不可猜測性 vs 免登入的取捨）
  → **待 Young 拍板**。這兩個條件本身互斥：短又免登入就是可猜。#2622 先實作
    `/demo-reading/{lesson_id}/{full|passage}` 可猜版本，**不部署 prod**
- ~~段落朗讀的「目標段落」來源~~ → **已解（2026-08-08）**：`key_reading.passage`，
  SOT 是 `backend/data/key_reading_passages.yml`（by lesson code，如 `G4-L01`），
  透過 `get_key_reading_passages()` 載入
- 語詞 8 題的資料來源與計分方式

## 實作 scope（2026-08-08 走 staging API 全量查證，165 課）

| 年級 | 課數 | 有念順順段 | 無 | 該產什麼 |
|---|---:|---:|---:|---|
| G4 | 26 | 21 | 5 | 全文 + 段落 |
| G5 | 28 | 21 | 7 | 全文 + 段落 |
| G6 | 28 | 24 | 4 | 全文 + 段落 |
| G7 | 33 | 23 | 10 | 全文 + 段落 |
| G8 | 31 | 7 | 24 | 只有段落 |
| G9 | 19 | 11 | 8 | 只有段落 |

```
全文音檔 115（4-7 年級每課）+ 段落音檔 107 = 222 個音檔 = 222 張 QR
批次合成字數 131,714
```

### 🔴 本需求沒涵蓋的缺口：8-9 年級有 32 課產不出任何東西

規格說 8-9 年級「只產段落」，但那 32 課（文言文、多文本為主）**沒有念順順段資料**
→ 依規格既不產全文也不產段落，整課沒有示範朗讀、沒有 QR。

#2622 照規格做並把它們列進「無法產出」報表，**未自作主張補全文**。
要不要為它們產全文是教材端的決定。

### 資料衛生：`key_reading_passages.yml` 有 32 個孤兒條目

該檔有 134 個 code 帶 passage，其中 **32 個對不到 DB 任何一課**（課碼改過或那些課沒進 DB）。
逐課比對後 API 與 YAML **沒有任何落差**（只有 YAML 有 = 0），所以不影響 scope，但該清。

⚠️ 查課程清單一律走 API：`GET /api/stories?page_size=300`（參數是 **`page_size`** 不是 `limit`，
傳 `limit` 會被靜默忽略只回 60 筆），並斷言拿到的筆數等於回應的 `total`。
`backend/data/curriculum/manifest.yml` 是 158 筆，**與 DB 的 165 不一致**，不要拿它當清單來源。
