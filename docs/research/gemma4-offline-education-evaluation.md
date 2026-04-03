# Gemma 4 離線教育部署評估

> 研究日期：2026-04-03
> 觸發來源：冠緯提出 Gemma 4 開源模型 + 方大哥之前問過離線可能性
> 用途：評估 Gemma 4 對 LingoLeap 的適用性，特別是偏鄉離線場景

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

## 三、離線部署場景分析（方大哥關注）

### 偏鄉學校部署方式

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

| 設備 | VRAM | 價格 | 能跑？ |
|------|------|------|--------|
| 學校舊桌機（無獨顯） | 0 | 免費 | ❌ |
| RTX 3060（二手） | 8-12GB | ~NT$7,000 | ✅ E2B/E4B |
| MacBook M2/M3 | 8-16GB | 已有就免費 | ✅ E2B/E4B |
| 一台新電腦 + RTX 3060 | 12GB | NT$30,000-50,000 | ✅ |
| RTX 4090 | 24GB | ~NT$55,000 | ✅ 跑更大模型 |

### 其他限制

- E2B 品質約 ChatGPT 3.5 等級，不是 GPT-4
- 離線 = 模型不會自動更新，要手動帶新版本去
- 第一次需要有人去安裝設定
- 學校 WiFi 爛的話，即使是 LAN 也可能受影響（建議有線網路）

---

## 四、我的判斷：現階段策略

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

## 五、給冠緯的故事（如果要跟數發部報告）

> 一顆 USB、一台 5 萬元的電腦，就能讓偏鄉學校有自己的 AI 老師。不需要網路，不需要月費，學生資料不出教室。我們不是買別人的服務，是帶能力到偏鄉

打中的點：
1. **數位平權** — 偏鄉也能用 AI
2. **資料主權** — 不依賴外國雲端
3. **成本極低** — 政府預算好編
4. **技術自主** — 「建自己的能力」不是「買別人的服務」

---

## 六、與方大哥之前的需求關聯

方大哥之前問過離線可能性。Gemma 4 讓這件事變得可行

但要誠實跟方大哥說：
- 離線版的 AI 品質比不上雲端版（E2B ≈ ChatGPT 3.5 等級）
- 蘇格拉底對話的深度和中文流暢度會下降
- 適合當 fallback，不適合當主力

**建議跟方大哥的溝通方式**：
> 離線功能技術上可行了（感謝 Gemma 4），但品質會下降。建議先把雲端版做到最好，Beta 後再加離線模式當備援

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
