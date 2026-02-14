# 設計文件變更記錄

## 2026-02-13: 大幅簡化 (從完整設計 → MVP)

### ❌ 刪除/封存的文件

**移到 `archive/過度設計/`**:
- 系統設計文件總覽.md (舊版,15 份文件清單)
- 部署架構設計.md (AWS 架構,已改用 GCP)
- 監控告警設計.md (Prometheus + Grafana,MVP 不需要)
- 測試策略.md (63 KB 測試策略,MVP 只測 E2E)
- AdminUI課程管理設計.md (TipTap 編輯器,V2 再做)
- 前端設計.md (32 KB 詳細設計,MVP 簡化)
- GoogleClassroom整合設計.md (OAuth 整合,V2 再做)
- AI評分引擎設計.md (Whisper STT,V2 再做)

**移到 `archive/研究文件/`**:
- API可行性驗證報告.md
- GitHub-API-深度評估.md
- PR當作交作業可行性評估.md
- 方案-全部用GitHub.md
- 資料主權與降級策略.md
- 完整系統設計-總覽.md

### ✅ 新增的文件

1. **MVP-設計.md** (核心文件)
   - MVP 功能範圍 (只做 3 件事)
   - 簡化資料庫設計 (4 張表)
   - GCP 部署架構
   - 4 週開發時程
   - ~$10/月成本 (50 學生)

2. **README.md** (導覽文件)
   - 文件結構說明
   - 快速開始指南
   - 開發前必須確認事項

3. **CHANGELOG.md** (本文件)
   - 設計演進記錄

### 📊 簡化對比

| 項目 | 之前 (完整設計) | 之後 (MVP) |
|------|----------------|-----------|
| **文件數量** | 15 份 (9 核心 + 6 研究) | 1 份核心 + 2 份參考 |
| **文件大小** | ~410 KB | ~20 KB |
| **開發時程** | 61 天 (8.5 週) | 28 天 (4 週) |
| **開發成本** | $38,060 | $17,600 |
| **月運營成本** | $437 (500 學生) | $50 (500 學生) |
| **資料庫表** | 20+ 張 (Multi-tenancy) | 4 張 (單一學校) |
| **雲端平台** | AWS (EKS, RDS, S3) | GCP (Cloud Run, Cloud SQL) |
| **功能範圍** | 完整 LMS | 最小 MVP |

### 🎯 簡化原因

1. **過度設計**: 基於錯誤假設 (義大醫院污染、示範學校、500 學生)
2. **沒有真實客戶**: 所有需求都是臆測
3. **技術棧改變**: AWS → GCP
4. **成本考量**: $437/月 → $50/月 (降低 88%)
5. **時程壓力**: 8.5 週 → 4 週 (減少 53%)

### 🔄 設計原則改變

#### 之前 (完整設計)

```
原則: 「考慮所有可能性,設計完整系統」
結果:
  - Multi-tenancy (Platform → Org → School → Classroom)
  - AI 自動評分引擎
  - Google Classroom 整合
  - Admin UI (TipTap 編輯器)
  - 完整監控告警
  - Kubernetes 部署
```

#### 之後 (MVP)

```
原則: 「只做最小可行產品,驗證核心價值」
結果:
  - 單一學校
  - 教師手動批改
  - GitHub 存課程 (教師直接改)
  - 無 Admin UI
  - 用雲端平台內建監控
  - Cloud Run 無伺服器部署
```

### 📝 保留的設計

雖然大幅簡化,但以下設計邏輯仍保留:

1. **GitHub 存課程** (Markdown)
   - 版本控制優勢
   - Git Clone 避免 Rate Limit
   - 定時同步邏輯

2. **基本資料結構**
   - students, lessons, submissions, gradings
   - 從複雜的 Multi-tenancy 簡化而來

3. **前端技術棧**
   - React + TypeScript
   - 錄音組件邏輯

### 🚀 下一步

1. **確認需求**: 與客戶訪談,確認真實需求
2. **開發 MVP**: 按照 `MVP-設計.md` 執行
3. **驗證假設**: 用真實使用者測試
4. **迭代改進**: 根據反饋決定是否要加功能

### 📚 如何查看舊設計

如果需要參考完整設計:

```bash
cd 平台架構設計/archive/

# 查看過度設計的文件
ls 過度設計/

# 查看研究文件
ls 研究文件/
```

**但記住**: 這些是過度設計,不應該照著實作!

---

## 2026-02-13 之前: 完整設計階段 (已封存)

### 設計演進過程

```
Step 1: 外部系統評估 (Notion + GitHub + Classroom)
    ↓ 發現 Notion API 沒版本歷史
Step 2: API 可行性驗證
    ↓ 確認三平台整合成本太高 (32 週)
Step 3: 簡化方案 (GitHub + Classroom)
    ↓ 評估 PR 交作業 → 不可行
Step 4: GitHub API 深度研究
    ↓ 決定用 Git Clone (避免 Rate Limit)
Step 5: 資料主權設計
    ↓ 確立「外部系統是工具」原則
Step 6: 完整系統設計
    ↓ 9 份核心技術文件完成
Step 7: 跨專案污染問題
    ↓ 發現義大醫院污染,全面修正
Step 8: Admin UI 補充
    ↓ 加入方案 H (GitHub + Admin UI)
Step 9: 意識到過度設計
    ↓ 大幅簡化 → MVP
```

### 主要產出 (2026-02-13 前)

- 9 份核心技術設計 (304 KB)
- 6 份研究文件 (111.5 KB)
- 總計 15 份文件 (~410 KB)

### 跨專案污染事件

**問題**: 義大醫院 (E-DA Hospital) 的資訊污染到本專案
**原因**: Global CLAUDE.md 使用 `@edah.org.tw` 作為範例
**影響**: 32 個設計文件中出現義大醫院相關內容
**解決**: 全面替換 → 示範學校/示範教育平台

參考: `修正記錄-跨專案污染清除.md`

---

**Generated with [Claude Code](https://claude.ai/code) via [Happy](https://happy.engineering)**

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>
