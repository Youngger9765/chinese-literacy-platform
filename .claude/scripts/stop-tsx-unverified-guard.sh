#!/bin/bash
# stop-tsx-unverified-guard.sh — Gate documentation reminder (#2289)
#
# Stop-guard: if this session edited frontend *.tsx files, emit a warning
# before the agent claims "complete" or "verified".
#
# This is a WARN guard (exit 0 always) — it prints a reminder but does NOT
# hard-block. The real enforcement is in CI (frontend-checks.yml runs
# npm run lint + npm run test on every PR touching frontend/src/**).
#
# Triggered: Stop event (when Claude is about to end a session/turn).
#
# Context: #2279 postmortem — TDZ ReferenceError (const declared after
# the useEffect that used it) caused white-screen. Build + tsc missed it.
# Render-smoke + ESLint would have caught it before merge.

# Detect if any .tsx files were recently modified in the working directory
RECENT_TSX=$(git diff --name-only HEAD 2>/dev/null | grep -c "\.tsx$" || echo 0)
STAGED_TSX=$(git diff --cached --name-only 2>/dev/null | grep -c "\.tsx$" || echo 0)

TOTAL_TSX=$((RECENT_TSX + STAGED_TSX))

if [ "$TOTAL_TSX" -gt 0 ]; then
  echo ""
  echo "⚠️  [render-safety-guard] ${TOTAL_TSX} *.tsx file(s) modified this session."
  echo "   Before claiming 'complete' or 'verified', confirm:"
  echo "   1. cd frontend && npm run lint        → 0 errors"
  echo "   2. cd frontend && npm run test -- src/__smoke__/  → 13/13 pass"
  echo "   3. /qa on affected page               → console errors = 0"
  echo "   See .claude/rules/frontend-render-safety.md + .claude/skills/ui-pr-verify/SKILL.md"
  echo ""
fi

exit 0
