#!/usr/bin/env bash
# iap-list.sh — List who currently has IAP access to staging/preview
# (Issue #3720, follow-up to #3719). For IT/Young's own CLI use; the admin
# page (GET /api/admin/iap-allowlist) is the day-to-day view for everyone
# else and reads this same underlying IAM policy.
#
# Usage:
#   scripts/iap-list.sh [--service=NAME ...] [--project=ID] [--region=REGION]
#
# Default services: both staging services (frontend + backend). Pass
# --service= one or more times to list a specific PR preview service
# instead/also, e.g. --service=lingoleap-frontend-issue-123

set -euo pipefail

PROJECT="lingoleap-dev"
REGION="asia-east1"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

SERVICES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --service=*) SERVICES+=("${1#--service=}") ;;
    --project=*) PROJECT="${1#--project=}" ;;
    --region=*) REGION="${1#--region=}" ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

if [ "${#SERVICES[@]}" -eq 0 ]; then
  SERVICES=("lingoleap-frontend-staging" "lingoleap-backend-staging")
fi

for svc in "${SERVICES[@]}"; do
  log "=== ${svc} (project=${PROJECT}, region=${REGION}) ==="
  gcloud beta iap web get-iam-policy \
    --resource-type=cloud-run \
    --service="${svc}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --format=json
  echo
done
