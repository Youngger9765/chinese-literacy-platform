#!/usr/bin/env bash
# deploy-production.sh — LingoLeap production deployment script
#
# Usage:
#   ./scripts/production/deploy-production.sh [--skip-confirm] [--backend-only] [--frontend-only]
#
# Prerequisites:
#   - gcloud CLI authenticated (gcloud config configurations activate lingoleap)
#   - Docker daemon running
#   - Git working directory is clean
#   - Called from repository root

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT="lingoleap-dev"
REGION="asia-east1"
REGISTRY="asia-east1-docker.pkg.dev/${PROJECT}/lingoleap"
BACKEND_SERVICE="lingoleap-backend"
FRONTEND_SERVICE="lingoleap-frontend"
HEALTH_CHECK_URL_BACKEND="https://lingoleap-backend-958347263320.asia-east1.run.app/api/health"
HEALTH_CHECK_URL_FRONTEND="https://lingoleap-frontend-958347263320.asia-east1.run.app"
HEALTH_CHECK_RETRIES=12
HEALTH_CHECK_INTERVAL=10  # seconds

SKIP_CONFIRM=false
DEPLOY_BACKEND=true
DEPLOY_FRONTEND=true

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
err()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

confirm() {
  local prompt="$1"
  if [[ "${SKIP_CONFIRM}" == "true" ]]; then
    log "Auto-confirming: ${prompt}"
    return 0
  fi
  read -r -p "${prompt} [y/N] " answer
  [[ "${answer}" =~ ^[Yy]$ ]] || die "Aborted by user."
}

wait_healthy() {
  local url="$1"
  local service="$2"
  local attempt=0
  log "Waiting for ${service} to be healthy at ${url} ..."
  until curl -sf -o /dev/null -w "%{http_code}" "${url}" | grep -q "^2"; do
    attempt=$((attempt + 1))
    if [[ ${attempt} -ge ${HEALTH_CHECK_RETRIES} ]]; then
      die "${service} did not become healthy after $((HEALTH_CHECK_RETRIES * HEALTH_CHECK_INTERVAL))s — aborting."
    fi
    log "  attempt ${attempt}/${HEALTH_CHECK_RETRIES} — waiting ${HEALTH_CHECK_INTERVAL}s ..."
    sleep "${HEALTH_CHECK_INTERVAL}"
  done
  log "${service} is healthy."
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "${arg}" in
    --skip-confirm)   SKIP_CONFIRM=true ;;
    --backend-only)   DEPLOY_FRONTEND=false ;;
    --frontend-only)  DEPLOY_BACKEND=false ;;
    *) die "Unknown argument: ${arg}" ;;
  esac
done

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
log "=== LingoLeap Production Deployment ==="
log "Project: ${PROJECT} | Region: ${REGION}"

# Verify gcloud active config
ACTIVE_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
ACTIVE_PROJECT=$(gcloud config get-value project 2>/dev/null)
log "gcloud account: ${ACTIVE_ACCOUNT}"
log "gcloud project: ${ACTIVE_PROJECT}"
[[ "${ACTIVE_PROJECT}" == "${PROJECT}" ]] || die "Wrong gcloud project. Run: gcloud config configurations activate lingoleap"

# Verify git state
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
GIT_STATUS=$(git status --porcelain)
log "Git branch: ${CURRENT_BRANCH}"
[[ "${CURRENT_BRANCH}" == "main" ]] || die "Must deploy from 'main' branch. Current branch: ${CURRENT_BRANCH}"
[[ -z "${GIT_STATUS}" ]] || die "Working directory is not clean. Commit or stash changes first."

# Capture version info
GIT_SHA=$(git rev-parse --short HEAD)
GIT_TAG=$(git describe --tags --always 2>/dev/null || echo "${GIT_SHA}")
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
IMAGE_TAG="${TIMESTAMP}-${GIT_SHA}"

log "Deploying version: ${GIT_TAG} (${GIT_SHA}) — image tag: ${IMAGE_TAG}"

# ---------------------------------------------------------------------------
# Confirmation gate
# ---------------------------------------------------------------------------
echo ""
echo "  BACKEND:   ${DEPLOY_BACKEND}"
echo "  FRONTEND:  ${DEPLOY_FRONTEND}"
echo "  IMAGE TAG: ${IMAGE_TAG}"
echo ""
confirm "Deploy to PRODUCTION?"

# ---------------------------------------------------------------------------
# Build and deploy backend
# ---------------------------------------------------------------------------
if [[ "${DEPLOY_BACKEND}" == "true" ]]; then
  log "--- Building backend image ---"
  gcloud builds submit \
    --tag "${REGISTRY}/backend:${IMAGE_TAG}" \
    --project "${PROJECT}" \
    ./backend

  log "--- Deploying backend to Cloud Run ---"
  gcloud run deploy "${BACKEND_SERVICE}" \
    --image "${REGISTRY}/backend:${IMAGE_TAG}" \
    --platform managed \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --set-env-vars "ENVIRONMENT=production" \
    --no-traffic

  log "--- Verifying backend health before routing traffic ---"
  CANDIDATE_URL=$(gcloud run revisions list \
    --service "${BACKEND_SERVICE}" \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --format "value(status.url)" \
    --limit 1)
  wait_healthy "${CANDIDATE_URL}/api/health" "backend (canary)"

  log "--- Routing 100% traffic to new backend revision ---"
  gcloud run services update-traffic "${BACKEND_SERVICE}" \
    --to-latest \
    --region "${REGION}" \
    --project "${PROJECT}"

  wait_healthy "${HEALTH_CHECK_URL_BACKEND}" "backend (production)"

  # Retain only last 3 prod images
  log "--- Cleaning up old backend images ---"
  OLD_IMAGES=$(gcloud artifacts docker images list \
    "${REGISTRY}/backend" \
    --filter "tags:${BACKEND_SERVICE}-prod-*" \
    --sort-by "~CREATE_TIME" \
    --format "value(DIGEST)" \
    --project "${PROJECT}" 2>/dev/null | tail -n +4 || true)
  if [[ -n "${OLD_IMAGES}" ]]; then
    while IFS= read -r digest; do
      gcloud artifacts docker images delete \
        "${REGISTRY}/backend@${digest}" \
        --quiet --project "${PROJECT}" 2>/dev/null || true
    done <<< "${OLD_IMAGES}"
  fi
fi

# ---------------------------------------------------------------------------
# Build and deploy frontend
# ---------------------------------------------------------------------------
if [[ "${DEPLOY_FRONTEND}" == "true" ]]; then
  log "--- Building frontend image ---"
  gcloud builds submit \
    --tag "${REGISTRY}/frontend:${IMAGE_TAG}" \
    --project "${PROJECT}" \
    ./frontend

  log "--- Deploying frontend to Cloud Run ---"
  gcloud run deploy "${FRONTEND_SERVICE}" \
    --image "${REGISTRY}/frontend:${IMAGE_TAG}" \
    --platform managed \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --port 8080

  wait_healthy "${HEALTH_CHECK_URL_FRONTEND}" "frontend (production)"
fi

# ---------------------------------------------------------------------------
# Post-deployment summary
# ---------------------------------------------------------------------------
log "=== Deployment complete ==="
log "Backend:  ${HEALTH_CHECK_URL_BACKEND}"
log "Frontend: ${HEALTH_CHECK_URL_FRONTEND}"
log "Version:  ${GIT_TAG} (${IMAGE_TAG})"
log ""
log "Next steps:"
log "  1. Smoke-test key user flows in production"
log "  2. Monitor Cloud Monitoring dashboard for 15 minutes"
log "  3. Check error rates in Cloud Logging"
log "  4. Tag the release: git tag prod-${IMAGE_TAG} && git push --tags"
