# LingoLeap 國語文閱讀學習平台

基於閱讀科學的 AI 朗讀教學工具，協助國小教師與學生提升閱讀流暢度。

## 核心理念

**閱讀能力 = 識字解碼 × 背景知識**

結合朗讀練習（識字自動化）與蘇格拉底式 AI 對話（深度理解），系統化提升學生閱讀能力。

## 主要功能

### 學生學習系統（8 步驟）
1. **簡介** — 課文背景介紹
2. **逐段朗讀** — AI 即時朗讀指導
3. **課文理解** — 蘇格拉底式 AI 對話（5 題 3 階段）
4. **生字練習** — 筆順 + 注音 + 部件拆解 + 發音練習
5. **聽寫練習** — TTS 聽寫 + 即時批改
6. **造句練習** — 生字造句應用
7. **全文朗讀** — 完整流暢度評估
8. **診斷報告** — 六環節 AI 分析報告

### 教師管理系統
- 班級管理 + 學生匯入（CSV / 邀請碼）
- 教材指派 + 自建課文上傳
- 作業系統（建立 / 批改 / 提醒）
- 學習儀表板（進度分析、學習曲線、班級熱力圖）
- 學習預警通知 + 個別化教學指示
- 跨課文學習模式分析

### 學生端
- 自學模式 + 作業模式
- 遊戲化（XP、成就、連續登入）
- 學習歷史 + 對話紀錄回顧
- 個人生字本 + 錯字矯正推薦
- 家長儀表板（查看孩子進度）

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | React 19 + Vite 6 + Tailwind CSS 3 + TypeScript |
| 後端 | FastAPI + SQLAlchemy 2.0 + PostgreSQL 15 |
| AI | Google Vertex AI Gemini 2.5 Flash |
| 部署 | GCP Cloud Run + Cloud SQL + Artifact Registry |
| CI/CD | GitHub Actions（push/PR 自動部署） |
| 測試 | pytest + Playwright E2E + Locust 壓測 |

## 開發環境設置

### 前端

```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
```

### 後端

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload  # http://localhost:8000
```

環境變數：複製 `.env.example` 到 `.env`，填入本地設定。
AI 呼叫走 Vertex AI service account（需要 `gcloud auth application-default login`）。

## Git Branch 策略

```
feature/*  ──PR──>  staging  ──PR──>  main
    │                  │                │
    ▼                  ▼                ▼
PR Preview          Staging         Production
(ephemeral)       (persistent)     (persistent)
```

詳見 [CONTRIBUTING.md](./CONTRIBUTING.md)

## 文件索引

| 文件 | 說明 |
|------|------|
| [PRD.md](docs/PRD.md) | 產品需求文檔 |
| [BRD.md](docs/BRD.md) | 商業需求文檔 |
| [MRD.md](docs/MRD.md) | 市場需求文檔 |
| [TRD.md](docs/TRD.md) | 技術規格文檔 |
| [ROADMAP.md](docs/ROADMAP.md) | 開發路線圖 |
| [CHANGELOG.md](CHANGELOG.md) | 功能變更記錄 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 開發流程與規範 |

## 團隊

- **Young** @Youngger9765 — Lead Dev
- **方大哥 / Shinjou** — Product Owner
- **靖杭** @if-else-master — 實習生
- **啟翔** @stgst — 實習生

## 授權

Private repository. All rights reserved.
