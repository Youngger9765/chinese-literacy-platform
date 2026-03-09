# LingoLeap Operational Runbook

## How to use this runbook

1. Identify the incident type from the section headers below
2. Follow the steps in order
3. If unresolved after 15 minutes → escalate to Young (lead dev)
4. Document the incident in a GitHub Issue with label `incident`

**Alert notification channel**: Set up in `monitoring-setup.md`

---

## Incident 1 — High Latency (P95 > 2s)

**Symptoms**: Slow page loads, API timeout errors, users complain of lag.

**Triage**:

```bash
# 1. Check current request latency
gcloud run services describe lingoleap-backend \
  --region=asia-east1 --project=lingoleap-dev \
  --format="table(status.latestReadyRevisionName,status.traffic)"

# 2. Check recent error logs for slow requests
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="lingoleap-backend"
   jsonPayload.duration_ms > 2000' \
  --limit=20 --project=lingoleap-dev \
  --format="value(jsonPayload.path, jsonPayload.duration_ms)"

# 3. Check instance count (are we at max?)
gcloud monitoring read \
  "resource.type=cloud_run_revision AND metric.type=run.googleapis.com/container/instance_count" \
  --project=lingoleap-dev
```

**Common causes and fixes**:

| Cause | Fix |
|-------|-----|
| Cold start (min-instances=0) | `gcloud run services update lingoleap-backend --min-instances=1` |
| DB connection pool exhausted | Restart backend: `gcloud run services update-traffic lingoleap-backend --to-latest` |
| AI service (Vertex AI) slow | See Incident 4 — AI Service Failures |
| High traffic spike | Increase max-instances: `gcloud run services update lingoleap-backend --max-instances=20` |

---

## Incident 2 — 5xx Error Spike

**Symptoms**: HTTP 500/502/503 responses. Uptime check failing.

**Triage**:

```bash
# 1. Run health check
./scripts/production/health-check.sh --env production

# 2. Check recent errors
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="lingoleap-backend"
   severity>=ERROR' \
  --limit=30 --project=lingoleap-dev \
  --format="value(timestamp, jsonPayload.message)"

# 3. Check for recent deployment (may be the cause)
gcloud run revisions list \
  --service=lingoleap-backend \
  --region=asia-east1 \
  --project=lingoleap-dev \
  --sort-by="~DEPLOYED" \
  --limit=3
```

**Escalation path**:

1. Errors started after a deploy → **rollback immediately**:
   ```bash
   ./scripts/production/rollback.sh --service backend
   ```

2. Errors unrelated to deploy → investigate logs, fix, deploy patch

3. DB is down → see Incident 3

---

## Incident 3 — Database Issues

**Symptoms**: `database` component shows `error` in `/api/health/detailed`.
Backend logs show `psycopg2.OperationalError` or `SQLAlchemy` connection errors.

**Triage**:

```bash
# 1. Check Cloud SQL instance status
gcloud sql instances describe lingoleap-db \
  --project=lingoleap-dev \
  --format="value(state, settings.activationPolicy)"

# 2. Check backend health detail
curl -s https://lingoleap-backend-958347263320.asia-east1.run.app/api/health/detailed \
  | python3 -m json.tool
```

**Common fixes**:

| Issue | Fix |
|-------|-----|
| Cloud SQL instance stopped | `gcloud sql instances patch lingoleap-db --activation-policy=ALWAYS --project=lingoleap-dev` |
| Connection pool exhausted | Restart backend service (see rollback procedure) |
| DB max connections reached | Check `max_connections` in Cloud SQL flags; consider connection pooler |
| Disk full | `gcloud sql instances patch lingoleap-db --storage-auto-increase --project=lingoleap-dev` |

**If data loss is suspected**:

```bash
# List available backups
gcloud sql backups list --instance=lingoleap-db --project=lingoleap-dev

# Restore from backup (DESTRUCTIVE — confirm with team lead first)
# gcloud sql backups restore <BACKUP_ID> --restore-instance=lingoleap-db --project=lingoleap-dev
```

---

## Incident 4 — AI Service Failures

**Symptoms**: Socratic dialogue returns 503. Logs show `circuit breaker open` or
`Vertex AI` errors. Assessment reports fail to generate.

**Check**:

```bash
# 1. Check AI component status
curl -s https://lingoleap-backend-958347263320.asia-east1.run.app/api/health/detailed \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['components']['ai_service'])"

# 2. Check Vertex AI quota
gcloud logging read \
  'resource.type="cloud_run_revision"
   jsonPayload.message=~"Vertex AI|circuit breaker|RESOURCE_EXHAUSTED"' \
  --limit=10 --project=lingoleap-dev
```

**Common causes**:

| Cause | Action |
|-------|--------|
| Vertex AI quota exceeded | Check quota in console; request increase |
| Service account permissions revoked | Verify SA has `roles/aiplatform.user` |
| Model ID changed | Check `ai_service.py` — model must be `gemini-2.5-flash`, location `us-central1` |
| Circuit breaker tripped (3 consecutive errors) | Restart backend; investigate root cause first |

**Circuit breaker reset** (restart the backend):

```bash
gcloud run services update-traffic lingoleap-backend \
  --to-latest \
  --region=asia-east1 \
  --project=lingoleap-dev
```

Note: Circuit breaker is in-memory. A restart resets it. Fix root cause before restarting.

---

## Incident 5 — Frontend Not Loading

**Symptoms**: Blank page, 404, or static assets fail to load.

**Check**:

```bash
# 1. HTTP status
curl -s -o /dev/null -w "%{http_code}" \
  https://lingoleap-frontend-958347263320.asia-east1.run.app/

# 2. Check Cloud Run status
gcloud run services describe lingoleap-frontend \
  --region=asia-east1 --project=lingoleap-dev \
  --format="value(status.conditions)"
```

**Fixes**:

```bash
# Rollback frontend only
./scripts/production/rollback.sh --service frontend

# Or force redeploy from main
./scripts/production/deploy-production.sh --frontend-only --skip-confirm
```

---

## Incident 6 — Authentication / Login Failures

**Symptoms**: Users cannot log in. JWT errors in logs.

**Check**:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision"
   resource.labels.service_name="lingoleap-backend"
   (jsonPayload.message=~"JWT|token|auth" OR jsonPayload.status_code="401")' \
  --limit=20 --project=lingoleap-dev
```

**Possible causes**:

| Cause | Fix |
|-------|-----|
| `JWT_SECRET_KEY` env var missing | Set env var in Cloud Run console |
| Google OAuth `GOOGLE_CLIENT_ID` mismatch | Verify env var matches Firebase/GCP console |
| Token expired (8h default) | Normal — users need to re-login |
| Clock skew | Cloud Run handles NTP automatically |

---

## Escalation Matrix

| Severity | Example | Response Time | Escalate To |
|----------|---------|---------------|-------------|
| P0 — Site down | All users blocked | 15 min | Young immediately |
| P1 — Partial outage | AI not working | 1 hour | Young within 30 min |
| P2 — Degraded | Slow responses | 4 hours | Next business day |
| P3 — Minor | Cosmetic bug | 1 week | Normal issue queue |

---

## Post-Incident Process

1. Service restored → write incident summary
2. Create GitHub Issue with label `incident` and `postmortem`
3. Fill in:
   - Timeline (detection → mitigation → resolution)
   - Root cause
   - Impact (users affected, duration)
   - Action items (prevent recurrence)
4. Share with team in next standup
