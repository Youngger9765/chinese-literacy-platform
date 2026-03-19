"""Teacher notifications endpoints: notification center (read/unread alerts)."""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.notification_read import TeacherNotificationRead
from ...models.school import Classroom, ClassroomStudent
from ...models.session import LearningSession
from ...models.user import User
from .teacher_schemas import (
    MarkReadRequest,
    NotificationItem,
    NotificationSummaryResponse,
    StudentAlertResponse,
)

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


def _build_classroom_alerts_for_teacher(
    teacher_id: int,
    db: Session,
) -> list[tuple[Classroom, StudentAlertResponse]]:
    """Return (classroom, alert) pairs for all classrooms owned by the teacher."""
    classrooms = (
        db.query(Classroom)
        .filter(Classroom.teacher_id == teacher_id, Classroom.is_active == True)  # noqa: E712
        .all()
    )

    now = datetime.now(timezone.utc)
    fourteen_days_ago = now - timedelta(days=14)
    results: list[tuple[Classroom, StudentAlertResponse]] = []

    def _make_aware(dt: datetime) -> datetime:
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    # Batch-load all enrollments across all classrooms in a single query
    all_classroom_ids = [c.id for c in classrooms]
    all_enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id.in_(all_classroom_ids))
        .all()
        if all_classroom_ids else []
    )
    enrollments_by_classroom: dict[int, list[ClassroomStudent]] = {}
    for e in all_enrollments:
        enrollments_by_classroom.setdefault(e.classroom_id, []).append(e)

    all_student_ids = list({e.student_id for e in all_enrollments})

    # Batch-load all scored sessions and latest sessions for all students at once
    all_scored_sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(all_student_ids),
            LearningSession.overall_score.isnot(None),
        )
        .order_by(LearningSession.student_id, LearningSession.started_at.asc())
        .all()
        if all_student_ids else []
    )
    scored_by_student: dict[int, list[LearningSession]] = {}
    for s in all_scored_sessions:
        scored_by_student.setdefault(s.student_id, []).append(s)

    all_latest = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(all_student_ids))
        .order_by(LearningSession.student_id, LearningSession.started_at.desc())
        .all()
        if all_student_ids else []
    )
    latest_by_student: dict[int, LearningSession] = {}
    for s in all_latest:
        if s.student_id not in latest_by_student:
            latest_by_student[s.student_id] = s

    for classroom in classrooms:
        enrollments = enrollments_by_classroom.get(classroom.id, [])
        for enrollment in enrollments:
            student = enrollment.student
            student_sessions = scored_by_student.get(student.id, [])
            latest_session = latest_by_student.get(student.id)
            last_session_date = latest_session.started_at if latest_session else None

            is_inactive = (
                last_session_date is None
                or _make_aware(last_session_date) < fourteen_days_ago
            )
            if is_inactive:
                days_since = (
                    int((now - _make_aware(last_session_date)).days)
                    if last_session_date
                    else None
                )
                detail = (
                    f"已 {days_since} 天未練習" if days_since is not None else "尚未開始練習"
                )
                results.append((
                    classroom,
                    StudentAlertResponse(
                        student_id=student.id,
                        student_name=student.name,
                        alert_type="inactive",
                        detail=detail,
                        last_session_date=last_session_date,
                    ),
                ))
                continue

            scores = [s.overall_score for s in student_sessions if s.overall_score is not None]
            if scores:
                avg_score = sum(scores) / len(scores)
                if avg_score < 50:
                    results.append((
                        classroom,
                        StudentAlertResponse(
                            student_id=student.id,
                            student_name=student.name,
                            alert_type="low_performance",
                            detail=f"平均分數 {avg_score:.0f} 分（低於 50 分）",
                            last_session_date=last_session_date,
                        ),
                    ))
                    continue

            if len(scores) >= 3:
                last3 = scores[-3:]
                if last3[0] > last3[1] > last3[2]:
                    results.append((
                        classroom,
                        StudentAlertResponse(
                            student_id=student.id,
                            student_name=student.name,
                            alert_type="declining",
                            detail=f"最近 3 次分數持續下降：{last3[0]:.0f} → {last3[1]:.0f} → {last3[2]:.0f}",
                            last_session_date=last_session_date,
                        ),
                    ))

    return results


@router.get(
    "/teacher/notifications",
    response_model=NotificationSummaryResponse,
)
def get_teacher_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate alerts from all teacher's classrooms and annotate with read state."""
    pairs = _build_classroom_alerts_for_teacher(current_user.id, db)

    all_keys = [
        f"{classroom.id}:{alert.student_id}:{alert.alert_type}"
        for classroom, alert in pairs
    ]

    read_records = (
        db.query(TeacherNotificationRead)
        .filter(
            TeacherNotificationRead.teacher_id == current_user.id,
            TeacherNotificationRead.alert_key.in_(all_keys),
        )
        .all()
    ) if all_keys else []

    read_map: dict[str, datetime] = {r.alert_key: r.read_at for r in read_records}

    items: list[NotificationItem] = []
    for classroom, alert in pairs:
        key = f"{classroom.id}:{alert.student_id}:{alert.alert_type}"
        is_read = key in read_map
        items.append(NotificationItem(
            alert_key=key,
            classroom_id=classroom.id,
            classroom_name=classroom.name,
            student_id=alert.student_id,
            student_name=alert.student_name,
            alert_type=alert.alert_type,
            detail=alert.detail,
            last_session_date=alert.last_session_date,
            is_read=is_read,
            read_at=read_map.get(key),
        ))

    # Sort: unread first, then by alert type priority, then student name
    type_priority = {"inactive": 0, "low_performance": 1, "declining": 2}
    items.sort(key=lambda n: (n.is_read, type_priority.get(n.alert_type, 9), n.student_name))

    unread_count = sum(1 for item in items if not item.is_read)

    return NotificationSummaryResponse(
        total=len(items),
        unread=unread_count,
        items=items,
    )


@router.post(
    "/teacher/notifications/mark-read",
    response_model=dict,
)
def mark_notifications_read(
    payload: MarkReadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark specific alert keys as read for the current teacher."""
    if not payload.alert_keys:
        return {"marked": 0}

    existing_keys = {
        r.alert_key
        for r in db.query(TeacherNotificationRead)
        .filter(
            TeacherNotificationRead.teacher_id == current_user.id,
            TeacherNotificationRead.alert_key.in_(payload.alert_keys),
        )
        .all()
    }

    new_keys = [k for k in payload.alert_keys if k not in existing_keys]
    for key in new_keys:
        db.add(TeacherNotificationRead(teacher_id=current_user.id, alert_key=key))

    if new_keys:
        db.commit()

    logger.info("Teacher %d marked %d notifications as read", current_user.id, len(new_keys))
    return {"marked": len(new_keys)}


@router.post(
    "/teacher/notifications/mark-all-read",
    response_model=dict,
)
def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark all current alerts as read for the current teacher."""
    pairs = _build_classroom_alerts_for_teacher(current_user.id, db)
    all_keys = [
        f"{classroom.id}:{alert.student_id}:{alert.alert_type}"
        for classroom, alert in pairs
    ]

    if not all_keys:
        return {"marked": 0}

    existing_keys = {
        r.alert_key
        for r in db.query(TeacherNotificationRead)
        .filter(
            TeacherNotificationRead.teacher_id == current_user.id,
            TeacherNotificationRead.alert_key.in_(all_keys),
        )
        .all()
    }

    new_keys = [k for k in all_keys if k not in existing_keys]
    for key in new_keys:
        db.add(TeacherNotificationRead(teacher_id=current_user.id, alert_key=key))

    if new_keys:
        db.commit()

    logger.info("Teacher %d marked all %d notifications as read", current_user.id, len(new_keys))
    return {"marked": len(new_keys)}
