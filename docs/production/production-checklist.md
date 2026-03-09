# LingoLeap Pre-Deployment Production Checklist

Complete this checklist before every production deployment.
Mark each item with `[x]` when confirmed.

---

## 1. Code Quality

- [ ] All PRs targeting `staging` have been reviewed and approved
- [ ] CI/CD pipeline green on `staging` branch
- [ ] No failing tests (`pytest` backend, `npm test` frontend)
- [ ] No critical security alerts from Gitleaks / detect-secrets
- [ ] Dependency audit passed (`pip-audit` backend, `npm audit` frontend)

## 2. Database

- [ ] No pending schema migrations without explicit approval
- [ ] Cloud SQL automated backup confirmed (run: `gcloud sql backups list --instance=lingoleap-db --project=lingoleap-dev --limit=1`)
- [ ] DB disk usage < 80% (`gcloud sql instances describe lingoleap-db --project=lingoleap-dev --format="value(settings.dataDiskSizeGb,diskEncryptionConfiguration)"`)

## 3. Environment Variables

- [ ] `JWT_SECRET_KEY` is set to a non-default value in production Cloud Run env
- [ ] `ENVIRONMENT=production` is set (enables Docs lockout, strictens JWT)
- [ ] `DATABASE_URL` points to Cloud SQL Unix socket (not localhost)
- [ ] `ALLOWED_ORIGINS` includes only production frontend URL (not localhost)
- [ ] `GOOGLE_CLIENT_ID` is set and matches Google Cloud Console

## 4. Secrets / Security

- [ ] No secrets committed to git (`git log --oneline -5` and `git diff HEAD~1 HEAD` reviewed)
- [ ] Gitleaks pre-commit hook active: `cat .git/hooks/pre-commit | grep gitleaks` (or similar)
- [ ] API docs disabled in production (`docs_url=None` in main.py — already implemented)

## 5. Infrastructure

- [ ] Cloud Run backend: `--min-instances=1`, `--max-instances=10`
- [ ] Cloud Run frontend: `--min-instances=1`, `--max-instances=5`
- [ ] Cloud SQL instance: ALWAYS activation policy, auto-storage-increase enabled
- [ ] Budget alert configured in Cloud Billing

## 6. Monitoring

- [ ] Uptime checks active (backend + frontend) — verify in Cloud Monitoring
- [ ] Alert policies confirmed active (5xx rate, latency)
- [ ] On-call email/notification channel receiving test alerts
- [ ] `/api/health/detailed` returns `status: ok` for all components on staging

## 7. Deployment Process

- [ ] Deploying from `main` branch (not `staging`)
- [ ] `git status` is clean (no uncommitted changes)
- [ ] Correct gcloud configuration active: `gcloud config get-value project` = `lingoleap-dev`
- [ ] Rollback plan confirmed: previous Cloud Run revision known

## 8. Communication

- [ ] Team notified of upcoming deployment (Slack/LINE)
- [ ] Deployment window selected (avoid peak hours: 08:00-17:00 Taiwan time)
- [ ] Stakeholder notification sent if user-facing changes are significant

---

## Post-Deployment Verification (complete within 15 min of deploy)

- [ ] `./scripts/production/health-check.sh --env production` — all checks pass
- [ ] Manual smoke test: log in as teacher, start a learning session
- [ ] Check Cloud Monitoring for 5xx spike in first 5 minutes
- [ ] Check Cloud Logging for unexpected ERROR entries
- [ ] Confirm response times are normal (P95 < 2s)
- [ ] Tag the release: `git tag prod-YYYYMMDD-SHA && git push --tags`

---

**If any item fails**: Do not deploy. Fix the issue, then restart the checklist.

**Checklist completed by**: ________________
**Date**: ________________
**Deploy version / image tag**: ________________
