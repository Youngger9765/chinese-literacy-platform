# Gemma 4 離線教育部署評估

> 研究日期：2026-04-03
> 用途：評估 Gemma 4 對 LingoLeap 的適用性，特別是偏鄉離線場景和資料隱私需求

---

## 一、Gemma 4 是什麼

Google 把 Gemini 技術的開源版本，Apache 2.0 授權，免費商用

| | Gemini | Gemma 4 |
|---|---|---|
| 誰能用 | 付費 API | 任何人免費 |
| 跑在哪 | Google 雲端 | 自己的電腦 |
| 資料去哪 | 送到 Google（GCP 專案內） | 不出你的機器 |
| 授權 | 商業 API | Apache 2.0（賣也行） |

### 四款模型

| 模型 | 參數 | VRAM 需求 | 適合跑在 |
|------|------|----------|---------|
| E2B | 2.3B | ~2GB | MacBook / 8GB 顯卡 |
| E4B | 4.5B | ~4GB | 12GB 顯卡 |
| 26B MoE | 26B (active 4B) | ~18GB | 伺服器 40GB 顯卡 |
| 31B Dense | 31B | ~20GB | 伺服器 40GB 顯卡 |

### 多模態能力

文字、圖片、影片、語音（E2B/E4B）、Function calling 全支援

---

## 二、LingoLeap 現況 vs Gemma 4

### 目前架構

```
LingoLeap → Vertex AI API → Gemini 2.5 Flash（雲端）
```

- 月費估計：<$50（現在用量不大）
- 零運維（serverless）
- 中文品質：優秀
- 需要網路：是

### Gemma 4 方案

```
LingoLeap → 本地/GKE GPU → Gemma 4（自架）
```

- 初始成本：NT$30,000-50,000（一台有顯卡的電腦）或 $490/月（GCP L4 GPU）
- 月費：$0（本地）或 $490+（GCP）
- 中文品質：未驗證，預期低於 Gemini
- 需要網路：不需要（本地部署）

### 品質比較

| 用途 | Gemini 2.5 Flash | Gemma 4 31B | Gemma 4 E2B |
|------|-----------------|-------------|-------------|
| 蘇格拉底對話（中文） | ★★★★★ | ★★★☆☆（預估） | ★★☆☆☆（預估） |
| 出場券出題 | ★★★★★ | ★★★☆☆ | ★★☆☆☆ |
| JSON 結構輸出 | 穩定 | 新功能，待驗證 | 可能不穩 |
| 繁體中文 | 優秀 | 未驗證 | 未驗證 |

**結論：品質上 Gemini 仍然大幅領先，特別是繁體中文教育場景**

---

## 三、離線部署場景分析

### 兩個維度：網路環境 × 運算架構

**維度一：學校的網路環境**

| 環境 | 說明 | 台灣常見？ |
|------|------|-----------|
| 🌐 有外網 | 正常上網，連 Google/API 沒問題 | 都市學校 |
| 🏫 只有內網 | 校內 LAN 通，但外網慢/受限/政策不允許資料出校園 | TANet 限速、隱私要求高的學校 |
| 🏔️ 完全離線 | 沒有任何網路 | 偏鄉小校 |

**維度二：AI 運算架構**

| 架構 | 說明 | 適合 |
|------|------|------|
| ☁️ 雲端 API | 用 Gemini API，運算在 Google | 有外網的學校 |
| 🖥️ 集中式 server | 學校一台 GPU server，其他設備當 thin client | 有內網的學校（最實際） |
| 💻 分散式 edge | 每台設備自己跑小模型 | 老師帶 MacBook 的場景 |

**組合起來：**

| 網路環境 | 推薦架構 | AI 模型 | 說明 |
|---------|---------|---------|------|
| 🌐 有外網 | ☁️ 雲端 API | Gemini 2.5 Flash | 最簡單，品質最好，按量付費 |
| 🏫 只有內網 | 🖥️ 集中式 server | Gemma 4 (E4B~31B) | 機房一台 server，教室 Chromebook 連 |
| 🏔️ 完全離線 | 🖥️ 集中式 server | Gemma 4 E2B | USB 帶模型去，裝一台電腦當 server |
| 🏔️ 完全離線（極簡） | 💻 分散式 edge | Gemma 4 E2B | 老師 MacBook 自己跑，學生圍過來看 |

---

### 集中式 server 架構（最實際的本地部署方案）

```
學校機房
  一台 server（有 GPU）
  跑 Gemma 4 + LingoLeap 後端
      ↑
      │ 校內 LAN（有線/WiFi）
      ↓
教室 1: 30 台 Chromebook ← 只開瀏覽器
教室 2: 30 台舊桌機 ← 只開瀏覽器
教室 3: 學生自帶平板 ← 只開瀏覽器
```

所有 AI 運算在 server，client 只負責顯示網頁（thin client）

**為什麼這是最實際的方案：**
- 學校只花一次錢買 server（NT$50,000-150,000 看規模）
- 教室設備不用升級，能開瀏覽器就行
- IT 只管一台機器，不用跑每間教室裝軟體
- Server 夠強可以跑更大模型（31B），品質更好
- 雙 4090 或 A100 可以同時服務整棟大樓

**跟現有架構的關係：**

跟我們現在的 Cloud Run 部署是同一個架構，只是 server 從 Google 雲端搬到學校機房。前端程式碼完全不用改，只需要把 `VITE_API_URL` 從 Cloud Run URL 改成學校 server 的內網 IP

| 項目 | 現在（Cloud Run） | 校內 server |
|------|------------------|------------|
| server 位置 | Google 雲端 | 學校機房 |
| AI 模型 | Gemini 2.5 Flash | Gemma 4 |
| 網路需求 | 外網 | 內網就夠 |
| 前端改動 | - | 只改一個環境變數 |
| 資料流向 | 經過 Google | 不出校園 |

---

### 偏鄉完全離線部署

```
事前（有網路的地方）：
  下載 Gemma 4 模型 → USB 隨身碟（~5GB）

帶到偏鄉學校：
  USB 插電腦 → 複製模型 → 啟動 server

教室內：
  30 台電腦 → 校內 LAN → 這台 server
  全程不需要外部網路
```

### 痛點解決

| 偏鄉痛點 | 雲端 AI (Gemini) | 本地 Gemma 4 |
|---------|-----------------|-------------|
| 沒網路 | ❌ 不能用 | ✅ 離線可用 |
| 網路慢 | 卡到不能用 | ✅ 不需網路 |
| 沒預算付 API | ❌ 每月要錢 | ✅ 免費 |
| 學生資料隱私 | 送到 GCP | ✅ 不出教室 |

### 吞吐量限制（誠實面對）

| 模型 | GPU | 單次回應 | 30 人排隊 |
|------|-----|---------|----------|
| E2B (2.3B) | RTX 3060 | ~2-3 秒 | 最後一人 ~90 秒 |
| E4B (4.5B) | RTX 4090 | ~3-5 秒 | 最後一人 ~150 秒 |

30 人同時做蘇格拉底對話會卡。但實際上不會 30 人同秒按送出

### 硬體需求

**學生端（client）— 什麼設備都行，只需要開瀏覽器**

| 設備 | 能用？ | 說明 |
|------|--------|------|
| Chromebook | ✅ | 開瀏覽器連 server |
| iPad | ✅ | 開瀏覽器連 server |
| Android 平板 | ✅ | 開瀏覽器連 server |
| 10 年前的舊桌機 | ✅ | 開瀏覽器連 server |
| 手機 | ✅ | 開瀏覽器連 server |

學生設備不需要 GPU，不需要安裝任何東西，只要能開網頁

**Server 端（跑 Gemma 4 的那台）— 需要 GPU**

| 設備 | VRAM | 價格 | 能跑？ |
|------|------|------|--------|
| Chromebook | 0 | - | ❌ 沒有 GPU |
| iPad / 平板 | 0 | - | ❌ 沒有 GPU |
| 學校舊桌機（無獨顯） | 0 | 免費 | ❌ |
| RTX 3060（二手） | 8-12GB | ~NT$7,000 | ✅ E2B/E4B |
| MacBook M2/M3 | 8-16GB（統一記憶體） | 已有就免費 | ✅ E2B/E4B |
| 一台新電腦 + RTX 3060 | 12GB | NT$30,000-50,000 | ✅ |
| RTX 4090 | 24GB | ~NT$55,000 | ✅ 跑更大模型 |

### 集中式 vs 分散式

```
集中式（Hub + Strong Server）
  一台強 server 負責所有 AI 運算
  其他設備都是 thin client（瀏覽器）

  [教室 Chromebook] ──┐
  [教室 Chromebook] ──┤
  [教室 平板]       ──┼── LAN ──→ [機房 GPU Server]
  [教室 舊桌機]     ──┤              跑 Gemma 4
  [老師 筆電]       ──┘              跑 LingoLeap

  ✅ 集中管理、可用大模型、client 零要求
  ❌ server 掛了全校停擺、需要 LAN

分散式（每台自己跑）
  每台設備自己跑小模型

  [MacBook M2 跑 E2B]     獨立運作
  [有 GPU 的桌機 跑 E2B]  獨立運作
  [老師筆電 跑 E2B]       獨立運作

  ✅ 不依賴網路、不依賴 server、一台壞不影響別台
  ❌ 每台都要有 GPU、只能跑小模型（品質低）、管理困難
```

**教育場景用集中式比較實際**：
- 學校的設備多是 Chromebook/平板/舊桌機，沒有 GPU
- IT 管一台比管 30 台容易
- 集中式可以跑更大模型，品質更好
- 分散式只有在「老師帶自己的 MacBook」這種場景才合理

### 不同規模學校的具體做法

| 場景 | 網路 | server | 模型 | 預算 | 適合 |
|------|------|--------|------|------|------|
| **都市學校** | 外網穩定 | 不需要（用 Cloud Run） | Gemini 2.5 Flash | ~$50/月 API | 大多數學校 |
| **有內網的學校** | 校內 LAN | 機房一台 RTX 3060 桌機 | Gemma 4 E2B/E4B | NT$30,000-50,000 一次 | 重視隱私或外網不穩 |
| **中型學校（多班同時用）** | 校內 LAN | 機房一台 RTX 4090 或雙 3060 | Gemma 4 26B MoE | NT$80,000-150,000 一次 | 3-5 班同時上課 |
| **偏鄉小校** | 完全離線 | USB 帶一台舊筆電 + 外接 GPU | Gemma 4 E2B | NT$15,000-30,000 | 10 人以下小校 |
| **縣市教育處集中部署** | 教育網路 TANet | 教育處機房 A100 server | Gemma 4 31B | NT$300,000+ | 全縣/市學校共用 |

**各場景詳細說明：**

**都市學校（最簡單）**
- 直接用現在的 Cloud Run 架構，不需要任何改動
- 老師學生開瀏覽器就用，IT 不需要介入
- 費用跟著用量走，用少付少

**有內網的學校（最常見的升級需求）**
- 學校 IT 在機房裝一台有 GPU 的電腦
- 用 Docker 跑 LingoLeap + Gemma 4（一行指令啟動）
- 所有教室 Chromebook/平板透過內網連
- 資料不出校園，符合隱私政策

**中型學校（多班同時）**
- RTX 4090 或雙 3060，跑 26B MoE 模型（品質更好）
- 可以同時服務 3-5 個班，約 100-150 人
- 需要有基礎 IT 能力的人維護

**偏鄉小校（完全離線）**
- USB 帶模型去，裝在任何有 GPU 的電腦上
- 10 人以下的小校用 E2B 就夠
- 不需要任何網路，裝好就用
- 缺點：品質最低（E2B ≈ ChatGPT 3.5），不會自動更新

**縣市集中部署（規模化）**
- 教育處機房放一台 A100 server
- 全縣/市學校透過 TANet 教育網路連上
- 跑最大的 31B 模型，品質接近雲端
- 一次投資，全縣共用，邊際成本趨近零

### 其他限制

- E2B 品質約 ChatGPT 3.5 等級，不是 GPT-4
- 離線 = 模型不會自動更新，要手動帶新版本去
- 第一次需要有人去安裝設定
- 學校 WiFi 爛的話，即使是 LAN 也可能受影響（建議有線網路）

---

## 四、現階段策略

### 短期（現在～Beta）：繼續用 Gemini 2.5 Flash

- 品質最好、成本最低（我們用量小）、零運維
- 專注把產品做到位，不要分心搞基礎建設

### 中期（Beta 後）：預留 Gemma 4 接口

- 在 `ai_service.py` 預留模型切換能力（已有 model 參數）
- 架構上不綁死 Vertex AI API，讓 self-hosted endpoint 可以替換

### 長期（規模化 / 偏鄉部署）：混合架構

```
正常情況 → Gemini API（品質好、便宜）
網路斷了 → fallback 到本地 Gemma 4（品質差但能用）
隱私要求 → 強制走本地
偏鄉學校 → USB 部署包，完全離線
```

### 切換時機

| 條件 | 動作 |
|------|------|
| 月 token > 5000 萬 | 評估自架成本 |
| 台灣立法要求資料不出境 | 啟動本地部署 |
| 偏鄉學校試點 | 準備 USB 部署包 |
| Gemma 4 中文品質追上 Gemini | 重新評估替換 |

---

## 五、對外溝通角度（如果要跟數發部報告）

> 一顆 USB、一台 5 萬元的電腦，就能讓偏鄉學校有自己的 AI 老師。不需要網路，不需要月費，學生資料不出教室。我們不是買別人的服務，是帶能力到偏鄉

打中的點：
1. **數位平權** — 偏鄉也能用 AI
2. **資料主權** — 不依賴外國雲端
3. **成本極低** — 政府預算好編
4. **技術自主** — 「建自己的能力」不是「買別人的服務」

---

## 六、離線功能的取捨

離線部署技術上可行了，但需要誠實面對品質取捨：
- 離線版的 AI 品質比不上雲端版（E2B ≈ ChatGPT 3.5 等級）
- 蘇格拉底對話的深度和中文流暢度會下降
- 適合當 fallback，不適合當主力

**策略**：先把雲端版做到最好，Beta 後再加離線模式當備援

---

## 七、參考資料

| 資源 | 連結 |
|------|------|
| Gemma 4 官方公告 | https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ |
| Gemma 4 on Google Cloud | https://cloud.google.com/blog/products/ai-machine-learning/gemma-4-available-on-google-cloud |
| Gemma 4 Model Card | https://ai.google.dev/gemma/docs/core/model_card_4 |
| Gemma 4 Function Calling | https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4 |
| Vertex AI 定價 | https://cloud.google.com/vertex-ai/generative-ai/pricing |
| llama.cpp (本地推理) | https://github.com/ggml-org/llama.cpp |
| vLLM 部署指南 | https://docs.vllm.ai/projects/recipes/en/latest/Google/Gemma4.html |
| NVIDIA Edge 部署 | https://developer.nvidia.com/blog/bringing-ai-closer-to-the-edge-and-on-device-with-gemma-4/ |
