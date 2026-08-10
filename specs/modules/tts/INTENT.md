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

### ✅ fallback 交叉回讀已移除（2026-08-10）

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

---

## 7. 一個音檔要滿足什麼才算「對」（2026-08-10 新增）

> 這一節存在的原因：2026-08-09 有四個讀音被回報，追下去發現**沒有任何地方寫著
> 「音檔怎樣才算對」**。判準散在 code 註解跟 commit 訊息裡，於是每一次改動都要靠
> 記得。下面五條是可機器檢查的，腳本在 `backend/scripts/verify_lesson_audio.py`。

| # | 條件 | 為什麼 | 怎麼驗 |
|---|---|---|---|
| A1 | 走的是 `azure` prefix，且 provider 是 `azure` | google prefix 是 `cmn-CN-Chirp3-HD` 中國腔，2026-04 已否決 | 查 serving revision 的 `TTS_PROVIDER` |
| A2 | 快取鍵含**校正表指紋** | 鍵只吃文字時，改了校正表舊音檔仍會被端出來，而且看不出來 | `CORRECTIONS_FINGERPRINT` 在 `_cache_key` 裡 |
| A3 | 段落內最長靜音 ≤ **400ms** | Azure 句末留 ~885ms，一段有四分之一是死空氣 | 解碼後偵測靜音 |
| A4 | 逗號停頓保留在 **200–350ms** | 全部壓平會失去句子的節奏 | 同上 |
| A5 | 讀音校正**實際套用**到該課文字 | 校正表有一條、不代表這課的音檔用到了 | 比對「有校正 vs 無校正」合成結果的 md5 |

### 什麼時候要重跑

- 改 `data/tts/taiwan_pronunciation.json` 或 `he_exceptions.json`
- 改 `normalization.py` 的 `_apply_phoneme_corrections` / `_cache_key`
- 改 `pauses.py` 的 `LONG_PAUSE_MS` / `TARGET_PAUSE_MS`
- 換語音、換 `<prosody rate>`、換 provider

### ✅ Azure 傳輸中斷已改成重試（2026-08-10 修）

`synthesize_speech` 在 Azure 丟 `TTSError` 時 fallback 到 `_synthesize_google`，
那是 `cmn-CN-Chirp3-HD`（**2026-04 已否決的中國腔**），而且**停頓壓縮只掛在 azure 分支**，
所以 fallback 產生的音檔既是中國腔、又保留 ~900ms 的長停頓。

實測頻率：`verify_lesson_audio --lesson 1` 跑 3 次有 **1 次**出現 900ms 以上的停頓
（903 / 937ms，比 Azure 原始的 885ms 還長 → 不是 Azure 的音檔）。直接呼叫
`shorten_sentence_pauses` 4/4 都成功，所以問題不在壓縮本身。

**這比停頓嚴重**：2026-08-10 移除的是 azure miss 時**回讀** google prefix，
沒有動 fallback **合成**。一次 Azure 抖動就會把中國腔寫進快取，而快取鍵不含 provider，
所以之後每次都命中它。

**根因是 `urllib`，不是 Azure**。Azure 回應用 chunked transfer-encoding，urllib 對
chunked 串流結尾的處理不可靠。同一段文字、同一時間連打 25 次：

| | 失敗 |
|---|---|
| `urllib.request.urlopen` | 3 / 25（12%） |
| `requests.post` | **0 / 25** |

排除過的假設：**文字長度無關**（76–243 字各打 6 次，失敗落在中間長度）；
分塊 `read(8192)` 只是減少不是根除（12 次 3 → 1）。

**修法**：改用 `requests.post`，並保留重試 3 次（backoff 0.5s×n）當作任何網路呼叫都有的殘餘保險；
HTTP 4xx/5xx **不重試**（400 代表 SSML 寫錯，再送一次還是 400）。

實測：最長段落（243 字）連打 **30 次全過、零重試觸發**。

⚠️ `requests` 原本只是間接依賴，現已明列進 `requirements.txt` —— 直接用卻不列，
哪天上游拿掉就會在部署時才炸。

**仍然存在的殘餘風險**：真的連續 3 次都失敗時，還是會落到 Google 中國腔且不壓縮。
若要完全根除，需要拿掉 fallback 或讓 fallback 不寫進快取 —— 尚未做。

### 🔴 `__init__.py` 曾重複定義 `_synthesize_azure`（已修，但同型問題還有 6 個）

`__init__.py` 第 50 行 `from .providers.azure import _synthesize_azure`，第 166 行**又定義一次**。
Python 取後者，所以那個 import 是死的 —— **整晚對 `providers/azure.py` 的修改在執行期完全沒作用**
（換 requests、加重試、拉長 timeout 全部無效），而測試也一路綠，因為它們也是從 providers 匯入的。

已刪除重複定義並加回歸鎖 `tests/test_no_duplicate_azure_impl.py`（用 AST 比對 import 與 def）。

⚠️ **同樣被遮蔽的還有 6 個**：`_gcs_get`、`_gcs_put`、`_get_gcs_bucket`、`_l1_put`、
`get_cached_tts`、`delete_tts_cache`。它們登記在測試的 `KNOWN` 白名單裡，**尚未處理** ——
順手刪掉的風險太大（快取行為改變會直接影響線上），要單獨評估。

### ⚠️ 三個已知會騙過人的陷阱

1. **`<sub alias>` 對多音字無效**。`著` 要讀 ㄓㄠˊ，但全教育部辭典**只有「著」這個字**讀
   ㄓㄠˊ，沒有替身可用。`<phoneme>` 在 `zh-TW-HsiaoChenNeural` 一律 HTTP 400（換
   `zh-CN-XiaoxiaoNeural` 同樣 markup 就成功 → 是語音不支援）。所以多音字**修不了**，
   不要再花時間試。
2. **測試 SSML 時不要餵已帶標籤的字串**。`_synthesize_azure` 會先跳脫再注入校正，
   餵進去的 `<sub>` 會被當文字唸出來 —— 曾因此誤判「校正讓朗讀慢 76%」。
3. **「音檔有聲音」不等於「用對了讀音」**。要驗讀音只能比對**開校正 vs 關校正**的
   輸出位元組；聽起來正常的音檔可能是幾天前的舊快取。

### ⛔ 還沒進快取鍵的東西

`_cache_key` 目前含**文字 + 校正表指紋**，**不含**語音與 `<prosody rate>`。
`rate="1.08"` 在 `providers/azure.py` 的註解裡寫著 product-tunable —— 哪天真的調了，
就會重現「舊音檔取不掉」這個問題。動它之前先把它加進鍵。

### ✅ L1 快取也做了 provider 隔離（2026-08-11，kiro gpt-5.6-terra review 三項修復）

2026-08-10 拿掉的是 GCS 層的跨 prefix 回讀（見上）——但 **L1（`_TTS_CACHE`）本身是
provider-blind 的**：`synthesize_speech` 最上面一行原本是
`if key in _TTS_CACHE: return _TTS_CACHE[key]`，key 只吃文字，不吃是誰合成的。
於是同一個症狀在記憶體層又發生一次：Azure 抖動一次 → fallback Google → 中國腔寫進 L1
（no provider tag）→ Azure 恢復後，下一個請求先撞到這個 provider-blind 的 L1 命中，
**連 provider chain 都不會再碰**，中國腔卡死到 process 重啟為止。用真實 code（monkeypatch
provider 函式，非猜測）復現：Azure 失敗一次→Google 命中→Azure 恢復→仍拿到 Google bytes。

修法：`_l1_key(key, provider)` 把 provider 併進 L1 的識別鍵（`f"{provider} {key}"`），
`_l1_put` / `get_cached_tts` 現在**強制**要求 `provider` 參數（不再有 provider-blind 的
呼叫方式）。`delete_tts_cache` 對三個 provider 都各查一次 L1 key 再刪，不再只查一個。
`routes/tts.py` 的兩處 `get_cached_tts(req.text)` 早退路徑改成
`get_cached_tts(req.text, provider=TTS_PROVIDER)`。

同時把 `synthesize_speech` 拆成 `_synthesize_speech_with_provider(text) -> (bytes, str)`
+ 兩行的 `synthesize_speech` wrapper——後者對外契約不變（still `-> bytes`），前者讓
`verify_lesson_audio.py` 的 A1 檢查可以直接問「這次是哪個 provider 合成的」，不用再從
停頓時長反推（見下）。

⚠️ 代價：provider 不一致時視為 miss，重付一次合成費——跟 2026-08-10 GCS 那次修復同一個
取捨（見上「A miss now costs one synthesis」的註解）。正常情況（Azure 健康）L1 完全沒受
影響；只有「active provider 名義上是 azure，但這次實際落到 google」的窗口會多付一次。
回歸鎖：`tests/test_tts_l1_cache_not_provider_blind.py`（含「重複呼叫仍命中 L1」的正向對照，
證明沒有把 L1 整個關掉）。

`_l1_put`/`get_cached_tts`/`delete_tts_cache` 仍在 §「已刪除重複定義」那段講的 6 個
shadowed 函式名單裡（`__init__.py` 蓋掉 `cache.py` 的匯入）——這次只改了 `__init__.py`
裡實際在跑的那份，`cache.py` 裡被蓋掉的死程式碼刻意沒動（風險隔離，見上一節的理由）。

### ✅ 「和」連接詞規則的假陽性（2026-08-11，同一次 review）

`_he_conjunction_positions` 靠 jieba 斷詞判斷「和」是否獨立成詞，但 jieba 對它沒見過的
專有名詞（鄭和、大和）一律拆成兩個單字，跟真連接詞長得一樣，兩道既有防線都擋不住：

- **`data/tts/he_exceptions.json`**：鄭和／大和／和麵／零和 之前被歸進
  `_dropped_rare_two_char`（當初刪冷僻 2 字詞是為了避免跨詞邊界誤中，如「白天和黑夜」
  誤中「天和」）——但這 4 個是專有名詞/動詞/現代常用詞，不是冷僻詞，已搬回 `words`。
  `_dropped_rare_two_char` 其餘條目逐一檢查過，其他都是真的冷僻或已被 jieba 字典/既有詞
  條擋住（如「大和號」「大和民族」「和珅」「違和感」「協和醫院」jieba 都直接斷成一個詞，
  沒有這個問題）。
- **`_is_self_reference(text, i)`**（新函式）：和單獨被引用/當標題時不是連接詞 ——
  `「和」`、`〈和〉`、`《和》`、整個字串就是 `和`。這是 jieba 斷詞 + exception list
  都管不到的第三道獨立防線。

回歸鎖：`tests/test_he_conjunction.py` 新增 `TestProperNounsAndVerbsWronglyDroppedAsRare`
+ `TestSelfReferenceIsNotAConjunction`（含 kiro 提供的全部 5 個反例）。

### ✅ `verify_lesson_audio.py` 自己的三個缺陷（2026-08-11，同一次 review）

這支腳本是「音檔怎樣算對」的判準本身，缺陷比較嚴重——它可能誤放行或誤判：

- **A2 沒有 try/finally**：探測 fingerprint 時直接改 `norm.CORRECTIONS_FINGERPRINT`，
  算完再改回去，中間沒包 try/finally。如果算 probe key 那行拋例外，
  `CORRECTIONS_FINGERPRINT` 會卡在 `"probe"` 上，**同一個 process 裡後面每一課的
  `_cache_key` 都會用錯的 fingerprint**，且不會有任何提示。已包 try/finally
  （`_fingerprint_moves_the_key`）。
- **A1 用停頓時長反推 provider**：`>890ms` 就當作「大概是 google fallback」——雙向都會
  誤判：段落本身沒有長停頓時，跟真的 google fallback 長得一樣（漏抓）；反過來，真的被
  Azure 合成、但恰好有一段 >890ms 的長靜音，會被誤報成 fallback（假警報）。改成直接問
  `_synthesize_speech_with_provider` 回的 provider 字串，不用猜。
- **A4 的判斷式漏掉最壞情況**：`if internal and not commas` 要求 `internal`
  非空才檢查——但這條規則要抓的正是「停頓被壓到偵測器的門檻(150ms)以下、
  `find_silences` 整段回空清單」，那種情況下 `internal` 恰好是空的，
  於是最壞情況反而完全沒被檢查。改成看**來源文字有沒有逗號類標點**（COMMA_LIKE_PUNCTUATION
  = "，、；："），不看 `internal` 是否非空。

三個修復都各自有 TDD（在原碼上先紅再修）+ mutation test（改回舊行為，確認測試會抓到）；
規格見 `backend/tests/test_verify_lesson_audio.py`。`check_lesson` 內部拆成
`_fingerprint_moves_the_key` / `_paragraph_findings` 兩個可獨立單元測試的函式，
不用真的打 Azure/GCS 就能測到這三條邏輯。

