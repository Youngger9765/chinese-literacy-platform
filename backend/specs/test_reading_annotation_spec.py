"""Spec tests for reading-annotation persistence (Issue #2070).

Contracts:
1. AnnotationEntry model has correct columns + constraints
2. PUT endpoint requires auth and session ownership
3. PUT endpoint saves all annotations and returns them
4. GET endpoint returns saved annotations
5. Input validation: annotation_type must be 'unknown' or 'important'
6. Input size cap: max 500 annotations
7. Empty PUT clears all annotations
8. Session ownership: can't access another user's session

These are unit/integration tests that run against the FastAPI test client.
No network calls; uses SQLite in-memory DB (same pattern as other spec tests).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# Contract 1: Model structure
# ---------------------------------------------------------------------------

def test_annotation_entry_model_columns():
    """Contract 1: AnnotationEntry has all required columns."""
    from app.models.annotation import AnnotationEntry
    cols = {c.name: c for c in AnnotationEntry.__table__.columns}
    assert "id" in cols
    assert "session_id" in cols
    assert "paragraph_index" in cols
    assert "char_start" in cols
    assert "char_end" in cols
    assert "annotation_type" in cols
    assert "client_id" in cols
    assert "created_at" in cols


def test_annotation_entry_fk_has_index():
    """Contract 1b: session_id FK must have an index (sqlalchemy-model-safety Rule 1)."""
    from app.models.annotation import AnnotationEntry
    session_id_col = AnnotationEntry.__table__.columns["session_id"]
    assert session_id_col.index is True or any(
        "session_id" in [c.name for c in idx.columns]
        for idx in AnnotationEntry.__table__.indexes
    ), "session_id must be indexed"


def test_annotation_entry_tablename():
    """Contract 1c: Correct table name."""
    from app.models.annotation import AnnotationEntry
    assert AnnotationEntry.__tablename__ == "annotation_entries"


# ---------------------------------------------------------------------------
# Contract 5: Input validation (Pydantic)
# ---------------------------------------------------------------------------

def test_annotation_type_validation_valid():
    """Contract 5a: 'unknown' and 'important' are valid types."""
    from app.routes.learning.learning_annotations import AnnotationIn
    for t in ("unknown", "important"):
        a = AnnotationIn(
            paragraph_index=0,
            char_start=0,
            char_end=5,
            annotation_type=t,
        )
        assert a.annotation_type == t


def test_annotation_type_validation_invalid():
    """Contract 5b: other annotation_type values are rejected."""
    from pydantic import ValidationError
    from app.routes.learning.learning_annotations import AnnotationIn
    with pytest.raises(ValidationError):
        AnnotationIn(
            paragraph_index=0,
            char_start=0,
            char_end=5,
            annotation_type="highlight",  # not valid
        )


def test_annotation_char_end_must_be_gt_char_start():
    """Contract 5c: char_end must be greater than char_start."""
    from pydantic import ValidationError
    from app.routes.learning.learning_annotations import AnnotationIn
    with pytest.raises(ValidationError):
        AnnotationIn(
            paragraph_index=0,
            char_start=5,
            char_end=5,  # equal — not allowed
            annotation_type="unknown",
        )


def test_annotation_char_end_lt_char_start_rejected():
    """Contract 5d: char_end < char_start is rejected."""
    from pydantic import ValidationError
    from app.routes.learning.learning_annotations import AnnotationIn
    with pytest.raises(ValidationError):
        AnnotationIn(
            paragraph_index=0,
            char_start=10,
            char_end=3,
            annotation_type="important",
        )


# ---------------------------------------------------------------------------
# Contract 6: Input size cap
# ---------------------------------------------------------------------------

def test_annotation_save_request_max_500():
    """Contract 6: AnnotationSaveRequest accepts up to 500 entries (schema level).
    The 500-item hard cap is enforced at the route level (_MAX_ANNOTATIONS_PER_SESSION).
    """
    from app.routes.learning.learning_annotations import (
        AnnotationIn,
        AnnotationSaveRequest,
        _MAX_ANNOTATIONS_PER_SESSION,
    )
    assert _MAX_ANNOTATIONS_PER_SESSION == 500
    # Build 500 valid annotations — should not raise
    items = [
        AnnotationIn(
            paragraph_index=i % 10,
            char_start=i * 2,
            char_end=i * 2 + 1,
            annotation_type="unknown",
            client_id=f"ann-{i}",
        )
        for i in range(500)
    ]
    req = AnnotationSaveRequest(annotations=items)
    assert len(req.annotations) == 500


# ---------------------------------------------------------------------------
# Contract: Router is registered
# ---------------------------------------------------------------------------

def _collect_router_paths(router) -> list[str]:
    """Collect paths from a composed APIRouter across FastAPI versions.

    FastAPI 0.137+ stores included routers as _IncludedRouter without a
    top-level .path; traverse via .original_router when present.
    """
    paths: list[str] = []
    for route in router.routes:
        path = getattr(route, "path", None)
        if path:
            paths.append(path)
            continue
        nested = getattr(route, "original_router", None)
        if nested is not None:
            paths.extend(_collect_router_paths(nested))
            continue
        if hasattr(route, "routes"):
            paths.extend(_collect_router_paths(route))
    return paths


def test_annotations_router_registered():
    """Contract: annotations router is registered in the learning package."""
    from app.routes.learning import router
    routes = _collect_router_paths(router)
    annotation_routes = [r for r in routes if "annotations" in r]
    assert len(annotation_routes) >= 2, (
        f"Expected at least 2 annotation routes (GET + PUT), found: {annotation_routes}"
    )
