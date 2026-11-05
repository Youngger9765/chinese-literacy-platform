"""TDD：StudentIndicatorEvidence model（#3780 第一階段）。

鎖住三件事：(1) 表存在、欄位齊全 (2) 文字寶貝 v1 的三張表已經從 ORM 消失
(3) alembic heads 只有一個（沒有分岔）。
"""
import subprocess
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base
from app.models.reading_baby import StudentIndicatorEvidence


def test_table_name_is_student_indicator_evidence():
    assert StudentIndicatorEvidence.__tablename__ == "student_indicator_evidence"


def test_all_prd_fields_exist_as_columns():
    columns = {c.name for c in StudentIndicatorEvidence.__table__.columns}
    expected = {
        "id", "student_id", "classroom_id", "session_id",
        "lesson_uid", "station", "indicator_code", "signal_type",
        "quality_passed", "quality_score",
        "items_total", "items_first_try_correct", "items_correct_after_hint",
        "cpm", "accuracy", "source_ref", "mapping_version", "created_at",
    }
    assert expected.issubset(columns), expected - columns


def test_every_foreign_key_column_is_indexed():
    table = StudentIndicatorEvidence.__table__
    fk_columns = {fk.parent.name for fk in table.foreign_keys}
    indexed_columns: set[str] = set()
    for idx in table.indexes:
        indexed_columns.update(c.name for c in idx.columns)
    for col in table.columns:
        if col.primary_key or col.unique:
            indexed_columns.add(col.name)
    missing = fk_columns - indexed_columns
    assert not missing, f"FK columns without an index: {missing}"


def test_word_baby_v1_models_are_gone():
    import importlib

    try:
        importlib.import_module("app.models.word_baby")
    except ModuleNotFoundError:
        pass
    else:
        raise AssertionError("app.models.word_baby should have been deleted (#3780 game-design §5.2)")


def test_can_create_and_query_in_sqlite():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine, tables=[StudentIndicatorEvidence.__table__])
    Session = sessionmaker(bind=engine)
    with Session() as db:
        # student_id FK target (users) isn't created here — sqlite FK enforcement
        # is off by default, so this purely exercises column read/write shape.
        row = StudentIndicatorEvidence(
            student_id=1,
            lesson_uid="L0001",
            station="spotlight",
            indicator_code="5-Ⅱ-5",
            signal_type="first_try_accuracy",
            quality_passed=True,
            quality_score=100.0,
            items_total=3,
            items_first_try_correct=3,
            mapping_version="draft-2026-10-31",
        )
        db.add(row)
        db.commit()
        fetched = db.query(StudentIndicatorEvidence).one()
        assert fetched.lesson_uid == "L0001"
        assert fetched.quality_passed is True


def test_alembic_heads_is_exactly_one():
    backend_dir = os.path.join(os.path.dirname(__file__), "..")
    result = subprocess.run(
        ["alembic", "heads"], cwd=backend_dir, capture_output=True, text=True, check=True
    )
    lines = [line for line in result.stdout.strip().splitlines() if line.strip()]
    assert len(lines) == 1, f"expected exactly one alembic head, got: {lines}"
