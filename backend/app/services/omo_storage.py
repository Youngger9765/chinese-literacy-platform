"""OMO GCS storage helpers — upload, signed URL generation, and GCS cleanup.

Extracted from backend/app/routes/omo.py as part of the 4-module split.
AnalysisBy: issue #1770 — routes/omo.py 1197-line refactor.

Contains:
- _OMO_GCS_BUCKET constant (shared with omo_jobs via import)
- _upload_to_gcs(): write image bytes to GCS, return object path
- _get_signed_url(): generate 1-hour IAM-signed URL (Cloud Run compatible)
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
_OMO_GCS_BUCKET = os.environ.get("GCS_OMO_BUCKET", "lingoleap-omo-uploads")


# ── GCS helpers ───────────────────────────────────────────────────────────────

def _upload_to_gcs(
    user_id: int, upload_id: int, attempt_idx: int, file_index: int,
    data: bytes, mime_type: str
) -> str:
    """Upload image bytes to GCS. Returns the GCS object path.

    Path format: {user_id}/{upload_id}/{attempt_idx}/{file_index}.jpg
    Falls back gracefully if google-cloud-storage is not installed (local dev).
    """
    object_path = f"{user_id}/{upload_id}/{attempt_idx}/{file_index}.jpg"
    try:
        from google.cloud import storage  # type: ignore[import]
        client = storage.Client()
        bucket = client.bucket(_OMO_GCS_BUCKET)
        blob = bucket.blob(object_path)
        blob.upload_from_string(data, content_type=mime_type)
        logger.info("OMO: uploaded gs://%s/%s", _OMO_GCS_BUCKET, object_path)
    except ImportError:
        logger.warning("google-cloud-storage not available — skipping GCS upload (local dev)")
    except Exception as exc:
        logger.warning("OMO GCS upload failed for %s: %s — continuing without GCS", object_path, exc)
    return object_path


def _get_signed_url(object_path: str) -> Optional[str]:
    """Generate a 1-hour signed URL for a GCS object. Returns None if unavailable.

    Uses IAM-based signing (service_account_email + access_token) so it works on
    Cloud Run where the default ADC has no private key file. Falls back to bare
    generate_signed_url() for local dev where credentials may already include a
    private key.
    """
    import datetime as dt
    try:
        from google.cloud import storage  # type: ignore[import]
        from google.auth import default as google_auth_default  # type: ignore[import]
        from google.auth.transport.requests import Request as GoogleAuthRequest  # type: ignore[import]

        client = storage.Client()
        bucket = client.bucket(_OMO_GCS_BUCKET)
        blob = bucket.blob(object_path)

        sa_email = None
        access_token = None
        try:
            credentials, _proj = google_auth_default()
            if credentials and not getattr(credentials, "valid", False):
                credentials.refresh(GoogleAuthRequest())
            sa_email = getattr(credentials, "service_account_email", None)
            access_token = getattr(credentials, "token", None)
        except Exception as cred_exc:
            logger.warning("OMO signed URL: failed to fetch ADC for IAM signing: %s", cred_exc)

        kwargs = {
            "version": "v4",
            "expiration": dt.timedelta(hours=1),
            "method": "GET",
        }
        # Only pass IAM signing kwargs when both are available — otherwise let the
        # SDK pick its default (private key path for local dev).
        if sa_email and access_token:
            kwargs["service_account_email"] = sa_email
            kwargs["access_token"] = access_token

        return blob.generate_signed_url(**kwargs)
    except Exception as exc:
        logger.warning("OMO signed URL failed for %s: %s", object_path, exc)
        return None
