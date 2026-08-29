"""Public asset proxy — serves images/worksheets from the (private) lingoleap-assets bucket.

Issue #2486: `lingoleap-assets` was public-read (allUsers objectViewer), which let
anyone anonymously *enumerate* (list all 3900+ objects) and bulk-download the
entire course image/worksheet library — an egress-cost risk with no cap, plus a
content-enumeration / IP-exposure concern. This route lets the backend's own
service-account credentials read the bucket while the bucket itself is private —
the browser only ever talks to our own origin (Firebase Hosting `/assets/**`
rewrite in prod/staging, or the backend's own Cloud Run URL directly in
preview/local dev), never to storage.googleapis.com.

Security posture:
- Only allow-listed top-level prefixes are servable (lessons-images/, stories/,
  worksheets/, demo-reading/) — these are exactly the prefixes referenced by frontend consts and
  backend-generated URLs. Legacy prefixes not consumed by the app (pr-screenshots/,
  qa/) are NOT proxied — no general-purpose GCS object reader.
- Strict allow-list regex on the full decoded path before it ever reaches GCS,
  plus an explicit ".." reject, guards against path-traversal-style requests.
- No auth required — this is public *content* (same visibility as before); the
  fix closes the *enumeration + uncapped egress* surface, not the content itself.
- Covered by the app-wide GlobalRateLimitMiddleware (see main.py) so a single IP
  can no longer hammer the bucket at unlimited rate.
"""
import logging
import re
from pathlib import Path
from functools import lru_cache

from fastapi import APIRouter, HTTPException
from starlette.responses import Response

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assets", tags=["assets"])

# Keep in sync with frontend `ASSET_BASE` consumers (assetBase.ts) and the
# backend URL builders in lesson_layer_loaders.py — this list IS the public
# content surface of the bucket.
_ALLOWED_PREFIXES = ("lessons-images/", "stories/", "worksheets/", "demo-reading/")

# Allow-list charset for the decoded object path. FastAPI's `{path:path}`
# converter URL-decodes the raw request path once before this ever runs, so a
# literal ".." here is a real traversal attempt, not a percent-encoding
# artifact.
#
# `\w` (Unicode by default for str patterns) matches ASCII word chars PLUS
# non-ASCII letters/digits, so CJK object names are allowed — this is a
# 國語文 (Chinese-literacy) platform and real thumbnails are named e.g.
# `文-L1.webp` (#2486 regression: the old ASCII-only class 404'd every
# classical-Chinese lesson thumbnail even though the object existed). Still
# rejected outright: backslashes, NUL, control chars, whitespace, `%`, quotes
# — none are in `[\w\-./]`. Path traversal is caught by the explicit ".."
# check + the allow-listed-prefix check in `_is_safe_object_path`.
_SAFE_PATH_RE = re.compile(r"[\w\-./]+")

_CONTENT_TYPES = {
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".mp3": "audio/mpeg",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_DEFAULT_CONTENT_TYPE = "application/octet-stream"

# Cache the asset immutably at the edge (Firebase Hosting CDN) and in the
# browser — object keys are effectively content-addressed by lesson code /
# filename in practice, and this is exactly the lever that reduces origin
# egress for repeat views.
_CACHE_CONTROL = "public, max-age=31536000, immutable"


def _is_safe_object_path(object_path: str) -> bool:
    if not object_path or ".." in object_path:
        return False
    if object_path.startswith("/"):
        return False
    if not _SAFE_PATH_RE.fullmatch(object_path):
        return False
    # Must have an actual filename component after the prefix — a bare
    # "lessons-images/" request is never a real object, reject it here
    # instead of letting it fall through to a GCS lookup.
    return any(
        object_path.startswith(prefix) and len(object_path) > len(prefix)
        for prefix in _ALLOWED_PREFIXES
    )


@lru_cache(maxsize=1)
def _get_bucket():
    """Lazily construct (and cache) the GCS bucket handle.

    Import is deferred (matches the pattern in omo_storage.py) so local dev /
    unit tests that never exercise this route don't need google-cloud-storage
    importable at module load time.
    """
    from google.cloud import storage  # type: ignore[import]
    client = storage.Client()
    return client.bucket(settings.gcs_bucket)


def _content_type_for(object_path: str) -> str:
    if "." not in object_path:
        return _DEFAULT_CONTENT_TYPE
    ext = "." + object_path.rsplit(".", 1)[-1].lower()
    return _CONTENT_TYPES.get(ext, _DEFAULT_CONTENT_TYPE)


_LESSONS_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "lessons"
_UID_RE = re.compile(r"^L\d{4}$")


@router.get("/lesson/{lesson_uid}/{filename}")
def get_lesson_asset(lesson_uid: str, filename: str) -> Response:
    """Serve a file from the uid tree: cover images, figures, anything shipped with
    the lesson.

    These live in the repo rather than in GCS because they are part of the lesson —
    the first edition kept covers in a bucket keyed by lesson code, and when the
    codes were renumbered every image pointed at a different story. Filing them under
    the uid removes that class of mistake entirely.

    Registered ABOVE the catch-all GCS proxy so `/assets/lesson/...` resolves here;
    everything else still goes to the bucket.
    """
    if not _UID_RE.match(lesson_uid) or "/" in filename or ".." in filename:
        raise HTTPException(status_code=404, detail="Not found")

    uid_dir = _LESSONS_ROOT / lesson_uid
    if not uid_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not found")
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    )
    if not versions:
        raise HTTPException(status_code=404, detail="Not found")

    # 從最新版本往回找第一個有這個檔的版本。只看 `versions[-1]` 的話，
    # 二修沒搬過去的資產（175 張封面全在 v2/assets/）一律 404 ——
    # 而它們是課的一部分，不是版本的一部分。
    path = next(
        (v / "assets" / filename for v in reversed(versions)
         if (v / "assets" / filename).is_file()),
        versions[-1] / "assets" / filename,   # 都沒有時維持原本的 404 路徑
    )
    # resolve() before the containment check: a symlink inside assets/ would
    # otherwise pass the string checks above and read outside the tree.
    if not path.resolve().is_file() or _LESSONS_ROOT.resolve() not in path.resolve().parents:
        raise HTTPException(status_code=404, detail="Not found")

    return Response(
        content=path.read_bytes(),
        media_type=_content_type_for(filename),
        headers={"Cache-Control": _CACHE_CONTROL},
    )


@router.get("/{object_path:path}")
def get_asset(object_path: str) -> Response:
    if not _is_safe_object_path(object_path):
        raise HTTPException(status_code=404, detail="Not found")

    try:
        bucket = _get_bucket()
        blob = bucket.blob(object_path)
        data = blob.download_as_bytes()
    except ImportError:
        logger.error("google-cloud-storage not installed — asset proxy unavailable")
        raise HTTPException(status_code=503, detail="Asset service unavailable")
    except Exception as exc:
        # Covers google.cloud.exceptions.NotFound and any other GCS failure.
        # Deliberately generic — never echo the exception text or bucket name
        # back to the client.
        logger.warning("Asset proxy miss for %r: %s", object_path, exc)
        raise HTTPException(status_code=404, detail="Not found")

    return Response(
        content=data,
        media_type=_content_type_for(object_path),
        headers={"Cache-Control": _CACHE_CONTROL},
    )
