#!/usr/bin/env bash
# Decide the "Audit summary" job result from the upstream job results (#3340).
# Usage: audit_summary_check.sh <npm-audit result> <pip-audit result>
#
# The summary job runs with `if: always()`. Only `success` counts as passing:
# `cancelled` / `skipped` (or anything else) mean the audit never finished.
NPM_STATUS="$1"
PIP_STATUS="$2"

echo "npm-audit: $NPM_STATUS"
echo "pip-audit: $PIP_STATUS"

if [ "$NPM_STATUS" != "success" ] || [ "$PIP_STATUS" != "success" ]; then
  echo ""
  echo "Security audit FAILED (every audit job must end in 'success'). Fix vulnerabilities or add known-safe CVEs to .security-audit-allowlist.json"
  exit 1
fi

echo "All security audits passed."
