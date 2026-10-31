"""閱讀寶貝 —— 學生端 API（#3780 第一階段）。

    GET /learning/students/{student_id}/reading-babies              — 179 課圖鑑
    GET /learning/students/{student_id}/reading-babies/{lesson_uid} — 單課寶貝卡

權限：沿用既有 `verify_student_access`（本人／任課老師／連結家長都能看，跟
v1 的「查詢」權限同一個精神——只有會改變狀態的動作才需要更嚴的權限，但這
兩支路由都是唯讀查詢，不存在「餵食」那種動作，所以不需要額外收緊）。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.user import User
from ...schemas.reading_baby import ReadingBabyAtlasResponse, ReadingBabyCardResponse
from ...services import reading_baby_config, reading_baby_service
from ._helpers import verify_student_access

router = APIRouter()


@router.get(
    "/learning/students/{student_id}/reading-babies",
    response_model=ReadingBabyAtlasResponse,
    summary="179 課閱讀寶貝圖鑑（#3780）",
)
def get_reading_baby_atlas(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    verify_student_access(student_id, current_user, db)
    babies = reading_baby_service.compute_atlas(db, student_id=student_id)
    total_fragments = sum(b.fragments_count for b in babies)
    return ReadingBabyAtlasResponse(
        student_id=student_id,
        total_lessons=len(babies),
        total_fragments=total_fragments,
        babies=babies,
    )


@router.get(
    "/learning/students/{student_id}/reading-babies/{lesson_uid}",
    response_model=ReadingBabyCardResponse,
    summary="單課閱讀寶貝卡（#3780）",
)
def get_reading_baby_card(
    student_id: int,
    lesson_uid: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    verify_student_access(student_id, current_user, db)
    if reading_baby_config.get_lesson_indicator(lesson_uid) is None:
        raise HTTPException(status_code=404, detail="這一課不在閱讀寶貝的 179 課課綱對照裡")
    growth = reading_baby_service.compute_lesson_growth(db, student_id=student_id, lesson_uid=lesson_uid)
    return growth
