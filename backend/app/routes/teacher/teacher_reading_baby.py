"""閱讀寶貝 —— 老師端 API（#3780 第一階段）。

    GET /teacher/classrooms/{classroom_id}/reading-baby-indicators
        — 畫面一：班級 × 能力指標熱力表
    GET /teacher/classrooms/{classroom_id}/reading-baby-indicators/{student_id}/{indicator_code}
        — 畫面三：這個判斷是哪幾課、哪幾題撐起來的

權限：老師必須擁有這個班級（`Classroom.teacher_id == current_user.id`），
跟 `teacher_reading_progress.py` 的 `_require_teacher_access_to_student` 同一個
模式，但這裡檢查的是「班級」owner 而不是「單一學生」——因為熱力表本身就是
整班視角。鑽取端點額外驗證該學生確實在這個班級裡，避免老師查到別班學生的
指標資料。
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.user import User
from ...schemas.reading_baby import ClassroomIndicatorHeatmapResponse, IndicatorEvidenceDetailResponse
from ...services import reading_baby_config, reading_baby_service

router = APIRouter(tags=["teacher"])


def _require_teacher_owns_classroom(classroom_id: int, current_user: User, db: Session) -> None:
    """⚠️ mutation 測試打的「權限檢查」②——`reading_baby_service.teacher_owns_classroom`
    若被改成永遠回傳 True，這裡的 403 就會消失，對應的負向測試會變紅。"""
    if not reading_baby_service.teacher_owns_classroom(
        db, classroom_id=classroom_id, teacher_id=current_user.id
    ):
        raise HTTPException(status_code=403, detail="你不是這個班級的老師")


@router.get(
    "/teacher/classrooms/{classroom_id}/reading-baby-indicators",
    response_model=ClassroomIndicatorHeatmapResponse,
    summary="班級 × 能力指標熱力表（#3780）",
)
def get_classroom_reading_baby_heatmap(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_teacher_owns_classroom(classroom_id, current_user, db)
    result = reading_baby_service.compute_classroom_indicator_heatmap(db, classroom_id=classroom_id)
    names = reading_baby_service.student_names(db, result.student_ids)
    return ClassroomIndicatorHeatmapResponse(
        classroom_id=result.classroom_id,
        indicator_codes=result.indicator_codes,
        student_ids=result.student_ids,
        students=[{"student_id": sid, "name": names.get(sid, f"學生 {sid}")} for sid in result.student_ids],
        indicators=[
            {"code": code, "text": reading_baby_config.get_indicator_text(code)}
            for code in result.indicator_codes
        ],
        cells=result.cells,
    )


@router.get(
    "/teacher/classrooms/{classroom_id}/reading-baby-indicators/{student_id}/{indicator_code}",
    response_model=IndicatorEvidenceDetailResponse,
    summary="能力指標鑽取：哪幾課、哪幾題撐起這個判斷（#3780）",
)
def get_classroom_reading_baby_indicator_detail(
    classroom_id: int,
    student_id: int,
    indicator_code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_teacher_owns_classroom(classroom_id, current_user, db)
    if not reading_baby_service.student_is_in_classroom(db, classroom_id=classroom_id, student_id=student_id):
        raise HTTPException(status_code=404, detail="這個學生不在這個班級裡")
    evidence = reading_baby_service.get_indicator_evidence_detail(
        db, student_id=student_id, indicator_code=indicator_code
    )
    return IndicatorEvidenceDetailResponse(
        student_id=student_id,
        student_name=reading_baby_service.student_names(db, [student_id]).get(student_id),
        indicator_code=indicator_code,
        indicator_text=reading_baby_config.get_indicator_text(indicator_code),
        evidence=evidence,
    )
