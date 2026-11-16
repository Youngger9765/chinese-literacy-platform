"""#3790 — seed_default_data() must not lose the demo accounts to a bad lesson grade.

The lesson catalogue stores `grade` as a STRING: "4".."9" for the graded
lessons, and a category name ("文言文", "品格教育") for the 27 ungraded ones.
`texts.grade` is an INTEGER column, so on Postgres the first category-named
lesson raised InvalidTextRepresentation, the whole seeding transaction rolled
back, and a fresh DB came up with zero users — no 王管理員／李老師／小明, so the
one-click demo login on /login had nothing behind it.

Two locks:
1. the YAML→texts sync never hands a non-integer grade to the INTEGER column
   (SQLite would silently store the string, so the assertion is on the value
   that reaches the row, not on an exception);
2. a failure inside that sync can no longer take the demo accounts with it.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.text import Text
from app.models.user import User
from app.services import seed as seed_module


def _lesson(ln, grade, grade_code):
    return {
        "lesson_number": ln,
        "title": f"課 {ln}",
        "paragraphs": ["一段。"],
        "char_count": 3,
        "grade": grade,
        "grade_code": grade_code,
    }


# Same shapes the real catalogue serves (strings, including category names).
FIXTURE_LESSONS = [
    _lesson(20011, "4", "G4-L1"),
    _lesson(20090, "9", "G9-L1"),
    _lesson(20156, "文言文", "文-L1"),
    _lesson(20167, "品格教育", "體-L1"),
]


@pytest.fixture()
def session_factory(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(seed_module, "SessionLocal", factory)
    monkeypatch.setenv("ENABLE_TEST_SEED", "true")
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    yield factory
    engine.dispose()


def _patch_catalogue(monkeypatch, lessons):
    import app.services.lesson_loader as loader

    monkeypatch.setattr(loader, "get_all_lessons", lambda: lessons)


def test_sync_only_writes_integer_grades(session_factory, monkeypatch):
    _patch_catalogue(monkeypatch, FIXTURE_LESSONS)
    db = session_factory()
    seed_module._sync_yaml_lessons_to_texts(db)

    rows = {t.lesson_number: t.grade for t in db.query(Text).all()}
    # Graded lessons land with an int grade.
    assert rows.get(20011) == 4 and isinstance(rows[20011], int)
    assert rows.get(20090) == 9 and isinstance(rows[20090], int)
    # Ungraded (category) lessons are not forced into the INTEGER column —
    # neither as the raw string nor as an invented year.
    assert 20156 not in rows
    assert 20167 not in rows
    assert all(isinstance(g, int) for g in rows.values()), rows


def test_demo_accounts_survive_a_failing_text_sync(session_factory, monkeypatch):
    def boom(db):
        raise RuntimeError("simulated texts sync failure")

    monkeypatch.setattr(seed_module, "_sync_yaml_lessons_to_texts", boom)
    seed_module.seed_default_data()

    db = session_factory()
    names = {u.name for u in db.query(User).all()}
    assert {"王管理員", "李老師", "小明"} <= names, names


def test_fresh_seed_with_category_grades_creates_demo_accounts(session_factory, monkeypatch):
    _patch_catalogue(monkeypatch, FIXTURE_LESSONS)
    seed_module.seed_default_data()

    db = session_factory()
    names = {u.name for u in db.query(User).all()}
    assert {"王管理員", "李老師", "小明"} <= names, names
    assert {t.lesson_number for t in db.query(Text).filter(Text.lesson_number.isnot(None))} == {20011, 20090}
