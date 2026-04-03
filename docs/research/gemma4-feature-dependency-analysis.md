# LingoLeap 全功能外部依賴 vs Gemma 4 離線可行性

> 研究日期：2026-04-03
> 用途：逐一檢查每個功能的外部依賴，判斷離線場景下哪些能用、哪些不能用

---

## 10 步驟逐一分析

### Step 1：讀全文做記號（ReadingAnnotation）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| 課文內容 | 本地 YAML 檔案 | ✅ 不需要網路 |
| 標記功能 | 純前端 JS | ✅ 不需要網路 |
| TTS 朗讀課文 | Azure TTS → GCS cache | ❌ **需要網路**（除非預先下載 mp3 cache） |

**離線方案**：預先把所有課文的 TTS mp3 打包進 server，就不需要即時呼叫 Azure

---

### Step 2：逐段朗讀（LiveTutor）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| STT 語音辨識 | Web Speech API（Chrome 內建，**需要連 Google server**） | ❌ **需要網路** |
| 錄音 | `navigator.mediaDevices.getUserMedia` | ✅ 瀏覽器內建 |
| 同音自動修正 | 本地 fluencyAnalyzer | ✅ 不需要網路 |
| 分級鼓勵 | 本地邏輯 | ✅ 不需要網路 |
| TTS 示範朗讀 | Azure TTS | ❌ **需要網路**（除非預先 cache） |

**離線瓶頸：STT 是最大問題**。Web Speech API 必須連網。離線替代方案：
- Whisper（OpenAI 開源 STT，可本地跑，但需要額外 GPU/CPU 資源）
- Gemma 4 的 audio input 能力（**未驗證**，不確定能否即時串流 STT）

---

### Step 3：全文朗讀（FullReading）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| STT 語音辨識 | Web Speech API | ❌ **需要網路** |
| 錄音 | 瀏覽器 getUserMedia | ✅ |
| LCS 文字比對 | 本地 DiffDisplay | ✅ |
| 流暢度分析 | 本地 fluencyAnalyzer | ✅ |

**同 Step 2，STT 是瓶頸**

---

### Step 4：生字練習（VocabPractice）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| 生字資料 | 本地 YAML vocabulary | ✅ |
| 部件拆解 | 本地 JSON decompositions | ✅ |
| 筆順動畫 | 本地 WriteCharacter | ✅ |
| 注音顯示 | 本地 BpmfIansui 字體 | ✅ |
| 注音拼讀遊戲 | 本地邏輯 | ✅ |
| 教育部字典查詢 | moedict.tw API | ❌ **需要網路** |

**離線方案**：字典資料預先 cache 到本地 DB（已有 DictionaryCache model）

---

### Step 5：詞語定義（VocabDefinitionMatch）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| 選擇題/配對題 | 本地 YAML multiple_choice | ✅ |
| 拖拉互動 | 純前端 | ✅ |

**完全離線可用** ✅

---

### Step 6：語詞應用（VocabApplication / FillInBlankExercise）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| 填空題 | 本地 YAML fill_in_blank + vocab_bank | ✅ |

**完全離線可用** ✅

---

### Step 7：課文理解（ComprehensionChat）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| 蘇格拉底對話 AI | Gemini 2.5 Flash（Vertex AI API） | ❌ → ✅ **Gemma 4 可取代** |
| 語音輸入（選用） | Web Speech API | ❌ **需要網路** |
| Circuit breaker | 本地邏輯 | ✅ |

**Gemma 4 可以取代 Gemini 做蘇格拉底對話**，但品質會下降（特別是繁體中文的理解深度）

---

### Step 8：語詞複習（VocabWordSearch）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| 方格遊戲 | 純前端 | ✅ |
| 詞語資料 | 本地 YAML | ✅ |

**完全離線可用** ✅

---

### Step 9：知識補給站（KnowledgeStation）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| YouTube 影片嵌入 | YouTube iframe | ❌ **需要網路** |

**離線不能用**。需要預先下載影片或改用本地影片檔

---

### Step 10：報告（AssessmentReport）

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| 分數計算 | 本地邏輯 | ✅ |
| AI 分析 | Gemini（AIAnalysisSection） | ❌ → ✅ **Gemma 4 可取代** |
| 圖表顯示 | 本地 Recharts | ✅ |

---

## 全站共用依賴

| 依賴 | 服務 | 離線能用？ |
|------|------|-----------|
| Google Fonts（cwTeXYen, Noto Sans TC） | fonts.googleapis.com | ❌ → ✅ 改成自架字體檔就好 |
| Google OAuth 登入 | Google API | ❌ **需要網路**。離線改用帳密登入 |
| GCS TTS cache | Cloud Storage | ❌ → ✅ 預先下載 mp3 到本地 |
| Cloud SQL 資料庫 | PostgreSQL | ✅ 本地裝 PostgreSQL 就好 |
| Vertex AI API | Gemini | ❌ → ✅ Gemma 4 取代 |

---

## 總結：Gemma 4 能取代什麼，不能取代什麼

### ✅ Gemma 4 能取代的

| 功能 | 現在用 | Gemma 4 取代 | 品質影響 |
|------|--------|-------------|---------|
| 蘇格拉底對話 | Gemini 2.5 Flash | Gemma 4 31B/E4B | ⚠️ 品質下降，繁體中文待驗證 |
| 出場券出題 | Gemini | Gemma 4 | ⚠️ 品質下降 |
| AI 朗讀分析 | Gemini | Gemma 4 | ⚠️ 品質下降 |
| 造句例句生成 | Gemini | Gemma 4 | ⚠️ 品質下降 |

### ❌ Gemma 4 不能取代的

| 功能 | 現在用 | 為什麼不能取代 | 離線替代方案 |
|------|--------|---------------|-------------|
| **STT 語音辨識** | Web Speech API（Chrome） | Gemma 4 不是即時串流 STT | Whisper（另外部署） |
| **TTS 語音合成** | Azure zh-TW Neural | Gemma 4 不做語音合成 | 預先生成 mp3 cache / Piper TTS |
| **YouTube 影片** | YouTube iframe | 第三方影片服務 | 預先下載影片到本地 |
| **Google OAuth** | Google API | 需要 Google server | 改用帳密登入 |
| **教育部字典** | moedict.tw API | 第三方 API | 預先 cache 字典資料 |
| **Google Fonts** | CDN | 需要外網 | 字體檔打包進前端 |

### 離線可用性總覽

| 步驟 | 不需改動就能離線 | 需要替代方案 | 完全不能離線 |
|------|----------------|------------|------------|
| 1 讀全文做記號 | 標記功能 | TTS（預先 cache） | — |
| 2 逐段朗讀 | 錄音、比對、鼓勵 | — | **STT**、TTS |
| 3 全文朗讀 | 錄音、比對 | — | **STT** |
| 4 生字練習 | 部件拆解、筆順、注音 | 字典（cache） | — |
| 5 詞語定義 | 全部 ✅ | — | — |
| 6 語詞應用 | 全部 ✅ | — | — |
| 7 課文理解 | — | AI 對話（Gemma 4） | STT 語音輸入（選用） |
| 8 語詞複習 | 全部 ✅ | — | — |
| 9 知識補給站 | — | — | **YouTube 影片** |
| 10 報告 | 分數計算、圖表 | AI 分析（Gemma 4） | — |

---

## 離線模式完整配套（不只是 AI）

換 AI model 只是離線的 1/5。整個系統要離線，要處理五個層面：

### 1. AI 模型層

| 雲端 | 離線替代 | 工程量 |
|------|---------|--------|
| Gemini 2.5 Flash | Gemma 4（本地 GPU） | 中 — 改 ai_service.py 的 endpoint |

### 2. 語音層（最大瓶頸）

| 雲端 | 離線替代 | 工程量 |
|------|---------|--------|
| Web Speech API（STT） | Whisper（本地 STT server） | **大** — 需要額外部署 + 改前端 STT 接口 |
| Azure TTS（語音合成） | 預生成 mp3 已有 2413 句 cache | 小 — 打包 GCS mp3 到本地檔案系統 |
| Azure TTS（新課文） | Piper TTS 或 Coqui TTS（本地） | 中 — 需要額外部署 |

**STT 是離線最大的技術障礙**。沒有 STT，Step 2（逐段朗讀）和 Step 3（全文朗讀）的核心功能——「學生唸、系統聽、即時比對」——完全不能用

### 3. 資料層

目前 20+ 個 DB 表在 Cloud SQL，離線要處理：

**不需要遷移的（已在 Git repo）：**
- 57 篇課文 YAML（~1MB）
- example_sentence_cache.json（~489KB）
- 部件拆解 JSON（~400KB）
- 字體檔 Iansui + BpmfIansui

**需要預處理打包的：**

| 資料 | 大小 | 處理方式 |
|------|------|---------|
| TTS mp3 cache | ~240MB | 從 GCS 下載整包，放進本地檔案系統 |
| 字典 cache | ~幾 MB | 從 moedict.tw 預先爬取所有生字，存 JSON |
| 知識補給站影片 | 每支 ~50MB | 從 YouTube 預先下載（或改用本地影片） |
| Google Fonts | ~2MB | 改成本地字體檔（cwTeXYen, Noto Sans TC） |

**需要本地 DB 的：**

| 資料 | 說明 | 處理方式 |
|------|------|---------|
| User 帳號 | 老師/學生帳號 | 本地 PostgreSQL，第一次由老師建立 |
| School/Classroom | 學校班級 | 本地建立，不需要跟雲端同步 |
| LearningSession | 學習紀錄 | 本地儲存，**如果將來要上雲端需要同步機制** |
| Assignment | 作業 | 本地建立 |
| Gamification (XP/Badge/Streak) | 遊戲化 | 本地儲存 |
| AIUsageLog | AI 使用紀錄 | 本地儲存（離線不需要計費） |

**最關鍵的問題：雲端 ↔ 離線的資料同步**
- 如果學校先用雲端版，之後想切離線，學生進度怎麼搬？
- 如果離線用了一段時間，又想回雲端，資料怎麼合併？
- 目前沒有同步機制，需要額外開發

### 4. 認證層

| 雲端 | 離線替代 | 工程量 |
|------|---------|--------|
| Google OAuth | 不能用，改純帳密登入 | 小 — 已有帳密登入，只是離線不能用 Google |
| JWT token | 本地簽發就好 | 零 — 已經是本地簽發 |
| email 驗證 | 不能發信，auto-verify | 零 — 已有 flag 控制 |

### 5. 前端資源層

| 資源 | 離線處理 |
|------|---------|
| Google Fonts CDN | 字體檔打包進 `frontend/public/fonts/`（cwTeXYen 還沒本地化） |
| YouTube iframe | 換成 `<video>` 標籤播本地影片 |
| CSP header | 拿掉外部 domain 白名單 |
| `VITE_API_URL` | 改成本地 server IP |

---

## 離線部署包的完整清單

如果要做一個「USB 帶去學校就能用」的部署包：

```
lingoleap-offline/
├── docker-compose.yml          # 一鍵啟動所有服務
├── backend/                    # FastAPI server
├── frontend/dist/              # 靜態前端檔案
├── models/
│   └── gemma-4-e4b.gguf       # ~5GB AI 模型
├── whisper/
│   └── whisper-large-v3.bin    # ~3GB STT 模型（如果要離線朗讀）
├── data/
│   ├── lessons/                # 57 篇課文 YAML
│   ├── tts-cache/              # ~240MB 預生成 mp3
│   ├── dictionary-cache.json   # 預爬字典資料
│   ├── videos/                 # 知識補給站影片（可選）
│   └── fonts/                  # cwTeXYen + Noto Sans TC
├── postgres/
│   └── init.sql                # DB schema + 初始資料
└── README.md                   # 安裝說明
```

**預估總大小**：~10GB（AI 模型 5GB + STT 模型 3GB + TTS cache 240MB + 其他）
**預估 USB 大小**：16GB 就夠

---

## 結論

**Gemma 4 只解決了離線的 1/5**

| 層面 | 佔離線工程量 | Gemma 4 解決？ |
|------|------------|---------------|
| AI 模型 | 20% | ✅ |
| STT 語音辨識 | **30%** | ❌ 需要 Whisper |
| TTS 語音合成 | 10% | ⚠️ 靠預生成 cache |
| 資料層（DB/檔案） | 25% | ❌ 需要打包工具 |
| 認證/前端資源 | 15% | ❌ 需要改設定 |

**不是裝一個 Gemma 4 就能離線用。要五個層面都處理好才行**

如果真的要做離線版，建議分階段：

| 階段 | 做什麼 | 離線能用的步驟 |
|------|--------|-------------|
| Phase 1 | Gemma 4 + 預生成資料打包 | Step 4-8（不需要語音的步驟全通） |
| Phase 2 | 加 Whisper STT | Step 2-3（朗讀功能恢復） |
| Phase 3 | 加本地 TTS + 影片下載 | Step 1, 9（完整 10 步驟） |
| Phase 4 | 雲端 ↔ 離線同步機制 | 混合模式（平時雲端，斷網自動切離線） |
