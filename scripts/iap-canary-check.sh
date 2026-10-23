#!/usr/bin/env bash
# iap-canary-check.sh — verify IAP end-to-end on a throwaway canary pair
# (issue #3730, proof-of-concept for #3719).
#
# This script only RUNS CHECKS. It does not deploy anything, does not
# enable IAP on anything, and does not grant/revoke any IAM access --
# those are separate, rare, higher-privilege one-off steps a human runs
# by hand (see the companion runbook note this issue adds to
# docs/iap-runbook.md once the experiment is done). Keeping this script
# read-only/curl-only means it's safe to commit and re-run, and it never
# needs the same approval gate the mutating steps do.
#
# Usage:
#   scripts/iap-canary-check.sh <frontend_url> <backend_url> <iap_audience>
#
# <iap_audience> is whatever `gcloud beta run services update --iap`
# reports as the IAP client ID / OAuth audience for the backend service
# once IAP is on (`gcloud run services describe <svc> --format=...` or
# the Cloud Console's IAP page) -- there is no fixed value, it's
# generated per-service when IAP is turned on.
#
# Checks performed, each prints PASS/FAIL/INFO and why:
#   1. Anonymous request to the backend's own origin -> expect IAP to
#      block it (302 to accounts.google.com, or 401/403) -- confirms IAP
#      is actually on and not silently allowing everyone through.
#   2. Request to the backend's own origin with a minted ID token
#      (Proxy-Authorization, via scripts/iap_token.py) -> expect 200 on
#      /api/health -- confirms the token-minting mechanism (#3725) really
#      clears real IAP, not just a hypothetical one.
#   3. The SAME token, sent to the FRONTEND's origin instead (through the
#      same-origin /api proxy from #3728) -> report the status, don't
#      assume. This is the part docs/iap-runbook.md's "已知落差" section
#      flags as unverified: nginx forwards whatever header the caller
#      sent, but if BOTH frontend and backend have IAP, a token scoped to
#      the backend's audience is not necessarily valid for the frontend's
#      own IAP check, and nginx has no way to mint a second one for its
#      own hop to the backend even if it gets through. Expect this one to
#      need investigation, not a clean PASS, on the first run.
set -euo pipefail

FRONTEND_URL="${1:?Usage: $0 <frontend_url> <backend_url> <iap_audience>}"
BACKEND_URL="${2:?Usage: $0 <frontend_url> <backend_url> <iap_audience>}"
IAP_AUDIENCE="${3:?Usage: $0 <frontend_url> <backend_url> <iap_audience>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "=== IAP canary check ==="
log "Frontend : ${FRONTEND_URL}"
log "Backend  : ${BACKEND_URL}"
log "Audience : ${IAP_AUDIENCE}"
echo ""

# ---------------------------------------------------------------------------
# 1. Anonymous request must be blocked
# ---------------------------------------------------------------------------
log "1. Anonymous curl -> ${BACKEND_URL}/api/health (expect blocked)"
ANON_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${BACKEND_URL}/api/health" || echo "000")
log "   HTTP ${ANON_STATUS}"
case "${ANON_STATUS}" in
  302|401|403) log "   PASS — anonymous access is blocked" ;;
  200) log "   FAIL — anonymous access got through. IAP is NOT actually protecting this service." ;;
  *) log "   INFO — unexpected status ${ANON_STATUS}, inspect manually (timeout? DNS? wrong URL?)" ;;
esac
echo ""

# ---------------------------------------------------------------------------
# 2. Token-bearing request to the backend's own origin
# ---------------------------------------------------------------------------
log "2. Token-bearing curl -> ${BACKEND_URL}/api/health (expect 200)"
TOKEN=$(python3 "${REPO_ROOT}/scripts/iap_token.py" "${IAP_AUDIENCE}" 2>&1)
if [ -z "${TOKEN}" ]; then
  log "   FAIL — could not mint a token (no gcloud credentials, or IAP_AUDIENCE wrong). Nothing further to test."
  exit 1
fi
DIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  -H "Proxy-Authorization: Bearer ${TOKEN}" \
  "${BACKEND_URL}/api/health" || echo "000")
log "   HTTP ${DIRECT_STATUS}"
case "${DIRECT_STATUS}" in
  200) log "   PASS — the IAP token helper (#3725) really clears real IAP on the backend's own origin" ;;
  *) log "   FAIL — expected 200, got ${DIRECT_STATUS}. Check: token audience matches this service's IAP client ID? CI service account granted roles/iap.httpsResourceAccessor (scripts/iap-grant.sh)?" ;;
esac
echo ""

# ---------------------------------------------------------------------------
# 3. SAME token, through the frontend's same-origin proxy — the open question
# ---------------------------------------------------------------------------
log "3. Same token -> ${FRONTEND_URL}/api/health (through the #3728 same-origin proxy)"
log "   This is the part docs/iap-runbook.md flags as an unverified gap —"
log "   report the real status, do not assume it works."
PROXIED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  -H "Proxy-Authorization: Bearer ${TOKEN}" \
  "${FRONTEND_URL}/api/health" || echo "000")
log "   HTTP ${PROXIED_STATUS}"
case "${PROXIED_STATUS}" in
  200) log "   result: 200 — the frontend-to-backend hop worked. Needs a second look at WHY (does the frontend's own IAP accept a token scoped to the backend's audience? Or does the frontend itself not have IAP on in this run?) before calling this solved." ;;
  302|401|403) log "   result: ${PROXIED_STATUS} — the hop did NOT work as-is. This matches the predicted gap: nginx can't mint its own IAP credential for the backend call once both services require one." ;;
  *) log "   result: ${PROXIED_STATUS} — inspect manually." ;;
esac
echo ""
log "=== Done. Record these three results in docs/iap-runbook.md's 已知落差 section. ==="
