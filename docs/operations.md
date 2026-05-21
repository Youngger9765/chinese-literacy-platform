# Operations Runbook

Cross-environment runbook covering security secrets, deploy quirks, and infrastructure cleanup.
For OMO-specific operations see `docs/omo/operations.md`.

Last updated: 2026-05-17

---

## 1. JWT Secret Rotation (prod + staging)

### When to rotate

- **Quarterly** (calendar reminder Q1/Q2/Q3/Q4) — proactive hygiene
- **Immediately** if any of the following:
  - Suspect a developer with secret access has left the team
  - A `dev-secret-change-in-production` fallback is detected in prod logs
  - GitHub repo visibility changed or compromised
  - Pre-commit gitleaks alert hits a JWT-shaped string

### Procedure

```bash
# 1. Generate fresh 32-byte secret (never reuse)
SECRET=$(openssl rand -hex 32)

# 2. Set as GitHub repo secret (write-only — value never readable again)
echo "$SECRET" | gh secret set PROD_JWT_SECRET_KEY --repo Youngger9765/chinese-literacy-platform
# For staging: STAGING_JWT_SECRET_KEY

# 3. Clear local var immediately
unset SECRET

# 4. Verify (returns last-updated timestamp, not value)
gh secret list | grep PROD_JWT_SECRET_KEY

# 5. Trigger deploy to apply
gh workflow run deploy.yml --ref main
# (workflow_dispatch — see section 2 for why)
```

### Consequence to users

**All existing JWTs invalidated immediately** when new revision serves. Every logged-in user must re-login. Web app handles this gracefully via `SessionExpiredError` flow (see `api.ts`).

### Verification post-rotation

```bash
# 1. New Cloud Run revision deployed
gcloud run services describe lingoleap-backend \
  --region asia-east1 --project lingoleap-dev \
  --format='value(status.latestReadyRevisionName)'
# Expect newer revision number than before rotation

# 2. Backend health
curl -s https://lingoleap-backend-958347263320.asia-east1.run.app/api/health
# Expect: {"status":"ok","version":"0.3.0"}

# 3. Try logging in via frontend with demo account — verify new JWT issued
```

### Historical incident

**2026-05-16**: PR #1651 hotfix discovered prod was running on the public-knowable `dev-secret-change-in-production` default. The JWT enforcement check (`main.py:72`) was added in commit `3977a79f` but `deploy.yml` never injected the secret like `staging-deploy.yml` did (PR #1580). Fixed in PR #1651 — added `JWT_SECRET_KEY=${{ secrets.PROD_JWT_SECRET_KEY }}` to deploy.yml `--set-env-vars` list.

---

## 2. Cloud Run `workflow_dispatch` override

### Why `gh workflow run deploy.yml` instead of merging an empty backend commit

`deploy.yml` uses `dorny/paths-filter@v4` to skip `deploy-backend` / `deploy-frontend` when only docs / workflows change:

```yaml
deploy-backend:
  if: needs.detect-changes.outputs.backend == 'true' || github.event_name == 'workflow_dispatch'
```

The `workflow_dispatch` override clause means a **manual trigger** runs deploy unconditionally, regardless of file paths. This is the correct path for:

- Hotfixing workflow-only changes (e.g. PR #1651 deploy.yml env var addition)
- Forcing a clean redeploy after manual Cloud Run state change
- Emergency rollback to a known-good main commit

### Procedure

```bash
# Manual trigger on main (latest commit)
gh workflow run deploy.yml --ref main

# Watch the resulting run
gh run list --branch main --workflow deploy.yml --limit 1
gh run watch <RUN_ID> --exit-status
```

### Verify deploy succeeded

```bash
# Backend revision should be new
gcloud run services describe lingoleap-backend \
  --region asia-east1 --project lingoleap-dev \
  --format='value(status.latestReadyRevisionName)'

# Frontend bundle hash should be new
curl -s https://lingoleap-prod.web.app/ | \
  grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1
```

### Trap: --set-env-vars wipes all env vars

`deploy.yml` uses `gcloud run deploy --set-env-vars` (not `--update-env-vars`). The `--set-env-vars` flag **replaces the entire env list**. When editing the workflow, always include the FULL var list, even unchanged ones. See `feedback_gcloud_set_env_vars.md` in memory.

---

## 3. Artifact Registry Cleanup Monitoring

### Policy state (applied 2026-05-16)

5-policy cleanup config on `lingoleap` repo (asia-east1):

| Policy | Action | Condition |
|--------|--------|-----------|
| `delete-untagged` | DELETE | UNTAGGED + olderThan 604800s (7 days) |
| `delete-old-issue-tags` | DELETE | TAGGED + prefix `issue-` + olderThan 1209600s (14 days) |
| `delete-old-v0-tags` | DELETE | TAGGED + prefix `v0.` + olderThan 5184000s (60 days) |
| `delete-old-staging-tags` | DELETE | TAGGED + prefix `staging-` + olderThan 2592000s (30 days) |
| `keep-recent-tagged` | KEEP | Most recent 3 versions |

### Async behavior

Google runs cleanup policies on a **24-48 hour async schedule**. Don't expect immediate size drop after applying. Verify size 24-48h after policy change.

### Verify cleanup progress

```bash
# Repo size
gcloud artifacts repositories describe lingoleap \
  --location asia-east1 --project lingoleap-dev \
  2>&1 | grep "Repository Size"

# Tag inventory by prefix
gcloud artifacts docker images list \
  asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend \
  --include-tags --limit 200 --format='value(tags)' 2>/dev/null | \
  awk '
    /^prod-/ {p++}
    /^staging-/ {s++}
    /^issue-/ {i++}
    /^$/ {u++}
    END {printf "prod=%d staging=%d issue=%d untagged=%d total=%d\n", p, s, i, u, p+s+i+u}'

# Frontend image count
gcloud artifacts docker images list \
  asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend \
  --limit 500 --format='value(digest)' 2>/dev/null | wc -l
```

### Baseline (2026-05-17 00:32)

- Repo size: **269 GB** (post-application of new policies)
- Backend: prod=22 / staging=103 / issue=75 / untagged=0 / total=200
- Frontend: 300 images
- Expected drop within 48h: ≥ ~50 GB (issue-* older than 14d + v0.* older than 60d + staging-* older than 30d)

### Verified 24h later (2026-05-18 10:12)

- Repo size: **108 GB** (-161 GB / **-60%** vs baseline) — policies proven effective
- Backend: prod=26 / staging=102 / issue=72 / untagged=0 / total=200 (proportions shifted, total stable)
- Frontend: 429 images (+129 — preview PR builds outpacing v0.* deletion this cycle; expect further drop)
- Real drop **3× the conservative ≥50 GB estimate**. Realistic monthly cost now **~$11/month** vs original $27/month projection

### Cost note

asia-east1 standard storage: ~$0.10/GB-month. 269 GB ≈ $27/month, dropped to ~$11/month at 108 GB. Net savings ~$190/year proven (originally projected $200-250).

### Modify policies

```bash
# Save policy JSON to file, then apply
gcloud artifacts repositories set-cleanup-policies lingoleap \
  --project lingoleap-dev \
  --location asia-east1 \
  --policy=/path/to/policy.json
```

### Policy JSON template (current 5-policy config)

```json
[
  {
    "name": "delete-untagged",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "UNTAGGED",
      "olderThan": "604800s"
    }
  },
  {
    "name": "delete-old-issue-tags",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "TAGGED",
      "tagPrefixes": ["issue-"],
      "olderThan": "1209600s"
    }
  },
  {
    "name": "delete-old-v0-tags",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "TAGGED",
      "tagPrefixes": ["v0."],
      "olderThan": "5184000s"
    }
  },
  {
    "name": "delete-old-staging-tags",
    "action": {"type": "Delete"},
    "condition": {
      "tagState": "TAGGED",
      "tagPrefixes": ["staging-"],
      "olderThan": "2592000s"
    }
  },
  {
    "name": "keep-recent-tagged",
    "action": {"type": "Keep"},
    "mostRecentVersions": {
      "keepCount": 3
    }
  }
]
```

Tune `olderThan` values per tag prefix as cost vs rollback safety trade-off requires.

---

## 4. Cross-environment matrix

| Concern | Prod | Staging | Preview |
|---------|------|---------|---------|
| Cloud SQL | `lingoleap-db` | `lingoleap-staging-db` (separate, PR #1579) | `lingoleap-preview-db` (separate, `PREVIEW_DATABASE_URL`) |
| GCS OMO bucket | `lingoleap-omo-uploads-prod` | `lingoleap-omo-uploads-staging` | `lingoleap-omo-uploads-preview` |
| JWT secret | `PROD_JWT_SECRET_KEY` | `STAGING_JWT_SECRET_KEY` | ❌ **NOT SET** — see security note below |
| Demo accounts | **disabled** (PR #1576 5/16) | enabled (王管理員 / 李老師 / 小明) | enabled |
| Auto-deploy trigger | push to `main` | push to `staging` | PR opened / updated |

---

## 4.1 Preview env JWT (fixed 2026-05-18 PR #1664)

**Original concern (before fix)**: `.github/workflows/preview-deploy.yml` did NOT inject `JWT_SECRET_KEY`. Preview Cloud Run ran with `settings.jwt_secret_key = ""` (empty string default in `config.py`).

**Why preview didn't crash on startup**: `main.py:67` defines `_is_dev = _env in ("development", "preview")`. The startup check only raises `RuntimeError` for `not _is_dev` — preview is treated as dev-like by design and only emits a warning when secret is empty. **Not a "mysterious bug" — intentional dev-tolerance.**

**Real impact**: preview JWTs were signed with empty string → trivially forgeable. Mitigated by ephemeral preview lifetime + isolated `lingoleap-preview-db`, but inconsistent security posture vs staging + prod.

**Fix applied** (Issue #1664 / PR fix/issue-1664-preview-jwt-inject):
- New GitHub secret `PREVIEW_JWT_SECRET_KEY` (32-byte hex from `openssl rand -hex 32`)
- `preview-deploy.yml` `--set-env-vars` now includes `JWT_SECRET_KEY=${{ secrets.PREVIEW_JWT_SECRET_KEY }}`
- Effective on next preview deploy (existing previews keep old behavior until redeployed)

Verify post-fix: `grep -c JWT_SECRET_KEY .github/workflows/preview-deploy.yml` returns 1.

---

## 5. Related docs

- `docs/omo/operations.md` — OMO Phase 1c env hardening detail (OAuth, cron, logging)
- `docs/omo/architecture.md` — OMO system diagram
- `docs/omo/debug-log.md` — OMO bug chronology
- `CLAUDE.md` — project root, GCP gcloud config + deploy commands
