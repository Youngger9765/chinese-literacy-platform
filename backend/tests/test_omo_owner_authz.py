"""A student's worksheet photos (OMO uploads) belong to that student only.

Delete, photo links, crop links and the answer flag all go through
`_get_upload_or_404(upload_id, user)`, which filters on student_id. None of these
routes had a test where *another* student asks — and a delete that skipped the
owner filter would erase a classmate's work. Positive control: the owner succeeds.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.omo_upload import OmoUpload, OmoUploadAttempt
from app.models.user import User

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def world():
    Base.metadata.create_all(bind=engine)
    db = Session()
    owner = User(email="owner@example.com", name="owner", password_hash="x", is_active=True)
    other = User(email="other@example.com", name="other", password_hash="x", is_active=True)
    db.add_all([owner, other])
    db.flush()
    up = OmoUpload(student_id=owner.id, answers=[{"question_id": "fb_1", "crop_image_url": "gs://b/crops/1/fb_1.jpg"}])
    db.add(up)
    db.flush()
    att = OmoUploadAttempt(omo_upload_id=up.id, attempt_idx=0, image_paths=["o/1/0/0.jpg"])
    db.add(att)
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    client = TestClient(app)

    def call(user, method, path, **kw):
        app.dependency_overrides[get_current_user] = lambda: user
        return client.request(method, path, **kw)

    def still_there():
        s = Session()
        try:
            return s.query(OmoUpload).filter(OmoUpload.id == up.id).first() is not None
        finally:
            s.close()

    yield {"call": call, "owner": owner, "other": other, "up": up.id, "att": att.id, "still_there": still_there}
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


def _reads(w):
    return [
        ("GET", f"/api/omo/{w['up']}/images/{w['att']}/0"),
        ("GET", f"/api/omo/{w['up']}/crops/fb_1"),
    ]


def test_another_student_cannot_read_photos_or_crops(world):
    for method, path in _reads(world):
        assert world["call"](world["other"], method, path).status_code == 404, path


def test_owner_can_read_photos(world):
    method, path = _reads(world)[0]
    r = world["call"](world["owner"], method, path)
    assert r.status_code == 200 and r.json()["url"]


def test_another_student_cannot_delete_and_the_upload_survives(world):
    r = world["call"](world["other"], "DELETE", f"/api/omo/{world['up']}")
    assert r.status_code == 404
    assert world["still_there"]()


def test_owner_can_delete(world):
    r = world["call"](world["owner"], "DELETE", f"/api/omo/{world['up']}")
    assert r.status_code == 204
    assert not world["still_there"]()


def test_another_student_cannot_flag_an_answer(world):
    r = world["call"](world["other"], "PATCH", f"/api/omo/{world['up']}/answers/fb_1/flag", json={"flagged": True})
    assert r.status_code == 404
