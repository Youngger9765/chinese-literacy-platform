"""Role-gated worksheet docx download (#3276).

Every lesson has a student-edition and a teacher-edition worksheet Word
document. Any authenticated user may download the student edition; only
teacher-tier roles may download the teacher edition.

This is a SEPARATE route from the public ``/assets/*`` proxy
(``app/routes/assets.py``) on purpose — that proxy is explicitly documented as
"No auth required — this is public content" and its responses carry
``Cache-Control: public, max-age=31536000, immutable`` for CDN edge caching.
Neither property is safe here:

- The teacher edition must 403 for a student token, which an unauthenticated
  public-content route cannot express.
- A `public` cache-control on an authenticated response is a classic cache
  -poisoning shape: if a teacher's request got cached at the CDN edge under
  the object's URL, a later request for the SAME URL (even from a student, or
  from someone with no token at all) could be served the cached teacher
  content straight from the edge, never reaching this auth check again. So
  this route always returns ``private, no-store``.

Docx bodies live in the (private) ``lingoleap-assets`` GCS bucket under
``worksheets-gated/`` — a prefix deliberately NOT in ``assets.py``'s
``_ALLOWED_PREFIXES`` allow-list, so the public proxy can never accidentally
serve them even if someone guesses the object path.
"""
import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, require_role
from ..database import get_db
from ..models.user import User
from ..services import worksheet_registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lessons", tags=["worksheets"])

# Roles allowed to fetch the teacher edition. Explicit allow-list (not "every
# role except student") — see rules/security.md's is_admin() trap note: we
# deliberately do NOT use is_admin()/is_system_admin() shortcuts here, this
# content isn't org/school-tenant-scoped so require_role's un-scoped role-name
# check is the correct (and simplest) tool.
_TEACHER_TIER_ROLES = (
    "teacher", "homeroom_teacher", "director", "principal",
    "org_admin", "org_owner", "system_admin",
)

_DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Authenticated content must never be cached by a shared/CDN cache — see the
# module docstring for why `public` here would be a cache-poisoning bug.
_CACHE_CONTROL = "private, no-store"


@lru_cache(maxsize=1)
def _get_bucket():
    """Lazily construct (and cache) the GCS bucket handle.

    Deliberately a SEPARATE cached handle from app.routes.assets._get_bucket
    (not shared) so tests that patch one never accidentally affect the other,
    and so the two routes' GCS access stays independently auditable.
    """
    from google.cloud import storage  # type: ignore[import]
    from ..config import settings
    client = storage.Client()
    return client.bucket(settings.gcs_bucket)


def _fetch_docx_bytes(gcs_path: str) -> bytes:
    bucket = _get_bucket()
    blob = bucket.blob(gcs_path)
    return blob.download_as_bytes()


@router.get("/{lesson_uid}/worksheet/student")
def download_student_worksheet(
    lesson_uid: str,
    current_user: User = Depends(get_current_user),
):
    """Any authenticated role (student, teacher, or above) may download this."""
    gcs_path = worksheet_registry.get_worksheet_gcs_path(lesson_uid, "student")
    if not gcs_path:
        raise HTTPException(status_code=404, detail="Worksheet not found")

    try:
        data = _fetch_docx_bytes(gcs_path)
    except ImportError:
        logger.error("google-cloud-storage not installed — worksheet download unavailable")
        raise HTTPException(status_code=503, detail="Worksheet service unavailable")
    except Exception as exc:
        logger.warning("Worksheet download miss for %r: %s", gcs_path, exc)
        raise HTTPException(status_code=404, detail="Worksheet not found")

    from starlette.responses import Response
    return Response(content=data, media_type=_DOCX_CONTENT_TYPE, headers={"Cache-Control": _CACHE_CONTROL})


@router.get("/{lesson_uid}/worksheet/teacher")
def download_teacher_worksheet(
    lesson_uid: str,
    current_user: User = require_role(*_TEACHER_TIER_ROLES),
):
    """Teacher-tier roles only. A student (or any non-teacher-tier role, e.g.
    parent) gets 403 via require_role before this body ever runs."""
    gcs_path = worksheet_registry.get_worksheet_gcs_path(lesson_uid, "teacher")
    if not gcs_path:
        raise HTTPException(status_code=404, detail="Worksheet not found")

    try:
        data = _fetch_docx_bytes(gcs_path)
    except ImportError:
        logger.error("google-cloud-storage not installed — worksheet download unavailable")
        raise HTTPException(status_code=503, detail="Worksheet service unavailable")
    except Exception as exc:
        logger.warning("Worksheet download miss for %r: %s", gcs_path, exc)
        raise HTTPException(status_code=404, detail="Worksheet not found")

    from starlette.responses import Response
    return Response(content=data, media_type=_DOCX_CONTENT_TYPE, headers={"Cache-Control": _CACHE_CONTROL})


@router.get("/{lesson_uid}/worksheet/{version}")
def download_worksheet_invalid_version(lesson_uid: str, version: str):
    """Catch-all for any version other than student/teacher — 404, not 422,
    to match the rest of this API's "unknown resource" convention (see
    app/routes/stories.py get_story's numeric-id normalization doing the same).
    Registered AFTER the two concrete routes above so they take priority.
    """
    raise HTTPException(status_code=404, detail="Unknown worksheet version")
