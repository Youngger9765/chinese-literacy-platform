"""
gcp_iap_client.py — reads the IAM policy for Identity-Aware Proxy (IAP) on
Cloud Run services directly from GCP, using the Cloud Run runtime's own
service account (google.auth.default()). No DB table — GCP is the source
of truth (Issue #3720, follow-up to #3719's "prepare for IAP" work).

Why the resource name is hand-built instead of a client library call
----------------------------------------------------------------------
IAP's own REST reference (`iap.googleapis.com/v1/{resource=**}:getIamPolicy`)
documents the method with a wildcard resource path and no concrete Cloud Run
example. The exact, confirmed format for a Cloud Run service comes from the
Terraform/Pulumi provider for `google_iap_web_cloud_run_service_iam_policy`
(`gcp.iap.WebCloudRunServiceIamPolicy`), whose import-id documentation spells
it out:

    projects/{project}/iap_web/cloud_run-{location}/services/{service}

This matches the `gcloud iap web get-iam-policy --resource-type=cloud-run
--service=SERVICE --region=REGION` command shown in Google's own "Enable IAP
for Cloud Run" docs — that gcloud command is a thin wrapper around exactly
this REST call.

The `{project}` segment must be the numeric project number, not the project
ID: gcloud's IAP resource parser resolves the ID to a number before building
this same Cloud Run resource path.

Role needed to call this
-------------------------
Reading the policy (what this module does) requires `iap.web.getIamPolicy`,
which is bundled in the predefined role `roles/iap.admin` ("IAP Policy
Admin"). That is a *different* role from `roles/iap.httpsResourceAccessor`
("IAP-secured Web App User", the role this module is inspecting — i.e. who
is let *through* IAP). As of this PR, `roles/iap.admin` has not been granted
to the backend's runtime service account yet, so every call here is expected
to 403 until Young does that — see `iap_allowlist_service.get_iap_allowlist`
for how that 403 is turned into a "尚未設定 IAP" state instead of an error
page.
"""

import logging
import os

logger = logging.getLogger(__name__)

IAP_ROLE = "roles/iap.httpsResourceAccessor"

# Same env-var convention as tts/providers/gemini.py (GCP_PROJECT, default
# lingoleap-dev) — kept consistent rather than inventing a new name.
GCP_PROJECT = os.environ.get("GCP_PROJECT", "lingoleap-dev")
IAP_ALLOWLIST_PROJECT_NUMBER = os.environ.get("IAP_ALLOWLIST_PROJECT_NUMBER", "958347263320")
IAP_ALLOWLIST_REGION = os.environ.get("IAP_ALLOWLIST_REGION", "asia-east1")

# Comma-separated Cloud Run service names this admin page reads the IAP
# allowlist from (e.g. "lingoleap-frontend-staging,lingoleap-backend-staging").
# Empty (default) = IAP has not been wired up on any service yet — the page
# shows "尚未設定 IAP" without even attempting a GCP call. Set this once
# Young turns IAP on for real (see Issue #3719).
IAP_ALLOWLIST_SERVICES = [
    s.strip()
    for s in os.environ.get("IAP_ALLOWLIST_SERVICES", "").split(",")
    if s.strip()
]

_REQUEST_TIMEOUT_SECONDS = 10


class IapFetchError(Exception):
    """Raised when GCP could not be reached, or returned a non-2xx status.

    `reason` is one of "permission_denied" (403 — role not granted yet),
    "not_found" (404 — IAP not enabled on that service, or it doesn't
    exist), or "other" (network error / unexpected status).
    """

    def __init__(self, reason: str, detail: str = ""):
        self.reason = reason
        self.detail = detail
        super().__init__(f"{reason}: {detail}")


def iap_resource_name(
    service: str,
    project: str = IAP_ALLOWLIST_PROJECT_NUMBER,
    region: str = IAP_ALLOWLIST_REGION,
) -> str:
    """Build the IAP web resource name for a Cloud Run service.

    See module docstring for why this exact shape.
    """
    return f"projects/{project}/iap_web/cloud_run-{region}/services/{service}"


def _fetch_one(resource: str) -> dict:
    """GET the IAM policy for one IAP web resource. Raises IapFetchError."""
    try:
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        session = AuthorizedSession(credentials)
        url = f"https://iap.googleapis.com/v1/{resource}:getIamPolicy"
        resp = session.post(
            url,
            json={"options": {"requestedPolicyVersion": 3}},
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 — credential lookup / network errors, all unrecoverable here
        raise IapFetchError("other", str(exc)) from exc

    if resp.status_code == 403:
        raise IapFetchError("permission_denied", resp.text[:500])
    if resp.status_code == 404:
        raise IapFetchError("not_found", resp.text[:500])
    if resp.status_code >= 400:
        raise IapFetchError("other", f"HTTP {resp.status_code}: {resp.text[:500]}")

    return resp.json()


def fetch_iap_policies() -> list[dict]:
    """Return the raw IAM Policy dict for every configured service.

    Returns [] when IAP_ALLOWLIST_SERVICES is empty (not configured yet).
    Raises IapFetchError on the first failing service — the caller
    (iap_allowlist_service.get_iap_allowlist) decides how to present that.
    """
    if not IAP_ALLOWLIST_SERVICES:
        return []
    return [_fetch_one(iap_resource_name(service)) for service in IAP_ALLOWLIST_SERVICES]
