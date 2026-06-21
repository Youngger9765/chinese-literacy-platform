"""GCS upload / signed-URL service for reading audio files (Issue #2266).

Responsibilities:
- Fire-and-forget: upload audio bytes to GCS in background (legacy path)
- Sync upload: upload and return blob path so callers can persist it to DB
- Signed URL: generate short-lived (10 min) URL for student audio playback
- NEVER set public ACL on blobs
- NEVER log audio content or user PII beyond user_id + duration_ms
- Fail silently: any upload/URL error only logs WARNING; returns None

Bucket:
    Controlled by env var READING_AUDIO_GCS_BUCKET.
    If the var is NOT set, uploads are skipped with a one-time WARNING — the
    service intentionally refuses to silently fall back to the TTS cache bucket
    (lingoleap-tts-cache) because mixing audio PII into the TTS bucket violates
    the principle of least privilege.

Path convention (Issue #2266):
    - Attempt-bound:    reading-audio/attempts/{attempt_id}{ext}
    - Submission-bound: reading-audio/submissions/{submission_id}{ext}
    - Legacy debug:     reading-audio/{lesson_id or unknown}/{user_id}/{ts}{ext}

Privacy / security:
    - Bucket must be PRIVATE (no make_public / predefined_acl calls here).
    - Blob path is stored in DB; signed URLs are generated on demand and expire.
    - This service does NOT store user names, email, or any PII beyond user_id.
    - The Cloud Run service account must have roles/storage.objectCreator +
      roles/storage.objectViewer on the bucket.  For signed URL generation it
      additionally needs iam.serviceAccounts.signBlob permission (available via
      roles/iam.serviceAccountTokenCreator on the SA itself, or run on GCE/Cloud
      Run where the SA can self-sign).

Concurrency:
    Cloud Run instances default to concurrency=80.  The GCS Client() constructor
    is NOT thread-safe during initialisation.  A threading.Lock guards the lazy
    init so concurrent cold-start requests do not race.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# ── Bucket resolution ─────────────────────────────────────────────────────────
# We only read the env var once at module import time so it is easy to patch
# in tests via monkeypatch or by setting os.environ before import.
READING_AUDIO_GCS_BUCKET: str | None = os.environ.get("READING_AUDIO_GCS_BUCKET")

# ── Lazy GCS client with thread-safe init ────────────────────────────────────
_SENTINEL_UNAVAILABLE = object()
_gcs_bucket_client: object = None  # None = not yet tried
_gcs_init_lock = threading.Lock()


def _get_gcs_bucket():
    """Lazy-init GCS bucket client.  Returns None if GCS is unavailable.

    Thread-safe: uses a module-level lock to prevent race on cold start.
    NEVER raises — always returns a bucket object or None.
    """
    global _gcs_bucket_client

    # Fast path: already initialised (success or failure)
    if _gcs_bucket_client is not None:
        return None if _gcs_bucket_client is _SENTINEL_UNAVAILABLE else _gcs_bucket_client

    with _gcs_init_lock:
        # Re-check inside the lock (another thread may have initialised already)
        if _gcs_bucket_client is not None:
            return None if _gcs_bucket_client is _SENTINEL_UNAVAILABLE else _gcs_bucket_client

        # Guard #1: no bucket name → skip with warning (never fall back to TTS bucket)
        if not READING_AUDIO_GCS_BUCKET:
            logger.warning(
                "READING_AUDIO_GCS_BUCKET env var not set — "
                "reading audio uploads are disabled.  "
                "Set the var to enable GCS debug audio storage."
            )
            _gcs_bucket_client = _SENTINEL_UNAVAILABLE
            return None

        # Guard #2: google-cloud-storage may not be installed in test envs
        try:
            from google.cloud import storage  # noqa: PLC0415

            client = storage.Client()
            _gcs_bucket_client = client.bucket(READING_AUDIO_GCS_BUCKET)
            logger.info(
                "GCS reading-audio bucket initialised: %s", READING_AUDIO_GCS_BUCKET
            )
        except Exception as exc:
            logger.warning(
                "GCS reading-audio bucket unavailable — uploads disabled: %s", exc
            )
            _gcs_bucket_client = _SENTINEL_UNAVAILABLE
            return None

    return _gcs_bucket_client


# Map normalised MIME types to file extensions for the GCS blob path.
_MIME_TO_EXT: dict[str, str] = {
    "audio/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}


def _normalise_mime(mime_type: str) -> str:
    """Strip codec suffix: 'audio/webm;codecs=opus' → 'audio/webm'."""
    return mime_type.split(";")[0].strip()


def upload_reading_audio_to_gcs(
    audio_bytes: bytes,
    mime_type: str,
    user_id: int,
    lesson_id: str | None,
    duration_ms: int | None,
) -> None:
    """Synchronous GCS upload (run via FastAPI BackgroundTasks).

    Designed to be called from ``background_tasks.add_task(...)`` so it runs
    *after* the HTTP response has been sent.  Never blocks the student score.

    Safety guarantees:
    - NEVER sets public ACL (make_public / predefined_acl are forbidden).
    - NEVER logs audio bytes or user PII beyond user_id + duration_ms.
    - Any exception is caught, logged as WARNING, and swallowed.
    - Bucket is determined by READING_AUDIO_GCS_BUCKET env var only — will NOT
      silently fall back to lingoleap-tts-cache or any other bucket.

    GCS path: ``reading-audio/{lesson_id or 'unknown'}/{user_id}/{timestamp}{ext}``

    TODO (Issue #2266): Retention policy — audio linked from a DB record (any
    ReadingAttemptHistory or AssignmentSubmission with a non-null audio_gcs_path)
    is kept forever so students and teachers can always replay it.  Only three
    "garbage" types are eligible for deletion: (1) discarded takes where no
    evaluation was sent — skip the GCS upload entirely in the frontend; (2) GCS
    orphans where the DB record no longer points to the blob — daily reconciliation
    cron; (3) cascade-delete when the parent attempt/session/assignment is deleted.
    Do NOT add time-based lifecycle rules (no 30-day / 90-day auto-expire).
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return  # Already logged a warning at init time; skip silently.

    try:
        base_mime = _normalise_mime(mime_type)
        ext = _MIME_TO_EXT.get(base_mime, ".audio")

        timestamp_iso = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        safe_lesson_id = (lesson_id or "unknown").replace("/", "-").replace("..", "")
        blob_path = f"reading-audio/{safe_lesson_id}/{user_id}/{timestamp_iso}{ext}"

        blob = bucket.blob(blob_path)
        # Content-type is informational only — NO ACL is set; bucket stays private.
        blob.upload_from_string(audio_bytes, content_type=base_mime)

        logger.info(
            "reading-audio GCS upload OK: user_id=%d bytes=%d duration_ms=%s path=%s",
            user_id,
            len(audio_bytes),
            duration_ms,
            blob_path,
        )
    except Exception as exc:
        # Fail silently — never let upload failure affect the student experience.
        logger.warning(
            "reading-audio GCS upload failed (non-fatal): user_id=%d bytes=%d "
            "duration_ms=%s error=%s",
            user_id,
            len(audio_bytes),
            duration_ms,
            exc,
        )


def upload_reading_audio_to_gcs_sync(
    audio_bytes: bytes,
    mime_type: str,
    blob_path: str,
) -> str | None:
    """Synchronous GCS upload that returns the blob path on success.

    Unlike the fire-and-forget variant, this function is designed to be called
    inline (not via BackgroundTasks) so the caller can write the returned path
    to the DB in the same request.

    Args:
        audio_bytes: Raw audio bytes.
        mime_type:   MIME type string (e.g. 'audio/webm').
        blob_path:   Pre-computed GCS object path (e.g.
                     'reading-audio/attempts/42.webm').  The caller constructs
                     the path from the DB id so it is deterministic.

    Returns:
        blob_path on success, None on any failure (already logged as WARNING).

    Safety:
        - NEVER sets public ACL.
        - On any exception returns None (fail-open for the DB write).
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return None  # Already warned at init; skip silently.

    try:
        base_mime = _normalise_mime(mime_type)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(audio_bytes, content_type=base_mime)
        logger.info(
            "reading-audio GCS sync upload OK: bytes=%d path=%s",
            len(audio_bytes),
            blob_path,
        )
        return blob_path
    except Exception as exc:
        logger.warning(
            "reading-audio GCS sync upload failed (non-fatal): bytes=%d path=%s error=%s",
            len(audio_bytes),
            blob_path,
            exc,
        )
        return None


def delete_gcs_blob(blob_path: str) -> bool:
    """Delete a single GCS blob by path.  Returns True on success, False on failure.

    Failure is logged as WARNING; callers MUST NOT raise — GCS delete failures
    are non-fatal and should not block DB operations.  The orphan reconciliation
    script (scripts/reconcile_reading_audio_orphans.py) handles any residual
    blobs on manual run.

    Args:
        blob_path: GCS object path stored in audio_gcs_path columns.

    Returns:
        True  — blob deleted (or did not exist: idempotent).
        False — GCS unavailable or unexpected error.
    """
    if not blob_path:
        return False

    bucket = _get_gcs_bucket()
    if bucket is None:
        logger.warning(
            "GCS unavailable — cannot delete blob %s; will appear as orphan", blob_path
        )
        return False

    try:
        blob = bucket.blob(blob_path)
        blob.delete(if_generation_match=None)  # idempotent: 404 is OK
        logger.info("reading-audio GCS blob deleted: %s", blob_path)
        return True
    except Exception as exc:
        # google-cloud-storage raises NotFound if already gone — that is success.
        exc_name = type(exc).__name__
        if "NotFound" in exc_name or "404" in str(exc):
            logger.debug(
                "reading-audio GCS blob already gone (404): %s", blob_path
            )
            return True
        logger.warning(
            "reading-audio GCS blob delete failed: path=%s error=%s — will appear as orphan",
            blob_path,
            exc,
        )
        return False


def delete_gcs_blobs_for_paths(blob_paths: list[str]) -> tuple[int, int]:
    """Delete a batch of GCS blobs.  Best-effort; never raises.

    Used by cascade-delete hooks so GCS audio is cleaned up in sync with DB row
    removal.  Each blob is attempted independently — one failure does not stop
    the others.  Callers MUST NOT let failures block DB operations.

    Args:
        blob_paths: List of GCS object paths (None / empty strings are skipped).

    Returns:
        (deleted_count, failed_count) — for logging.
    """
    deleted = 0
    failed = 0
    for path in blob_paths:
        if not path:
            continue
        ok = delete_gcs_blob(path)
        if ok:
            deleted += 1
        else:
            failed += 1
    if any(blob_paths):
        logger.info(
            "reading-audio cascade delete: deleted=%d failed=%d total=%d",
            deleted,
            failed,
            sum(1 for p in blob_paths if p),
        )
    return deleted, failed


_signing_creds = None
_signing_creds_lock = threading.Lock()
_signing_email: str | None = None


def _signing_identity() -> tuple[str | None, str | None]:
    """Return (service_account_email, access_token) for IAM-based v4 signing.

    On Cloud Run/GCE the default credentials hold only an OAuth token, so v4
    signing must go through the IAM SignBlob API — which needs the runtime SA's
    email + a fresh access token. Returns (None, None) if unavailable (caller
    then falls back to library default, e.g. a private key in local dev).
    """
    global _signing_creds, _signing_email
    try:
        from google.auth import default as _ga_default  # noqa: PLC0415
        from google.auth.transport.requests import Request as _GaRequest  # noqa: PLC0415

        with _signing_creds_lock:
            if _signing_creds is None:
                _signing_creds, _ = _ga_default()
            creds = _signing_creds
        if not getattr(creds, "valid", False):
            creds.refresh(_GaRequest())

        email = _signing_email or getattr(creds, "service_account_email", None)
        if not email or email == "default":
            # compute_engine creds may report "default" → resolve real email
            import urllib.request  # noqa: PLC0415

            req = urllib.request.Request(
                "http://metadata.google.internal/computeMetadata/v1/instance/"
                "service-accounts/default/email",
                headers={"Metadata-Flavor": "Google"},
            )
            email = urllib.request.urlopen(req, timeout=2).read().decode().strip()  # noqa: S310
        _signing_email = email
        return email, getattr(creds, "token", None)
    except Exception as exc:  # never block signing setup; fall back to default
        logger.debug("signing identity unavailable, using library default: %s", exc)
        return None, None


def generate_audio_signed_url(
    blob_path: str,
    expiration_seconds: int = 600,
) -> str | None:
    """Generate a signed URL for private GCS audio playback.

    The signed URL is short-lived (default 10 minutes) and allows the holder
    to GET the object without any authentication.  It is generated server-side
    and returned to the authorised student only — never cached or stored.

    Args:
        blob_path:          GCS object path stored in ReadingAttemptHistory.audio_gcs_path.
        expiration_seconds: URL lifetime in seconds (default 600 = 10 min).

    Returns:
        Signed URL string on success, None on any failure.

    Requirements:
        The Cloud Run service account must be able to call
        blob.generate_signed_url().  On GCE / Cloud Run this works automatically
        when the SA has roles/iam.serviceAccountTokenCreator on itself.
    """
    bucket = _get_gcs_bucket()
    if bucket is None:
        return None

    try:
        blob = bucket.blob(blob_path)
        kwargs = {
            "expiration": timedelta(seconds=expiration_seconds),
            "method": "GET",
            "version": "v4",
        }
        # Cloud Run / GCE default credentials only carry an OAuth token (no
        # private key) → blob.generate_signed_url() would raise "you need a
        # private key to sign credentials". Passing service_account_email +
        # access_token makes the client sign via the IAM SignBlob API instead
        # (requires the runtime SA to have roles/iam.serviceAccountTokenCreator
        # on itself — already granted to the compute SA).
        email, token = _signing_identity()
        if email and token:
            kwargs["service_account_email"] = email
            kwargs["access_token"] = token
        url = blob.generate_signed_url(**kwargs)
        logger.debug(
            "reading-audio signed URL generated: path=%s expiry=%ds via_iam=%s",
            blob_path,
            expiration_seconds,
            bool(email and token),
        )
        return url
    except Exception as exc:
        logger.warning(
            "reading-audio signed URL generation failed: path=%s error=%s",
            blob_path,
            exc,
        )
        return None
