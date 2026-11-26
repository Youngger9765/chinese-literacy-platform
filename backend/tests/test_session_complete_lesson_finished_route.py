"""路由層：POST /gamification/session-complete 的 lesson_finished 真的從請求傳到服務。

服務層測試（test_session_complete_lesson_finished.py）只證明函式行為；這裡證明
HTTP 請求欄位有接線，欄位名稱拼錯或沒傳下去時會紅。
"""
from tests.test_session_complete_ownership import w  # noqa: F401
from sqlalchemy import text


def _status(db, sid):
    return db.execute(text("SELECT status FROM learning_sessions WHERE id=:i"), {"i": sid}).scalar_one()


def _post(w, sid, **extra):
    from app.auth.dependencies import get_current_user
    from app.database import get_db
    from app.main import app
    from app.models.user import User
    from fastapi import Depends
    from fastapi.testclient import TestClient

    uid = w["a"].id
    app.dependency_overrides[get_current_user] = lambda db=Depends(get_db): db.get(User, uid)
    return TestClient(app, raise_server_exceptions=False).post(
        "/api/gamification/session-complete",
        json={"student_id": uid, "session_id": sid, **extra},
    )


def _reset(w, status):
    from tests.test_session_complete_ownership import Session

    db = Session()
    db.execute(text("UPDATE learning_sessions SET status=:s, completed_at=NULL WHERE id=:i"),
               {"s": status, "i": w["sa"]})
    db.execute(text("DELETE FROM student_xp_log WHERE session_id=:i"), {"i": w["sa"]})
    db.commit()
    return db


def test_request_lesson_finished_false_keeps_in_progress(w):
    db = _reset(w, "in_progress")
    r = _post(w, w["sa"], reading_accuracy=90, lesson_finished=False)
    assert r.status_code == 200 and r.json()["xp_earned"] > 0
    db.expire_all()
    assert _status(db, w["sa"]) == "in_progress"
    db.close()


def test_request_lesson_finished_true_marks_completed(w):
    db = _reset(w, "in_progress")
    r = _post(w, w["sa"], reading_accuracy=90, lesson_finished=True)
    assert r.status_code == 200
    db.expire_all()
    assert _status(db, w["sa"]) == "completed"
    db.close()
