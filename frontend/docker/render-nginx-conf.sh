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

# #3733 — only non-empty once backend switches to Cloud Run invoker auth.
INVOKER_PORT="${BACKEND_INVOKER_SIDECAR_PORT:-}"

if [ -n "$INVOKER_PORT" ]; then
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
  AUTH_REQUEST_LINES="
    auth_request /_invoker_token;
    auth_request_set \$invoker_raw_token \$upstream_http_x_invoker_token;
    proxy_set_header X-Serverless-Authorization \$invoker_auth_header;"
else
  MAP_BLOCK=""
  SIDECAR_LOCATIONS=""
  AUTH_REQUEST_LINES=""
fi

cat > "$OUT" <<NGINXCONF
${MAP_BLOCK}server {
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
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
  }

  location /q/ {${AUTH_REQUEST_LINES}
    proxy_pass ${BACKEND_INTERNAL_URL};
    proxy_set_header Host ${BACKEND_HOST};
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINXCONF
