#!/bin/sh
# test-security-headers.sh — regression lock for issue #3850
#
# What #3850 found: curl against lingoleap-prod.web.app/login and the Cloud
# Run frontend's /login both came back with NO anti-clickjacking / MIME-sniff
# / referrer headers. A comment in frontend/index.html claimed "Anti-
# clickjacking is enforced via HTTP headers in SecurityHeadersMiddleware",
# but that middleware lives in backend/app/main.py — it only ever runs on
# responses FROM the backend FastAPI app (/api/*, /assets/*, /q/*). It never
# touches the actual HTML page response, which is served by Firebase Hosting
# (prod/staging/dev) or by this repo's own nginx (the Cloud Run frontend
# image) — neither of which had these headers configured.
#
# This locks that both of those two serving paths now carry:
#   X-Frame-Options, Content-Security-Policy (frame-ancestors),
#   X-Content-Type-Options, Referrer-Policy — and nginx additionally carries
#   Strict-Transport-Security (Firebase Hosting already sends a stronger one
#   automatically on *.web.app, confirmed via curl, so firebase.json
#   deliberately does not duplicate/weaken it — see PR description).
#
# Why SAMEORIGIN / frame-ancestors 'self' and NOT DENY / 'none': this app's
# own admin QA tooling embeds its own `/learn/*` pages in a same-origin
# iframe for live-preview purposes —
#   frontend/src/pages/admin/story-structure-lab/StoryStructureLabPage.tsx
#     <iframe src={`/learn/${detail.story_id}/keypoints-table`} />
#   frontend/public/spotlight-qa/app.js renderFrame() — `${renderBase()}/learn/${id}/...`
#     (renderBase() returns location.origin when deployed, i.e. same-origin)
#   frontend/public/keypoints-qa/app.js — same pattern
#   frontend/public/presentation/reading-pipeline.html — same-origin relative iframe
# DENY/'none' block ALL framing, same-origin included, which would break
# every one of those. SAMEORIGIN / 'self' still stops the actual attack
# (an attacker's cross-origin page framing /login) while leaving our own
# same-origin QA dashboards working.
#
# Why these headers are scoped to page routes only (firebase.json's existing
# "/", "/!(api|assets|q)", "/!(api|assets|q)/**" sources; nginx's `location /`
# and `location /assets/`) and deliberately NOT added to /api/, /assets/
# (backend fallback), /q/, or the invoker-auth sidecar locations: those
# routes already get backend/app/main.py's SecurityHeadersMiddleware, which
# sets a DELIBERATELY WIDER frame-ancestors for /assets/* responses
# (`frame-ancestors 'self' https://*.run.app` — see that file's #2486
# comment) so the worksheet PDF can be framed cross-origin on Cloud-Run-direct
# deployments where frontend and backend are different hosts. Duplicating a
# narrower header here (nginx's plain `add_header` does not replace an
# upstream header of the same name — it appends a second one, and browsers
# enforce the INTERSECTION of multiple CSP headers) would silently re-narrow
# that back to 'self' only and reproduce the exact bug #2486 already fixed.
# This test therefore also asserts these headers are ABSENT from the proxy
# locations, not just present on the page ones — removing that scoping is
# exactly the kind of "looks more thorough" change that would quietly break
# the worksheet PDF iframe.
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
RENDER_SCRIPT="$SCRIPT_DIR/render-nginx-conf.sh"
FIREBASE_JSON="$REPO_ROOT/firebase.json"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

FAILED=0

run_render() {
  sed "s#/etc/nginx/conf.d/default.conf#$1#" "$RENDER_SCRIPT" > "$WORKDIR/render-local.sh"
  sh "$WORKDIR/render-local.sh"
}

# run_check DESC CMD [ARGS...] — like test-render-nginx-conf.sh's check_cmd,
# but prints the command's own stdout/stderr instead of swallowing it: the
# python checks below emit a line per missing/misplaced header, and that
# detail is the whole point of a failure here.
run_check() {
  desc="$1"
  shift
  if "$@"; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc"
    FAILED=1
  fi
}

# --- 1. firebase.json: all 3 hosting targets, 3 page-route sources ---
run_check "firebase.json has the 4 security headers on every page route, every target" \
  python3 "$SCRIPT_DIR/_check_firebase_headers.py" "$FIREBASE_JSON"

# --- 2. nginx: render both variants, check header placement ---
OUT_SPA="$WORKDIR/spa.conf"
( unset BACKEND_INTERNAL_URL BACKEND_INVOKER_SIDECAR_PORT 2>/dev/null || true
  run_render "$OUT_SPA" )

OUT_INVOKER="$WORKDIR/invoker.conf"
( export BACKEND_INTERNAL_URL="https://lingoleap-backend-xyz.a.run.app"
  export BACKEND_INVOKER_SIDECAR_PORT="8081"
  run_render "$OUT_INVOKER" )

run_check "nginx configs carry the security headers on page locations only (not proxy locations)" \
  python3 "$SCRIPT_DIR/_check_nginx_headers.py" "$OUT_SPA" "$OUT_INVOKER"

if [ "$FAILED" = "1" ]; then
  echo ""
  echo "FAILED"
  exit 1
fi
echo ""
echo "All checks passed."
