#!/bin/sh
# test-render-nginx-conf.sh — regression lock for render-nginx-conf.sh (#3733)
#
# Why a shell test instead of pytest/vitest: render-nginx-conf.sh is itself a
# POSIX shell script with no Python/Node runtime involved, and there's no
# existing test harness wrapping it (the #3728 same-origin-proxy work that
# introduced it was validated ad hoc via `docker build` + `docker run`, not
# with a committed automated test) -- this is the first one.
#
# What this locks, mirroring the manual verification done for #3733:
#   1. Zero-behavior-change invariant: with BACKEND_INVOKER_SIDECAR_PORT
#      unset (today's reality everywhere), output must be BYTE IDENTICAL to
#      both the SPA-only path and the existing #3719 same-origin-proxy path
#      -- nobody should be able to add a new env-var-gated feature here and
#      accidentally perturb output for everyone who isn't using it.
#   2. When BACKEND_INVOKER_SIDECAR_PORT IS set, the generated config
#      actually contains the auth_request wiring (not just "doesn't crash").
#
# What this does NOT check (verified manually instead, see PR description):
#   `nginx -t` syntax validity of the generated config, and the real runtime
#   behavior (token-available / no-token / sidecar-unreachable) against a
#   live nginx + sidecar + backend trio on a docker network -- those need
#   Docker and take tens of seconds per run, disproportionate to add to a
#   fast CI-facing regression lock for a script whose structure rarely
#   changes. If render-nginx-conf.sh's heredoc structure changes again,
#   re-run that manual check rather than skipping it.
#
# ⚠️ Every assertion below is deliberately routed through check_cmd/
# check_cmd_not rather than `cmd; check $?` -- under `set -e`, a bare failing
# command (not the condition of an if/while) kills the WHOLE SCRIPT on the
# spot, before the next line's `check $?` ever runs. That's not a hypothetical:
# the first version of this file had exactly that bug, and it was only caught
# because a mutation test against render-nginx-conf.sh silently reported
# nothing beyond the first assertion instead of a loud FAIL, rather than
# because the bug was spotted by inspection.
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
RENDER_SCRIPT="$SCRIPT_DIR/render-nginx-conf.sh"
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

FAILED=0

# The real script hardcodes OUT=/etc/nginx/conf.d/default.conf; redirect it
# to a scratch file so this can run outside a container.
run_render() {
  sed "s#/etc/nginx/conf.d/default.conf#$1#" "$RENDER_SCRIPT" > "$WORKDIR/render-local.sh"
  sh "$WORKDIR/render-local.sh"
}

# check_cmd DESC CMD [ARGS...] — passes if CMD exits 0. Using "$@" as the
# condition of an `if` is what makes this immune to set -e regardless of
# which POSIX shell runs it (unlike `cmd; check $?`, which is not).
check_cmd() {
  desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "ok   - $desc"
  else
    echo "FAIL - $desc"
    FAILED=1
  fi
}

# check_cmd_not DESC CMD [ARGS...] — passes if CMD exits NONZERO (i.e. the
# thing being grepped for must be absent).
check_cmd_not() {
  desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL - $desc"
    FAILED=1
  else
    echo "ok   - $desc"
  fi
}

# --- 1a. SPA-only path (nothing set) must be exactly today's output ---
OUT_SPA="$WORKDIR/spa.conf"
( unset BACKEND_INTERNAL_URL BACKEND_INVOKER_SIDECAR_PORT 2>/dev/null || true
  run_render "$OUT_SPA" )
EXPECTED_SPA='server { listen 8080; absolute_redirect off; location / { root /usr/share/nginx/html; try_files $uri $uri/ /index.html; } }'
ACTUAL_SPA=$(cat "$OUT_SPA")
check_cmd "SPA-only output unchanged when nothing is configured" \
  test "$ACTUAL_SPA" = "$EXPECTED_SPA"

# --- 1b. Proxy requested WITHOUT the invoker sidecar: must now be a hard
#     BUILD FAILURE (#3740), not a silently-renderable config. Before #3740
#     this combination rendered a working-looking proxy that quietly
#     reproduced the exact shared-rate-limit-bucket regression (X-Client-IP
#     sent, never trusted, every proxied request falls back to the old
#     broken XFF rule) -- refusing to build it outright is the fix, not
#     just a warning comment. ---
OUT_HALF_CONFIGURED="$WORKDIR/half-configured.conf"
HALF_CONFIGURED_STDERR="$WORKDIR/half-configured.stderr"
HALF_CONFIGURED_RC=0
( export BACKEND_INTERNAL_URL="https://lingoleap-backend-xyz.a.run.app"
  unset BACKEND_INVOKER_SIDECAR_PORT 2>/dev/null || true
  run_render "$OUT_HALF_CONFIGURED" ) >/dev/null 2>"$HALF_CONFIGURED_STDERR" || HALF_CONFIGURED_RC=$?

check_cmd "BACKEND_INTERNAL_URL without BACKEND_INVOKER_SIDECAR_PORT fails the build (exit $HALF_CONFIGURED_RC, want nonzero)" \
  test "$HALF_CONFIGURED_RC" != "0"

check_cmd "the build failure names #3740 so a future reader can find the reasoning" \
  grep -q "3740" "$HALF_CONFIGURED_STDERR"

# --- 2. Invoker sidecar configured: structural assertions ---
OUT_INVOKER="$WORKDIR/invoker.conf"
( export BACKEND_INTERNAL_URL="https://lingoleap-backend-xyz.a.run.app"
  export BACKEND_INVOKER_SIDECAR_PORT="8081"
  run_render "$OUT_INVOKER" )

check_cmd "map block present to build the Authorization header value" \
  grep -q 'map \$invoker_raw_token \$invoker_auth_header' "$OUT_INVOKER"

check_cmd "internal /_invoker_token location present" \
  grep -q "location = /_invoker_token" "$OUT_INVOKER"

check_cmd "sidecar is reached via 127.0.0.1 (localhost -- shared netns on Cloud Run), port from env var" \
  grep -q 'proxy_pass http://127.0.0.1:8081/;' "$OUT_INVOKER"

check_cmd "fail-open fallback wired for a completely unreachable sidecar" \
  grep -q 'error_page 500 502 503 504 = @invoker_token_unavailable;' "$OUT_INVOKER"

check_cmd "fail-open fallback location present" \
  grep -q '^  location @invoker_token_unavailable {$' "$OUT_INVOKER"

# Each of the 3 backend-proxying locations (/api/, @assets_backend, /q/)
# must carry the auth_request trio -- count, don't just grep -q once, so a
# future edit that drops it from one of the three doesn't silently pass.
AUTH_REQUEST_COUNT=$(grep -c 'auth_request /_invoker_token;' "$OUT_INVOKER")
check_cmd "auth_request wired into all 3 backend-proxying locations (found $AUTH_REQUEST_COUNT, want 3)" \
  test "$AUTH_REQUEST_COUNT" = "3"

check_cmd "X-Serverless-Authorization set from the map result (never Authorization -- app owns that header)" \
  grep -q 'proxy_set_header X-Serverless-Authorization \$invoker_auth_header;' "$OUT_INVOKER"

check_cmd_not "Authorization header is never touched by this wiring" \
  grep -q 'proxy_set_header Authorization' "$OUT_INVOKER"

# --- 3. #3740: real client IP behind the proxy ---
check_cmd "derived_client_ip map present (second-from-right XFF, mirrors backend's real_ip_from_xff)" \
  grep -q 'map $http_x_forwarded_for $derived_client_ip' "$OUT_INVOKER"

# `|| true` below is load-bearing, not decorative: `grep -c` still PRINTS
# "0" on zero matches, but exits 1 -- and under this script's `set -eu`, a
# bare `VAR=$(cmd)` assignment statement (unlike a command inside an `if`)
# still aborts the ENTIRE script the instant `cmd` exits nonzero, before
# check_cmd ever runs. That's exactly the silent-death class of bug this
# file's own header comment warns about, just one line earlier than where
# it was first caught -- confirmed by deliberately zeroing out the match
# count during mutation testing and watching the script die with no "FAIL"
# printed at all, rather than a loud one.
X_CLIENT_IP_COUNT=$(grep -c 'proxy_set_header X-Client-IP $derived_client_ip;' "$OUT_INVOKER" || true)
check_cmd "X-Client-IP wired into all 3 backend-proxying locations (found $X_CLIENT_IP_COUNT, want 3)" \
  test "$X_CLIENT_IP_COUNT" = "3"

# --- 4. #3740 follow-up (security review): X-Frontend-Identity carries the
# same raw token under a header Cloud Run never touches, so backend can
# verify it itself instead of trusting X-Serverless-Authorization blindly.
X_FRONTEND_IDENTITY_COUNT=$(grep -c 'proxy_set_header X-Frontend-Identity $invoker_raw_token;' "$OUT_INVOKER" || true)
check_cmd "X-Frontend-Identity wired into all 3 backend-proxying locations (found $X_FRONTEND_IDENTITY_COUNT, want 3)" \
  test "$X_FRONTEND_IDENTITY_COUNT" = "3"

if [ "$FAILED" = "1" ]; then
  echo ""
  echo "FAILED"
  exit 1
fi
echo ""
echo "All checks passed."
