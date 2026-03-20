"""Teacher alerts endpoints: classroom alerts and at-risk student predictions."""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.school import ClassroomStudent
from ...models.session import LearningSession
from ...models.user import User
from ...services.prediction_service import predict_learning_difficulty
from .teacher_schemas import AtRiskStudentResponse, StudentAlertResponse

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


@router.get(
    "/teacher/classrooms/{classroom_id}/alerts",
    response_model=list[StudentAlertResponse],
)
def get_classroom_alerts(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect at-risk students in a classroom.

    Alert types:
    - inactive: no sessions in last 14 days
    - low_performance: average score below 50
    - declining: score declining trend (last 3 sessions decreasing)
    """
    _check_classroom_access(current_user, classroom_id, db)

    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    if not enrollments:
        return []

    student_ids = [e.student_id for e in enrollments]
    now = datetime.now(timezone.utc)
    fourteen_days_ago = now - timedelta(days=14)

    # Batch-load all scored sessions for alert analysis (single query instead of N)
    all_scored_sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.overall_score.isnot(None),
        )
        .order_by(LearningSession.student_id, LearningSession.started_at.asc())
        .all()
    )
    scored_by_student: dict[int, list[LearningSession]] = {}
    for s in all_scored_sessions:
        scored_by_student.setdefault(s.student_id, []).append(s)

    # Batch-load latest session per student
    all_latest_sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(student_ids))
        .order_by(LearningSession.student_id, LearningSession.started_at.desc())
        .all()
    )
    latest_by_student: dict[int, LearningSession] = {}
    for s in all_latest_sessions:
        if s.student_id not in latest_by_student:
            latest_by_student[s.student_id] = s

    def _make_aware(dt: datetime) -> datetime:
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    alerts: list[StudentAlertResponse] = []
    for enrollment in enrollments:
        student = enrollment.student
        latest = latest_by_student.get(student.id)
        last_date = latest.started_at if latest else None

        is_inactive = last_date is None or _make_aware(last_date) < fourteen_days_ago
        if is_inactive:
            days_since = (
                int((now - _make_aware(last_date)).days) if last_date else None
            )
            detail = f"已 {days_since} 天未練習" if days_since is not None else "尚未開始練習"
            alerts.append(
                StudentAlertResponse(
                    student_id=student.id,
                    student_name=student.name,
                    alert_type="inactive",
                    detail=detail,
                    last_session_date=last_date,
                )
            )
            continue

        scored = scored_by_student.get(student.id, [])
        scores = [s.overall_score for s in scored if s.overall_score is not None]

        if scores:
            avg_score = sum(scores) / len(scores)
            if avg_score < 50:
                alerts.append(
                    StudentAlertResponse(
                        student_id=student.id,
                        student_name=student.name,
                        alert_type="low_performance",
                        detail=f"平均分數 {avg_score:.0f} 分（低於 50 分）",
                        last_session_date=last_date,
                    )
                )
                continue

        if len(scores) >= 3:
            last3 = scores[-3:]
            if last3[0] > last3[1] > last3[2]:
                alerts.append(
                    StudentAlertResponse(
                        student_id=student.id,
                        student_name=student.name,
                        alert_type="declining",
                        detail=f"最近 3 次分數持續下降：{last3[0]:.0f} → {last3[1]:.0f} → {last3[2]:.0f}",
                        last_session_date=last_date,
                    )
                )

    return alerts


@router.get(
    "/teacher/classrooms/{classroom_id}/at-risk-students",
    response_model=list[AtRiskStudentResponse],
)
def get_at_risk_students(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Predict which students may struggle based on early learning patterns.

    Uses a rule-based engine (Issue #254) that analyses:
    - Low accuracy on first 2-3 stories
    - High character error rate
    - Declining accuracy trend
    - Long inactivity gaps
    - Multiple stuck-points

    Returns all students in the classroom with their risk prediction.
    Only medium/high risk students are highlighted by default; the frontend
    may choose to show all or filter to at-risk only.
    """
    _check_classroom_access(current_user, classroom_id, db)

    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    if not enrollments:
        return []

    results: list[AtRiskStudentResponse] = []
    for enrollment in enrollments:
        student = enrollment.student
        prediction = predict_learning_difficulty(student.id, db)

        results.append(
            AtRiskStudentResponse(
                student_id=student.id,
                student_name=student.name,
                risk_level=prediction["risk_level"],
                risk_factors=prediction["risk_factors"],
                recommended_actions=prediction["recommended_actions"],
                confidence_score=prediction["confidence_score"],
                supporting_data=prediction["supporting_data"],
            )
        )

    order = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (order.get(r.risk_level, 3), r.student_name))

    return results
