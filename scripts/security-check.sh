#!/usr/bin/env bash
# scripts/security-check.sh
# Local dependency security scan: runs npm audit + pip-audit and prints a summary.
# Usage: bash scripts/security-check.sh [--fail-on-vuln]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL_ON_VULN=false

for arg in "$@"; do
  case "$arg" in
    --fail-on-vuln) FAIL_ON_VULN=true ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

NPM_STATUS="skipped"
PIP_STATUS="skipped"

echo ""
echo -e "${BLUE}=== LingoLeap Dependency Security Check ===${NC}"
echo ""

# ── npm audit ─────────────────────────────────────────────────────────────────
echo -e "${BLUE}[1/2] npm audit (frontend)${NC}"

if ! command -v npm &>/dev/null; then
  echo -e "${YELLOW}  npm not found — skipping frontend audit${NC}"
else
  if [ ! -f "$REPO_ROOT/frontend/package-lock.json" ]; then
    echo -e "${YELLOW}  package-lock.json missing — run 'npm install' in frontend/ first${NC}"
    NPM_STATUS="skipped"
  else
    pushd "$REPO_ROOT/frontend" > /dev/null
    set +e
    npm audit --audit-level=high 2>&1
    NPM_EXIT=$?
    set -e
    popd > /dev/null

    if [ "$NPM_EXIT" -eq 0 ]; then
      NPM_STATUS="passed"
      echo -e "${GREEN}  npm audit: PASSED (no High/Critical vulnerabilities)${NC}"
    else
      NPM_STATUS="failed"
      echo -e "${RED}  npm audit: FAILED (High or Critical vulnerabilities found)${NC}"
    fi
  fi
fi

echo ""

# ── pip-audit ─────────────────────────────────────────────────────────────────
echo -e "${BLUE}[2/2] pip-audit (backend)${NC}"

if ! command -v pip-audit &>/dev/null; then
  echo -e "${YELLOW}  pip-audit not found — installing...${NC}"
  pip install pip-audit --quiet
fi

if [ ! -f "$REPO_ROOT/backend/requirements.txt" ]; then
  echo -e "${YELLOW}  backend/requirements.txt not found — skipping${NC}"
  PIP_STATUS="skipped"
else
  set +e
  pip-audit -r "$REPO_ROOT/backend/requirements.txt" 2>&1
  PIP_EXIT=$?
  set -e

  if [ "$PIP_EXIT" -eq 0 ]; then
    PIP_STATUS="passed"
    echo -e "${GREEN}  pip-audit: PASSED (no known vulnerabilities)${NC}"
  else
    PIP_STATUS="failed"
    echo -e "${RED}  pip-audit: FAILED (vulnerabilities found)${NC}"
  fi
fi

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo ""

print_status() {
  local label="$1"
  local status="$2"
  case "$status" in
    passed)  echo -e "  ${GREEN}PASS${NC}  $label" ;;
    failed)  echo -e "  ${RED}FAIL${NC}  $label" ;;
    skipped) echo -e "  ${YELLOW}SKIP${NC}  $label" ;;
  esac
}

print_status "npm audit (frontend)" "$NPM_STATUS"
print_status "pip-audit (backend)"  "$PIP_STATUS"

echo ""

OVERALL_FAILED=false
[ "$NPM_STATUS" = "failed" ] && OVERALL_FAILED=true
[ "$PIP_STATUS" = "failed" ] && OVERALL_FAILED=true

if $OVERALL_FAILED; then
  echo -e "${RED}Vulnerabilities detected. Review the output above for details.${NC}"
  if $FAIL_ON_VULN; then
    exit 1
  fi
else
  echo -e "${GREEN}All checks passed.${NC}"
fi

echo ""
