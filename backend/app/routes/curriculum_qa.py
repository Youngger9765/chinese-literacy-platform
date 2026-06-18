"""Curriculum QA dashboard API — keypoints manifest + previews (admin only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse

from ..auth.dependencies import get_current_user, require_role
from ..models.user import User
from ..services.curriculum_qa_service import (
    get_lesson_entry,
    load_keypoints_manifest,
    read_preview_html,
    read_snapshot_json,
)
from ..services.curriculum_qa_spotlight import get_spotlight_lesson, load_spotlight_manifest

router = APIRouter(
    prefix="/curriculum-qa",
    tags=["curriculum-qa"],
    dependencies=[require_role("system_admin")],
)


@router.get("/keypoints")
async def get_keypoints_manifest(
    current_user: User = Depends(get_current_user),
):
    """Full keypoints QA manifest (lesson table + gate results)."""
    return load_keypoints_manifest()


@router.get("/keypoints/{lesson_id}")
async def get_keypoints_lesson_detail(
    lesson_id: str,
    current_user: User = Depends(get_current_user),
):
    entry = get_lesson_entry(lesson_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Lesson not in QA manifest")

    return {
        **entry,
        "keypoints": read_snapshot_json(lesson_id, "keypoints.json"),
        "structure": read_snapshot_json(lesson_id, "structure.json"),
    }


@router.get("/keypoints/{lesson_id}/preview/original", response_class=HTMLResponse)
async def get_keypoints_original_preview(
    lesson_id: str,
    current_user: User = Depends(get_current_user),
):
    html = read_preview_html(lesson_id)
    if html is None:
        raise HTTPException(status_code=404, detail="Original preview not found")
    return HTMLResponse(content=html)


@router.get("/spotlight")
async def get_spotlight_manifest(
    current_user: User = Depends(get_current_user),
):
    """Dev7 spotlight QA manifest (eval + gold fingerprint)."""
    return load_spotlight_manifest()


@router.get("/spotlight/{lesson_id}")
async def get_spotlight_lesson_detail(
    lesson_id: str,
    current_user: User = Depends(get_current_user),
):
    entry = get_spotlight_lesson(lesson_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Lesson not in spotlight QA manifest")
    return entry
