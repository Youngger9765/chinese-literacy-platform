from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from jose import JWTError

from ..database import get_db
from ..models.school import Teacher, ClassStudent, Class
from ..models.student import Student
from ..schemas.auth import UserProfile
from ..services.auth_service import decode_token

router = APIRouter(tags=["users"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)
):
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="未提供認證 Token"
        )
    try:
        payload = decode_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token 無效或已過期"
        )

    role = payload.get("role")
    user_id = int(payload.get("sub"))

    if role == "teacher":
        user = db.get(Teacher, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="用戶不存在"
            )
        return UserProfile(
            id=user.id, name=user.name, role="teacher", email=user.email
        )
    else:
        user = db.get(Student, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="用戶不存在"
            )
        # Get class info for student
        cs = db.query(ClassStudent).filter(ClassStudent.student_id == user.id).first()
        class_code = None
        seat_number = None
        if cs:
            cls = db.get(Class, cs.class_id)
            class_code = cls.class_code if cls else None
            seat_number = cs.seat_number
        return UserProfile(
            id=user.id,
            name=user.name,
            role="student",
            seat_number=seat_number,
            class_code=class_code,
        )


@router.get("/users/me", response_model=UserProfile)
def me(user: UserProfile = Depends(get_current_user)):
    return user
