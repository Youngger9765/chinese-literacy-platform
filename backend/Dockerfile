# Pinned to a digest, not a floating tag (#3853): the base image + the
# pip/setuptools/wheel it ships pre-installed + the Debian base all float on
# whatever Docker Hub serves for `python:3.11-slim` on build day otherwise.
# requirements.lock (#3849) already hash-pins every PyPI package; this closes
# the same category of gap one layer down. Digest resolved via
# `docker buildx imagetools inspect python:3.11-slim` (multi-arch index
# digest, so the right linux/amd64 manifest is still picked at build time) —
# tag at time of pinning: 3.11.18-slim-trixie (2026-11-05).
FROM python:3.11-slim@sha256:07d4824036af339fa1b6ef769cc99d9c10a141769538b52b3b597c84f7a7b535
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# requirements.txt is the human-edited source (version ranges); requirements.lock is the
# generated, hash-pinned build artifact actually installed — see backend/README.md for
# how the two relate and how to regenerate the lock. --require-hashes refuses to install
# anything (direct or transitive) whose sha256 doesn't match what was pinned, closing the
# "any `pip install` can silently pull a same-day typosquat/compromised release" gap
# (MAL-2026-4750, #2002, #3849).
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
COPY app/ ./app/
COPY data/ ./data/
COPY alembic/ ./alembic/
COPY alembic.ini .
# entrypoint.sh runs the schema guard from here. Omitting this directory does not
# produce a missing-file warning — the container simply exits 1 at startup and Cloud Run
# reports "failed to start and listen on the port", which reads like a port problem.
COPY scripts/ ./scripts/
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["./entrypoint.sh"]
