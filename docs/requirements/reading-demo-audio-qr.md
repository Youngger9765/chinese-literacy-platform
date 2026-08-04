---
title: 示範朗讀音檔 + QR code 導向平台
status: 需求已確認，未實作
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

#### 實際跑哪個 provider：**Gemini 3.1（`gemini31`）**

| 來源 | 說法 | 判定 |
|---|---|---|
| `.github/workflows/deploy.yml`（prod） | `TTS_PROVIDER=gemini31` | ✅ **真相** |
| `.github/workflows/staging-deploy.yml` | `TTS_PROVIDER=gemini31` | ✅ 同上 |
| `.github/workflows/preview-deploy.yml` | `TTS_PROVIDER=gemini31` | ✅ 同上 |
| `backend/app/services/tts/__init__.py:11` | default `azure` | ⚠️ **只在 env 未設時生效** — 三個部署環境全都覆寫了，實務上碰不到這個 default |
| `docs/DEVELOPMENT_GUIDE.md:311` | 「Gemini 3.1 Flash TTS（primary，台灣腔）」 | ✅ **正確** |
| `.github/workflows/{pytest,keypoints-manifest-gate}.yml` | `TTS_PROVIDER=google` | 測試環境專用，非部署值 |

⚠️ **不要拿 `backend/specs/test_tts_spec.py` 的 Contract 1（"default is azure"）當作「跑 azure」的依據** —— 它測的是「env 不存在時的 code default」這個契約，不是實際部署行為。這個區別害我一開始判斷相反。

驗 runtime 實際值（需要 gcloud token 有效；**別用 `cmd | grep X || echo "沒有"` 的寫法**，gcloud 失敗時 stdout 空、grep exit 1、fallback 會印出「沒有」，看起來跟「真的沒設」一模一樣）：

```bash
OUT=$(gcloud run services describe lingoleap-backend --region asia-east1 \
  --project lingoleap-dev --format='value(spec.template.spec.containers[0].env[].name)' 2>&1); RC=$?
[ $RC -ne 0 ] && { echo "查詢失敗（不是「沒設」）: $OUT" | head -2; exit 1; }
echo "$OUT" | tr ';,' '\n\n' | grep -c ENVIRONMENT   # positive control：先證明抓得到已知存在的 env
echo "$OUT" | tr ';,' '\n\n' | grep TTS
```

#### 🔴 `gemini31` 有本機 `ffmpeg` 依賴 —— 批次產出前必須確認

因為**所有部署環境都跑 `gemini31`**，這是真實風險不是假設：

`backend/app/services/tts/providers/gemini.py` 用 `subprocess` 呼叫 **`ffmpeg`** 把 PCM 轉 MP3。
`ffmpeg` 不存在時它 catch `FileNotFoundError` 並**降級回傳 WAV bytes**，但呼叫端仍以 `audio/mpeg` 回應、cache path 仍是 `.mp3`
→ **副檔名 / MIME / 實際 bytes 三者不一致**。批次跑 180 課會**整批**帶著這個錯，而且不會有任何 exception。

- 批次執行環境（本機或 CI）**必須有 `ffmpeg`**
- 產出第一個檔案就要驗**實際 bytes 是不是真 MP3**（`file <檔>` 或 `ffprobe`），不要只看副檔名
- 另有既存的 Variant A 設定要一起帶：`GEMINI_TTS_PROMPT_PREFIX`（台灣腔 prompt）+ GCS path 是 `gemini31-prompt-only/sentences/`（PR #1133 切換過，已有 2408 個預生成句級檔案可命中快取）

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
- 段落朗讀的「目標段落」來源：從既有 `reading_timer` / 重點朗讀設定取，或另建對照表
- 語詞 8 題的資料來源與計分方式
