# Live Tutor：收音提示 + 中文標點修復

> Issue #2156 延伸 — 朗讀步驟「即時導師」的兩個 UX / 顯示 bug  
> 架構方向：**方案 B**（MediaRecorder + AnalyserNode 音量，逐步脫鉤 Web Speech 即時 UI）

---

## 1. 收音提示「好像沒有偵測到聲音」卡住

### 問題定義

| 項目 | 內容 |
|------|------|
| **現象** | 按「開始朗讀」後出現琥珀色橫幅「好像沒有偵測到聲音」；學生已開口念，橫幅不消失 |
| **預期（方案 B）** | `AnalyserNode` 偵測到音量 → 代表「有收音」→ 橫幅應自動消失 |
| **實際** | 橫幅綁 **Web Speech 是否在 5 秒內出字**；一旦亮起，**沒有**在後續開口時清除 |

### 根因

1. `useLiveTutorSpeech`：`onNoAudioDetected` 在 session 開始 5 秒且 `currentTranscriptRef` 為空時觸發。
2. `LiveTutor.tsx`：只在 `startSession()` 呼叫 `setNoAudioDetected(false)`；`onresult` 只清 timer，**不清** `noAudioDetected` state。
3. 橫幅顯示條件：`noAudioDetected && stt.isSessionActive`（綁 STT，非錄音器）。
4. `useAudioRecorder` 已有 `volumeLevel`，但 `LiveTutor` 未用於收音判斷。

### 要修哪裡

| 檔案 | 改什麼 |
|------|--------|
| `LiveTutor.tsx` | 收音改綁 `paragraphRecorder`；`volumeLevel` 過閾值即清橫幅；無音量逾時才顯示橫幅 |
| `useLiveTutorSpeech.ts` | 不再傳 `onNoAudioDetected`（停用 Web Speech 無聲計時） |
| `LiveTutorControls.tsx` | `canSubmit` 改為「錄音中且已偵測到音量（或最短錄音秒數）」，不依 `streamingUserInput` |

### 怎麼修

```
startSession()
  → paragraphRecorder.startRecording()
  → setNoAudioDetected(false); setHasDetectedAudio(false)
  → 錄音 status === 'recording' 時啟動 4s 無音量計時

volumeLevel >= 0.06
  → setHasDetectedAudio(true); setNoAudioDetected(false)

橫幅條件
  → noAudioDetected && paragraphRecorder.status === 'recording'

canSubmit
  → 錄音中 && (hasDetectedAudio || recordingSecs >= 2 || 重試有 lastDiffTokens)
```

### 驗收標準

- [ ] 開始朗讀後 **4 秒內完全無音量** → 才出現橫幅
- [ ] **一開口**（AnalyserNode 過閾）→ 橫幅 **立即消失**（不需等 STT 出字）
- [ ] 按「完成」後橫幅不再殘留
- [ ] 麥克風權限被拒 → 顯示權限錯誤，不是這條橫幅

### 完成後確認（避免無效送件）

| 項目 | 內容 |
|------|------|
| **問題** | 按「完成」立刻送 Gemini / 評分，無聲或測試性錄音也會消耗 API |
| **預期** | 「完成」= **暫停錄音**；學生確認後才送評估 |

**流程**

```
錄音中 → 按「完成」
  → 停止 STT + MediaRecorder，暫存 transcript + audioBlob
  → 底部顯示兩個選項：
       1. 評估 — 送出暫存音檔與轉錄，走既有 Gemini + evaluateAndRespond
       2. 重錄 — 丟棄暫存，重新 startSession()

評估中 → 「評分中…」，不可重複點擊
```

**要修哪裡**

| 檔案 | 改什麼 |
|------|--------|
| `LiveTutor.tsx` | `finishRecording` / `confirmEvaluate` / `confirmRerecord`；暫存 `pendingRecordingRef` |
| `LiveTutorControls.tsx` | 「完成」改呼叫 `onFinishRecording`；`recordingPendingReview` 時顯示「評估」「重錄」 |

**驗收標準**

- [ ] 按「完成」**不會**立刻呼叫 `transcribeReading` / `evaluateAndRespond`
- [ ] 僅按「評估」才送件
- [ ] 按「重錄」回到錄音中，舊 blob 不送出
- [ ] 無效錄音（無音量、極短）仍須先按「完成」才能看到選項；「完成」維持 `canSubmit` 門檻

---

## 2. 朗讀結果出現英文半形標點（`,` `;`）

### 問題定義

| 項目 | 內容 |
|------|------|
| **現象** | 「朗讀結果」出現 `中國的戰國時期, 有七個…互比苗頭; 了`（半形 `,` `;`、逗號後空格） |
| **預期** | 與課文一致的全形標點：`，` `、` `。` 等 |
| **課文原文** | `中國的戰國時期，有七個國家總是爭強鬥勝、互比苗頭，…`（G6-L22） |

### 根因

1. **Gemini / Web Speech** 轉錄常回傳 ASCII 標點與半形空格。
2. `normalizeForComparison` 只剝 **全形** 標點；半形 `,` `;` 會留在 diff 對齊裡。
3. `interleavePunctuation` 的 `DISPLAY_PUNCT_RE` **不含**半形標點；若標點已進 `diff_tokens.char`，會原樣當「已唸對」綠字顯示，**不會**改為課文標點。

### 要修哪裡

| 層級 | 檔案 | 作法 |
|------|------|------|
| 工具 | `textDiff.ts` | `normalizePunctuationToChinese()`；比對前正規化；`interleavePunctuation` 跳過 token 內標點字元 |
| 流程 | `LiveTutor.tsx` | Gemini / Web Speech transcript 評分前套用正規化 |
| 測試 | `textDiff.test.ts` | 半形 spoken + 全形 target → 顯示全形 |

### 怎麼修

1. **Transcript**：`,→，` `;→；`、移除半形空格等。
2. **比對**：`normalizeForComparison` 先跑 `normalizePunctuationToChinese`。
3. **顯示**：`interleavePunctuation` 只吃非標點 token；標點一律從 `targetText`（課文）插入。

### 驗收標準

- [ ] 朗讀結果區不出現半形 `,` `;`
- [ ] 標點與課文一致（`，` `、` 等）
- [ ] 逗號後無多餘半形空格
- [ ] 評分邏輯不 regress（既有 `textDiff` 測試通過）

---

## 3. 與其他議題的邊界

| 議題 | 關係 |
|------|------|
| 注音開關 `useZhuyin()` | **無關** — 純顯示層 |
| 標點只出現在已唸段落（灰/綠） | 已修 `interleavePunctuation` 走完整課文；本次修的是半形/全形 |
| 完全移除 Web Speech | **後續 P1**；本次先讓收音 UX 與標點正確，STT 仍可並行供 fallback |

---

## 4. 實作清單（本 PR）

- [x] 規格文件（本檔）
- [x] `textDiff.ts` — 標點正規化 + `interleavePunctuation` 跳過 token 標點
- [x] `LiveTutor.tsx` — AnalyserNode 音量驅動橫幅 + transcript 正規化
- [x] `LiveTutorControls.tsx` — `hasDetectedAudio` 驅動 `canSubmit` + 音量條
- [x] `LiveTutor.tsx` + `LiveTutorControls.tsx` — 完成後「評估 / 重錄」確認步驟
- [x] `textDiff.test.ts` — 新增標點案例
