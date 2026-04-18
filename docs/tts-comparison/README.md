# TTS 語音比較測試 — L01 贏得喝采的輸家

4/17 會議決議評估新 TTS 方案，以下是三種 TTS 引擎的比較音檔

## 試聽音檔

### 第一段（76 字）
> 「戴資穎戴資穎第一名，戴資穎戴資穎我愛妳~~~」這一句洗腦的廣告臺詞，是否也在你的周遭出現？她就是台灣第一人，累計214周排名世界第一的球后──戴資穎。

| 引擎 | 下載 |
|------|------|
| **Chirp3-HD Sulafat**（現行） | [L01-para1-chirp3hd.mp3](L01-para1-chirp3hd.mp3) |
| **Gemini 2.5 Flash TTS** | [L01-para1-gemini25flash.mp3](L01-para1-gemini25flash.mp3) |
| **Gemini 3.1 Flash TTS**（最新） | [L01-para1-gemini31flash.mp3](L01-para1-gemini31flash.mp3) |

### 全文（707 字，5 段）

| 引擎 | 下載 |
|------|------|
| **Gemini 2.5 Flash TTS** | [L01-full-gemini25flash.mp3](L01-full-gemini25flash.mp3) |
| **Gemini 3.1 Flash TTS**（最新） | [L01-full-gemini31flash.mp3](L01-full-gemini31flash.mp3) |

> Chirp3-HD 全文版因句子長度限制需切句拼接，暫未生成

## 比較數據

### 第一段（76 字）

| 指標 | Chirp3-HD Sulafat | Gemini 2.5 Flash | Gemini 3.1 Flash |
|------|-------------------|------------------|------------------|
| 生成時間 | 3.29s（切 2 句） | 12.88s | 10.71s |
| 檔案大小 | 79 KB | 764 KB | 808 KB |
| 句子限制 | 有，太長要切句 | 沒有 | 沒有 |
| 格式 | MP3 | MP3 | L16 raw → MP3 |

### 全文（707 字）

| 指標 | Gemini 2.5 Flash | Gemini 3.1 Flash |
|------|------------------|------------------|
| 生成時間 | 49.3s | 68.1s |
| 檔案大小 | 6.3 MB | 6.5 MB |

### 成本估算（57 篇課文，約 40,000 字）

| 引擎 | 單價 | 57 篇全部 |
|------|------|-----------|
| Chirp3-HD | $0.160 / 1K 字 | ~$6.40 |
| Gemini 2.5 Flash TTS | ~$0.10 / 1M tokens | ~$0.01 |
| Gemini 3.1 Flash TTS | ~$0.10 / 1M tokens | ~$0.01 |

## 請幫忙評估

1. **自然度**：哪個聽起來最像真人在念課文？
2. **抑揚頓挫**：哪個有情感起伏，不是平平的念？
3. **台灣口音**：哪個最接近台灣國語？
4. **咬字清晰度**：學生聽得懂嗎？
5. **整體偏好**：如果要給小學生聽，你選哪個？

## 相關 Issue
- [#1107 — 評估 Gemini 3.1 Flash TTS 取代 Chirp3-HD](https://github.com/Youngger9765/chinese-literacy-platform/issues/1107)
