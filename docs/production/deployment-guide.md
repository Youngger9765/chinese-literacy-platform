# 部署與故障排除（工程用）

從 `/help` 的「管理員」分頁搬過來（#3142）。那一頁是給老師與學生看的使用說明，
放 `gcloud` 指令與 CI/CD workflow 名稱等於把工程 runbook 擺在錯的對象面前。

> ⚠️ 這份是**搬移**而非重寫。以下內容維持 2026-03 當時的原樣，只做最小澄清，
> 並標出已經和現況不符的地方。要當權威請以 repo 根目錄的 `CLAUDE.md` 為準 ——
> 那裡才是持續維護的一份。

## 系統架構

| 層 | 技術 | 部署目標 |
|---|---|---|
| 前端 | React 19 + TypeScript + Tailwind | Cloud Run `lingoleap-frontend` |
| 後端 | FastAPI + SQLAlchemy | Cloud Run `lingoleap-backend` |
| 資料庫 | PostgreSQL 15 | Cloud SQL（asia-east1） |
| AI | Vertex AI Gemini | us-central1 |

⚠️ **已過期**：原文寫「Vertex AI Gemini 2.5 Flash」，而現在是 per-task 配置，
不是單一模型。真相在 `backend/app/services/llm_models.py` 的 `TASK_MODELS`，
換模型的流程見 `docs/ai/llm-model-ab-2026-05.md`。

## 切換 GCP 設定

```bash
gcloud config configurations activate lingoleap
```

Vertex AI 必須用 us-central1，asia-east1 不支援 Gemini 模型。

⚠️ 跑任何 `gcloud` 之前先確認 active config 的 project 與 account 是對的 ——
全域 active config 是單一共用的，多個終端機會互搶。

## 查看服務日誌

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=lingoleap-backend" \
  --limit 100 --project lingoleap-dev
```

只看錯誤加上 `AND severity>=ERROR`

## 常見故障排除

**API 503** —— 看 backend 日誌，確認 Vertex AI 連線與 Cloud SQL 狀態

**AI 失效** —— 確認 AI service location 是 us-central1，且 service account 有
`roles/aiplatform.user`

**422 Session Not Found** —— Cloud Run 重啟後記憶體中的 session 被清掉，
學生重新整理即可（前端有自動重建機制）

## CI/CD Workflows

| Workflow | 觸發 | 部署到 |
|---|---|---|
| `deploy.yml` | push `main` | Production |
| `staging-deploy.yml` | push `staging` | Staging |
| `preview-deploy.yml` | PR 開啟／關閉 | PR Preview（PR 關閉後自動刪除） |

```bash
gh run list --limit 10
```

⚠️ **判斷「部署好了沒」不要只看 workflow 綠**。要看正在服務 100% 流量的那個
revision 跑的 image 是不是這次建的：

```bash
gcloud run services describe <service> --region asia-east1 --project lingoleap-dev \
  --format='value(status.traffic)'          # 找 percent: 100 那筆的 revisionName
gcloud run revisions describe <該 revision> --region asia-east1 --project lingoleap-dev
```

`services describe` 的 image 欄位是「下次建 revision 要用哪個 image」的 spec 範本，
不是現況；舊 revision 也會 health 200、也是 `Ready=True`。
