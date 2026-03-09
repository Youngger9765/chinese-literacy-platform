#!/usr/bin/env bash
# rollback.sh — Roll back LingoLeap Cloud Run services to a previous revision
#
# Usage:
#   ./scripts/production/rollback.sh [--service backend|frontend|all] [--revision REVISION_NAME]
#
# If --revision is not specified, rolls back to the second-latest revision
# (i.e. the revision that was serving traffic before the current one).

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT="lingoleap-dev"
REGION="asia-east1"
BACKEND_SERVICE="lingoleap-backend"
FRONTEND_SERVICE="lingoleap-frontend"
HEALTH_CHECK_BACKEND="https://lingoleap-backend-958347263320.asia-east1.run.app/api/health"
HEALTH_CHECK_FRONTEND="https://lingoleap-frontend-958347263320.asia-east1.run.app"
HEALTH_CHECK_RETRIES=12
HEALTH_CHECK_INTERVAL=10

TARGET_SERVICE="all"
TARGET_REVISION=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
err()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; }
die()  { err "$*"; exit 1; }

confirm() {
  local prompt="$1"
  read -r -p "${prompt} [y/N] " answer
  [[ "${answer}" =~ ^[Yy]$ ]] || die "Aborted by user."
}

wait_healthy() {
  local url="$1"
  local service="$2"
  local attempt=0
  log "Waiting for ${service} to be healthy ..."
  until curl -sf -o /dev/null -w "%{http_code}" "${url}" | grep -q "^2"; do
    attempt=$((attempt + 1))
    if [[ ${attempt} -ge ${HEALTH_CHECK_RETRIES} ]]; then
      err "${service} did not recover after $((HEALTH_CHECK_RETRIES * HEALTH_CHECK_INTERVAL))s"
      return 1
    fi
    log "  attempt ${attempt}/${HEALTH_CHECK_RETRIES} — waiting ${HEALTH_CHECK_INTERVAL}s ..."
    sleep "${HEALTH_CHECK_INTERVAL}"
  done
  log "${service} is healthy."
}

rollback_service() {
  local service="$1"
  local health_url="$2"

  log "--- Rolling back ${service} ---"

  # List recent revisions (latest first)
  mapfile -t REVISIONS < <(gcloud run revisions list \
    --service "${service}" \
    --region "${REGION}" \
    --project "${PROJECT}" \
    --sort-by "~DEPLOYED" \
    --format "value(name)" \
    --limit 5)

  if [[ ${#REVISIONS[@]} -lt 2 ]]; then
    die "No previous revision available for ${service}."
  fi

  CURRENT="${REVISIONS[0]}"
  if [[ -n "${TARGET_REVISION}" ]]; then
    ROLLBACK_TO="${TARGET_REVISION}"
  else
    ROLLBACK_TO="${REVISIONS[1]}"
  fi

  log "Current revision:  ${CURRENT}"
  log "Rolling back to:   ${ROLLBACK_TO}"
  confirm "Confirm rollback for ${service}?"

  gcloud run services update-traffic "${service}" \
    --to-revisions "${ROLLBACK_TO}=100" \
    --region "${REGION}" \
    --project "${PROJECT}"

  if wait_healthy "${health_url}" "${service}"; then
    log "Rollback of ${service} to ${ROLLBACK_TO} succeeded."
  else
    die "Rollback of ${service} failed — service is unhealthy. Investigate manually."
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "${arg}" in
    --service=*)   TARGET_SERVICE="${arg#*=}" ;;
    --revision=*)  TARGET_REVISION="${arg#*=}" ;;
    *) die "Unknown argument: ${arg}" ;;
  esac
done

# ---------------------------------------------------------------------------
# Verify gcloud config
# ---------------------------------------------------------------------------
ACTIVE_PROJECT=$(gcloud config get-value project 2>/dev/null)
[[ "${ACTIVE_PROJECT}" == "${PROJECT}" ]] || \
  die "Wrong gcloud project '${ACTIVE_PROJECT}'. Run: gcloud config configurations activate lingoleap"

# ---------------------------------------------------------------------------
# Execute rollback
# ---------------------------------------------------------------------------
log "=== LingoLeap Production Rollback ==="

case "${TARGET_SERVICE}" in
  backend)  rollback_service "${BACKEND_SERVICE}"  "${HEALTH_CHECK_BACKEND}" ;;
  frontend) rollback_service "${FRONTEND_SERVICE}" "${HEALTH_CHECK_FRONTEND}" ;;
  all)
    rollback_service "${BACKEND_SERVICE}"  "${HEALTH_CHECK_BACKEND}"
    rollback_service "${FRONTEND_SERVICE}" "${HEALTH_CHECK_FRONTEND}"
    ;;
  *) die "Unknown service: ${TARGET_SERVICE}. Use: backend | frontend | all" ;;
esac

log "=== Rollback complete ==="
log ""
log "Post-rollback checklist:"
log "  1. Verify user flows are working"
log "  2. Open a post-incident issue on GitHub"
log "  3. Document root cause of the bad deploy"
