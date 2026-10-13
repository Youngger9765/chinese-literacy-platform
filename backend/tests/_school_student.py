"""Test helper: make a user a real student of a school (#3534).

`POST /api/classrooms/{id}/students` only enrolls users holding an active `student`
role scoped to the classroom's school — the exact role batch/CSV/Junyi import grant.
Fixtures that register a generic user and then enroll it must grant that role first.
"""

from app.models.school import Classroom
from app.models.user import Role, UserRole


def grant_school_student_role(session_factory, user_id, *, classroom_id=None, school_id=None):
    """Grant `user_id` an active student role at `school_id` (or the classroom's school)."""
    db = session_factory()
    try:
        if school_id is None:
            school_id = db.query(Classroom.school_id).filter(Classroom.id == classroom_id).scalar()
        role = db.query(Role).filter(Role.name == "student").first()
        if role is None:
            role = Role(name="student", display_name="Student", scope_level="school")
            db.add(role)
            db.flush()
        exists = db.query(UserRole).filter(
            UserRole.user_id == user_id,
            UserRole.role_id == role.id,
            UserRole.scope_type == "school",
            UserRole.scope_id == str(school_id),
        ).first()
        if exists is None:
            db.add(UserRole(user_id=user_id, role_id=role.id,
                            scope_type="school", scope_id=str(school_id)))
        elif not exists.is_active:
            exists.is_active = True
        db.commit()
    finally:
        db.close()
