# LingoLeap Monitoring Setup Guide

## Architecture

```
Cloud Run (backend + frontend)
  └── Cloud Logging (structured JSON logs)
  └── Cloud Monitoring
        ├── Uptime Checks (every 1 min)
        ├── Alert Policies (5xx rate, latency, error count)
        └── Log-based Metrics (AI errors, DB errors)
```

---

## 1. Uptime Checks

Create via Cloud Monitoring > Uptime Checks.

### Backend health check

| Field | Value |
|-------|-------|
| Target | HTTPS |
| Hostname | lingoleap-backend-958347263320.asia-east1.run.app |
| Path | /api/health |
| Check interval | 1 minute |
| Timeout | 10 seconds |
| Regions | asia-east1, us-central1, europe-west1 |
| Alert delay | 2 consecutive failures |

### Frontend check

| Field | Value |
|-------|-------|
| Target | HTTPS |
| Hostname | lingoleap-frontend-958347263320.asia-east1.run.app |
| Path | / |
| Check interval | 1 minute |
| Expected response code | 200 |

---

## 2. Alert Policies

### 2a. High 5xx Error Rate

```yaml
displayName: "LingoLeap Backend — High 5xx Error Rate"
conditions:
  - displayName: "5xx rate > 1%"
    conditionThreshold:
      filter: >
        resource.type="cloud_run_revision"
        AND resource.labels.service_name="lingoleap-backend"
        AND metric.type="run.googleapis.com/request_count"
        AND metric.labels.response_code_class="5xx"
      comparison: COMPARISON_GT
      thresholdValue: 0.01       # 1% of requests
      duration: 120s             # sustained for 2 minutes
      aggregations:
        - alignmentPeriod: 60s
          perSeriesAligner: ALIGN_RATE
notificationChannels:
  - <your-email-notification-channel-id>
alertStrategy:
  autoClose: 1800s               # auto-close after 30 min if resolved
```

### 2b. High Latency

```yaml
displayName: "LingoLeap Backend — P95 Latency > 2s"
conditions:
  - displayName: "P95 request latency"
    conditionThreshold:
      filter: >
        resource.type="cloud_run_revision"
        AND resource.labels.service_name="lingoleap-backend"
        AND metric.type="run.googleapis.com/request_latencies"
      comparison: COMPARISON_GT
      thresholdValue: 2000       # milliseconds
      duration: 180s
      aggregations:
        - alignmentPeriod: 60s
          perSeriesAligner: ALIGN_PERCENTILE_95
```

### 2c. Uptime Check Failure

Automatically created when you create the Uptime Check in step 1.
Customize notification channel to PagerDuty or email.

### 2d. Budget Alert (Cost Control)

Cloud Billing > Budgets & Alerts > Create budget:

| Field | Value |
|-------|-------|
| Project | lingoleap-dev |
| Amount | $200/month |
| Alert thresholds | 50%, 75%, 90%, 100% |
| Notification | Email to billing admins |

---

## 3. Log-based Metrics

### 3a. AI Service Errors

```bash
gcloud logging metrics create lingoleap_ai_errors \
  --description="Count of AI service errors" \
  --log-filter='
    resource.type="cloud_run_revision"
    resource.labels.service_name="lingoleap-backend"
    jsonPayload.message=~"AI service error|circuit breaker|Vertex AI"
    severity>=ERROR
  ' \
  --project=lingoleap-dev
```

### 3b. Database Connection Errors

```bash
gcloud logging metrics create lingoleap_db_errors \
  --description="Count of database connection errors" \
  --log-filter='
    resource.type="cloud_run_revision"
    resource.labels.service_name="lingoleap-backend"
    jsonPayload.message=~"database|psycopg|SQLAlchemy"
    severity>=ERROR
  ' \
  --project=lingoleap-dev
```

### 3c. Authentication Failures

```bash
gcloud logging metrics create lingoleap_auth_failures \
  --description="Count of authentication failures (HTTP 401/403)" \
  --log-filter='
    resource.type="cloud_run_revision"
    resource.labels.service_name="lingoleap-backend"
    jsonPayload.status_code=~"401|403"
  ' \
  --project=lingoleap-dev
```

---

## 4. Notification Channels

### Email

```bash
gcloud alpha monitoring channels create \
  --channel-content='{"type":"email","displayName":"On-call team","labels":{"email_address":"oncall@junyiacademy.org"}}' \
  --project=lingoleap-dev
```

### LINE Notify (optional for mobile alerts)

Use Cloud Functions as a webhook bridge:
1. Create a Cloud Function triggered by Pub/Sub
2. Function calls LINE Notify API
3. Configure Pub/Sub as alert notification channel

---

## 5. Cloud Run Auto-scaling

```bash
# Backend: scale to 0 in off-hours, cap at 10 for cost control
gcloud run services update lingoleap-backend \
  --min-instances=1 \
  --max-instances=10 \
  --concurrency=80 \
  --cpu=1 \
  --memory=512Mi \
  --region=asia-east1 \
  --project=lingoleap-dev

# Frontend: mostly static, low CPU
gcloud run services update lingoleap-frontend \
  --min-instances=1 \
  --max-instances=5 \
  --concurrency=200 \
  --cpu=1 \
  --memory=256Mi \
  --region=asia-east1 \
  --project=lingoleap-dev
```

`min-instances=1` avoids cold start for students during school hours.

---

## 6. Database Backup

Cloud SQL automated backups are enabled by default. Verify settings:

```bash
gcloud sql instances describe lingoleap-db \
  --project=lingoleap-dev \
  --format="value(settings.backupConfiguration)"
```

Recommended settings:
- Enabled: true
- Start time: 03:00 (Taiwan time = 19:00 UTC)
- Retention: 7 days
- Point-in-time recovery: enabled
- Transaction log retention: 7 days

---

## 7. Error Reporting

Cloud Error Reporting is automatically populated from structured logs with
`severity=ERROR`. Visit:
`https://console.cloud.google.com/errors?project=lingoleap-dev`

No additional setup required — FastAPI's unhandled exception middleware
already emits structured error logs.

---

## 8. Dashboard

Import the Cloud Monitoring dashboard JSON from
`docs/production/cloud-monitoring-dashboard.json` (to be created by ops team)
or create custom widgets for:

- Request rate (RPM) — backend
- 5xx error rate — backend
- P50/P95 latency — backend
- Active Cloud Run instances — backend + frontend
- AI error count — log-based metric
- DB connection errors — log-based metric
