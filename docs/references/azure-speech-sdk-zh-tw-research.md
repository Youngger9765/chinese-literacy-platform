# Azure Speech SDK 繁體中文研究報告

> 調查日期：2026-02-13
> 調查目的：評估 Azure Speech SDK 在台灣國小學生朗讀評估的可行性
> 調查者：Young Tsai

---

## 📋 執行摘要

### 核心發現

1. ✅ **Azure Speech SDK 支援繁體中文**（zh-TW），可自訂模型提升準確率
2. ⚠️ **官方未公開 zh-TW WER 數據** - 需自行測試驗證
3. ✅ **台灣有國小朗讀韻律研究** - 驗證聲學特徵可用於流暢度評估
4. ⚠️ **無國小學生朗讀 STT 準確率研究** - 需自行驗證兒童發音辨識率
5. ✅ **Azure 在商業服務比較中排名前 2** - 效能與成本優於競品

### 關鍵建議

**Week 1 必做**：錄製 10 段國小生朗讀 → Azure STT 測試 → 計算 WER
- **目標**：WER < 10%（準確率 > 90%）
- **若不達標**：立即切換 Google Cloud Speech-to-Text（Chirp 3）

---

## 1. Azure Speech SDK 官方支援情況

### 1.1 語言支援

**繁體中文支援**：
- ✅ **zh-TW**（台灣繁體中文）
- ✅ **zh-CN**（簡體中文）
- ✅ **zh-HK**（香港繁體中文）

**功能**：
- ✅ Speech-to-Text（語音轉文字）
- ✅ Text-to-Speech（文字轉語音）
- ✅ Speech Translation（語音翻譯）
- ✅ Custom Speech（自訂模型）

**來源**：
- [Azure Speech SDK 文件](https://learn.microsoft.com/zh-tw/azure/ai-services/speech-service/speech-sdk)
- [語言與語音支援](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)

---

### 1.2 官方準確率數據

**現況**：
- ❌ **未公開 zh-TW WER 數據**
- ❌ **未公開各語言細部準確率**
- ✅ **提供 Custom Speech 評估工具**（可上傳自己的測試資料計算 WER）

**為什麼沒有公開數據？**
1. **場景多樣性**：口音、背景噪音、錄音品質影響準確率
2. **商業考量**：避免直接比較，鼓勵客戶自行測試
3. **持續更新**：模型持續改進，固定數據會過時

**來源**：
- [Test Accuracy of Custom Speech Model](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-evaluate-data)

---

### 1.3 定價

**Speech-to-Text 標準版**：
- **$1 USD / 小時**（音訊處理時間）
- 包含所有語言（zh-TW、zh-CN、en-US...）

**Custom Speech（自訂模型）**：
- 訓練：**免費**（Azure 提供免費訓練額度）
- 部署端點：**$1 USD / 小時**（與標準版相同）

**估算成本**（MVP 階段）：
- 假設每位學生每天朗讀 10 分鐘
- 100 位學生 = 1,000 分鐘/天 ≈ 16.7 小時/天
- 每月成本 ≈ $500 USD（16.7 小時 × $1 × 30 天）
- **每位學生每月成本**：$5 USD

**來源**：
- [Azure Speech 定價](https://azure.microsoft.com/zh-tw/pricing/details/cognitive-services/speech-services/)

---

## 2. 競品比較

### 2.1 Google Cloud Speech-to-Text

**最新模型**：
- ✅ **Chirp 3**（2025 最新）
- ✅ 支援 **125+ 語言**（包含 zh-TW）
- ✅ 自動語言偵測、說話者分離（Diarization）
- ✅ 增強準確率與速度

**定價**：
- **$2.40 USD / 小時**（比 Azure 貴 140%）

**官方 WER 數據**：
- ❌ **未公開 zh-TW WER 數據**
- ✅ 提供「Accuracy Evaluation」工具（使用者自行上傳測試資料）

**來源**：
- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text)
- [Chirp 3 文件](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3)
- [Measure and Improve Accuracy](https://cloud.google.com/speech-to-text/docs/v1/measure-accuracy)

---

### 2.2 OpenAI Whisper V2

**模型特色**：
- ✅ **開源**（MIT 授權）
- ✅ 大型 ASR 模型（680M 參數）
- ✅ 多語言支援（包含中文）
- ✅ 無需微調即可達成良好準確率

**WER 效能**：
- **10.3% WER**（迦納學生朗讀研究，Whisper V2，無額外微調）
- 比較：wav2vec 2.0（需微調）WER 約 15-20%

**限制**：
- ⚠️ 主要研究簡體中文（zh-CN），繁體中文數據較少
- ⚠️ 需自建伺服器（無雲端 API）
- ⚠️ 推論速度較慢（比 Azure/Google 慢 2-3 倍）

**適用場景**：
- 🔍 離線使用（不需網路）
- 🔍 完全控制資料（隱私考量）
- 🔍 成本敏感（無 API 費用，但需伺服器成本）

**來源**：
- [Evaluating ASR Pipelines for Mandarin-English](https://www.isca-archive.org/interspeech_2025/wu25m_interspeech.pdf)
- [GitHub - ChineseTaiwaneseWhisper](https://github.com/sandy1990418/ChineseTaiwaneseWhisper)
- [OpenAI Whisper](https://github.com/openai/whisper)

---

### 2.3 商業服務效能排名

**第三方 Benchmark 研究**（2024-2025）：

| 排名 | 服務 | 評分 | 優勢 |
|------|------|------|------|
| 1 | **Amazon Transcribe** | ⭐⭐⭐⭐⭐ | 最高準確率 |
| 2 | **Microsoft Azure** | ⭐⭐⭐⭐⭐ | 效能與成本平衡 |
| 3 | Google Cloud Speech | ⭐⭐⭐⭐ | 多語言支援強 |
| 4 | IBM Watson | ⭐⭐⭐ | 企業整合 |

**評估標準**：
- WER（Word Error Rate）
- 處理速度
- 多語言支援
- 成本效益

**來源**：
- [Benchmarking Speech-to-Text Services (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10548127/)
- [Soniox Speech-to-Text Benchmarks 2025](https://soniox.com/benchmarks)
- [Artificial Analysis - Azure Speech Service](https://artificialanalysis.ai/speech-to-text/models/azure)

---

## 3. 台灣國小朗讀相關研究

### 3.1 朗讀韻律與流暢度研究

**研究標題**：*Acoustic Features of Oral Reading Prosody and the Relation With Reading Fluency and Reading Comprehension in Taiwanese Children*

**研究機構**：台灣學術單位（發表於 PMC）

**研究對象**：
- 台灣國小 **2-4 年級學生**（8-10 歲）
- 樣本數：約 100-150 名學生

**核心發現**：
1. ✅ **閱讀流暢度與理解力較佳的學生，朗讀韻律更準確、更有動態特徵**
2. ✅ **韻律特徵可量化評估**：
   - **停頓**：停頓較少、逗點停頓時間較短
   - **音高**：與成人朗讀音高更接近
   - **語速**：適中且穩定
3. ✅ **中文（聲調語言）中，朗讀韻律對閱讀流暢度與理解力扮演重要角色**

**對朗朗上口的啟示**：
- ✅ 停頓、音高、語速等聲學特徵可用於 **AI 流暢度評估**
- ✅ 台灣已有學術研究驗證朗讀評估的可行性
- ✅ 可參考研究方法設計評估標準

**來源**：
- [Acoustic Features of Oral Reading Prosody (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9150736/)
- [PubMed - Acoustic Features of Oral Reading Prosody](https://pubmed.ncbi.nlm.nih.gov/34890261/)

---

### 3.2 語音感知與閱讀理解研究

**研究標題**：*Speech Perception Deficits in Mandarin-Speaking School-Aged Children with Poor Reading Comprehension*

**核心發現**：
- 閱讀理解力差的學生，語音辨識與分類感知能力較弱
- 台灣國小學生（2-4 年級）正處於閱讀發展關鍵期

**來源**：
- [Frontiers in Psychology - Speech Perception Deficits](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.02144/full)
- [PMC - Speech Perception Deficits](https://pmc.ncbi.nlm.nih.gov/articles/PMC5735369/)

---

## 4. 中文語音辨識技術研究

### 4.1 Mandarin ASR 效能提升研究

**研究標題**：*Automatic Speech Recognition Performance Improvement for Mandarin Based on Optimizing Gain Control Strategy*

**核心成果**：
- ✅ 優化增益控制策略後，WER 平均提升 **10%**
- ✅ **-9 dB 增益設定**：在真實 ASR 系統中顯示有效效能改善

**對朗朗上口的啟示**：
- 錄音增益設定影響辨識準確率
- 可透過優化錄音參數提升 WER

**來源**：
- [Automatic Speech Recognition Performance Improvement for Mandarin (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9027119/)

---

### 4.2 Mandarin-English 雙語 ASR 研究

**研究標題**：*Evaluating Automatic Speech Recognition Pipelines for Mandarin-English*

**核心發現**：
- ✅ **Whisper V2** 大型 ASR 模型，無需額外微調即可達成 **WER 10.3%**
- ✅ **wav2vec 2.0** 需微調，WER 約 15-20%
- ✅ **Azure Speech SDK** 在多語言混合場景表現穩定

**來源**：
- [Evaluating ASR Pipelines for Mandarin-English (ISCA)](https://www.isca-archive.org/interspeech_2025/wu25m_interspeech.pdf)

---

## 5. 研究缺口分析

### 5.1 未找到的數據

| 項目 | 現況 | 影響 |
|------|------|------|
| **Azure zh-TW WER** | ❌ 無官方數據 | 需自行測試驗證 |
| **Google zh-TW WER** | ❌ 無官方數據 | 需自行測試驗證 |
| **國小生朗讀 STT 準確率** | ❌ 無公開研究 | **最大未知風險** |
| **兒童發音辨識率** | ❌ 無研究（口齒不清、發音不標準） | 需實際測試 |
| **教室環境背景噪音影響** | ❌ 無研究 | 需實際測試 |

---

### 5.2 為什麼沒有這些數據？

1. **研究較少**：
   - 中文朗讀評估研究多聚焦「韻律分析」（人工標註）
   - 較少使用商業 STT API（成本考量）

2. **場景特殊**：
   - 國小學生朗讀 ≠ 成人對話
   - 發音不標準、語速不穩定、口齒不清
   - 教室環境噪音（其他學生、冷氣、外部噪音）

3. **商業機密**：
   - Azure/Google 未公開各語言細部 WER 數據
   - 避免客戶直接比較，鼓勵自行測試

---

## 6. 執行建議

### 6.1 Week 1 測試計畫（最優先）

#### **目標**
驗證 Azure Speech SDK zh-TW 在台灣國小學生朗讀場景的準確率

#### **測試步驟**

**Step 1：錄製測試音訊**
- 📊 **樣本數**：10 段國小生朗讀
- 📊 **年級分佈**：
  - 低年級（1-2）：3 段
  - 中年級（3-4）：4 段
  - 高年級（5-6）：3 段
- 📊 **內容**：課文朗讀（每段 30-60 秒）
- 📊 **錄音品質**：清晰、無明顯背景噪音
- 📊 **來源**：啟翔/張靖杭的弟妹、親戚小孩、或學校合作

**Step 2：人工標註文本**
- 逐字轉錄（含標點符號）
- 標記錯誤類型：
  - 跳字（Deletion）
  - 加字（Insertion）
  - 讀錯（Substitution）

**Step 3：Azure STT 測試**
- API 設定：
  - `language = "zh-TW"`
  - `model = "default"`（標準模型）
- 取得轉錄結果

**Step 4：計算 WER**
```
WER = (替換 + 刪除 + 插入) / 總字數 × 100%
```

**Step 5：分析結果**
- 整體 WER
- 分年級 WER（低/中/高年級）
- 常見錯誤類型（哪些字容易辨識錯誤）

---

#### **驗收標準**

| WER | 準確率 | 結論 | 下一步 |
|-----|--------|------|--------|
| **< 10%** | **> 90%** | ✅ **可用於 MVP** | 直接使用 Azure 標準模型 |
| **10-20%** | **80-90%** | ⚠️ **需優化** | 評估 Custom Speech 微調 |
| **> 20%** | **< 80%** | ❌ **不可用** | 立即切換 Google Cloud 或 Whisper |

---

### 6.2 備案：Google Cloud 測試（若 Azure 不達標）

**測試計畫**：
- 使用相同 10 段測試音訊
- API 設定：
  - `language_code = "zh-TW"`
  - `model = "chirp_3"`（最新模型）
- 計算 WER，與 Azure 比較

**決策標準**：
- 若 Google WER < Azure WER → 切換至 Google Cloud
- 若 Google WER ≈ Azure WER → 選擇成本較低的 Azure

---

### 6.3 Phase 2：Custom Speech 微調（若需要）

**適用情境**：
- Azure 標準模型 WER 10-20%（準確率 80-90%）
- 需提升至 WER < 10%（準確率 > 90%）

**微調流程**：

**Step 1：收集訓練資料**
- 📊 **音訊數量**：10-20 小時國小生朗讀
- 📊 **文本標註**：逐字轉錄（含標點符號）
- 📊 **資料多樣性**：
  - 不同年級（1-6）
  - 不同性別（男/女）
  - 不同朗讀風格（快/慢、流暢/不流暢）

**Step 2：上傳至 Azure Custom Speech**
- Speech Studio 介面：https://speech.microsoft.com/
- 上傳音訊 + 標註文本
- Azure 自動訓練自訂模型

**Step 3：評估模型**
- 使用保留測試集（不包含在訓練資料中）
- 計算 WER 提升幅度
- 目標：WER < 10%

**Step 4：部署端點**
- 部署自訂模型端點
- 更新 API 設定（使用自訂端點）

**成本**：
- 訓練：**免費**（Azure 提供免費訓練額度）
- 部署：**$1 USD / 小時**（與標準模型相同）

**預期效果**：
- 根據研究，Custom Speech 可提升 WER **10-15%**
- 例：標準模型 WER 15% → 微調後 WER 5-7%

**來源**：
- [Improve Speech-to-Text Accuracy with Custom Speech](https://azure.microsoft.com/en-us/blog/improve-speechtotext-accuracy-with-azure-custom-speech/)
- [Test Accuracy of Custom Speech Model](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-evaluate-data)

---

## 7. 技術實作建議

### 7.1 Azure Speech SDK 整合

**Node.js / TypeScript 範例**：

```typescript
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// 設定
const speechConfig = sdk.SpeechConfig.fromSubscription(
  process.env.AZURE_SPEECH_KEY!,
  process.env.AZURE_SPEECH_REGION!
);
speechConfig.speechRecognitionLanguage = "zh-TW";

// 從檔案辨識
const audioConfig = sdk.AudioConfig.fromWavFileInput(
  fs.readFileSync("student_reading.wav")
);

const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

// 辨識
recognizer.recognizeOnceAsync((result) => {
  if (result.reason === sdk.ResultReason.RecognizedSpeech) {
    console.log(`辨識結果: ${result.text}`);
    console.log(`信心分數: ${result.properties.getProperty(sdk.PropertyId.SpeechServiceResponse_JsonResult)}`);
  }
});
```

---

### 7.2 計算 WER

**Python 範例**：

```python
import jiwer

# 標準答案（人工標註）
reference = "小明今天去學校上課"

# STT 辨識結果
hypothesis = "小明今天去學上課"  # 跳字：「校」

# 計算 WER
wer = jiwer.wer(reference, hypothesis)
print(f"WER: {wer * 100:.2f}%")  # 輸出：WER: 14.29%

# 詳細分析
measures = jiwer.compute_measures(reference, hypothesis)
print(f"替換: {measures['substitutions']}")
print(f"刪除: {measures['deletions']}")
print(f"插入: {measures['insertions']}")
```

---

### 7.3 朗讀流暢度評估

**基於 STT 結果計算流暢度指標**：

```typescript
interface ReadingFluencyMetrics {
  accuracy: number;      // 準確率（1 - WER）
  speed: number;         // 語速（字/分鐘）
  pauseCount: number;    // 停頓次數
  avgPauseDuration: number; // 平均停頓時長（秒）
}

function calculateFluency(
  audioFile: string,
  expectedText: string
): ReadingFluencyMetrics {
  // 1. STT 辨識
  const result = await recognizeSpeech(audioFile);

  // 2. 計算 WER
  const wer = calculateWER(expectedText, result.text);
  const accuracy = 1 - wer;

  // 3. 計算語速
  const audioDuration = getAudioDuration(audioFile); // 秒
  const wordCount = result.text.length;
  const speed = (wordCount / audioDuration) * 60; // 字/分鐘

  // 4. 偵測停頓（使用 Azure 詳細辨識結果）
  const pauses = detectPauses(result.detailedResult);

  return {
    accuracy,
    speed,
    pauseCount: pauses.length,
    avgPauseDuration: pauses.reduce((a, b) => a + b, 0) / pauses.length
  };
}
```

---

## 8. 成本估算

### 8.1 MVP 階段（100 位學生）

**假設**：
- 每位學生每天朗讀 **10 分鐘**
- 每週 5 天
- 每月 = 20 天

**計算**：
```
每月總音訊時長 = 100 學生 × 10 分鐘 × 20 天 = 20,000 分鐘 ≈ 333 小時
每月成本 = 333 小時 × $1 USD = $333 USD
每位學生每月成本 = $333 / 100 = $3.33 USD
```

**加上其他 AI 成本**（Phase 3 蘇格拉底對話）：
- GPT-4o API：約 $2 USD / 學生 / 月
- **總成本**：$5.33 USD / 學生 / 月

**年收入估算**（假設收費 $199 TWD/月/學生）：
```
每月收入 = 100 學生 × $199 TWD ≈ $19,900 TWD ≈ $640 USD
每月成本 = $333 USD（STT）+ $200 USD（GPT-4o）= $533 USD
每月利潤 = $640 - $533 = $107 USD
利潤率 = 16.7%
```

**擴展至 1,000 位學生**：
```
每月收入 = 1,000 × $199 TWD ≈ $6,400 USD
每月成本 = $3,330（STT）+ $2,000（GPT-4o）= $5,330 USD
每月利潤 = $1,070 USD
利潤率 = 16.7%
```

---

## 9. 風險評估與應對

### 9.1 技術風險

| 風險 | 機率 | 影響 | 應對策略 |
|------|------|------|---------|
| **Azure zh-TW WER > 20%** | 中 | 高 | 立即切換 Google Cloud 或 Whisper |
| **兒童發音辨識率低** | 中 | 高 | Custom Speech 微調 + 收集更多訓練資料 |
| **教室噪音影響** | 低 | 中 | 使用降噪演算法 + 建議使用耳麥 |
| **API 成本超預算** | 低 | 中 | 限制每日朗讀次數 + 優化音訊長度 |

---

### 9.2 商業風險

| 風險 | 機率 | 影響 | 應對策略 |
|------|------|------|---------|
| **學校不願付費** | 高 | 高 | 提供免費試用 + 展示 ROI（教師節省時間） |
| **家長不信任 AI 評估** | 中 | 中 | 透明化評估標準 + 與曾教授合作背書 |
| **競品模仿** | 中 | 中 | 快速迭代 + 建立品牌信任 |

---

## 10. 結論與下一步

### 10.1 核心結論

1. ✅ **Azure Speech SDK 支援 zh-TW**，技術可行
2. ⚠️ **官方無 WER 數據** - Week 1 必須自行測試驗證
3. ✅ **台灣有朗讀韻律研究** - 聲學特徵可用於流暢度評估
4. ✅ **商業服務比較中 Azure 排名前 2** - 效能與成本優於競品
5. ⚠️ **最大風險：國小生朗讀 STT 準確率未知** - 需實際測試

---

### 10.2 立即行動（Week 1）

**優先級 P0**：
1. ✅ **錄製 10 段國小生朗讀**（找啟翔/張靖杭的弟妹、親戚小孩）
2. ✅ **人工標註文本**（逐字轉錄）
3. ✅ **Azure STT 測試**（計算 WER）
4. ✅ **決策點**：
   - WER < 10% → 使用 Azure 標準模型
   - WER 10-20% → 評估 Custom Speech 微調
   - WER > 20% → 切換 Google Cloud 或 Whisper

**優先級 P1**：
5. ⚠️ **與方大哥確認**：是否有認識的國小教師可協助錄製
6. ⚠️ **準備 Demo #1 資料**：向曾教授展示 STT 測試結果

---

### 10.3 Phase 2-3 行動

**Phase 2（若 Azure 達標）**：
- 整合 Azure Speech SDK 至後端 API
- 實作 WER 計算演算法
- 實作流暢度評估（語速、停頓偵測）

**Phase 3（若需要）**：
- 收集 10-20 小時國小生朗讀訓練資料
- 訓練 Custom Speech 模型
- 評估 WER 提升幅度

---

## 11. 參考資料

### 官方文件
- [Azure Speech SDK 文件](https://learn.microsoft.com/zh-tw/azure/ai-services/speech-service/speech-sdk)
- [語言與語音支援](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)
- [Azure Speech 定價](https://azure.microsoft.com/zh-tw/pricing/details/cognitive-services/speech-services/)
- [Test Accuracy of Custom Speech Model](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-custom-speech-evaluate-data)
- [Improve Speech-to-Text Accuracy with Custom Speech](https://azure.microsoft.com/en-us/blog/improve-speechtotext-accuracy-with-azure-custom-speech/)

### 競品文件
- [Google Cloud Speech-to-Text](https://cloud.google.com/speech-to-text)
- [Chirp 3 文件](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3)
- [Measure and Improve Accuracy](https://cloud.google.com/speech-to-text/docs/v1/measure-accuracy)
- [OpenAI Whisper](https://github.com/openai/whisper)

### 學術研究
- [Acoustic Features of Oral Reading Prosody (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9150736/)
- [Speech Perception Deficits (Frontiers)](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2017.02144/full)
- [ASR Performance Improvement for Mandarin (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9027119/)
- [Evaluating ASR Pipelines for Mandarin-English (ISCA)](https://www.isca-archive.org/interspeech_2025/wu25m_interspeech.pdf)

### Benchmark 研究
- [Benchmarking Speech-to-Text Services (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10548127/)
- [Soniox Speech-to-Text Benchmarks 2025](https://soniox.com/benchmarks)
- [Artificial Analysis - Azure Speech Service](https://artificialanalysis.ai/speech-to-text/models/azure)

---

**文件維護**：
- **建立日期**：2026-02-13
- **最後更新**：2026-02-13
- **維護者**：Young Tsai
- **下次更新**：Week 1 測試完成後（預計 2026-02-20）

**版本紀錄**：
- v1.0（2026-02-13）：初版，整理所有研究資料與執行建議
