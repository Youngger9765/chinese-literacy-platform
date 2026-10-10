"""Junyi class/student import endpoints (issue #3380).

Both endpoints are fully gated behind ``settings.junyi_class_import_enabled``
(404 when off). Authorization mirrors ``create_classroom``: the caller must
have standing in the target school. The real cross-tenant boundary lives in
the parametrised BigQuery query (``WHERE teacher_user_id = @caller``) plus the
service-layer allowlist; this route adds school-membership + rate limiting.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.policies import is_system_admin, _is_org_admin_of_school
from ...auth.rate_limiter import InMemoryRateLimiter
from ...database import get_db
from ...config import settings
from ...models.school import School
from ...models.user import User
from ...schemas.classroom import JunyiImportClassesResponse, JunyiImportRequest, JunyiImportResponse
from ...services.junyi_bigquery_client import JunyiBigQueryError
from ...services.junyi_class_import_service import list_importable_classes, import_junyi_classes

router = APIRouter(tags=["classrooms"])
_junyi_import_rate_limiter = InMemoryRateLimiter()


def get_junyi_bq_client():
    from ...services.junyi_bigquery_client import DemoJunyiBigQueryClient, RealJunyiBigQueryClient

    if settings.junyi_bq_mode == "fake":
        return DemoJunyiBigQueryClient()
    return RealJunyiBigQueryClient()


def _require_school_membership(current_user: User, school_id: int, db: Session) -> School:
    school = db.query(School).filter(School.id == school_id).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")
    if is_system_admin(current_user.id, db):
        return school
    is_member = any(
        ur.is_active and ur.role.name == "teacher"
        and ur.scope_type == "school" and ur.scope_id == str(school.id)
        for ur in current_user.user_roles
    )
    if not (is_member or _is_org_admin_of_school(current_user.id, school.id, db)):
        raise HTTPException(status_code=403, detail="Not authorized for this school")
    return school


@router.get("/classrooms/junyi-import/classes", response_model=JunyiImportClassesResponse)
def get_junyi_importable_classes(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    bq_client=Depends(get_junyi_bq_client),
):
    if not settings.junyi_class_import_enabled:
        raise HTTPException(status_code=404, detail="Not Found")
    _require_school_membership(current_user, school_id, db)
    rl_info = _junyi_import_rate_limiter.check_with_info(f"list:{current_user.id}", 20, 60)
    if not rl_info.allowed:
        raise HTTPException(status_code=429, detail="Too many requests")
    try:
        return list_importable_classes(db, current_user, school_id, bq_client)
    except JunyiBigQueryError as exc:
        raise HTTPException(status_code=503, detail="暫時查不到均一資料，請稍後再試") from exc


@router.post("/classrooms/junyi-import/import", response_model=JunyiImportResponse)
def post_junyi_import(
    payload: JunyiImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    bq_client=Depends(get_junyi_bq_client),
):
    if not settings.junyi_class_import_enabled:
        raise HTTPException(status_code=404, detail="Not Found")
    _require_school_membership(current_user, payload.school_id, db)
    rl_info = _junyi_import_rate_limiter.check_with_info(f"import:{current_user.id}", 10, 60)
    if not rl_info.allowed:
        raise HTTPException(status_code=429, detail="Too many requests")
    try:
        return import_junyi_classes(db, current_user, payload.school_id, payload.junyi_class_ids, bq_client)
    except JunyiBigQueryError as exc:
        raise HTTPException(status_code=503, detail="暫時查不到均一資料，請稍後再試") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
