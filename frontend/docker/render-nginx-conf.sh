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

cat > "$OUT" <<NGINXCONF
server {
  listen 8080;
  absolute_redirect off;
  root /usr/share/nginx/html;

  # #3719 — same-origin proxy to this deploy's own backend. Order mirrors
  # firebase.json's rewrites (/api, /assets, /q, then SPA fallback).
  location /api/ {
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
  location @assets_backend {
    proxy_pass ${BACKEND_INTERNAL_URL};
    proxy_set_header Host ${BACKEND_HOST};
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
  }

  location /q/ {
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
