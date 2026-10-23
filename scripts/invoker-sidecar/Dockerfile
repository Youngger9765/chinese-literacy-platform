# Cloud Run invoker-token sidecar (#3733). Tiny, stdlib-only image — this
# container never receives external traffic (see scripts/run_invoker_token.py's
# module docstring and frontend/docker/render-nginx-conf.sh's comment block
# for the full picture: it sits next to the frontend's nginx container in
# the same Cloud Run revision, reachable only via localhost by that nginx
# container's `auth_request`, never exposed to the internet).
#
# Build from the REPO ROOT (not this directory), since it needs
# scripts/run_invoker_token.py which lives one level up from here:
#   docker build -f scripts/invoker-sidecar/Dockerfile -t <tag> .
FROM python:3.12-alpine
WORKDIR /app
COPY scripts/run_invoker_token.py ./run_invoker_token.py
# No external deps -- stdlib only (urllib, http.server, base64, json).
ENV PORT=8081
EXPOSE 8081
CMD ["python3", "run_invoker_token.py", "--serve"]
