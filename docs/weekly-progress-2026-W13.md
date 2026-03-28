# 週進度報告 2026 W13 (3/22 - 3/28)

## 儀表板

```
╔══════════════════════════════════════════════════════════════╗
║              LingoLeap 週進度儀表板 W13                      ║
╠══════════════════════════════════════════════════════════════╣
║  PRs merged:  19                                            ║
║  Commits:     52 (Young 51 + 靖杭 1)                       ║
║  Issues:      16 新開 / 8 關閉                              ║
║  Steps:       7 → 10（+閱讀標記/語詞定義/語詞應用/語詞複習/知識補給站）║
║  TTS:         Web Speech → Google Chirp3-HD → Azure 台灣腔   ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 團隊貢獻

### Young (Lead Dev) — 51 commits, 18 PRs

| 分類 | PRs | 說明 |
|------|-----|------|
| TTS 語音系統 | #665 #680 #681 | Web Speech → Google Chirp3-HD → Azure zh-TW Neural 48kHz |
| 三民步驟整合 | #672 #673 #674 #675 #677 #682 | 10 步驟模組化 + 4 新元件 |
| 朗讀評估 | #651 #654 #656 #659 #666 | 同音字寬容/混合評分/pinyin 擴展/靜態化 |
| 基礎設施 | #648 #649 #657 | 測試/api.ts 拆分/slug 修復 |
| UI | #683 | StepperNav sidebar 重設計 |
| 進度持久化 | #679 | 6 元件 localStorage |

### 靖杭 @if-else-master (Intern) — 1 commit, 1 PR merged

| PR | 說明 | 狀態 |
|----|------|------|
| #642 | 逐段朗讀不準確 BUG 修復 | ✅ merged |
| #652 | ComprehensionChat UI 優化 | 🔄 等解 conflict |
| #662 | Loading skeleton | 🔄 等改兩點 |
| #644 | 頁面整合 | 🔄 進行中 |

### 靖杭未來兩週計劃
1. 功能簡化 — 保留家長功能但隱藏，聚焦核心
2. 頁面整合 — 重構精簡 + #644
3. 體驗檢視 — 實際操作，移除不必要功能
4. 作業測試 — 測試 1~10 關流程

---

## 本週重點成果

### 1. TTS 語音系統（從 0 到完整）

```
Week start: 瀏覽器 Web Speech API（機器音）
Week end:   Azure zh-TW HsiaoChenNeural 48kHz（台灣腔自然語音）
            + GCS 句子級 cache
            + 前端逐句串接播放
            + 57 篇課文預生成中（1009/~2000 句）
            + 成本：$0（Azure 免費額度內）
```

### 2. 三民學習單 9 步驟 → 10 步驟

```
Before: 簡介 → 朗讀 → 理解 → 生字 → 聽寫 → 全文 → 報告（7 步）
After:  閱讀標記 → 逐段朗讀 → 全文朗讀 → 生字練習 → 語詞定義 →
        語詞應用 → 課文理解 → 語詞複習 → 知識補給站 → 報告（10 步）
```

對照表：https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/step-mapping.html

### 3. 朗讀評估改善

| 改善 | 效果 |
|------|------|
| 課文靜態化 | 朗讀時文字不再變色/跳動 |
| 符號清理 | ~~~、──、…、# 不再出現在比對裡 |
| 同音字寬容 | 3952 字 pinyin 表 + 近音字 8 組 |
| extra 隱藏 | 口吃/重念不顯示、不扣分 |
| 數字轉換 | 214 → 二百一十四 自動配對 |

### 4. 基礎設施

| 項目 | 說明 |
|------|------|
| StepperNav 模組化 | stepConfig.ts 一處改順序 |
| StepperNav sidebar | 10 步驟改左側 sidebar |
| CSP 修復 | blob: URL 解鎖 TTS 播放 |
| CORS 修復 | Preview deploy 動態 URL |
| CI/CD Azure env vars | 三個 workflow 都加了 |
| Worktree 自動清理 hook | SessionStart 檢查 merged PR |
| localStorage 持久化 | 6 元件加進度保存 |

---

## 方大哥反饋追蹤

| 反饋 | 狀態 |
|------|------|
| 聲音太機器人 | ✅ 已換 Azure 台灣腔 |
| 課文視覺變化干擾 | ✅ 已做靜態化 |
| 按鈕太小 | ✅ 已放大 |
| 「擊」念一聲（大陸腔）| ✅ 已換 Azure zh-TW |
| 閱讀標記選字 bug | ✅ 已修（indexOf 替代 DOM offset） |
| 舊 demo 無法朗讀 | 📋 Backlog |

---

## 下週優先事項

1. 方大哥測試 staging 10 步驟 + 台灣腔 TTS
2. 靖杭 PR merge（#652 #662 #644）
3. 靖杭作業流程測試回報
4. TTS 預生成完成（57 篇 Azure 台灣腔）
5. 閱讀標記 UX 優化
