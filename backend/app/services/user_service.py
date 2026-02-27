import secrets
import string

from sqlalchemy.orm import Session

from ..models.school import School, Teacher, Class, ClassStudent  # noqa: F401
from ..models.student import Student
from .auth_service import hash_password


def create_teacher(
    db: Session, email: str, name: str, password_hash: str, school_id: int
) -> Teacher:
    teacher = Teacher(
        school_id=school_id, email=email, name=name, password_hash=password_hash
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


def get_teacher_by_email(db: Session, email: str) -> Teacher | None:
    return db.query(Teacher).filter(Teacher.email == email).first()


def create_student(db: Session, name: str, password: str) -> Student:
    student = Student(
        name=name, password_hash=hash_password(password)
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return student


def get_students_in_class(db: Session, class_id: int) -> list[Student]:
    rows = db.query(ClassStudent).filter(ClassStudent.class_id == class_id).all()
    return [db.get(Student, r.student_id) for r in rows]


def create_class(db: Session, teacher_id: int, name: str) -> Class:
    cls = Class(
        teacher_id=teacher_id, name=name, class_code=generate_class_code(db)
    )
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return cls


def generate_class_code(db: Session) -> str:
    chars = string.ascii_uppercase + string.digits
    for _ in range(100):  # max retries
        code = "".join(secrets.choice(chars) for _ in range(6))
        if not db.query(Class).filter(Class.class_code == code).first():
            return code
    raise RuntimeError("Failed to generate unique class code")


def generate_initial_password() -> str:
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(8))
