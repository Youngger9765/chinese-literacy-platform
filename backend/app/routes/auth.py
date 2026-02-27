from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.school import School, Teacher, Class, ClassStudent
from ..models.student import Student
from ..schemas.auth import TeacherRegisterRequest, LoginRequest, AuthResponse, UserProfile
from ..services.auth_service import hash_password, verify_password, create_access_token

router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=AuthResponse)
def register_teacher(req: TeacherRegisterRequest, db: Session = Depends(get_db)):
    # Check email uniqueness
    existing = db.query(Teacher).filter(Teacher.email == req.email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="此 Email 已被註冊")

    # Find or create school
    school = db.query(School).filter(School.name == req.school_name).first()
    if not school:
        school = School(name=req.school_name)
        db.add(school)
        db.flush()

    # Create teacher
    teacher = Teacher(
        school_id=school.id,
        email=req.email,
        name=req.name,
        password_hash=hash_password(req.password),
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    # Generate token
    token = create_access_token({"sub": str(teacher.id), "role": "teacher"})

    return AuthResponse(
        access_token=token,
        user=UserProfile(id=teacher.id, name=teacher.name, role="teacher", email=teacher.email),
    )


@router.post("/auth/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    if req.login_type == "teacher":
        teacher = db.query(Teacher).filter(Teacher.email == req.email).first()
        if not teacher or not verify_password(req.password, teacher.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="帳號或密碼錯誤"
            )
        if not teacher.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="帳號已停用"
            )

        token = create_access_token({"sub": str(teacher.id), "role": "teacher"})
        return AuthResponse(
            access_token=token,
            user=UserProfile(
                id=teacher.id, name=teacher.name, role="teacher", email=teacher.email
            ),
        )

    else:  # student
        cls = db.query(Class).filter(Class.class_code == req.class_code.upper()).first()
        if not cls:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="無效的班級代碼"
            )

        cs = (
            db.query(ClassStudent)
            .filter(
                ClassStudent.class_id == cls.id,
                ClassStudent.seat_number == req.seat_number,
            )
            .first()
        )
        if not cs:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="找不到此座號"
            )

        student = db.get(Student, cs.student_id)
        if not student or not verify_password(req.password, student.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="帳號或密碼錯誤"
            )
        if not student.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="帳號已停用"
            )

        token = create_access_token(
            {"sub": str(student.id), "role": "student", "class_id": cls.id}
        )
        return AuthResponse(
            access_token=token,
            user=UserProfile(
                id=student.id,
                name=student.name,
                role="student",
                seat_number=req.seat_number,
                class_code=cls.class_code,
            ),
        )
