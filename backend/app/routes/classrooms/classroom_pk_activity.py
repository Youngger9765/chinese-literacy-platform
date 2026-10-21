"""Teacher-facing PK activity + settings — PRD §3.2/§7.4/§11.
``GET /api/classrooms/{id}/pk-activity`` and
``PATCH /api/classrooms/{id}/pk-settings``.

Deliberately separate from ``routes/pk.py`` (PRD independence rule #2 in
spirit — this reads/writes PK-adjacent data but is a *classroom* endpoint,
same place ``classroom_crud.py`` and friends live) and the activity view is
deliberately read-only/aggregate (PRD §3.2 "不看個別對戰內容" — see
services/pk/engine.get_classroom_pk_activity docstring for why only counts
are returned, never a match's rounds/answers).

``pk-settings`` (added 2026-10-16, issue #3586 §7.4 final revision; extended
2026-10-17, issue #3607): the teacher-only toggle for the three per-class
feature flags — 真人 PK (同學配對對戰 + 邀請碼), 跨班賽季 (league), and
課堂搶答 (live_quiz). Route path kept as ``/pk-settings`` even though it now
covers three switches, not one — renaming it would be a breaking change for
any existing caller for zero behavioral benefit. Stored in
``classrooms.feature_settings`` (schemaless JSON, see
services/pk/classroom_features.py), not a dedicated boolean column, so a
future class-level toggle never needs another migration. There is no
``pk_ai`` key and no corresponding endpoint field — Young 2026-10-16:
"AI PK 跟班級無關", 挑戰文學家 is unconditionally available to any
logged-in student and is never gated by classroom settings.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.user import User
from ...schemas.classroom import ClassroomFeatureSettingsRequest, ClassroomFeatureSettingsResponse
from ...services.pk import classroom_features
from ...services.pk.engine import get_classroom_pk_activity
from .helpers import get_classroom_or_404, require_owner_or_admin

router = APIRouter(tags=["classrooms"])


@router.get("/classrooms/{classroom_id}/pk-activity")
def get_pk_activity(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)
    return get_classroom_pk_activity(db, classroom_id)


@router.patch("/classrooms/{classroom_id}/pk-settings", response_model=ClassroomFeatureSettingsResponse)
def update_pk_settings(
    classroom_id: int,
    payload: ClassroomFeatureSettingsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Teacher-only. Only the classroom owner/admin can flip any of the
    three switches — same guard as ``PATCH /classrooms/{id}``
    (classroom_crud.update_classroom).

    Merges into the existing ``feature_settings`` dict rather than
    overwriting it wholesale, so flipping one switch never clobbers the
    other two (or any future key). ``exclude_unset`` means a request body
    that only names one field (e.g. ``{"league": true}``) only ever writes
    that one key — the other two switches' feature_settings entries (or
    lack thereof, which matters for the backward-compat legacy-usage rule)
    are left completely untouched. Routes the write through
    ``classroom_features.validate_feature_settings_patch`` even though the
    request body is already typed — that function is the single place the
    "unknown keys rejected / bool only" rule lives, and every write path
    (tests included) should exercise it rather than trusting the Pydantic
    layer alone to stay in sync with it.
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_owner_or_admin(classroom, current_user, db)

    provided = payload.model_dump(exclude_unset=True, exclude_none=True)
    cleaned = classroom_features.validate_feature_settings_patch(provided)
    merged = dict(classroom.feature_settings or {})
    merged.update(cleaned)
    classroom.feature_settings = merged
    db.commit()
    db.refresh(classroom)

    return ClassroomFeatureSettingsResponse(**classroom_features.gated_feature_values(classroom, db))
