#!/usr/bin/env python3
"""Name the lone unnamed container of an existing Cloud Run service (#3733).

Existing LingoLeap frontend services (staging and every live preview) were
deployed as ONE UNNAMED container with a port. `gcloud beta run deploy
--container=frontend ... --container=sidecar` can't address an unnamed
container, so it adds two more beside it and Cloud Run rejects the revision
("Revision template should contain exactly one container with an exposed
port") -- the first IAP open attempt (#4083) died on that.

Usage (stdlib only, runs on a bare GitHub runner):

    gcloud run services describe SVC --format=json \
      | python3 scripts/cloudrun_name_legacy_container.py frontend > spec.json
    gcloud run services replace spec.json --region R --project P

The printed spec changes exactly ONE thing -- the container gets NAME. Same
image, ports, probes, service account, scaling, ingress and IAP annotations,
so the rename revision serves exactly what the previous one did; the normal
two-container deploy that follows then updates `frontend` in place and adds
the sidecar together with --iap in a single revision.

Exit codes (the workflow step depends on these):
  0   rename spec printed on stdout
  10  nothing to do: a container named NAME already exists
  2   unexpected shape or unreadable input -- fail the deploy, don't guess
"""
from __future__ import annotations

import json
import sys

NOTHING_TO_DO = 10
FAIL = 2

# Server-owned metadata that `gcloud run services describe --format=export`
# also strips; sending them back to `services replace` is at best noise.
_DROP_SERVICE_ANNOTATIONS = {
    "run.googleapis.com/client-name",
    "run.googleapis.com/client-version",
    "run.googleapis.com/ingress-status",
    "run.googleapis.com/operation-id",
    "run.googleapis.com/urls",
    "serving.knative.dev/creator",
    "serving.knative.dev/lastModifier",
}
_KEEP_METADATA = ("name", "namespace", "labels", "annotations")


def rename_spec(service: dict, name: str) -> dict | None:
    """Return the replace spec, or None if NAME already exists. Raises ValueError."""
    try:
        template = service["spec"]["template"]
        containers = template["spec"]["containers"]
    except (KeyError, TypeError) as exc:
        raise ValueError(f"not a Cloud Run service description: missing {exc}") from exc
    if not isinstance(containers, list) or not containers:
        raise ValueError("service has no containers")
    if any(c.get("name") == name for c in containers):
        return None
    if len(containers) != 1:
        names = [c.get("name") for c in containers]
        raise ValueError(f"expected one legacy container, found {len(containers)}: {names}")

    meta = {k: service["metadata"][k] for k in _KEEP_METADATA if k in service.get("metadata", {})}
    meta["annotations"] = {
        k: v for k, v in meta.get("annotations", {}).items()
        if k not in _DROP_SERVICE_ANNOTATIONS
    }
    tmeta = dict(template.get("metadata") or {})
    tmeta.pop("name", None)  # a fixed revision name would collide
    labels = {k: v for k, v in (tmeta.get("labels") or {}).items()
              if k != "client.knative.dev/nonce"}
    if labels:
        tmeta["labels"] = labels
    else:
        tmeta.pop("labels", None)

    tspec = dict(template["spec"])
    tspec["containers"] = [dict(containers[0], name=name)]
    spec = dict(service["spec"])
    spec["template"] = dict(template, metadata=tmeta, spec=tspec)
    return {
        "apiVersion": service.get("apiVersion", "serving.knative.dev/v1"),
        "kind": service.get("kind", "Service"),
        "metadata": meta,
        "spec": spec,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not argv[1]:
        print("usage: cloudrun_name_legacy_container.py CONTAINER_NAME < describe.json", file=sys.stderr)
        return FAIL
    try:
        service = json.loads(sys.stdin.read())
        out = rename_spec(service, argv[1])
    except (ValueError, AttributeError) as exc:
        print(f"cannot convert service: {exc}", file=sys.stderr)
        return FAIL
    if out is None:
        print(f"container {argv[1]!r} already present: nothing to rename", file=sys.stderr)
        return NOTHING_TO_DO
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
