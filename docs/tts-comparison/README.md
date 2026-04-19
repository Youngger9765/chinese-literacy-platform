# TTS 語音比較測試 — L01 贏得喝采的輸家

4/17 會議決議評估新 TTS 方案，以下是三種 TTS 引擎的比較音檔

## 試聽音檔

### 第一段（76 字）
> 「戴資穎戴資穎第一名，戴資穎戴資穎我愛妳~~~」這一句洗腦的廣告臺詞，是否也在你的周遭出現？她就是台灣第一人，累計214周排名世界第一的球后──戴資穎。

| 引擎 | 公司 | Voice | 下載 |
|------|------|-------|------|
| **Azure Speech**（現行 primary） | Microsoft | zh-TW-HsiaoChenNeural | [L01-para1-azure.mp3](L01-para1-azure.mp3) |
| **Chirp3-HD**（現行 fallback） | Google | cmn-CN-Chirp3-HD-Sulafat | [L01-para1-chirp3hd.mp3](L01-para1-chirp3hd.mp3) |
| **Gemini 3.1 Flash TTS**（候選） | Google | Aoede | [L01-para1-gemini31flash.mp3](L01-para1-gemini31flash.mp3) |

### 全文（707 字，5 段）

| 引擎 | 下載 |
|------|------|
| **Gemini 3.1 Flash TTS** | [L01-full-gemini31flash.mp3](L01-full-gemini31flash.mp3) |

> Azure 和 Chirp3-HD 全文版需切句拼接，暫未生成

## 比較數據

### 第一段（76 字）

| 指標 | Azure HsiaoChen | Chirp3-HD Sulafat | Gemini 3.1 Flash |
|------|-----------------|-------------------|------------------|
| 檔案大小 | 381 KB | 79 KB | 150 KB |
| 句子限制 | 無（SSML） | 有，~40 字要切句 | 無 |
| 格式 | MP3（48kHz/192kbps） | MP3 | L16 PCM → MP3（24kHz） |
| 即時速度 | ~1-2s | ~3s（切 2 句） | ~10s |
| 口音 | 台灣腔 | 中國腔（偏中性） | 待評估 |

### 成本估算（57 篇課文，約 40,000 字）

| 引擎 | 單價 | 57 篇全量預生成 | 月即時 5000 句 |
|------|------|-----------------|---------------|
| **Azure** | ~$16/1M chars | ~$0.64 | ~$0.80 |
| **Chirp3-HD** | $0.16/1K chars | ~$6.40 | ~$8.00 |
| **Gemini 3.1 Flash** | ~$0.10/1M tokens | ~$0.01 | ~$0.01 |

## 已發現的差異

### 特殊符號處理
原文有 `~~~`（波浪符），三個引擎處理方式不同：

| 引擎 | 處理方式 |
|------|---------|
| **Azure** | 後端 `_clean_for_tts()` 已過濾，不影響 |
| **Chirp3-HD** | 直接念出來（會聽到奇怪發音） |
| **Gemini 3.1 Flash** | 自動忽略 |

> 後端 `_clean_for_tts()` 會在生成前過濾 `~~~`，但 GCS 裡舊 cache（2419 句）是在加過濾之前產生的，部分帶著錯誤發音

### 句子長度限制
| 引擎 | 限制 | 影響 |
|------|------|------|
| **Azure** | 無（SSML 支援長文本） | 語氣連貫 |
| **Chirp3-HD** | ~40 字上限，超過 400 error | 需切句拼接，拼接處語氣斷裂 |
| **Gemini 3.1 Flash** | 無 | 整段丟進去，語氣連貫 |

### 即時生成可行性
| 引擎 | 76 字 | 適合即時？ |
|------|-------|-----------|
| **Azure** | ~1-2s | ✅ 可以即時 |
| **Chirp3-HD** | ~3s（含切句） | ⚠️ 勉強 |
| **Gemini 3.1 Flash** | ~10s | ❌ 必須預生成 |

## 請幫忙評估

1. **自然度**：哪個聽起來最像真人在念課文？
2. **抑揚頓挫**：哪個有情感起伏，不是平平的念？
3. **台灣口音**：哪個最接近台灣國語？
4. **咬字清晰度**：學生聽得懂嗎？
5. **整體偏好**：如果要給小學生聽，你選哪個？

## 相關 Issue
- [#1107 — 評估 Gemini 3.1 Flash TTS 取代 Chirp3-HD](https://github.com/Youngger9765/chinese-literacy-platform/issues/1107)
