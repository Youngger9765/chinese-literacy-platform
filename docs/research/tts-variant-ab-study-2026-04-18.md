# 一天的 TTS 探險：從 Azure / Chirp3 到 Gemini 3.1 Variant A

**日期**：2026-04-18（單日）
**決策者**：Young + 方大哥（A/B 盲聽）
**結論**：全面採用 **Gemini 3.1 Flash TTS + Variant A（prompt-only）**。台灣腔、成本、品質三贏。
**決策 PR**：#1133 feat(tts): switch runtime to Variant A

> 這份文件也當 blog material — 完整走過為了台灣腔調做過的所有嘗試。

---

## TL;DR

- 從 Azure Speech / Google Chirp3-HD 一路換到 Gemini 3.1 Flash TTS
- 早上花半天做 Variant C（37 條同音字替換 + prompt prefix）
- 下午發現 Variant A（純 prompt prefix、無替換）**更自然**
- A/B 盲聽 44 樣本 6 類，方大哥拍板：A 勝
- 切換 + 文件 + 關 5 個 research issues + close 1 PR，一天完成
- 37 條替換規則 / SSML phoneme 機制 / 斷句停頓研究 / 多音字 scan — 全部變 dead code
- **Gemini 3.1 Flash TTS + 一句台灣腔 prompt 就夠了**

---

## 背景：我們為什麼折騰這個

國小國語文教學平台，學生聽 TTS 念課文學讀音。方大哥（product owner）反覆要求：
- **必須台灣腔**（攻擊要念 `gōng jí` 不是 `gōng jī`）
- **自然流暢**（不要機械感）
- **念對多音字**（「喝采」要 `hè` 不是 `hē`）
- **念對人名/地名/數字**（戴資穎、陳彥博、214 周、2021 年）

TTS 市場上的選項：

| Provider | 台灣腔 | 成本 | 品質 | 問題 |
|----------|-------|------|------|------|
| **Azure Speech（zh-TW HsiaoChen）** | ✅ 原生 | 貴 | 好，略僵 | 單位成本高、SSML phoneme 要手維護 |
| **Google Chirp3-HD Sulafat（cmn-CN）** | ❌ 中國腔 | 中 | 非常好 | 無法指定台灣腔 |
| **Gemini 3.1 Flash TTS（preview）** | 🟡 可 prompt 指示 | 便宜（~$0.30/2483 句） | 好 | 新 API |

---

## 歷程

### 階段 0：起點（2026 年初）

- Primary：**Azure Speech** `zh-TW-HsiaoChenNeural`（#667 sentence-level cache）
- Fallback：**Google Cloud TTS** `cmn-CN-Chirp3-HD-Sulafat`
- 手工維護 SSML `<phoneme>` 修多音字：
  ```xml
  <phoneme alphabet="x-microsoft-zhuyin" ph="ㄏㄜˋ">喝</phoneme>采
  ```
- Azure bill 每月累積貴

### 階段 1：Gemini 3.1 Flash TTS 加入（#1107 → PR #1108）

Google 推出 Gemini 3.1 Flash TTS preview，native audio output。加為**第三個 provider**：

- Model: `gemini-3.1-flash-tts-preview`
- Voice: `Aoede`（prebuilt）
- Location: `us-central1`
- Env switch: `TTS_PROVIDER=gemini31`

批次預生成全部課文句子到 `gs://lingoleap-tts-cache/gemini31/sentences/`。

### 階段 2：發現 Gemini 預設念中國音（#1109）

學生聽到「垃圾」被念成 `lā jī`（中國音），不是 `lè sè`（台灣）。

Root cause：Gemini 沒有 voice 選項指定地區腔調，模型預設中國發音。

### 階段 3：Variant C —「同音字替換」Workaround

早上的嘗試。原理：**TTS 只看發音不看字義**，換成同音字繞過中國音：

```python
_TAIWAN_TTS_REPLACEMENTS = [
    ("垃圾", "樂色"),     # TW lè sè vs CN lā jī
    ("研究", "研舊"),     # 究 TW jiù vs CN jiū
    ("危險", "圍險"),     # 危 TW wéi vs CN wēi
    ("攻擊", "攻急"),     # 擊 TW jí vs CN jī — 方大哥指名
    # ... 37 條規則
]
```

加上阿拉伯數字轉中文：`214` → `兩百一十四`

還加 prompt prefix 穩定腔調：
```
請使用台灣用語的繁體中文，以親切且自然的語氣朗讀以下內容：{替換後文字}
```

**投入**：半天時間，37 條規則、批次重生 2417 句。

### 階段 4：品質保證 — Provenance Audit Trail

方大哥要「可以驗收每一句音檔」— 擔心規則套錯或 Gemini 念錯。加了：

**Append-only JSONL log** `backend/data/tts-provenance.jsonl`，29 欄位/條：
- `raw_text` / `tts_input`（送 Gemini 的實際字串）
- `replacements_applied`（哪些規則觸發）
- `audio_sha256` / `gcs_uri` / `audio_duration_ms`
- `variant` / `batch_run_id` / `script_git_sha` / `generated_by`
- `supersedes`（指向前一版 audit_id，形成歷史鏈）

**Admin TTS 稽核頁**（#1120 / PR #1121）：方大哥能瀏覽 2036+ 句、filter 替換/數字/台灣發音、點進 side panel 看完整 metadata、播音檔抽聽。

### 階段 5：踩坑 — Batch script 漏套 `_clean_for_gemini`

第一輪 C 版生成完 → 使用者反映「攻擊」還是中國音。

Root cause：`batch_gemini_tts.py` 只 call `_clean_for_tts()`（去符號），沒 call `_clean_for_gemini()`（套替換）。送 Gemini 的還是原文。

修復 + 重跑 batch（2483 句、~20 分鐘、~$0.30）。

PR #1129 還修了另一個：Gemini 偶爾回 HTTP 200 + empty candidates（safety block），舊 code 直接 `response.candidates[0]` crash → 加 null check（修了 66 個 errors）。

### 階段 6：Variant A 實驗 — Prompt-only

下午 Young 問：「**不做替換，只靠 prompt 指示台灣腔，會不會就夠了？**」

建了 variant 系統：
- `backend/data/tts-variants.yaml`：
  - **A**：`apply_replacements: false`，GCS `gemini31-prompt-only/sentences/`
  - **C**：`apply_replacements: true`，GCS `gemini31/sentences/`
- `batch_gemini_tts.py --variant A|C`
- Provenance 加 `variant` 欄位
- Supersedes chain 改 `(variant, cache_key)` 複合鍵

跑 A batch：2417 句 / ~20 分鐘 / ~$0.30。

### 階段 7：A/B 盲聽

做了 `/tmp/tts-ab-compare.html`（44 樣本 6 類）：

- **台灣發音-高頻**（垃圾 / 研究 / 危險 / 攻擊 / 企業 / 成績 / 星期 / 法律）×13
- **台灣發音-其他**（微笑 / 盡量 / 休息 / 包括 / 質量 / 認識 / 知識）×10
- **人名-難字**（陳彥博 / 楊俊瀚 / 戴資穎 / 陳雨菲）×7
- **地名**（東京 / 台灣）×4
- **數字**（214 / 2021 / 100）×5
- **中英混讀**（NASA / Hemsworth / PEACE / Frankenstein）×5

左邊綠 = Variant A（原字送 Gemini），右邊橘 = Variant C（替換後送）。每筆並排 audio element，一鍵比對。

82 個 mp3 從 private GCS bucket 下載到 `/tmp/tts-audio-cache/`，HTML 用相對路徑 — `file://` 瀏覽器打開直接聽。

### 階段 8：結果 — A 勝

- **A 更自然**：整句連貫、語氣親切
- **C 略僵硬**：替換字擾動語意、停頓怪
- **邊界字**：A 靠 prompt 念對人名（陳彥博、楊俊瀚）
- **數字**：A 的 Gemini 自己處理 `214 周` → `兩百一十四周`，不需手動規則

方大哥 + Young 拍板：**以後就用 A**。

### 階段 9：切換 + 歸檔（PR #1133）

Runtime 改動：
1. `_synthesize_gemini` 拿掉 `_clean_for_gemini(cleaned)` 呼叫
2. 加 `GEMINI_TTS_PROMPT_PREFIX` 常數，每次 API call 前綴
3. GCS 讀寫路徑 `gemini31/sentences/` → `gemini31-prompt-only/sentences/`
4. `delete_tts_cache` 加 rollback 說明

2408 個 A 音檔已預生成在 GCS → 切換當下 cache hit 率 ~97%（2483 句裡 75 句未預生，runtime 首次打時即時生成）。

### 階段 10：清理（同日下午）

- 關 5 個 research issues：#1111 #1113 #1114 #1115 #1116（A 決策後 obsolete）
- Close PR #1132 多音字 scan doc（為擴充 replacement 表準備的 audit，A 後 dead）
- `_TAIWAN_TTS_REPLACEMENTS`、`_apply_taiwan_pronunciation`、`_numbers_to_chinese_tw`、`_clean_for_gemini` → 全變 dead code（保留作 rollback）
- SSML `<phoneme>` 機制 → 繼續存在於 Azure path，但 Gemini path 不用

---

## 成本對比

| 方案 | 人工維護 | 單次生成 | API 月費 | 音質 | 台灣腔 |
|------|---------|---------|---------|------|--------|
| Azure + SSML phoneme | 高（每字手編） | 高 | 貴 | 好，略僵 | ✅ 原生 |
| Chirp3-HD（中國腔） | 0 | 中 | 中 | 非常好 | ❌ |
| **Gemini 3.1 Variant C**（替換表） | 中（37 條 + 維護） | ~$0.30 / 2483 句 | 便宜 | 略僵 | ✅ 靠規則 |
| **Gemini 3.1 Variant A**（prompt-only） | **零** | ~$0.30 / 2483 句 | 便宜 | **好** | **✅ 靠 prompt** |

**A 全贏**：零維護、音質最好、cost 最低。

---

## Lessons Learned

### 1. Prompt 先試，規則後做

早上做 37 條 replacement 規則，下午發現 prompt 就夠了。如果先試 prompt，能省半天。

**教訓**：LLM 時代，**先試 prompt**，別急著寫規則。規則是最後手段。

### 2. Audit trail 的價值不是除錯，是**信任**

Provenance JSONL + admin 稽核頁不是為了工程 debug — 是為了方大哥可以**逐句驗收**。教育平台，TTS 念錯 = 教育事故。audit trail 讓責任可追。

這套機制也讓 A/B 比對成為可能（因為 variant + cache_key 都記錄）。

### 3. Variant system 的長期價值

`tts-variants.yaml` + `--variant` flag 設計從一次實驗變成了長期 infra：
- 未來若 Gemini 3.1 推出 voice 選項，可加 Variant D 測
- 若需要 per-lesson variant（低年級不同腔）也能擴
- GCS 分 folder 避免 cache 污染

### 4. 「Dead code 保留」= cheap rollback insurance

- `_clean_for_gemini` + 37 條表 + SSML phoneme + 舊 C 音檔（`gemini31/sentences/`, 2417 檔）全留
- 如果 A 之後被投訴，revert PR + 換 GCS path 就回 C
- 刪除的成本高、保留幾乎為零

---

## 未來新 TTS 工作的 canonical 做法

**All TTS changes follow Variant A pattern.** Details in `docs/PRD.md` 「TTS 朗讀架構（Variant A）」章節。

### ✅ 該做的

- Raw text + prompt prefix → Gemini
- GCS 路徑：`gemini31-prompt-only/sentences/`
- Provenance entry 標 `variant: "A"`
- 若 Gemini safety block（empty candidates），log raw_text 不 auto-retry

### ❌ 不要做的

- 擴充 `_TAIWAN_TTS_REPLACEMENTS` 表
- 做 SSML phoneme override（Gemini 不支援，prompt 已夠）
- 用 Azure / Chirp3 做 Gemini 路徑 fallback

---

## 相關 Issues / PRs

### 功能/修復

| Ref | 狀態 | 標題 |
|-----|------|------|
| #1107 | closed | Gemini 3.1 Flash TTS 加入（feasibility） |
| PR #1108 | merged | feat(tts): add Gemini 3.1 Flash TTS provider |
| #1109 | closed | bug: Gemini 3.1 TTS cache always misses on staging（hash mismatch） |
| PR #1106 | merged | fix(data-integrity): normalize slugs, unify streak, dedup sessions |
| #1110 | closed | bug: 逐段朗讀字色高亮追不上朗讀速度 |
| PR #1117 | merged | fix(tts): sync highlight with speech by using cleaned char count |
| #1120 | closed | feat(admin): TTS 句子稽核後台 MVP |
| PR #1121 | merged | feat(admin): TTS sentence audit page |
| #1127 | closed | bug(tts): batch_gemini_tts.py crashes on empty candidates |
| PR #1129 | merged | fix(tts): null-check empty candidates before indexing |

### Research → 決策關的

| Ref | 原問題 | 結論 |
|-----|--------|------|
| #1111 | 多音字修正機制（SSML phoneme） | **Prompt 已解** |
| #1113 | 中英混讀品質 | **A 版 OK** |
| #1114 | 斷句停頓模式 | **A 版 OK** |
| #1115 | 台灣特有詞彙 | **A 版 OK** |
| #1116 | 人名地名聲調 | **A 版 OK** |
| PR #1132 | 多音字 scan audit doc | **Not merged**（為 C 做的功課） |

### 決策 PR

- **PR #1133** — `feat(tts): switch runtime to Variant A (prompt-only Taiwan style)` — 2026-04-18 merged

### 仍 open（未來 feature）

- #1112 TTS 語速 + 字色同步（不在 A/B 範圍，另行 spec）
- #1123 orphan session cleanup（與 TTS 無關）

---

## 附錄：檔案 inventory

- 決策 PR：#1133 `feat(tts): switch runtime to Variant A`
- Runtime code：`backend/app/services/tts_service.py`（拿掉 `_clean_for_gemini`、加 `GEMINI_TTS_PROMPT_PREFIX`）
- PRD canonical：`docs/PRD.md` 「TTS 朗讀架構（Variant A — Prompt-Only Taiwan Style）」
- Audit log：`backend/data/tts-provenance.jsonl`（7249 行：legacy 4832 + A 2417）
- Variant config：`backend/data/tts-variants.yaml`（default_variant: A）
- Batch script：`backend/scripts/batch_gemini_tts.py --variant A`
- A/B 比對 tool：`/tmp/tts-ab-compare.html` + `/tmp/tts-audio-cache/`（local only）
- Research doc（本篇）：`docs/research/tts-variant-ab-study-2026-04-18.md`
- 多音字 scan（PR closed 但 local 可參考）：`backend/data/multi-reading-chars-scan.md`
- Admin 稽核頁 live：`/admin/tts-audit`

---

## Blog version outline（未來寫 blog 用）

```
# 一天之內，我們為了讓 AI 念對「垃圾」搞了 3 套方案，最後發現一句 prompt 就夠了

## Hook
學生聽到「垃圾」被念成 `lā jī` — 中國發音。國小國語文平台，這是教育事故。

## 背景
國小國語文 TTS 平台，方大哥要求台灣腔。

## 第一版：SSML phoneme
Azure 可以，但貴、難維護。每個多音字手編 ㄏㄜˋ 這種 Zhuyin 標記。

## 第二版：37 條同音字替換表
Gemini + 「垃圾→樂色」規則。做完發現 batch script 有 bug（漏套 `_clean_for_gemini`），重跑兩次。

## 第三版：一句 prompt
Gemini + 「請使用台灣用語的繁體中文...」。沒替換、沒規則、更自然。

## A/B 盲聽
44 樣本 6 類。方大哥拍板：A 勝。

## Lessons
- Prompt 先試、規則後做
- LLM 時代的 infrastructure 是 audit + variant system
- Dead code 保留 = 便宜的 rollback 保險

## 技術 spec
- `GEMINI_TTS_PROMPT_PREFIX = "請使用台灣用語的繁體中文..."`
- `gs://.../gemini31-prompt-only/sentences/{sha256}.mp3`
- Provenance JSONL + admin audit page
```
