from sqlalchemy.orm import Session

from ..models.organization import Organization
from ..models.points_log import OrganizationPointsLog


class InsufficientPointsError(Exception):
    pass


def check_and_deduct_points(
    db: Session,
    organization_id: str,
    user_id: int | None,
    points: int,
    feature_type: str,
    description: str | None = None,
) -> OrganizationPointsLog:
    org = db.query(Organization).filter(Organization.id == organization_id).with_for_update().first()
    if org is None:
        raise ValueError("Organization not found")

    if org.total_points is not None:
        remaining = org.total_points - org.used_points
        if remaining < points:
            raise InsufficientPointsError(f"點數不足：剩餘 {remaining}，需要 {points}")

    org.used_points += points
    log = OrganizationPointsLog(
        organization_id=organization_id,
        user_id=user_id,
        points_used=points,
        feature_type=feature_type,
        description=description,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def get_org_for_student(db: Session, student_id: int) -> str | None:
    """Find org_id for a student via classroom → school → organization."""
    from ..models.school import Classroom, ClassroomStudent
    from ..models.school import School

    result = (
        db.query(School.organization_id)
        .join(Classroom, Classroom.school_id == School.id)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(ClassroomStudent.student_id == student_id)
        .filter(School.organization_id.isnot(None))
        .first()
    )
    return result[0] if result else None
