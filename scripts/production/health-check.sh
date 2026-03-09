#!/usr/bin/env bash
# health-check.sh — Verify all LingoLeap production services are healthy
#
# Usage:
#   ./scripts/production/health-check.sh [--env staging|production]
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ENV="production"
PASS=0
FAIL=0

for arg in "$@"; do
  case "${arg}" in
    --env=*) ENV="${arg#*=}" ;;
    *) echo "Unknown argument: ${arg}"; exit 1 ;;
  esac
done

case "${ENV}" in
  production)
    BACKEND_URL="https://lingoleap-backend-958347263320.asia-east1.run.app"
    FRONTEND_URL="https://lingoleap-frontend-958347263320.asia-east1.run.app"
    ;;
  staging)
    BACKEND_URL="https://lingoleap-backend-staging-958347263320.asia-east1.run.app"
    FRONTEND_URL="https://lingoleap-frontend-staging-958347263320.asia-east1.run.app"
    ;;
  *)
    echo "Unknown environment: ${ENV}. Use: staging | production"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

check_http() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local timeout="${4:-10}"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time "${timeout}" "${url}" 2>/dev/null || echo "000")

  if [[ "${status}" == "${expected_status}" ]]; then
    log "  [PASS] ${name} — HTTP ${status}"
    PASS=$((PASS + 1))
  else
    log "  [FAIL] ${name} — Expected HTTP ${expected_status}, got HTTP ${status} (${url})"
    FAIL=$((FAIL + 1))
  fi
}

check_json_field() {
  local name="$1"
  local url="$2"
  local field="$3"
  local expected="$4"
  local timeout="${5:-10}"

  local body
  body=$(curl -s --max-time "${timeout}" "${url}" 2>/dev/null || echo "{}")

  local actual
  actual=$(echo "${body}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('${field}','MISSING'))" 2>/dev/null || echo "PARSE_ERROR")

  if [[ "${actual}" == "${expected}" ]]; then
    log "  [PASS] ${name} — ${field}=${actual}"
    PASS=$((PASS + 1))
  else
    log "  [FAIL] ${name} — Expected ${field}=${expected}, got ${field}=${actual}"
    FAIL=$((FAIL + 1))
  fi
}

check_response_time() {
  local name="$1"
  local url="$2"
  local max_ms="${3:-2000}"

  local elapsed_ms
  elapsed_ms=$(curl -s -o /dev/null -w "%{time_total}" --max-time 10 "${url}" 2>/dev/null | awk '{printf "%d", $1*1000}' || echo "99999")

  if [[ "${elapsed_ms}" -le "${max_ms}" ]]; then
    log "  [PASS] ${name} — ${elapsed_ms}ms (threshold: ${max_ms}ms)"
    PASS=$((PASS + 1))
  else
    log "  [FAIL] ${name} — ${elapsed_ms}ms exceeds ${max_ms}ms threshold"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------
log "=== LingoLeap Health Check (${ENV}) ==="
echo ""

log "1. Backend API"
check_http        "Backend /api/health"          "${BACKEND_URL}/api/health"
check_json_field  "Backend status=ok"            "${BACKEND_URL}/api/health" "status" "ok"
check_http        "Backend /api/health/detailed" "${BACKEND_URL}/api/health/detailed"
check_response_time "Backend latency"            "${BACKEND_URL}/api/health" 2000

echo ""
log "2. Frontend"
check_http "Frontend root"     "${FRONTEND_URL}/"
check_http "Frontend /health"  "${FRONTEND_URL}/health" "200"
check_response_time "Frontend latency" "${FRONTEND_URL}/" 3000

echo ""
log "3. Backend component health"
DETAILED=$(curl -s --max-time 10 "${BACKEND_URL}/api/health/detailed" 2>/dev/null || echo "{}")
DB_STATUS=$(echo "${DETAILED}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('components',{}).get('database',{}).get('status','unknown'))" 2>/dev/null || echo "parse_error")
AI_STATUS=$(echo "${DETAILED}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('components',{}).get('ai_service',{}).get('status','unknown'))" 2>/dev/null || echo "parse_error")

if [[ "${DB_STATUS}" == "ok" ]]; then
  log "  [PASS] Database connectivity — ${DB_STATUS}"
  PASS=$((PASS + 1))
else
  log "  [FAIL] Database connectivity — ${DB_STATUS}"
  FAIL=$((FAIL + 1))
fi

if [[ "${AI_STATUS}" == "ok" ]]; then
  log "  [PASS] AI service (Vertex AI) — ${AI_STATUS}"
  PASS=$((PASS + 1))
else
  log "  [WARN] AI service — ${AI_STATUS} (non-critical for health check)"
fi

echo ""
log "4. API smoke tests (unauthenticated endpoints)"
check_http "GET /api/stories"       "${BACKEND_URL}/api/stories" "200"
check_http "GET /api/stories (5xx)" "${BACKEND_URL}/api/stories" "200"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$((PASS + FAIL))
echo ""
log "=== Summary ==="
log "Passed: ${PASS}/${TOTAL}"
log "Failed: ${FAIL}/${TOTAL}"

if [[ ${FAIL} -gt 0 ]]; then
  log "STATUS: UNHEALTHY — ${FAIL} check(s) failed"
  exit 1
else
  log "STATUS: HEALTHY"
  exit 0
fi
