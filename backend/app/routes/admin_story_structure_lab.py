"""Story Structure Lab API — YAML / keypoints / live render / QA gates (admin)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth.dependencies import get_current_user, require_role
from ..models.user import User
from ..services.story_structure_lab_service import build_lab_detail, build_lab_index

router = APIRouter(
    prefix="/admin/story-structure-lab",
    tags=["admin-story-structure-lab"],
    dependencies=[require_role("system_admin")],
)


@router.get("")
async def list_story_structure_lab(
    current_user: User = Depends(get_current_user),
):
    """Index: all loader lessons with tier + interaction_profile + QA gate lights."""
    return build_lab_index()


@router.get("/{story_id}")
async def get_story_structure_lab_detail(
    story_id: int,
    current_user: User = Depends(get_current_user),
):
    """Detail: YAML table, keypoints, sanitized structure, grading structure, QA gates."""
    detail = build_lab_detail(story_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Story not found")
    return detail
