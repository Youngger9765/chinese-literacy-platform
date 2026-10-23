#!/usr/bin/env bash
# iap-grant.sh — Grant a person temporary IAP access to staging/preview
# (Issue #3720, follow-up to #3719). For IT/Young to run by hand; this is
# NOT called by any automated pipeline.
#
# Usage:
#   scripts/iap-grant.sh <email> <duration like 7d> "<name>" [options]
#
# Options:
#   --service=NAME   Cloud Run service to grant on (repeatable).
#                     Default: both staging services (frontend + backend).
#                     Pass this to ALSO grant on a specific PR preview
#                     service, e.g. --service=lingoleap-frontend-issue-123
#   --project=ID      Default: lingoleap-dev
#   --region=REGION   Default: asia-east1
#
# Example:
#   scripts/iap-grant.sh hans@example.com 7d "Hans 劉燁"
#   scripts/iap-grant.sh hans@example.com 14d "Hans 劉燁" --service=lingoleap-frontend-issue-3700
#
# Refuses to run against production services (lingoleap-frontend /
# lingoleap-backend, exact names, no -staging or -issue- suffix) — this
# script only ever grants staging/preview access, never prod.

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
PROJECT="lingoleap-dev"
REGION="asia-east1"
ROLE="roles/iap.httpsResourceAccessor"

# Exact Cloud Run service names used in production (see
# scripts/production/rollback.sh) — this script must never target these.
PROD_SERVICES=("lingoleap-frontend" "lingoleap-backend")

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2; exit 1; }

is_prod_service() {
  local svc="$1"
  for prod in "${PROD_SERVICES[@]}"; do
    [[ "${svc}" == "${prod}" ]] && return 0
  done
  return 1
}

usage() {
  sed -n '2,20p' "$0"
  exit 1
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
[ $# -lt 3 ] && usage

EMAIL="$1"; shift
DURATION="$1"; shift
NAME="$1"; shift

SERVICES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --service=*) SERVICES+=("${1#--service=}") ;;
    --project=*) PROJECT="${1#--project=}" ;;
    --region=*) REGION="${1#--region=}" ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

if [ "${#SERVICES[@]}" -eq 0 ]; then
  SERVICES=("lingoleap-frontend-staging" "lingoleap-backend-staging")
fi

for svc in "${SERVICES[@]}"; do
  if is_prod_service "${svc}"; then
    die "Refusing to grant IAP access on production service '${svc}'. This script only grants staging/preview access."
  fi
done

[[ "${EMAIL}" == *"@"* ]] || die "Not an email: ${EMAIL}"

# A condition title is a free-text label in gcloud's KEY=VALUE,KEY=VALUE
# syntax — a comma in it would be read as the start of the next key, so
# strip any the caller passed in rather than letting the gcloud call break
# in a confusing way.
if [[ "${NAME}" == *,* ]]; then
  log "⚠️  Name contains a comma — removing it (gcloud --condition uses commas as a separator)."
  NAME="${NAME//,/ }"
fi

# ---------------------------------------------------------------------------
# Duration → absolute UTC expiry timestamp
# ---------------------------------------------------------------------------
DAYS="${DURATION%d}"
if [[ "${DAYS}" != "${DURATION}" && "${DAYS}" =~ ^[0-9]+$ ]]; then
  : # matched "<N>d"
else
  die "Duration must look like '7d' (days only), got: ${DURATION}"
fi

if date -u -v+${DAYS}d +"%Y-%m-%dT%H:%M:%SZ" >/dev/null 2>&1; then
  EXPIRY="$(date -u -v+${DAYS}d +"%Y-%m-%dT%H:%M:%SZ")"   # BSD/macOS date
else
  EXPIRY="$(date -u -d "+${DAYS} days" +"%Y-%m-%dT%H:%M:%SZ")"   # GNU date
fi

CONDITION_TITLE="${NAME}"
CONDITION="expression=request.time < timestamp(\"${EXPIRY}\"),title=${CONDITION_TITLE}"

# ---------------------------------------------------------------------------
# Grant
# ---------------------------------------------------------------------------
log "Granting ${ROLE} to user:${EMAIL} (${NAME}), expiring ${EXPIRY}"
for svc in "${SERVICES[@]}"; do
  log "  → ${svc} (project=${PROJECT}, region=${REGION})"
  gcloud beta iap web add-iam-policy-binding \
    --member="user:${EMAIL}" \
    --role="${ROLE}" \
    --resource-type=cloud-run \
    --service="${svc}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --condition="${CONDITION}"
done

log "Done. Verify with: scripts/iap-list.sh"
