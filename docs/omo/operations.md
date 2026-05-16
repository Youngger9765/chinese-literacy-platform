# OMO Operations Reference

Reference document for operational concerns across all environments (production, staging, preview).
Maintained as part of Phase 1c env-hardening (#1603, refs #1343).

---

## Item 1 — OAuth Client ID per-env

### How Google Sign-In works in LingoLeap

LingoLeap uses the **Google Identity Services (GSI) One Tap / Sign-In button** flow, NOT the traditional OAuth 2.0 authorization-code redirect flow.

- Frontend (`GoogleSignInButton.tsx`) renders the Google-hosted sign-in button via a `<script src="https://accounts.google.com/gsi/client">` tag.
- On successful sign-in Google invokes a **JavaScript callback** with a short-lived `id_token` (JWT).
- The frontend POSTs that `id_token` directly to `/api/auth/google` (no browser redirect involved).
- The backend (`routes/auth.py`) calls `google.oauth2.id_token.verify_oauth2_token()` to validate the JWT against Google's public keys and the configured `GOOGLE_CLIENT_ID`.

### Why a single OAuth Client ID is safe across environments

Because the GSI flow uses **Authorized JavaScript Origins** (not redirect URIs), sharing the same Client ID across production, staging, and preview is acceptable provided:

1. All origin domains are listed under "Authorized JavaScript origins" in GCP OAuth consent screen → Credentials:
   - `https://lingoleap-frontend-<hash>.asia-east1.run.app` (production)
   - `https://lingoleap-frontend-staging-<hash>.asia-east1.run.app` (staging)
   - `http://localhost:3000` (local dev)
   - Preview origins follow pattern `https://lingoleap-frontend-issue-<N>-<hash>.asia-east1.run.app`

2. There is **no redirect_uri** in this flow; the credential is sent via JavaScript callback, so the classic redirect-URI mismatch problem does not apply.

### Current status (2026-05-14)

- `GOOGLE_CLIENT_ID` is set as a Cloud Run env var independently per environment.
- `VITE_GOOGLE_CLIENT_ID` is baked into the Docker image at build time (Vite env substitution).
- Both production and staging currently use the same OAuth Client ID — this is correct and intentional; no change needed.
- Preview environments inherit the same Client ID from the preview-deploy workflow build args.

### Action required

- **No code change needed.** The current setup is correct for the GSI token-based flow.
- **Operational checklist** (one-time, performed in GCP console):
  - [ ] Verify all three origin domains are listed under "Authorized JavaScript origins" in the OAuth Client.
  - [ ] Add a wildcard-safe origin `https://*.asia-east1.run.app` if preview dynamic URLs are not individually registered (GCP supports wildcard origins for OAuth).

---

## Item 2 — Cron / Scheduled Job Inventory

All scheduled jobs in the LingoLeap codebase. Last audited 2026-05-14.

### 2.1 GitHub Actions cron workflows

| Workflow | Schedule | Side effects | Prod-only gate needed? | Gate status |
|----------|----------|-------------|----------------------|-------------|
| `security-audit.yml` | Weekly Mon 09:00 UTC | Read-only (npm audit, pip audit) | No | N/A — no writes |
| `cleanup.yml` | Weekly Sun 00:00 UTC | Deletes old AR images + Cloud Run revisions | No — only deletes infra artifacts, not user data | N/A — idempotent infra cleanup |
| `preview-cleanup.yml` | Weekly Sun 00:00 UTC | Deletes orphan preview Cloud Run services + AR tags | No — preview services only | N/A — preview resources only |
| `skill-tree-update.yml` | Daily 15:00 UTC | Commits to `staging` branch (analytics update) | No — analytics only, no user-facing side effects | N/A — staging-only by design |

**Conclusion**: None of the four cron workflows require a `ENVIRONMENT=production` guard because:
- Security audit and skill-tree update are read-only / analytics.
- Cleanup workflows delete infra artifacts (images, Cloud Run revisions), not user data; they are safe to run regardless of environment and are already scoped to specific service names.

### 2.2 In-process background tasks (FastAPI BackgroundTasks)

Found in `backend/app/routes/omo.py` (lines 479, 605, 708, 795).

These are **per-request async tasks** (e.g., image processing, score calculation) triggered by user actions — not scheduled crons. They run in all environments as expected. No prod-only gate needed.

### 2.3 Cloud Scheduler / Cloud Run Jobs

```
gcloud scheduler jobs list --location asia-east1 --project lingoleap-dev
# → 0 jobs listed

gcloud run jobs list --region asia-east1 --project lingoleap-dev
# → 0 jobs listed
```

No external cron infrastructure exists. All scheduling is handled via GitHub Actions.

### Action required

No changes made — all scheduled jobs audited and confirmed safe across environments.

---

## Item 3 — Logging Environment Tag

### Change implemented in #1603

`backend/app/utils/logging_config.py` was updated to:

1. **Apply JSON logging to staging and preview** (previously only production used JSON; staging used human-readable format, making Cloud Logging filtering impossible across environments).

2. **Inject `env` field into every log record** via a new `_EnvFilter` class. The filter attaches `record.env = ENVIRONMENT` so the JSON formatter emits it as a top-level field.

### Before (staging logs)

```
2026-05-14T09:00:00 app.main INFO HTTP GET /api/health -> 200 (12.3ms)
```
Human-readable only — no `env` field, not machine-parseable in Cloud Logging.

### After (staging logs)

```json
{
  "timestamp": "2026-05-14T09:00:00",
  "name": "app.main",
  "severity": "INFO",
  "env": "staging",
  "message": "HTTP GET /api/health -> 200 (12.3ms)",
  "request_id": "abc-123",
  "method": "GET",
  "path": "/api/health",
  "status_code": 200,
  "duration_ms": 12.3
}
```

### Filtering by environment in Cloud Logging

```
# Show only staging errors (excludes production noise):
resource.type="cloud_run_revision"
jsonPayload.env="staging"
severity>=ERROR

# Compare error rates across environments:
resource.type="cloud_run_revision"
jsonPayload.env=("staging" OR "preview")
jsonPayload.status_code>=500
```

### Environments and their JSON logging status after #1603

| ENVIRONMENT value | JSON logging | `env` field emitted |
|-------------------|-------------|---------------------|
| `production` | Yes | `"production"` |
| `staging` | Yes (new) | `"staging"` |
| `preview` | Yes (new) | `"preview"` |
| `development` (local) | No (human-readable) | No |
| unset (local, no K_SERVICE) | No (human-readable) | No |

---

## Environment Variable Reference

| Var | Production | Staging | Preview | Local dev |
|-----|------------|---------|---------|-----------|
| `ENVIRONMENT` | `production` | `staging` | `preview` | unset |
| `GOOGLE_CLIENT_ID` | shared client | same client | same client | unset (feature off) |
| `VITE_GOOGLE_CLIENT_ID` | shared client | same client | same client | unset or local |
| `GCS_OMO_BUCKET` | `lingoleap-omo-uploads-prod` | `lingoleap-omo-uploads-staging` | `lingoleap-omo-uploads-preview` | `lingoleap-omo-uploads` |
| `ENABLE_TEST_SEED` | `false` | unset (defaults true) | unset (defaults true) | unset |
| `SENTRY_DSN` | set | unset | unset | unset |
