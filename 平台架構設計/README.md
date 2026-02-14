# 國語文朗讀學習平台 - 設計文件

> **專案狀態**: MVP 設計階段 (方大哥)
>
> **更新日期**: 2026-02-13
>
> **核心理念**: AI 語音分析 + 即時回饋,協助教師精準掌握學生閱讀流暢度

---

## ⚠️ 重要更新 (2026-02-13 晚上)

### 之前的 MVP 設計是錯的!

**舊文件** `MVP-設計.md` **完全誤解需求**,已廢棄。

| 項目 | ❌ 錯誤版本 | ✅ 正確需求 |
|------|-----------|-----------|
| 核心功能 | 教師手動批改 | **AI 自動分析語音** |
| 回饋速度 | 延遲批改 | **< 5 秒即時回饋** |
| 分析內容 | 無 | 語速、正確率、逐句對比、錯字詞清單 |

---

## 📋 當前文件 (正確版)

### 核心文件 (必讀)

1. **[MVP-設計-正確版.md](./MVP-設計-正確版.md)** ⭐ **從這裡開始**
   - ✅ AI 語音分析核心功能
   - ✅ 六大環節即時回饋
   - ✅ Azure Speech SDK 整合
   - ✅ 完整技術實作範例
   - ✅ 4 週開發時程

2. **[資料庫Schema設計.md](./資料庫Schema設計.md)** (簡化版正在更新)
   - 完整 Schema (過度設計)
   - MVP 只需要看 `students`, `lessons`, `submissions`, `gradings`

3. **[GitHub同步服務設計.md](./GitHub同步服務設計.md)** (簡化版正在更新)
   - Git Clone 同步邏輯
   - MVP 用定時 Pull,不用 Webhook

---

## 📦 封存文件 (不需要看)

所有過度設計的文件都已移到 `archive/`:

### archive/過度設計/
- 部署架構設計.md (AWS 架構,已改用 GCP)
- 監控告警設計.md (MVP 不需要)
- 測試策略.md (MVP 只測 E2E)
- AdminUI課程管理設計.md (MVP 不做)
- 前端設計.md (太詳細,MVP 簡化)
- GoogleClassroom整合設計.md (V2 再做)
- AI評分引擎設計.md (V2 再做)

### archive/研究文件/
- API可行性驗證報告.md
- GitHub-API-深度評估.md
- PR當作交作業可行性評估.md
- 方案-全部用GitHub.md
- 資料主權與降級策略.md
- 完整系統設計-總覽.md

**這些文件仍有參考價值,但不影響 MVP 開發。**

---

## 🎯 MVP 核心理念 (正確版)

### 必須有 (Core)

1. **AI 語音分析** ⭐ 核心!
   - Azure Speech SDK 繁體中文 (zh-TW)
   - 語速、正確率自動計算
   - 錯誤分類 (跳字、加字、讀錯)

2. **即時回饋六大環節** ⭐ 核心!
   1. 朗讀結果總覽
   2. 錄音播放與轉錄
   3. 逐句分析對比
   4. 錯字詞練習清單
   5. 練習建議
   6. AI 詳細分析

3. **分段朗讀流程**
   - 段落 → 段落 → 整篇
   - 達標解鎖機制

4. **注音符號切換** (Space 鍵)

### 明確不做 (V2 再說)

- ❌ Google Classroom 整合
- ❌ 課程管理 Admin UI (教師直接改 GitHub)
- ❌ Multi-tenancy (先做單一學校)
- ❌ 複雜監控 (用 GCP 內建)

---

## 🏗️ 技術棧

| 層級 | 技術 | 原因 |
|------|------|------|
| 前端 | **Next.js 14 + TypeScript** | PRD 指定 |
| 後端 | **NestJS + PostgreSQL** | PRD 指定 |
| 語音識別 | **Azure Speech SDK (zh-TW)** ⭐ | 排名前 2,準確率高 |
| 雲端 | **GCP** (Cloud Run + Cloud SQL) | 無伺服器,成本低 |
| 課程 | **GitHub (Markdown)** | 版本控制 + 免費 |

---

## 💰 成本估算 (正確版)

| 學生數 | Azure STT | 其他 GCP | 總計 |
|--------|-----------|----------|------|
| 50 學生 | **$250/月** | $7 | **~$257/月** |
| 500 學生 | **$2,500/月** | $81 | **~$2,581/月** |

**重要**: Azure Speech SDK 是最大成本項!

**成本優化方案**:
- V2 考慮切換 OpenAI Whisper (自建,~$300/月無限用量)
- 或 Hybrid 模式: Azure (即時) + Whisper (批次) ≈ $150/月

**開發成本**: $17,600 (4 週 × 1 全端工程師)

---

## 📅 時程 (正確版)

```
Week 1: 後端 + Azure Speech SDK 整合 ⭐
        - 測試 Azure zh-TW WER (目標 < 10%)
        - 文本比對演算法

Week 2: 學生端 + 錄音組件 + 六大環節回饋 ⭐
        - AudioRecorder 組件
        - FeedbackPanel 六大環節

Week 3: 分段朗讀流程 + 教師端
        - 段落解鎖機制
        - 班級/個別報告

Week 4: 測試 + 部署 + 真實使用者驗證
        - 至少 2-3 位國小學生測試
        - 曾世杰教授驗證 ⭐

→ 4 週 MVP
```

---

## ⚠️ 開始開發前必須確認

- [ ] **客戶**: 方大哥
- [ ] **學生人數**: ___________
- [ ] **預算範圍**: 能否接受 $257/月 (50 學生) 的 Azure 成本?
- [ ] **上線時間**: ___________
- [ ] **Week 1 必做**: 測試 Azure zh-TW WER,若 > 10% 立即切換 Google Chirp 3

**關鍵風險**: Azure Speech SDK 成本高,需確認預算!

---

## 🔄 設計演進記錄

### 2026-02-13: 大幅簡化

- 從 15 份文件 → 1 份核心文件 (MVP-設計.md)
- 從 AWS → GCP
- 從 Multi-tenancy → 單一學校
- 從 6 週 → 4 週
- 從 $38k → $17.6k

**原因**: 過度設計,基於錯誤假設 (義大醫院污染、示範學校)

### 2026-02-13 之前: 完整設計 (已封存)

- 9 份核心技術設計
- 6 份研究文件
- Multi-tenancy 架構
- 完整監控告警
- Admin UI

**問題**: 太複雜,沒有真實客戶,浪費時間

---

## 📚 如何使用這些文件

### 如果你是開發人員

1. **必讀**: [MVP-設計-正確版.md](./MVP-設計-正確版.md)
2. **必讀**: [PRD.md](../../docs/PRD.md) - 完整產品需求
3. 參考: [Azure Speech SDK 繁體中文研究](../../docs/references/azure-speech-sdk-zh-tw-research.md)
4. 參考: [方大哥 Flutter App](https://github.com/Shinjou/learning-to-read-chinese)
5. 忽略: `MVP-設計.md` (舊版,已廢棄)
6. 忽略: `archive/` 資料夾

### 如果你是產品經理

1. 先確認「待確認事項」
2. 確認 MVP 功能範圍是否符合需求
3. 確認 4 週時程和 $17.6k 預算是否可行

### 如果你想看完整設計

- 參考 `archive/` 資料夾
- 但記住:這些是過度設計,不應該照著實作

---

## 📞 聯絡資訊

- **GitHub Repo**: https://github.com/[org]/chinese-literacy-platform
- **GCP 專案**: literacy-platform
- **設計文件**: /平台架構設計/

---

**Generated with [Claude Code](https://claude.ai/code) via [Happy](https://happy.engineering)**

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
