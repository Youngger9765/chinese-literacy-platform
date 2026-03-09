# LingoLeap Beta 上線前檢查清單

> 版本：Beta v1.0 | 更新日期：2026-03-09
>
> 負責人：由 Release Manager 指派各項負責人
> 預計上線日期：[填入日期]

---

## 使用說明

- 每個項目完成後打勾 `[x]`
- 若有問題或阻塞項目，在 `備註` 欄記錄
- **上線決定須所有 P0 項目完成後才能執行**

---

## 一、環境驗證

### 1.1 後端服務

- [ ] Backend Cloud Run 服務正常運行（Health check 回傳 200）
- [ ] Database 連線正常（Cloud SQL 可連接）
- [ ] Vertex AI 呼叫正常（Gemini API 回應正常）
- [ ] CORS 設定正確（Staging frontend origin 已加入白名單）
- [ ] 環境變數設定完整（`DATABASE_URL`, `ALLOWED_ORIGINS` 等）
- [ ] API 文件可存取（`/docs` 端點正常）

**備註**：

---

### 1.2 前端服務

- [ ] Frontend Cloud Run 服務正常運行（首頁可開啟）
- [ ] `VITE_API_URL` 指向正確的後端 URL
- [ ] 靜態資源載入正常（字型、圖片、CSS）
- [ ] 無 Console 錯誤（開啟 DevTools 確認）
- [ ] 注音字型（BpmfIansui）正確載入
- [ ] Service Worker / PWA 設定正確（如有）

**備註**：

---

### 1.3 CI/CD Pipeline

- [ ] `staging-deploy.yml` 觸發並成功部署 Staging 環境
- [ ] `preview-deploy.yml` 可正常建立 PR Preview 環境
- [ ] Artifact Registry 映像清理 Policy 已設定
- [ ] GitHub Secrets 已更新（`GCP_SA_KEY` 等）

**備註**：

---

## 二、功能驗證（End-to-End 測試）

### 2.1 核心學習流程

- [ ] 步驟 1：課文簡介正常顯示
- [ ] 步驟 2：LiveTutor 朗讀指導可啟動（麥克風授權、AI 回應）
- [ ] 步驟 3：生字練習 — 筆順動畫正常播放
- [ ] 步驟 3：生字練習 — 注音標示正確
- [ ] 步驟 4：ComprehensionChat — 蘇格拉底對話正常啟動
- [ ] 步驟 4：ComprehensionChat — AI 可回覆問題（5題流程完整）
- [ ] 步驟 5：全文朗讀評估可完整錄音並上傳
- [ ] 步驟 6：學習報告正確生成並顯示

**備註**：

---

### 2.2 帳號管理

- [ ] 新用戶可正常註冊
- [ ] 現有用戶可正常登入
- [ ] 密碼重設流程正常（發送 Email + 重設成功）
- [ ] Session 超時後自動重建（SessionExpiredError 處理）
- [ ] 教師帳號可進入後台管理頁面
- [ ] 學生帳號無法存取教師後台

**備註**：

---

### 2.3 教師功能

- [ ] 班級管理頁面正常載入
- [ ] 新增學生功能正常
- [ ] CSV 批量匯入學生功能正常
- [ ] 班級學習熱圖（Heatmap）正確顯示
- [ ] 學生個人學習報告可查看

**備註**：

---

### 2.4 瀏覽器相容性

- [ ] Chrome 最新版 — 完整功能測試通過
- [ ] Edge 最新版 — 完整功能測試通過
- [ ] Safari 16+ — 基本功能測試通過（朗讀功能受限為已知問題）
- [ ] 平板裝置（iPad） — 基本功能測試通過

**備註**：

---

## 三、資料備份

### 3.1 上線前備份

- [ ] Cloud SQL 已建立快照（`pre-beta-launch-[日期]`）
- [ ] 快照建立成功並可還原驗證
- [ ] 備份保留期限設定（至少 30 天）
- [ ] 備份位置記錄於此：`[GCS bucket 路徑]`

**備份時間**：[填入日期時間]

**備份負責人**：[填入姓名]

**備註**：

---

### 3.2 資料驗證

- [ ] 現有課文資料完整（57 篇 YAML 均已載入）
- [ ] 測試帳號資料正確建立
- [ ] 歷史學習記錄未被影響

**備註**：

---

## 四、監控設定

### 4.1 GCP 監控

- [ ] Cloud Run — 服務運行狀態警報已設定
- [ ] Cloud Run — 請求延遲 P99 > 5s 警報已設定
- [ ] Cloud SQL — CPU 使用率 > 80% 警報已設定
- [ ] Cloud SQL — 連線數接近上限警報已設定
- [ ] Vertex AI — API 錯誤率 > 5% 警報已設定
- [ ] Artifact Registry — 儲存空間 > 80% 警報已設定

**備註**：

---

### 4.2 錯誤追蹤

- [ ] Backend 錯誤 log 可在 Cloud Logging 中查詢
- [ ] Frontend 錯誤可被捕捉（Error Boundary）
- [ ] Circuit Breaker 機制正常運作（3 次 AI 錯誤 → 503）
- [ ] 500 錯誤會觸發警報通知

**備註**：

---

### 4.3 性能基準

上線前記錄基準數值（供後續比較）：

| 指標 | 基準值 | 實際測量值 | 達標 |
|------|--------|-----------|------|
| 首頁載入時間 | < 3s | | [ ] |
| API 平均回應時間 | < 1s | | [ ] |
| LiveTutor AI 回應時間 | < 3s | | [ ] |
| 蘇格拉底對話回應時間 | < 5s | | [ ] |
| Cloud Run 啟動時間（冷啟動） | < 10s | | [ ] |

**備註**：

---

## 五、安全性確認

- [ ] HTTPS 強制啟用（HTTP 自動跳轉 HTTPS）
- [ ] CORS 設定僅允許白名單 Origin
- [ ] API 端點需要驗證（未登入無法存取受保護 API）
- [ ] 沒有 API Key 或 Secret 暴露在前端程式碼中
- [ ] 依賴套件安全掃描通過（Dependabot / npm audit）
- [ ] Gitleaks 掃描通過（無 Secret 洩漏）

**備註**：

---

## 六、文件與溝通

### 6.1 Beta 測試文件

- [ ] `docs/beta-launch/beta-guide.md` 已完成並審閱
- [ ] `docs/beta-launch/beta-faq.md` 已完成並審閱
- [ ] `docs/beta-launch/support-templates.md` 已完成並審閱
- [ ] `docs/beta-launch/feedback-form.md` 已完成並審閱
- [ ] 歡迎信件草稿已準備

**備註**：

---

### 6.2 Beta 測試者準備

- [ ] Beta 測試者名單確認（名單已取得）
- [ ] 測試帳號建立完成（[N] 個帳號）
- [ ] 歡迎信件已寄出（或計劃於上線當天寄出）
- [ ] Line 群組已建立並邀請測試者

**備註**：

---

## 七、回滾計畫

### 7.1 回滾觸發條件

以下任一情況發生時，立即啟動回滾：

- P0 Bug：核心功能（登入、學習流程）完全無法使用
- 資料損壞：學習記錄遺失或錯誤
- 安全性事件：未授權存取或資料洩漏
- 服務可用性：Staging 環境錯誤率 > 20% 且持續 15 分鐘以上

---

### 7.2 回滾步驟

**後端回滾**：

```bash
# 1. 確認上一個穩定版本的 Image Tag
gcloud run revisions list --service lingoleap-backend --region asia-east1 --project lingoleap-dev

# 2. 回滾到上一個 Revision
gcloud run services update-traffic lingoleap-backend \
  --to-revisions [REVISION_NAME]=100 \
  --region asia-east1 \
  --project lingoleap-dev
```

**前端回滾**：

```bash
# 回滾前端服務
gcloud run services update-traffic lingoleap-frontend \
  --to-revisions [REVISION_NAME]=100 \
  --region asia-east1 \
  --project lingoleap-dev
```

**資料庫回滾**（僅在資料損壞時）：

```bash
# 列出可用快照
gcloud sql backups list --instance lingoleap-db --project lingoleap-dev

# 從快照還原（注意：此操作不可逆）
# 執行前須取得 Release Manager 確認
gcloud sql backups restore [BACKUP_ID] \
  --restore-instance lingoleap-db \
  --project lingoleap-dev
```

---

### 7.3 回滾後確認

- [ ] 後端 Health check 回傳 200
- [ ] 前端首頁可正常載入
- [ ] 基本登入流程正常
- [ ] 通知所有 Beta 測試者（說明暫時中斷原因）

---

## 八、上線當天 SOP

| 時間 | 動作 | 負責人 | 完成 |
|------|------|--------|------|
| T-2h | 最終環境檢查 | DevOps | [ ] |
| T-1h | 資料備份確認 | DevOps | [ ] |
| T-30m | 通知 Beta 測試者（上線倒計時） | PM | [ ] |
| T-0 | 發送歡迎信件 | PM | [ ] |
| T+30m | 第一輪監控檢查 | DevOps | [ ] |
| T+2h | 蒐集初步回饋 | PM | [ ] |
| T+24h | 第一天回顧會議 | 全團隊 | [ ] |

---

## 九、上線後追蹤（第一週）

- [ ] Day 1：監控 Error Rate、Response Time
- [ ] Day 1：檢查 Cloud Logging 是否有異常
- [ ] Day 2：蒐集初步用戶回饋
- [ ] Day 3：第一次 Bug 修復 Sprint（如有 P0/P1 問題）
- [ ] Day 5：Beta 測試者滿意度調查（簡短問卷）
- [ ] Day 7：第一週回顧 — 回饋整理、優先修復清單

---

**簽核確認**

| 角色 | 姓名 | 確認時間 | 簽核 |
|------|------|---------|------|
| Release Manager | | | [ ] |
| 技術負責人 | | | [ ] |
| 產品負責人 | | | [ ] |

**上線決定最終確認**：所有 P0 項目完成、Sign-off 完成 → 可執行上線。

---

*Release Checklist v1.0 — 每次上線前請複製此文件並更新日期*
