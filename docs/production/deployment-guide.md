# LingoLeap Production Deployment Guide

## Overview

LingoLeap runs on GCP Cloud Run. Production deployment goes through the
`staging → main` PR flow, followed by the deployment script. Never push
directly to `main`.

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| gcloud CLI | >= 455 | `gcloud version` |
| Docker | >= 24 | `docker version` |
| git | any | `git version` |

```bash
# Activate the correct gcloud configuration
gcloud config configurations activate lingoleap

# Verify
gcloud config get-value account   # youngtsai@junyiacademy.org
gcloud config get-value project   # lingoleap-dev
```

---

## Step-by-Step Deployment

### Step 1 — Merge staging to main via PR

```bash
gh pr create \
  --base main \
  --head staging \
  --title "Release: <description>" \
  --body "## Production Release
- Fixes #N, #M
- <summary of changes>"

# After CI passes and review is approved:
gh pr merge <PR_NUMBER> --merge
```

### Step 2 — Run the deployment script

```bash
# From repository root, on main branch
git checkout main && git pull origin main

./scripts/production/deploy-production.sh
```

The script will:
1. Verify gcloud configuration and clean git state
2. Prompt for confirmation before deploying
3. Build Docker images via Cloud Build
4. Deploy backend with `--no-traffic` first, health-check the canary
5. Route 100% traffic to the new revision
6. Deploy frontend
7. Run final health checks

### Step 3 — Post-deployment smoke test

```bash
./scripts/production/health-check.sh --env production
```

Manually verify key user flows:
- [ ] Teacher can log in
- [ ] Student can start a learning session
- [ ] AI Socratic dialogue responds correctly
- [ ] Assessment report generates

### Step 4 — Tag the release

```bash
git tag prod-$(date '+%Y%m%d')-$(git rev-parse --short HEAD)
git push --tags
```

---

## Environment Variables (Cloud Run)

Set these via Cloud Run console or `gcloud run services update --set-env-vars`.
Never commit them to git.

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Cloud SQL Unix socket connection string |
| `JWT_SECRET_KEY` | Random 64-char hex string |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins |
| `ENVIRONMENT` | Set to `production` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |

---

## Deployment Checklist

Run `docs/production/production-checklist.md` before every deploy.

---

## Rollback

If something is wrong after deploy:

```bash
./scripts/production/rollback.sh --service all
```

See `rollback.sh` for manual revision targeting.

---

## CI/CD Automated Deploys

| Branch | Workflow | Result |
|--------|----------|--------|
| `main` | `.github/workflows/deploy.yml` | Production deploy |
| `staging` | `.github/workflows/staging-deploy.yml` | Staging deploy |
| `fix/issue-*` | `.github/workflows/preview-deploy.yml` | Ephemeral PR preview |

The deployment script in this guide is for **manual / emergency deploys** only.
Normal releases go through the automated CI/CD on `main` push.
