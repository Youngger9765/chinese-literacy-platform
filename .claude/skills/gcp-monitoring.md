# GCP Monitoring & Alerting

## Overview
LingoLeap 的監控和告警系統，全部使用 GCP 內建免費服務。

## Uptime Checks (每 5 分鐘)

| Check | Host | Path |
|-------|------|------|
| LingoLeap Frontend | `lingoleap-frontend-958347263320.asia-east1.run.app` | `/` |
| LingoLeap Backend | `lingoleap-backend-958347263320.asia-east1.run.app` | `/` |

## Alert Policies

| Policy | Trigger | Action |
|--------|---------|--------|
| LingoLeap Frontend Down | Frontend uptime check 連續失敗 5 分鐘 | Email 通知 |
| LingoLeap Backend Down | Backend uptime check 連續失敗 5 分鐘 | Email 通知 |
| LingoLeap Backend Errors | Backend Cloud Run 出現 ERROR 等級 log | Email 通知（每 5 分鐘限一次） |

## Error Reporting

- API: `clouderrorreporting.googleapis.com` 已啟用
- Cloud Run + Python 自動收集 unhandled exception
- 不需額外 SDK，exception 寫到 stderr 即自動歸類

## Notification Channel

- Type: Email
- Address: `youngtsai@junyiacademy.org`

## 管理指令

```bash
# 查看 uptime checks
gcloud alpha monitoring uptime list-configs --project lingoleap-dev

# 查看 alert policies
gcloud alpha monitoring policies list --project lingoleap-dev

# 查看通知管道
gcloud alpha monitoring channels list --project lingoleap-dev

# 查看 Error Reporting（瀏覽器）
# https://console.cloud.google.com/errors?project=lingoleap-dev
```

## 費用

全部免費（GCP Cloud Monitoring 免費額度內）。
