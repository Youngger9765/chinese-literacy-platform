"""能力估計查詢（#4164）：學生看自己的閱讀等級與「準不準」提示。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.user import User
from ...services.ability.service import estimate_for_user

router = APIRouter()


@router.get("/learning/ability/me")
def get_my_ability(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return estimate_for_user(db, current_user.id, getattr(current_user.student_profile, "grade", None))
