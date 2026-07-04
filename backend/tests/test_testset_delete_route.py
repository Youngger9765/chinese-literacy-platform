"""DELETE /api/testset/recordings — 刪除單筆錄音（#2465）。

錄音明細表每列可刪；貢獻者非獨立實體 → 刪掉一筆錄音該筆貢獻者屬性隨之消失，
若該貢獻者尚有其他錄音則其貢獻自然保留（各自獨立 blob，本 route 只碰目標 stem）。

鎖定：
  - no auth             -> 401
  - logged-in non-admin -> 403
  - system_admin / org_admin -> 200 + 刪 .webm/.json/.eval.json
  - .eval.json 不存在   -> 只刪存在的兩個，仍 200
  - 目標音檔不存在      -> 404
  - 非法路徑（traversal / 跨 prefix / 非 .webm） -> 400
  - 只刪目標 stem，不動其他貢獻者的 blob

Run: cd backend && python -m pytest tests/test_testset_delete_route.py -v
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.auth.dependencies import get_current_user

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)


@event.listens_for(engine, "connect")
def _pragma(conn, _):
    cur = conn.cursor(); cur.execute("PRAGMA foreign_keys=ON"); cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _fresh_user(uid: int, uname: str) -> User:
    return User(id=uid, username=uname, name=uname, email=f"{uname}@x.com", password_hash="x")


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    for rd in [
        {"name": "student", "display_name": "Student", "scope_level": "school"},
        {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
        {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    ]:
        if not db.query(Role).filter(Role.name == rd["name"]).first():
            db.add(Role(**rd))
    db.commit()
    db.add_all([_fresh_user(1, "admin_u"), _fresh_user(2, "pleb_u"), _fresh_user(3, "orgadmin_u")])
    db.commit()
    sa = db.query(Role).filter(Role.name == "system_admin").first()
    st = db.query(Role).filter(Role.name == "student").first()
    oa = db.query(Role).filter(Role.name == "org_admin").first()
    db.add(UserRole(user_id=1, role_id=sa.id, scope_type="platform", scope_id=None))
    db.add(UserRole(user_id=2, role_id=st.id, scope_type="school", scope_id="1"))
    db.add(UserRole(user_id=3, role_id=oa.id, scope_type="organization", scope_id="1"))
    db.commit()
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _wire_db():
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.clear()


class _FakeBucket:
    """記憶體模擬 GCS bucket：記存在的 blob 路徑，記錄 delete 呼叫。"""

    def __init__(self, existing: set[str]):
        self.existing = set(existing)
        self.deleted: list[str] = []

    def blob(self, name: str):
        parent = self

        class _Blob:
            def exists(self):
                return name in parent.existing

            def delete(self):
                parent.existing.discard(name)
                parent.deleted.append(name)

        return _Blob()


VALID = "test-dataset/wang/lesson1/correct-abc12345.webm"
STEM = "test-dataset/wang/lesson1/correct-abc12345"


def _as_admin(uid=1, uname="admin_u"):
    app.dependency_overrides[get_current_user] = lambda: _fresh_user(uid, uname)


def _clear_user():
    app.dependency_overrides.pop(get_current_user, None)


def test_no_auth_returns_401():
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
    assert r.status_code == 401, r.text


def test_non_admin_returns_403():
    _as_admin(2, "pleb_u")
    try:
        with TestClient(app, raise_server_exceptions=False) as c:
            r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 403, r.text
    finally:
        _clear_user()


def test_admin_deletes_all_three_blobs():
    _as_admin()
    bucket = _FakeBucket({VALID, STEM + ".json", STEM + ".eval.json"})
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 200, r.text
        assert set(r.json()["deleted"]) == {VALID, STEM + ".json", STEM + ".eval.json"}
        assert bucket.existing == set()
    finally:
        _clear_user()


def test_org_admin_allowed():
    _as_admin(3, "orgadmin_u")
    bucket = _FakeBucket({VALID, STEM + ".json"})
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 200, r.text
    finally:
        _clear_user()


def test_missing_eval_json_still_ok():
    """.eval.json 未跑分 → 不存在，只刪 .webm + .json，仍 200。"""
    _as_admin()
    bucket = _FakeBucket({VALID, STEM + ".json"})
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 200, r.text
        assert set(r.json()["deleted"]) == {VALID, STEM + ".json"}
    finally:
        _clear_user()


def test_audio_not_found_returns_404():
    _as_admin()
    bucket = _FakeBucket(set())  # 目標音檔不存在
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 404, r.text
    finally:
        _clear_user()


@pytest.mark.parametrize(
    "bad",
    [
        "test-dataset/wang/lesson1/correct-abc12345.json",   # 非 .webm
        "../../etc/passwd",                                   # traversal
        "test-dataset/../secret/x.webm",                      # traversal 進 prefix 後跳出
        "other-prefix/x.webm",                                # 跨 prefix
        "/absolute/x.webm",                                   # 絕對路徑
    ],
)
def test_invalid_path_returns_400(bad):
    _as_admin()
    bucket = _FakeBucket({VALID})
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete("/api/testset/recordings", params={"audio_path": bad})
        assert r.status_code == 400, r.text
    finally:
        _clear_user()


def test_only_target_stem_deleted_other_contributor_untouched():
    """刪某貢獻者一筆錄音，不動另一貢獻者的 blob（貢獻者資訊隨各自錄音保留）。"""
    _as_admin()
    other = "test-dataset/lee/lesson1/correct-zzz99999.webm"
    other_json = "test-dataset/lee/lesson1/correct-zzz99999.json"
    bucket = _FakeBucket({VALID, STEM + ".json", other, other_json})
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 200, r.text
        assert bucket.existing == {other, other_json}  # 另一貢獻者完整保留
    finally:
        _clear_user()


class _RaiseOnDeleteBucket(_FakeBucket):
    """指定某個 blob 的 delete() 拋錯，模擬刪除中途 storage 失敗。"""

    def __init__(self, existing: set[str], raise_on: str):
        super().__init__(existing)
        self.raise_on = raise_on

    def blob(self, name: str):
        parent = self

        class _Blob:
            def exists(self):
                return name in parent.existing

            def delete(self):
                if name == parent.raise_on:
                    raise RuntimeError("simulated GCS delete failure")
                parent.existing.discard(name)
                parent.deleted.append(name)

        return _Blob()


def test_sidecar_delete_failure_keeps_webm_and_returns_503():
    """中途失敗（.json delete 拋錯）→ 503，且 .webm 未被刪（#2466 P0）。

    刪除順序刻意為 sidecar 先、.webm 最後：sidecar 刪一半失敗時，不可取代的音檔仍在，
    列表狀態一致、可重試清除；不會留下指向已刪音檔、又刪不掉的 ghost .json。
    """
    _as_admin()
    bucket = _RaiseOnDeleteBucket(
        {VALID, STEM + ".json", STEM + ".eval.json"}, raise_on=STEM + ".json"
    )
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 503, r.text
        assert VALID in bucket.existing  # .webm 仍在（未被刪）→ 可重試，不變 ghost
    finally:
        _clear_user()


def test_storage_unavailable_returns_503():
    """_get_gcs_bucket 回 None（storage 不可用）→ fail-closed 503。"""
    _as_admin()
    try:
        with patch("app.routes.testset._get_gcs_bucket", return_value=None):
            with TestClient(app, raise_server_exceptions=False) as c:
                r = c.delete(f"/api/testset/recordings?audio_path={VALID}")
        assert r.status_code == 503, r.text
    finally:
        _clear_user()
