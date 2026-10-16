"""League Theme Studio is system_admin-only — every route in
admin_story_packs.py. The guard is router-level
(`dependencies=[require_role("system_admin")]`), so it is easy to believe
a specific sub-route only checks login. These tests run the real routes
with the lowest roles that can log in (teacher, student) and a positive
control (system_admin) — same pattern as
test_admin_story_structure_lab_authz.py.
"""
import os
import sys
import uuid

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
from app.models.user import Role, User, UserRole
from app.services.story_pack_defaults import MYTH_PACK_KEY, TANG_PACK_KEY
from app.services.story_pack_store import InMemoryStoryPackStore, get_story_pack_store

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def make_client():
    Base.metadata.create_all(bind=engine)
    db = Session()
    roles = {n: Role(name=n, display_name=n, scope_level="platform") for n in ("system_admin", "teacher", "student")}
    db.add_all(roles.values())
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    def build(role_name: str) -> TestClient:
        u = User(email=f"{uuid.uuid4().hex}@example.com", password_hash="x", name=role_name)
        db.add(u)
        db.commit()
        db.add(UserRole(user_id=u.id, role_id=roles[role_name].id, scope_type="platform", is_active=True))
        db.commit()
        db.refresh(u)
        app.dependency_overrides[get_db] = _get_db
        app.dependency_overrides[get_current_user] = lambda: u
        return TestClient(app)

    yield build
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _isolated_theme_store(monkeypatch):
    """The admin routes call `get_story_pack_store()` (process-wide singleton)
    — swap it for a fresh store per test so these tests can't bleed state
    into each other or into test_league_theme_service.py's assumptions."""
    import app.routes.admin_story_packs as routes_mod

    fresh = InMemoryStoryPackStore()
    monkeypatch.setattr(routes_mod, "get_story_pack_store", lambda *_args, **_kwargs: fresh)
    return fresh


GET_PATHS = [
    "/api/admin/story-packs",
    "/api/admin/story-packs/active",
    f"/api/admin/story-packs/{TANG_PACK_KEY}",
    "/api/admin/story-packs/seasons/1",
]


@pytest.mark.parametrize("role", ["teacher", "student"])
@pytest.mark.parametrize("path", GET_PATHS)
def test_non_admin_get_is_forbidden(make_client, role, path):
    assert make_client(role).get(path).status_code == 403


@pytest.mark.parametrize("role", ["teacher", "student"])
def test_non_admin_cannot_validate(make_client, role):
    r = make_client(role).post("/api/admin/story-packs/validate", json={"payload": {}})
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["teacher", "student"])
def test_non_admin_cannot_set_active(make_client, role):
    r = make_client(role).put("/api/admin/story-packs/active", json={"key": TANG_PACK_KEY})
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["teacher", "student"])
def test_non_admin_cannot_upsert(make_client, role):
    r = make_client(role).put(f"/api/admin/story-packs/some-theme", json={"payload": {}})
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["teacher", "student"])
def test_non_admin_cannot_delete(make_client, role):
    r = make_client(role).delete("/api/admin/story-packs/some-theme")
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["teacher", "student"])
def test_non_admin_cannot_assign_season_theme(make_client, role):
    r = make_client(role).put("/api/admin/story-packs/seasons/1", json={"key": TANG_PACK_KEY})
    assert r.status_code == 403


class TestSystemAdminPositiveControl:
    """These 403s above must come from the role check, not from a route
    that never resolves. system_admin gets past the guard."""

    def test_system_admin_can_list(self, make_client):
        r = make_client("system_admin").get("/api/admin/story-packs")
        assert r.status_code == 200
        keys = {t["key"] for t in r.json()}
        assert TANG_PACK_KEY in keys

    def test_system_admin_can_get_active_default(self, make_client):
        r = make_client("system_admin").get("/api/admin/story-packs/active")
        assert r.status_code == 200
        assert r.json()["key"] == MYTH_PACK_KEY  # default pack is 上古神話 (Young 2026-10-16)

    def test_system_admin_can_validate(self, make_client):
        r = make_client("system_admin").post("/api/admin/story-packs/validate", json={"payload": {}})
        assert r.status_code == 200
        assert r.json()["valid"] is False
        assert len(r.json()["errors"]) > 0

    def test_system_admin_can_upsert_then_fetch(self, make_client):
        client = make_client("system_admin")
        payload = {
            "era": "明",
            "title": "鄭和下西洋賽",
            "intro": ["船隊出航，兩班讀家一起補給遠航的糧草。"],
            "faction_labels": ["船隊東路", "船隊西路"],
            "energy_bar_label": "補給",
            "milestones": [{"ratio": 1.0, "message": "補給齊全，啟航"}],
            "chest": {"name": "寶船寶箱", "description": "全班過半參與即可開啟", "art": {"kind": "emoji", "value": "🚢"}},
            "badges": [
                {"key": "individual_badge", "name": "領航勳章", "description": "個人達標", "art": {"kind": "emoji", "value": "⭐"}},
                {"key": "class_badge", "name": "船隊勳章", "description": "班級達標", "art": {"kind": "emoji", "value": "🏅"}},
            ],
            "result_copy": {"win": "勝利", "lose": "再接再厲", "draw": "平手"},
        }
        r = client.put("/api/admin/story-packs/ming-voyage", json={"payload": payload})
        assert r.status_code == 200, r.text

        r2 = client.get("/api/admin/story-packs/ming-voyage")
        assert r2.status_code == 200
        assert r2.json()["title"] == "鄭和下西洋賽"

    def test_system_admin_cannot_overwrite_builtin(self, make_client):
        # A fully VALID payload — this must fail on the builtin-key
        # collision (409), not on schema validation (422), so the payload
        # has to actually pass StoryPack validation first.
        valid_payload = {
            "era": "明",
            "title": "鄭和下西洋賽",
            "intro": ["船隊出航，兩班讀家一起補給遠航的糧草。"],
            "faction_labels": ["船隊東路", "船隊西路"],
            "energy_bar_label": "補給",
            "milestones": [{"ratio": 1.0, "message": "補給齊全，啟航"}],
            "chest": {"name": "寶船寶箱", "description": "全班過半參與即可開啟", "art": {"kind": "emoji", "value": "🚢"}},
            "badges": [
                {"key": "individual_badge", "name": "領航勳章", "description": "個人達標", "art": {"kind": "emoji", "value": "⭐"}},
                {"key": "class_badge", "name": "船隊勳章", "description": "班級達標", "art": {"kind": "emoji", "value": "🏅"}},
            ],
            "result_copy": {"win": "勝利", "lose": "再接再厲", "draw": "平手"},
        }
        client = make_client("system_admin")
        r = client.put(f"/api/admin/story-packs/{TANG_PACK_KEY}", json={"payload": valid_payload})
        assert r.status_code == 409

    def test_system_admin_can_assign_and_read_season_theme(self, make_client):
        from app.services.story_pack_defaults import SONG_PACK_KEY

        client = make_client("system_admin")
        r = client.put("/api/admin/story-packs/seasons/123", json={"key": SONG_PACK_KEY})
        assert r.status_code == 200
        assert r.json()["pack"]["key"] == SONG_PACK_KEY

        r2 = client.get("/api/admin/story-packs/seasons/123")
        assert r2.status_code == 200
        assert r2.json()["effective_pack"]["key"] == SONG_PACK_KEY
