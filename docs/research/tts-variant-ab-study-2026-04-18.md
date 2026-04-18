# TTS Variant A/B 研究紀錄

**日期**：2026-04-18
**決策者**：Young + 方大哥（A/B 盲聽）
**結論**：全面改用 **Variant A（prompt-only）**，不再使用替換字規則
**產出 PR**：#1133 feat(tts): switch to Variant A

---

## 背景

方大哥（product owner）指名國語文 TTS 必須念正確的台灣腔調。關鍵字例如：
- 攻擊（擊 TW `jí`、CN `jī`）
- 垃圾（TW `lè sè`、CN `lā jī`）
- 研究（究 TW `jiù`、CN `jiū`）

Gemini 3.1 Flash TTS 預設會念中國音。必須干預。

早期（2026-04-18 前半天）採用 **Variant C** 做法：
- 建了 37 條 `_TAIWAN_TTS_REPLACEMENTS` 同音字替換表
- 「垃圾」→ 送「樂色」給 Gemini，同音不同字
- 另加數字轉中文（214 → 兩百一十四）

後半天實驗 **Variant A**：prompt-only，raw text 原封送 Gemini，只靠前綴 prompt 指示台灣腔調：

> 請使用台灣用語的繁體中文，以親切且自然的語氣朗讀以下內容：{原文}

---

## 方法論

### 批次生成兩份音檔

**Script**：`backend/scripts/batch_gemini_tts.py`（支援 `--variant A|C` flag，讀取 `backend/data/tts-variants.yaml`）

**GCS 存放**：
- C：`gs://lingoleap-tts-cache/gemini31/sentences/{sha256(raw)}.mp3`（2417 檔）
- A：`gs://lingoleap-tts-cache/gemini31-prompt-only/sentences/{sha256(raw)}.mp3`（2408 檔）

兩份用同一個 cache_key（raw sentence hash），只有 TTS input + GCS path 不同。

### Provenance 紀錄

`backend/data/tts-provenance.jsonl` append-only log，每筆 29 欄位，包含：
- `variant`: "A" | "C"
- `raw_text`: 前端 display 用的原文
- `tts_input`: 實際送 Gemini 的字串
- `replacements_applied`: 哪些規則被觸發
- `audio_sha256`, `gcs_uri`, `batch_run_id`, `script_git_sha`...

### A/B 比對工具

`/tmp/tts-ab-compare.html`（33 KB，44 樣本）+ `/tmp/tts-audio-cache/`（82 mp3 下載）

6 類樣本：
- 台灣發音-高頻：垃圾 / 研究 / 危險 / 攻擊 / 企業 / 成績 / 星期 / 法律（13 樣本）
- 台灣發音-其他：微笑 / 盡量 / 休息 / 包括 / 質量 / 認識 / 知識（10 樣本）
- 人名-難字：陳彥博 / 楊俊瀚 / 戴資穎 / 陳雨菲（7 樣本）
- 地名：東京 / 台灣（4 樣本）
- 數字：214 / 2021 / 100（5 樣本）
- 中英混讀：NASA / Hemsworth / PEACE / Frankenstein（5 樣本）

每筆左綠=A（原字），右橘=C（替換後），直接 audio element 並排聽。

---

## 結果

### A 勝

- **A 更自然**：整句連貫，語氣親切
- **C 略僵硬**：替換字擾動語意，Gemini 有時停頓怪
- **邊界字（人名難字）**：A 靠 prompt 也念對（陳彥博、楊俊瀚）
- **數字**：A 的 Gemini 自己處理 arabic → 台式中文（「214 周」→「兩百一十四周」）

### 替換規則保留哪些

**都不保留。** A 組本身靠 prompt 就能搞定台灣腔調。37 條 `_TAIWAN_TTS_REPLACEMENTS` 全部變成 dead code（保留檔案為 rollback 用，但不再呼叫、不再擴充）。

---

## 決策

### 運行時切換（PR #1133）

1. `_synthesize_gemini` 不再套 `_clean_for_gemini`
2. 新增 `GEMINI_TTS_PROMPT_PREFIX` 常數，wrap 每次 API call
3. GCS 讀寫路徑 → `gemini31-prompt-only/sentences/`
4. 2408 個 A 音檔已預生成在 GCS，切換後 cache hit 即用

### 未來新 TTS 功能遵循模式

- ✅ Raw text + prompt prefix → Gemini
- ❌ 不要擴 `_TAIWAN_TTS_REPLACEMENTS`
- ❌ 不要做 SSML phoneme override（Gemini 未支援，且 prompt 已夠用）
- ✅ GCS 寫 `gemini31-prompt-only/sentences/`
- ✅ Provenance entry 標 `variant: "A"`

已寫進 `docs/PRD.md` 「TTS 朗讀架構（Variant A）」章節作為 canonical spec。

---

## 連動關閉的 issues

A/B 研究結果已解消以下 issues（2026-04-18 closed）：

| Issue | 原問題 | 結論 |
|-------|--------|------|
| #1111 | 多音字修正機制（SSML phoneme） | Prompt 已處理，無需額外機制 |
| #1113 | 中英混讀品質 | A 版本 OK |
| #1114 | 斷句停頓模式 | A 版本 OK |
| #1115 | 台灣特有詞彙發音 | A 版本 OK |
| #1116 | 人名地名聲調 | A 版本 OK |

**保持 open**：
- #1112 TTS 語速 + 字色同步（feature，需另做）
- #1123 orphan session cleanup（與 TTS 無關）

---

## 附錄：檔案 inventory

- Research commit：PR #1133 `6aadcd2d feat(tts): switch to Variant A`
- Audit log：`backend/data/tts-provenance.jsonl`（7249 行：legacy 4832 + A 2417）
- Variant config：`backend/data/tts-variants.yaml`（default: A）
- Dead code retained：`_TAIWAN_TTS_REPLACEMENTS`, `_apply_taiwan_pronunciation`, `_numbers_to_chinese_tw`, `_clean_for_gemini`
- Comparison tool：`/tmp/tts-ab-compare.html` + `/tmp/tts-audio-cache/`（local）
- 多音字 scan（連動）：`backend/data/multi-reading-chars-scan.md`（PR #1132）

---

## 如果未來要 rollback 到 C

1. Revert PR #1133
2. GCS 舊 C 音檔仍在 `gs://lingoleap-tts-cache/gemini31/sentences/`（2417 檔）
3. `_clean_for_gemini` 函數保留 → 恢復呼叫即可
4. 37 條替換表 `_TAIWAN_TTS_REPLACEMENTS` 保留 → 直接可用

Rollback 零資料重建成本。
