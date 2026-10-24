#!/bin/sh
# render-nginx-conf.sh — writes /etc/nginx/conf.d/default.conf (#3719)
#
# Why this is a separate file instead of an inline `RUN echo '...'` in the
# Dockerfile: the IAP-prep proxy block has nginx variables ($scheme etc, must
# NOT be shell-expanded) sitting next to shell variables (the backend's own
# URL, which MUST be shell-expanded) in the same heredoc. That mix is exactly
# the kind of escaping that's easy to get subtly wrong and hard to read once
# squeezed into a single Dockerfile RUN line — a dedicated, testable script
# is safer. This file can be (and was) run directly on a plain Linux shell
# to inspect the generated config before ever building the image.
#
# Behaviour:
#   BACKEND_INTERNAL_URL unset/empty (production's Cloud Run build, and the
#   default when nobody passes the new Docker build-arg) → SPA-only config,
#   byte-for-byte what this repo served before #3719.
#
#   BACKEND_INTERNAL_URL set (staging/preview builds) → same SPA fallback,
#   plus /api, /assets, /q proxied same-origin to that backend — mirroring
#   firebase.json's rewrites, so the browser only ever talks to one origin
#   (required once IAP sits in front of these Cloud Run services; harmless
#   either way since it's just a same-origin reverse proxy).
#
#   BACKEND_INVOKER_SIDECAR_PORT additionally set (#3733 — only matters once
#   backend requires Cloud Run invoker auth, i.e. --no-allow-unauthenticated
#   + roles/run.invoker, NOT native IAP; see scripts/run_invoker_token.py's
#   module docstring for why backend went this route instead) → each
#   backend-proxying location first makes an internal `auth_request`
#   subrequest to a sidecar container (scripts/run_invoker_token.py --serve,
#   listening on this port on localhost — Cloud Run multi-container
#   instances share a network namespace, confirmed via
#   https://docs.cloud.google.com/run/docs/deploying: "Containers ingress
#   and sidecar can communicate with each other on http://localhost", and a
#   sidecar's port is "not reachable from outside the instance"), and
#   attaches whatever token it returns as X-Serverless-Authorization (never
#   Authorization — the app owns that header for its own JWT).
#
#   If the sidecar can't be reached at all (not yet started, crashed) this
#   must NOT turn into a 500 for real traffic — the internal location falls
#   back to a bare 200 with no token header via `error_page` + a named
#   location, and the `map` below turns "no token" into an EMPTY header
#   value, which nginx's `proxy_set_header` treats as "omit this header
#   entirely" (documented: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
#   — "To remove a header field from a request passed to a proxied server,
#   set it to an empty string"). So the worst case degrades to exactly
#   today's un-authenticated-to-backend behavior, never a broken response.
#   Not yet verified end to end against a real backend with invoker auth
#   turned on — that's what the throwaway canary pair is for.
#
# BACKEND_INTERNAL_URL is a static value baked in at image build time (the
# deploy workflow already knows the backend's Cloud Run URL before building
# the frontend image — see staging-deploy.yml/preview-deploy.yml). nginx
# therefore resolves it once when the worker starts, not per-request; if the
# backend's underlying IP ever changed independently of a redeploy, this
# frontend container would need a restart to pick it up. Staging/preview
# redeploy both services on every push, so that's an acceptable trade-off
# for this phase.
set -eu

OUT=/etc/nginx/conf.d/default.conf

if [ -z "${BACKEND_INTERNAL_URL:-}" ]; then
  cat > "$OUT" <<'NGINXCONF'
server { listen 8080; absolute_redirect off; location / { root /usr/share/nginx/html; try_files $uri $uri/ /index.html; } }
NGINXCONF
  exit 0
fi

# Cloud Run (and any TLS-terminating reverse proxy in front of it) routes by
# Host header / SNI — passing through the FRONTEND's own Host header would
# target the wrong service. Strip the scheme to get the bare host for both
# the Host header and SNI.
BACKEND_HOST=$(printf '%s' "$BACKEND_INTERNAL_URL" | sed -E 's#^[a-zA-Z]+://##; s#/+$##')

# #3740 — real client IP behind this same-origin proxy. Always computed
# whenever we're proxying at all (not gated on BACKEND_INVOKER_SIDECAR_PORT
# below): the #3728 regression that broke backend's per-IP rate limiting
# affects every proxied request regardless of whether the invoker-auth
# sidecar is also in the picture. nginx derives the real end-user IP the
# SAME way backend's own real_ip_from_xff() already does for direct
# traffic (second-from-right of X-Forwarded-For -- GCP's own ingress
# always appends exactly [real-client-ip, lb-ip] to whatever arrived at
# THIS service), then passes it on as X-Client-IP. Backend only trusts
# that header when this request also carries a Cloud-Run-verified
# X-Serverless-Authorization identifying the frontend's own service
# account (see backend/app/auth/rate_limiter.py's trusted_proxy_client_ip)
# -- so setting this header here is necessary but not sufficient on its
# own; the design deliberately doesn't rely on nginx being the only thing
# that can reach backend (#3740: backend stays directly reachable for CI/
# health-checks, so a fixed hop-count or "trust X-Client-IP unconditionally"
# design was rejected as forgeable).
#
# The two map patterns below are tried in order (first match wins); the
# second-from-right one requires at least 2 comma-separated entries, the
# third handles exactly one entry, and `default $remote_addr` covers no
# XFF at all -- same fallback shape as real_ip_from_xff(xff, peer).
# Verified live against nginx:alpine for 2/3/4-entry and no-comma inputs
# before relying on it here (see PR description, not re-derived blind).
CLIENT_IP_MAP='
map $http_x_forwarded_for $derived_client_ip {
  default $remote_addr;
  "~^(?:[^,]*,\s*)*?([^,]+)\s*,\s*[^,\s]+$" $1;
  "~^\s*([^,\s]+)\s*$" $1;
}
'

# #3733 — only non-empty once backend switches to Cloud Run invoker auth.
INVOKER_PORT="${BACKEND_INVOKER_SIDECAR_PORT:-}"

# #3740 — fail the BUILD, not just the runtime behavior, if someone ever
# wires BACKEND_INTERNAL_URL into a deploy step without ALSO wiring the
# sidecar port. The X-Client-IP this script sends is only trustworthy to
# backend when X-Serverless-Authorization also proves it came from the
# frontend's own service account (see backend/app/auth/rate_limiter.py) --
# that header is ONLY attached by the sidecar/auth_request wiring below.
# Same-origin-proxy WITHOUT the sidecar reproduces the exact #3740
# regression (X-Client-IP sent, never trusted, every proxied request
# silently falls back to the old broken XFF rule) while looking, from the
# build-arg surface, like the fix is in place. Refuse to build that
# half-configured, silently-still-broken combination.
if [ -z "$INVOKER_PORT" ]; then
  echo "render-nginx-conf.sh: BACKEND_INTERNAL_URL is set but BACKEND_INVOKER_SIDECAR_PORT is not." >&2
  echo "Same-origin proxying without the invoker-auth sidecar reproduces the #3740 regression" >&2
  echo "(X-Client-IP sent but never trusted -- every proxied request silently falls back to the" >&2
  echo "old broken per-IP rate-limit rule). Set BOTH or neither; refusing to build just one." >&2
  exit 1
fi

# Past the guard above, INVOKER_PORT is guaranteed non-empty here -- no
# "proxy without a sidecar" branch exists to fall into (see #3740 guard).
#
# `map`'s result is an EMPTY string when there's no token (nginx then
# omits the header entirely instead of sending a malformed empty bearer
# value — see comment block above), or "Bearer <token>" otherwise.
MAP_BLOCK="
map \$invoker_raw_token \$invoker_auth_header {
  ''      '';
  default \"Bearer \$invoker_raw_token\";
}
"
SIDECAR_LOCATIONS="
  location = /_invoker_token {
    internal;
    proxy_pass http://127.0.0.1:${INVOKER_PORT}/;
    proxy_connect_timeout 1s;
    proxy_read_timeout 2s;
    proxy_intercept_errors on;
    error_page 500 502 503 504 = @invoker_token_unavailable;
  }
  location @invoker_token_unavailable {
    internal;
    return 200;
  }
"
# #3740 follow-up (security review) — X-Serverless-Authorization above is a
# Cloud-Run-owned header the platform may rewrite or strip depending on
# backend's own auth mode (see backend/app/auth/rate_limiter.py's
# _verify_frontend_identity docstring for the full reasoning); backend can't
# unconditionally trust it to decide whose X-Client-IP to believe. Send the
# SAME raw token again under an ordinary header name Cloud Run never
# touches, so backend can cryptographically verify it itself regardless of
# whichever auth mode it's currently in. Same empty-string-omits-header
# behavior as X-Serverless-Authorization above when the sidecar has no
# token (nginx docs: an empty proxy_set_header value removes the header
# entirely) -- no separate map needed, $invoker_raw_token is already either
# a bare token or empty.
AUTH_REQUEST_LINES="
    auth_request /_invoker_token;
    auth_request_set \$invoker_raw_token \$upstream_http_x_invoker_token;
    proxy_set_header X-Serverless-Authorization \$invoker_auth_header;
    proxy_set_header X-Frontend-Identity \$invoker_raw_token;"

cat > "$OUT" <<NGINXCONF
${CLIENT_IP_MAP}${MAP_BLOCK}server {
  listen 8080;
  absolute_redirect off;
  root /usr/share/nginx/html;
${SIDECAR_LOCATIONS}
  # #3719 — same-origin proxy to this deploy's own backend. Order mirrors
  # firebase.json's rewrites (/api, /assets, /q, then SPA fallback).
  location /api/ {${AUTH_REQUEST_LINES}
    proxy_pass ${BACKEND_INTERNAL_URL};
    proxy_set_header Host ${BACKEND_HOST};
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Client-IP \$derived_client_ip;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
  }

  # ⚠️ /assets/ is NOT a plain proxy like /api and /q above — Vite's own
  # build output also lives under /assets/ (dist/assets/index-<hash>.js),
  # and that path collides with the backend's /assets/{path} course-content
  # route (#2486). A bare proxy_pass here would send the frontend's OWN JS
  # bundle to the backend and 404 the entire app (verified locally: a real
  # \`docker build\` + \`docker run\` of this exact config returned 404 for
  # the bundle before this try_files was added). firebase.json's rewrite
  # avoids this because Firebase Hosting always prefers an existing static
  # file over a rewrite; try_files reproduces that same preference in
  # nginx — serve the local file if it exists, only fall through to the
  # backend (the named location below) when it doesn't.
  location /assets/ {
    try_files \$uri @assets_backend;
  }
  location @assets_backend {${AUTH_REQUEST_LINES}
    proxy_pass ${BACKEND_INTERNAL_URL};
    proxy_set_header Host ${BACKEND_HOST};
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Client-IP \$derived_client_ip;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
  }

  location /q/ {${AUTH_REQUEST_LINES}
    proxy_pass ${BACKEND_INTERNAL_URL};
    proxy_set_header Host ${BACKEND_HOST};
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Client-IP \$derived_client_ip;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINXCONF
