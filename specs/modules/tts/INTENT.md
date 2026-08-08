---
spec_id: tts.synthesis.provider_chain
module: tts
title: TTS 合成服務 — 提供者鏈（Azure → Chirp3-HD fallback）+ synthesize_speech 入口
stability: active
canonical_source: backend/app/services/tts/__init__.py
owns_code:
  - backend/app/services/tts/__init__.py
  - backend/app/services/tts/providers/azure.py
  - backend/app/services/tts/providers/gemini.py
  - backend/app/services/tts/providers/google.py
  - backend/app/services/tts_service.py
owns_data: []
spec_tests:
  - backend/specs/test_tts_spec.py
related_issues: []
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-08-08
owner: young
---

# TTS 合成服務：提供者鏈與 synthesize_speech 入口

> 給**人**讀的 spec（Young / 實習生）。機器契約在
> `backend/specs/test_tts_spec.py`。
> 改 TTS 提供者邏輯或加新提供者前先讀這份。

## 1. 這個 module 在管什麼

`synthesize_speech(text)` 是 TTS 的唯一公開入口。它實作：
1. L1 記憶體快取（by-key）
2. GCS 物件快取（by-provider prefix）
3. 提供者鏈（依 `TTS_PROVIDER` 環境變數決定）

> 正規化（`_clean_for_tts`、`_split_sentences`、phoneme corrections）和
> L1/GCS 快取邏輯由**獨立的 characterization tests** 覆蓋：
> - `tests/test_characterization_tts_normalization.py`
> - `tests/test_characterization_tts_cache.py`
>
> 本 spec 只補充那兩份沒覆蓋的：**提供者鏈行為** + **TTS_PROVIDER 預設值**。

## 2. 提供者鏈（`synthesize_speech` 實際邏輯）

`TTS_PROVIDER` 決定主提供者：

| `TTS_PROVIDER` | 主提供者 | Fallback |
|----------------|----------|----------|
| `"gemini31"` | Gemini 3.1 Flash TTS | 無（失敗直接拋 `TTSError`）|
| `"azure"` | Azure Cognitive Speech | Google Chirp3-HD |
| 其他（含預設）| Google Chirp3-HD | 無 |

> **重要**：`azure` 模式下，若 Azure 失敗會自動 fallback 到 Google。
> 但 `gemini31` 和 `google` 模式**沒有 fallback**，失敗即拋 `TTSError`。

### 🔴 實際部署值：`azure`（2026-08-08 起，三個環境一致）

| 環境 | `TTS_PROVIDER` | 查證方式 |
|---|---|---|
| prod | `azure` | revision `lingoleap-backend-00107-lrr`（`status.traffic` percent 100）|
| staging | `azure` | revision `lingoleap-backend-staging-01126-ddv` |
| preview | `azure` | `.github/workflows/preview-deploy.yml` |

⚠️ **2026-08-08 之前三個環境都是 `gemini31`**，網路上找得到的舊文件（含本 repo 的
`docs/DEVELOPMENT_GUIDE.md`、`docs/requirements/reading-demo-audio-qr.md`）在那之前
都寫「Gemini 是 primary」。判斷現況一律查 **serving revision 的 env**，不要讀文件。

### ⚠️ fallback 會把中國腔永久寫進快取（已知缺陷，未修）

`_synthesize_google` 的預設 voice 是 **`cmn-CN-Chirp3-HD-Sulafat`** —— `cmn-CN` 是
中國大陸腔，2026-04 盲聽時已被否決。而 `synthesize_speech` 的讀取路徑有一段
provider 交叉回讀：

```python
gcs_data = _gcs_get(key, provider=active_provider)     # azure/sentences/ miss
if active_provider == "azure":
    gcs_data = _gcs_get(key, provider="google")        # ← 改讀 tts-cache/，命中就送
```

所以一次短暫的 Azure 失敗會：合成中國腔 → 寫進 `tts-cache/{key}.mp3` →
**之後每次請求該句都命中這裡**，Azure 恢復也救不回（`azure/sentences/` 那個 key 從沒被寫過）。
唯一訊號是後端一行 `logger.warning`，前端與使用者不會知道。

現況曝險（2026-08-08 實測 `gs://lingoleap-tts-cache/`）：

```
azure/sentences/                    6356
gemini31-prompt-only-v2/sentences/  1418
tts-cache/                            10   ← 全部建立於 2026-05-22，且 10 個 key 都不在 azure prefix
```

那 10 個的來源文字已對不上任何現行課文句（比對 `data/sentences.v2.jsonl` 2301 句，0 命中），
所以**實際上幾乎不會被請求到**。風險在機制本身，不在這 10 個物件。

### 預設值

```python
TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "azure")
```

在沒有 `TTS_PROVIDER` 環境變數時，預設使用 **`"azure"`**（→ azure + google fallback）。

> 待查（待查）：Production（Cloud Run）實際設的 `TTS_PROVIDER` 值？
> `private/STRATEGY.md` 中提到線上走 `gemini31`，但程式碼預設是 `azure`。
> 下次 deploy 時確認 Cloud Run env var。

## 3. Azure → Google Fallback 的安全保證

```python
if active_provider == "azure":
    try:
        audio_bytes = _synthesize_azure(cleaned)
        used_provider = "azure"
    except TTSError as exc:
        logger.warning("Azure TTS failed, falling back to Google: %s", exc)
        try:
            audio_bytes = _synthesize_google(cleaned)
            used_provider = "google"
        except TTSError as google_exc:
            raise TTSError(
                f"Both Azure ({exc}) and Google ({google_exc}) TTS failed"
            ) from google_exc
```

兩個提供者都失敗時，才把 `TTSError` 往上拋（含兩邊的錯誤訊息）。
**不會靜默回傳空 bytes。**

## 4. Voice 常數（providers/）

| 提供者 | 常數 | 預設值 |
|--------|------|--------|
| Google | `TTS_VOICE` | `"cmn-CN-Chirp3-HD-Sulafat"` |
| Azure | `AZURE_TTS_VOICE` | `"zh-TW-HsiaoChenNeural"` |
| Gemini | `GEMINI_TTS_VOICE` | `"Aoede"` |

## 5. 允許 / 禁止的改動

✅ **允許**
- 新增提供者（在 `providers/` 下建新檔，並在 `synthesize_speech` 加 `if` 分支）
- 改 voice 名稱（常數在各 provider 檔）
- 改 Azure `prosody rate`（在 `providers/azure.py`）

⛔ **禁止（會破壞契約）**
- 讓 `synthesize_speech` 在兩個提供者都失敗後回傳 `b""` 或 `None`（下游必須得到例外）
- 改動 `tts_service.py` shim（它是向後相容層，只應 re-export，不含邏輯）
- 讓 `azure` 模式失敗後**不 fallback** 直接拋（破壞雙提供者高可用設計）

## 6. 既有 characterization tests 的關係

| 測試檔 | 覆蓋範圍 | 與本 spec 關係 |
|--------|---------|---------------|
| `test_characterization_tts_normalization.py` | `_clean_for_tts`、`_split_sentences`、`_numbers_to_chinese_tw`、`_cache_key` | 本 spec 不重複這些 |
| `test_characterization_tts_cache.py` | L1 eviction、`_blob_path`、GCS sentinel | 本 spec 不重複這些 |
| `test_tts_spec.py`（本 spec）| `TTS_PROVIDER` 預設、azure→google fallback 邏輯、constants | 補充上面兩份沒有的 |
