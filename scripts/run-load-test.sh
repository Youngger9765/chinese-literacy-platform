#!/usr/bin/env bash
# =============================================================================
# scripts/run-load-test.sh
# Quick local runner for LingoLeap load tests (Issue #260)
#
# Defaults: 30 users, 5 users/sec spawn, 2 min, Scenario 2 (StudentReadingUser)
#
# Usage:
#   ./scripts/run-load-test.sh
#   LOAD_TEST_HOST=https://my-backend.run.app ./scripts/run-load-test.sh
#   USERS=10 SCENARIO=TeacherDashboardUser ./scripts/run-load-test.sh
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOAD_TEST_DIR="$REPO_ROOT/tests/load-testing"
REPORTS_DIR="$LOAD_TEST_DIR/reports"
# shellcheck source=lib/iap-token.sh
source "${REPO_ROOT}/scripts/lib/iap-token.sh"

# ---------------------------------------------------------------------------
# Configurable defaults (override via env vars)
# ---------------------------------------------------------------------------
HOST="${LOAD_TEST_HOST:-https://lingoleap-backend-staging-958347263320.asia-east1.run.app}"
USERS="${USERS:-30}"
SPAWN_RATE="${SPAWN_RATE:-5}"
RUN_TIME="${RUN_TIME:-2m}"
SCENARIO="${SCENARIO:-StudentReadingUser}"
REPORT_NAME="${REPORT_NAME:-load-test-$(date +%Y%m%dT%H%M%S).html}"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
echo "=== LingoLeap Load Test Runner ==="
echo "Host       : $HOST"
echo "Users      : $USERS"
echo "Spawn rate : $SPAWN_RATE users/sec"
echo "Duration   : $RUN_TIME"
echo "Scenario   : $SCENARIO"
echo ""

if ! command -v locust &>/dev/null; then
  echo "[ERROR] locust is not installed."
  echo "Run: cd $LOAD_TEST_DIR && pip install -r requirements.txt"
  exit 1
fi

# Check host reachability (non-fatal — staging may require auth)
# #3719 — IAP 準備：IAP_AUDIENCE 沒設時（現在就是這樣）這裡是空陣列，
# 跟今天的 curl 完全一樣；真正跑壓測的請求由 locustfile.py 自己的
# on_start 掛 header，這裡只是 preflight 探活。
IAP_AUTH_ARGS=()
IAP_TOKEN="$(iap_token "${IAP_AUDIENCE:-}")"
if [[ -n "${IAP_TOKEN}" ]]; then
  IAP_AUTH_ARGS=(-H "Proxy-Authorization: Bearer ${IAP_TOKEN}")
fi
if command -v curl &>/dev/null; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${IAP_AUTH_ARGS[@]+${IAP_AUTH_ARGS[@]}}" "$HOST/stories" || echo "000")
  if [[ "$STATUS" == "000" ]]; then
    echo "[WARN] Cannot reach $HOST — proceeding anyway (may require VPN or auth)."
  else
    echo "[OK] Host reachable (HTTP $STATUS)"
  fi
fi

# ---------------------------------------------------------------------------
# Create reports directory
# ---------------------------------------------------------------------------
mkdir -p "$REPORTS_DIR"

# ---------------------------------------------------------------------------
# Run Locust
# ---------------------------------------------------------------------------
echo ""
echo "Starting load test..."
echo "Report will be saved to: $REPORTS_DIR/$REPORT_NAME"
echo ""

locust \
  -f "$LOAD_TEST_DIR/locustfile.py" \
  --host="$HOST" \
  --users="$USERS" \
  --spawn-rate="$SPAWN_RATE" \
  --run-time="$RUN_TIME" \
  --headless \
  --only-summary \
  --html="$REPORTS_DIR/$REPORT_NAME" \
  "$SCENARIO"

echo ""
echo "Done. HTML report: $REPORTS_DIR/$REPORT_NAME"
