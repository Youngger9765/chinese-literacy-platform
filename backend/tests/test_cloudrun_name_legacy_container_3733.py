"""#3733 second attempt — existing frontend services (staging and every live
preview) are ONE UNNAMED container with a port. `gcloud beta run deploy
--container=frontend ... --container=sidecar` cannot address an unnamed
container, so it adds two more next to it and Cloud Run rejects the revision
("Revision template should contain exactly one container with an exposed
port"). The first open attempt (#4083) died on exactly that.

scripts/cloudrun_name_legacy_container.py turns `gcloud run services describe
--format=json` of such a service into a `gcloud run services replace` spec
that changes ONE thing: the lone container gets the name `frontend`. Same
image, same port, same IAP / ingress / scaling / service account, so the
rename revision behaves exactly like the one it replaces. The normal
two-container deploy then finds `frontend` by name and updates it in place,
adding the sidecar and --iap in one revision.

Exit codes are the contract the workflow step relies on:
  0  -> a rename spec was printed (call `services replace`)
  10 -> nothing to do (already named `frontend`)
  2  -> unexpected shape / bad input: fail the deploy, don't guess
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "cloudrun_name_legacy_container.py"

FE_IMAGE = "asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend:staging-69c734758"


def legacy_service(iap: bool = False) -> dict:
    """Shape copied from the live lingoleap-frontend-staging describe (2026-11-16)."""
    ann = {
        "run.googleapis.com/client-name": "gcloud",
        "run.googleapis.com/client-version": "591.0.0",
        "run.googleapis.com/ingress": "all",
        "run.googleapis.com/ingress-status": "all",
        "run.googleapis.com/maxScale": "100",
        "run.googleapis.com/operation-id": "612cb9a7",
        "run.googleapis.com/urls": '["https://x.run.app"]',
        "serving.knative.dev/creator": "github-actions@lingoleap-dev.iam.gserviceaccount.com",
        "serving.knative.dev/lastModifier": "github-actions@lingoleap-dev.iam.gserviceaccount.com",
    }
    if iap:
        ann["run.googleapis.com/iap-enabled"] = "true"
        ann["run.googleapis.com/launch-stage"] = "BETA"
    return {
        "apiVersion": "serving.knative.dev/v1",
        "kind": "Service",
        "metadata": {
            "annotations": ann,
            "creationTimestamp": "2026-02-21T17:32:12.603014Z",
            "generation": 1774,
            "labels": {"cloud.googleapis.com/location": "asia-east1"},
            "name": "lingoleap-frontend-staging",
            "namespace": "958347263320",
            "resourceVersion": "AAZgY4glyq8",
            "selfLink": "/apis/serving.knative.dev/v1/namespaces/958347263320/services/x",
            "uid": "73bde8dd",
        },
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "autoscaling.knative.dev/maxScale": "1",
                        "run.googleapis.com/client-name": "gcloud",
                        "run.googleapis.com/startup-cpu-boost": "true",
                    },
                    "labels": {
                        "client.knative.dev/nonce": "segefupqob",
                        "run.googleapis.com/startupProbeType": "Default",
                    },
                },
                "spec": {
                    "containerConcurrency": 80,
                    "containers": [{
                        "image": FE_IMAGE,
                        "ports": [{"containerPort": 8080, "name": "http1"}],
                        "resources": {"limits": {"cpu": "1", "memory": "512Mi"}},
                        "startupProbe": {"failureThreshold": 1, "periodSeconds": 240,
                                         "tcpSocket": {"port": 8080}, "timeoutSeconds": 240},
                    }],
                    "serviceAccountName": "lingoleap-frontend-run@lingoleap-dev.iam.gserviceaccount.com",
                    "timeoutSeconds": 300,
                },
            },
            "traffic": [{"latestRevision": True, "percent": 100}],
        },
        "status": {"url": "https://x.run.app", "latestReadyRevisionName": "r-1"},
    }


def run(payload: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPT), *args], input=payload,
                          capture_output=True, text=True, timeout=30)


def test_legacy_unnamed_container_is_renamed_and_nothing_else_changes():
    src = legacy_service()
    p = run(json.dumps(src), "frontend")
    assert p.returncode == 0, p.stderr
    spec = json.loads(p.stdout)
    containers = spec["spec"]["template"]["spec"]["containers"]
    assert len(containers) == 1
    assert containers[0]["name"] == "frontend"
    # everything that defines what the revision serves is unchanged
    want = dict(src["spec"]["template"]["spec"]["containers"][0], name="frontend")
    assert containers[0] == want
    for k in ("serviceAccountName", "timeoutSeconds", "containerConcurrency"):
        assert spec["spec"]["template"]["spec"][k] == src["spec"]["template"]["spec"][k]
    assert spec["spec"]["traffic"] == src["spec"]["traffic"]
    assert spec["spec"]["template"]["metadata"]["annotations"]["autoscaling.knative.dev/maxScale"] == "1"
    assert spec["metadata"]["annotations"]["run.googleapis.com/ingress"] == "all"


def test_server_owned_fields_are_dropped_so_replace_accepts_it():
    spec = json.loads(run(json.dumps(legacy_service()), "frontend").stdout)
    assert "status" not in spec
    assert set(spec["metadata"]) <= {"name", "namespace", "labels", "annotations"}
    ann = spec["metadata"]["annotations"]
    for k in ("run.googleapis.com/operation-id", "run.googleapis.com/urls",
              "run.googleapis.com/ingress-status", "serving.knative.dev/creator",
              "serving.knative.dev/lastModifier"):
        assert k not in ann, k
    # a fresh nonce -> Cloud Run must cut a new revision for the rename
    assert "client.knative.dev/nonce" not in spec["spec"]["template"]["metadata"]["labels"]


def test_iap_annotation_survives_the_rename():
    """A preview that already had IAP must not lose it in the rename revision."""
    spec = json.loads(run(json.dumps(legacy_service(iap=True)), "frontend").stdout)
    ann = spec["metadata"]["annotations"]
    assert ann["run.googleapis.com/iap-enabled"] == "true"
    assert ann["run.googleapis.com/launch-stage"] == "BETA"


def test_already_named_two_container_service_is_left_alone():
    src = legacy_service()
    c = src["spec"]["template"]["spec"]["containers"]
    c[0]["name"] = "frontend"
    c.append({"name": "sidecar", "image": "sidecar:x"})
    p = run(json.dumps(src), "frontend")
    assert p.returncode == 10, (p.returncode, p.stdout, p.stderr)
    assert p.stdout.strip() == ""


def test_single_container_already_named_frontend_is_left_alone():
    src = legacy_service()
    src["spec"]["template"]["spec"]["containers"][0]["name"] = "frontend"
    assert run(json.dumps(src), "frontend").returncode == 10


def test_unexpected_multi_container_shape_fails_closed():
    src = legacy_service()
    c = src["spec"]["template"]["spec"]["containers"]
    c[0]["name"] = "web"
    c.append({"name": "other", "image": "x"})
    p = run(json.dumps(src), "frontend")
    assert p.returncode == 2
    assert p.stdout.strip() == ""


def test_garbage_input_fails_closed():
    assert run("not json", "frontend").returncode == 2
    assert run("", "frontend").returncode == 2
