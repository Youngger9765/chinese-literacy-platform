"""
admin_iap_allowlist.py — read-only admin view of who IAP currently lets
through to staging/preview (Issue #3720, follow-up to #3719).

GCP is the source of truth — no DB table. See
services/iap_allowlist_service.py for the parsing rules and
services/gcp_iap_client.py for how we reach GCP and which IAM role this
needs.
"""

from fastapi import APIRouter

from ..auth.dependencies import require_role
from ..services.iap_allowlist_service import get_iap_allowlist

router = APIRouter(tags=["admin-iap-allowlist"])


@router.get(
    "/admin/iap-allowlist",
    dependencies=[require_role("system_admin")],
)
def read_iap_allowlist():
    """List who is allowed through IAP on staging/preview, system_admin only.

    Returns {"configured": False, "message": "..."} when IAP hasn't been
    wired up yet (no services configured, or GCP denies the read) — this is
    an expected state right now, not an error (see Issue #3719/#3720).
    """
    return get_iap_allowlist()
