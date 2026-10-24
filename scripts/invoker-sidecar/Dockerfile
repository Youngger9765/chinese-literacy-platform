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
ENV SIDECAR_PORT=8081
# 2026-10-24 自動化安全審查（深度防禦）：故意不寫 EXPOSE——這個 port 只給同一
# Cloud Run 實例裡的 nginx 容器打，不是要公開的服務。EXPOSE 本身不會真的擋
# 什麼（純文件性質），但留著它等於暗示「這個 port 本來就該開給外面」，拿掉比
# 較不會誤導未來維護的人。真正的防線是 run_invoker_token.py 自己的 loopback
# 檢查（見 _decide_sidecar_response）。
CMD ["python3", "run_invoker_token.py", "--serve"]
