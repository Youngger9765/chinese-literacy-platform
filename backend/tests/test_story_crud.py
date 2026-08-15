"""
Tests for the Admin Story CRUD API.

Tests cover:
- GET /api/admin/stories (list with search/grade filter)
- GET /api/admin/stories/{lesson_number} (detail)
- POST /api/admin/stories (create)
- PUT /api/admin/stories/{lesson_number} (update)
- DELETE /api/admin/stories/{lesson_number} (soft-delete / archive)
- Validation: duplicate lesson_number, missing title, empty paragraphs
- Auth: endpoints require system_admin role

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-7/backend
    python -m pytest tests/test_story_crud.py -v
"""

import sys
import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models import Base
from app.database import get_db
from app.models.user import User, Role, UserRole
from app.auth.password import hash_password
from app.auth.jwt import create_access_token


# ── DB fixtures ──────────────────────────────────────────────────────────────

SQLALCHEMY_TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def db_engine():
    engine = create_engine(
        SQLALCHEMY_TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def db_session(db_engine):
    SessionLocal = sessionmaker(bind=db_engine)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(scope="module")
def admin_token(db_session):
    """Create a system_admin user and return a valid JWT token."""
    # Create role
    role = db_session.query(Role).filter_by(name="system_admin").first()
    if not role:
        role = Role(name="system_admin", display_name="System Admin", scope_level="global")
        db_session.add(role)
        db_session.flush()

    # Create user
    user = User(
        email="crud_admin@test.com",
        password_hash=hash_password("admin1234"),
        name="CRUD Admin",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    # Assign role
    ur = UserRole(user_id=user.id, role_id=role.id, scope_type="platform", is_active=True)
    db_session.add(ur)
    db_session.commit()

    token = create_access_token(user.id)
    return token


@pytest.fixture(scope="module")
def client(db_session):
    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── Isolated YAML directory per test session ──────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def isolated_lessons_dir():
    """Redirect the lesson_loader and admin_stories to a temp directory so
    tests don't touch real YAML files and don't interfere with the stories API."""
    import app.routes.admin_stories as admin_mod
    import app.services.lesson_loader as loader_mod
    import app.services.lesson_uid_loader as uid_mod

    real_lessons_dir = loader_mod._LESSONS_DIR
    real_uid_root = uid_mod.LESSONS_ROOT
    real_all_lessons = list(loader_mod._ALL_LESSONS)
    real_by_id = dict(loader_mod._LESSONS_BY_ID)
    real_grades = list(loader_mod._AVAILABLE_GRADES)

    tmp = Path(tempfile.mkdtemp())

    # Seed with real lessons. These are directories now, not flat `L{n}.yml` files —
    # the store is `data/lessons/<lesson_uid>/<version>/`, so a glob for "*.yml"
    # silently copied nothing and every baseline test read an empty corpus.
    if real_uid_root.exists():
        for d in sorted(real_uid_root.glob("L[0-9][0-9][0-9][0-9]"))[:3]:
            shutil.copytree(d, tmp / d.name)

    # Patch BOTH paths: the admin route writes through `_LESSONS_DIR` while reads go
    # through the uid loader's own root. Patching one and not the other let writes
    # land in the temp dir and reads come from the real tree.
    loader_mod._LESSONS_DIR = tmp
    admin_mod._LESSONS_DIR = tmp
    uid_mod.LESSONS_ROOT = tmp
    uid_mod.reset_cache()

    # Reload from temp dir
    loader_mod._ALL_LESSONS = loader_mod._load_lessons()
    loader_mod._LESSONS_BY_ID = {l["id"]: l for l in loader_mod._ALL_LESSONS}
    loader_mod._AVAILABLE_GRADES = sorted({l["grade"] for l in loader_mod._ALL_LESSONS})

    yield tmp

    # Restore
    loader_mod._LESSONS_DIR = real_lessons_dir
    admin_mod._LESSONS_DIR = real_lessons_dir
    uid_mod.LESSONS_ROOT = real_uid_root
    uid_mod.reset_cache()
    loader_mod._ALL_LESSONS = real_all_lessons
    loader_mod._LESSONS_BY_ID = real_by_id
    loader_mod._AVAILABLE_GRADES = real_grades
    shutil.rmtree(tmp, ignore_errors=True)


# ── Helpers ──────────────────────────────────────────────────────────────────

# ids in the tree are `20000 + n`, and lessons live in <uid>/<version>/ rather than
# a flat L{n}.yml — both changed with the second-edition re-ink (#2683).
SAMPLE_STORY = {
    "lesson_number": 9001,
    "title": "測試課文",
    "grade": 5,
    "grade_code": "G5-99",
    "genre": "記敘文",
    "text_type": "單",
    "reading_strategy": "測試閱讀策略",
    "paragraphs": ["第一段內容：大家好，這是測試課文。", "第二段內容：繼續閱讀吧。"],
    "vocabulary": [
        {"word": "測試", "definition": "用來驗證功能的行為"},
    ],
}


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Auth guard tests ──────────────────────────────────────────────────────────

class TestAuthGuard:
    def test_list_without_token_returns_401(self, client):
        resp = client.get("/api/admin/stories")
        assert resp.status_code == 401

    def test_create_without_token_returns_401(self, client):
        resp = client.post("/api/admin/stories", json=SAMPLE_STORY)
        assert resp.status_code == 401

    def test_update_without_token_returns_401(self, client):
        resp = client.put("/api/admin/stories/1", json={"title": "x"})
        assert resp.status_code == 401

    def test_delete_without_token_returns_401(self, client):
        resp = client.delete("/api/admin/stories/1")
        assert resp.status_code == 401


# ── GET /api/admin/stories ────────────────────────────────────────────────────

class TestListAdminStories:
    def test_returns_200(self, client, admin_token):
        resp = client.get("/api/admin/stories", headers=auth_headers(admin_token))
        assert resp.status_code == 200

    def test_response_has_stories_and_total(self, client, admin_token):
        resp = client.get("/api/admin/stories", headers=auth_headers(admin_token))
        data = resp.json()
        assert "stories" in data
        assert "total" in data

    def test_story_items_have_required_fields(self, client, admin_token):
        resp = client.get("/api/admin/stories", headers=auth_headers(admin_token))
        data = resp.json()
        if data["stories"]:
            item = data["stories"][0]
            for field in ["lesson_number", "title", "grade", "genre", "paragraph_count", "char_count"]:
                assert field in item, f"Admin list item missing field: {field}"

    def test_grade_filter_works(self, client, admin_token, isolated_lessons_dir):
        resp = client.get("/api/admin/stories?grade=5", headers=auth_headers(admin_token))
        data = resp.json()
        assert all(s["grade"] == 5 for s in data["stories"])

    def test_search_filter_works(self, client, admin_token):
        resp = client.get("/api/admin/stories?search=測試", headers=auth_headers(admin_token))
        data = resp.json()
        # After creating, will match; before creating this may be 0 — just check shape
        assert isinstance(data["stories"], list)

    def test_total_matches_stories_length(self, client, admin_token):
        resp = client.get("/api/admin/stories", headers=auth_headers(admin_token))
        data = resp.json()
        assert data["total"] == len(data["stories"])


# ── POST /api/admin/stories ───────────────────────────────────────────────────

class TestCreateStory:
    def test_create_returns_201(self, client, admin_token):
        resp = client.post(
            "/api/admin/stories",
            json=SAMPLE_STORY,
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 201

    def test_create_returns_admin_item(self, client, admin_token):
        story = {**SAMPLE_STORY, "lesson_number": 9002, "title": "第二測試課文"}
        resp = client.post(
            "/api/admin/stories",
            json=story,
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["lesson_number"] == 9002
        assert data["title"] == "第二測試課文"

    def test_create_yaml_file_exists(self, client, admin_token, isolated_lessons_dir):
        story = {**SAMPLE_STORY, "lesson_number": 9003, "title": "第三測試課文"}
        client.post(
            "/api/admin/stories",
            json=story,
            headers=auth_headers(admin_token),
        )
        yaml_path = isolated_lessons_dir / "L9003" / "v1" / "lesson.yml"
        assert yaml_path.exists()

    def test_create_yaml_content_correct(self, client, admin_token, isolated_lessons_dir):
        story = {**SAMPLE_STORY, "lesson_number": 9004, "title": "YAML內容驗證"}
        client.post(
            "/api/admin/stories",
            json=story,
            headers=auth_headers(admin_token),
        )
        yaml_path = isolated_lessons_dir / "L9004" / "v1" / "lesson.yml"
        with open(yaml_path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        assert doc["title"] == "YAML內容驗證"
        assert doc["grade"] == "5"   # the axis is a string (文言文 / 品格教育 are not years)
        assert len(doc["paragraphs"]) == 2

    def test_create_duplicate_lesson_number_returns_409(self, client, admin_token):
        # lesson 9001 was created in test_create_returns_201
        resp = client.post(
            "/api/admin/stories",
            json=SAMPLE_STORY,
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 409

    def test_create_without_title_returns_422(self, client, admin_token):
        bad = {**SAMPLE_STORY, "lesson_number": 9099, "title": ""}
        resp = client.post(
            "/api/admin/stories",
            json=bad,
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 422

    def test_create_with_empty_paragraphs_returns_422(self, client, admin_token):
        bad = {**SAMPLE_STORY, "lesson_number": 9099, "paragraphs": []}
        resp = client.post(
            "/api/admin/stories",
            json=bad,
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 422

    def test_create_updates_in_memory_cache(self, client, admin_token):
        story = {**SAMPLE_STORY, "lesson_number": 9005, "title": "快取更新測試"}
        client.post(
            "/api/admin/stories",
            json=story,
            headers=auth_headers(admin_token),
        )
        import app.services.lesson_loader as loader
        assert loader.get_lesson_by_id(29005) is not None

    def test_create_paragraph_count_computed(self, client, admin_token, isolated_lessons_dir):
        story = {**SAMPLE_STORY, "lesson_number": 9006, "title": "段落計算"}
        client.post(
            "/api/admin/stories",
            json=story,
            headers=auth_headers(admin_token),
        )
        yaml_path = isolated_lessons_dir / "L9006" / "v1" / "lesson.yml"
        with open(yaml_path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        assert doc["paragraph_count"] == 2


# ── GET /api/admin/stories/{lesson_number} ───────────────────────────────────

class TestGetAdminStory:
    def test_get_existing_story_returns_200(self, client, admin_token):
        resp = client.get("/api/admin/stories/9001", headers=auth_headers(admin_token))
        assert resp.status_code == 200

    def test_get_returns_full_detail(self, client, admin_token):
        resp = client.get("/api/admin/stories/9001", headers=auth_headers(admin_token))
        data = resp.json()
        assert data["lesson_number"] == 9001
        assert data["title"] == "測試課文"
        assert "paragraphs" in data
        assert len(data["paragraphs"]) == 2

    def test_get_nonexistent_returns_404(self, client, admin_token):
        resp = client.get("/api/admin/stories/99999", headers=auth_headers(admin_token))
        assert resp.status_code == 404


# ── PUT /api/admin/stories/{lesson_number} ───────────────────────────────────

class TestUpdateStory:
    def test_update_title_returns_200(self, client, admin_token):
        resp = client.put(
            "/api/admin/stories/9001",
            json={"title": "更新後的標題"},
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "更新後的標題"

    def test_update_persists_to_yaml(self, client, admin_token, isolated_lessons_dir):
        client.put(
            "/api/admin/stories/9001",
            json={"title": "YAML持久化測試"},
            headers=auth_headers(admin_token),
        )
        # The store is a tree now: <lesson_uid>/<version>/lesson.yml
        yaml_path = isolated_lessons_dir / "L9001" / "v1" / "lesson.yml"
        with open(yaml_path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        assert doc["title"] == "YAML持久化測試"

    def test_update_paragraphs_recalculates_char_count(self, client, admin_token, isolated_lessons_dir):
        new_paragraphs = ["新段落一二三四五六七八九十"]
        client.put(
            "/api/admin/stories/9001",
            json={"paragraphs": new_paragraphs},
            headers=auth_headers(admin_token),
        )
        # The store is a tree now: <lesson_uid>/<version>/lesson.yml
        yaml_path = isolated_lessons_dir / "L9001" / "v1" / "lesson.yml"
        with open(yaml_path, encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        assert doc["paragraph_count"] == 1
        assert doc["char_count"] > 0

    def test_update_partial_does_not_overwrite_other_fields(self, client, admin_token):
        # Fetch current grade
        get_resp = client.get("/api/admin/stories/9001", headers=auth_headers(admin_token))
        original_grade = get_resp.json()["grade"]

        client.put(
            "/api/admin/stories/9001",
            json={"reading_strategy": "新策略"},
            headers=auth_headers(admin_token),
        )

        get_resp2 = client.get("/api/admin/stories/9001", headers=auth_headers(admin_token))
        assert get_resp2.json()["grade"] == original_grade

    def test_update_nonexistent_returns_404(self, client, admin_token):
        resp = client.put(
            "/api/admin/stories/99999",
            json={"title": "不存在"},
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 404

    def test_update_updates_in_memory_cache(self, client, admin_token):
        client.put(
            "/api/admin/stories/9001",
            json={"title": "記憶體快取更新"},
            headers=auth_headers(admin_token),
        )
        import app.services.lesson_loader as loader
        cached = loader.get_lesson_by_id(29001)
        assert cached is not None
        assert cached["title"] == "記憶體快取更新"


# ── DELETE /api/admin/stories/{lesson_number} ─────────────────────────────────

class TestDeleteStory:
    def test_delete_existing_returns_204(self, client, admin_token):
        # Create a story to delete
        story = {**SAMPLE_STORY, "lesson_number": 9010, "title": "待刪除課文"}
        client.post("/api/admin/stories", json=story, headers=auth_headers(admin_token))

        resp = client.delete("/api/admin/stories/9010", headers=auth_headers(admin_token))
        assert resp.status_code == 204

    def test_delete_moves_to_archive(self, client, admin_token, isolated_lessons_dir):
        story = {**SAMPLE_STORY, "lesson_number": 9011, "title": "歸檔測試"}
        client.post("/api/admin/stories", json=story, headers=auth_headers(admin_token))
        client.delete("/api/admin/stories/9011", headers=auth_headers(admin_token))

        original_path = isolated_lessons_dir / "L9011" / "v1" / "lesson.yml"
        archive_path = isolated_lessons_dir / "archive" / "L9011"
        assert not original_path.exists(), "Original file should be gone"
        assert archive_path.exists(), "Archived file should exist"

    def test_delete_removes_from_in_memory_cache(self, client, admin_token):
        story = {**SAMPLE_STORY, "lesson_number": 9012, "title": "快取移除"}
        client.post("/api/admin/stories", json=story, headers=auth_headers(admin_token))
        client.delete("/api/admin/stories/9012", headers=auth_headers(admin_token))

        import app.services.lesson_loader as loader
        assert loader.get_lesson_by_id(29012) is None

    def test_delete_nonexistent_returns_404(self, client, admin_token):
        resp = client.delete("/api/admin/stories/99999", headers=auth_headers(admin_token))
        assert resp.status_code == 404

    def test_deleted_story_not_in_list(self, client, admin_token):
        story = {**SAMPLE_STORY, "lesson_number": 9013, "title": "列表移除測試"}
        client.post("/api/admin/stories", json=story, headers=auth_headers(admin_token))
        client.delete("/api/admin/stories/9013", headers=auth_headers(admin_token))

        resp = client.get("/api/admin/stories", headers=auth_headers(admin_token))
        lesson_numbers = [s["lesson_number"] for s in resp.json()["stories"]]
        assert 9013 not in lesson_numbers


# ── #2683 regression locks: the four defects the re-ink introduced here ──────

class TestUidTreeWriteInvariants:
    """Each of these was live at some point during the second-edition re-ink, and
    each failed *silently* — the API returned 2xx and the work went nowhere. That
    shape of failure is what this whole effort exists to remove, so it gets locked
    from the write side too."""

    def test_created_story_is_visible_without_a_restart(self, client, admin_token):
        """The uid loader memoises its directory scan with lru_cache. Rebuilding the
        lesson list without clearing it re-read the memoised answer, so a created
        story returned 201 and then could not be found until the process restarted."""
        payload = {**SAMPLE_STORY, "lesson_number": 9101, "title": "重載測試"}
        assert client.post("/api/admin/stories", json=payload,
                           headers=auth_headers(admin_token)).status_code == 201
        resp = client.get("/api/admin/stories/9101", headers=auth_headers(admin_token))
        assert resp.status_code == 200, "created story not visible in the same process"
        assert resp.json()["title"] == "重載測試"

    def test_created_story_keeps_the_fields_it_was_given(self, client, admin_token):
        """The tree builder hardcoded genre/paragraphs/char_count to empty defaults,
        so an admin could save a full record and get one back with its content blanked."""
        payload = {**SAMPLE_STORY, "lesson_number": 9102, "title": "欄位保留",
                   "genre": "說明文", "paragraphs": ["甲段。", "乙段。", "丙段。"]}
        client.post("/api/admin/stories", json=payload, headers=auth_headers(admin_token))
        item = client.get("/api/admin/stories/9102",
                          headers=auth_headers(admin_token)).json()
        assert item["genre"] == "說明文"
        assert len(item["paragraphs"]) == 3

    def test_archiving_two_stories_does_not_overwrite_the_first(
        self, client, admin_token, isolated_lessons_dir
    ):
        """Every lesson's file is now `<uid>/<version>/lesson.yml`, so archiving the
        FILE put them all at `archive/lesson.yml` — the second delete destroyed the
        first one's only copy."""
        for n, title in ((9103, "先刪的"), (9104, "後刪的")):
            client.post("/api/admin/stories", json={**SAMPLE_STORY,
                        "lesson_number": n, "title": title},
                        headers=auth_headers(admin_token))
            assert client.delete(f"/api/admin/stories/{n}",
                                 headers=auth_headers(admin_token)).status_code == 204
        archive = isolated_lessons_dir / "archive"
        assert (archive / "L9103").exists(), "first archived lesson was destroyed"
        assert (archive / "L9104").exists()

    def test_a_named_collection_does_not_break_the_admin_list(self, client, admin_token):
        """`grade` was `int Field(ge=4, le=9)`. 文言文 and 品格教育 are not years, so
        the admin list 500ed on the first one it reached — the whole page, not one row."""
        client.post("/api/admin/stories", json={**SAMPLE_STORY, "lesson_number": 9105,
                    "title": "文言文測試", "grade": "文言文", "grade_code": "文-L99"},
                    headers=auth_headers(admin_token))
        resp = client.get("/api/admin/stories", headers=auth_headers(admin_token))
        assert resp.status_code == 200, "a non-year grade took down the whole list"
        assert any(s["grade"] == "文言文" for s in resp.json()["stories"])

    def test_grade_filter_matches_string_grades(self, client, admin_token):
        """The filter was typed `int`, so comparing it against a string grade never
        matched: every year returned an empty list and the two collections could not
        be filtered at all."""
        client.post("/api/admin/stories", json={**SAMPLE_STORY, "lesson_number": 9106,
                    "title": "篩選測試", "grade": "7", "grade_code": "G7-L99"},
                    headers=auth_headers(admin_token))
        resp = client.get("/api/admin/stories?grade=7", headers=auth_headers(admin_token))
        assert resp.status_code == 200
        stories = resp.json()["stories"]
        assert stories, "grade filter returned nothing"
        assert all(s["grade"] == "7" for s in stories)

    def test_a_lesson_number_the_uid_format_cannot_hold_is_rejected(self, client, admin_token):
        """`f"L{n:04d}"` pads but does not truncate, so lesson_number 19999 became
        `L19999` — five digits, which `_is_uid_dir` rejects as not-a-uid. The file was
        written, 201 came back, and the lesson never appeared. The boundary must fail
        loudly instead of accepting something it cannot serve."""
        resp = client.post("/api/admin/stories",
                           json={**SAMPLE_STORY, "lesson_number": 19999, "title": "超出範圍"},
                           headers=auth_headers(admin_token))
        assert resp.status_code == 422, f"expected rejection, got {resp.status_code}"
        assert "L19999" in resp.text or "uid" in resp.text.lower()

    def test_the_largest_addressable_lesson_number_still_works(self, client, admin_token):
        """Positive control for the check above — without it, a guard that rejected
        everything would look identical to a guard that rejects the right things."""
        resp = client.post("/api/admin/stories",
                           json={**SAMPLE_STORY, "lesson_number": 9999, "title": "邊界內"},
                           headers=auth_headers(admin_token))
        assert resp.status_code == 201, resp.text
