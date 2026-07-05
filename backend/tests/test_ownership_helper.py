"""Unit contract for get_owned_resource_or_403 (backend audit refactor 2026-07-02).

Locks the shared teacher-ownership guard extracted from the duplicated inline
checks in teacher_instructions.py. Pure logic — stubs the DB so it exercises the
guard branches without any database. The key invariant: it must behave EXACTLY
like the inline guards it replaced (404 missing / 403 not-owner / return owned),
with NO system_admin bypass.

Run:  cd backend && python -m pytest tests/test_ownership_helper.py -v
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.dependencies.tenant import get_owned_resource_or_403


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class _FakeDB:
    """Minimal stand-in: db.query(Model).filter(...).first() -> result."""

    def __init__(self, result):
        self._result = result

    def query(self, model):
        return _FakeQuery(self._result)


class _Row:
    def __init__(self, owner_id, other_field="teacher_id"):
        self.id = 1
        setattr(self, other_field, owner_id)


class _Model:  # dummy ORM marker; helper only uses it as db.query() arg
    id = None


def test_returns_row_when_caller_owns_it():
    row = _Row(owner_id=42)
    result = get_owned_resource_or_403(
        _FakeDB(row), _Model, 1, 42,
        not_found_detail="nope", forbidden_detail="mine",
    )
    assert result is row


def test_404_when_row_missing():
    with pytest.raises(HTTPException) as exc:
        get_owned_resource_or_403(
            _FakeDB(None), _Model, 999, 42,
            not_found_detail="Instruction not found",
            forbidden_detail="Not your instruction",
        )
    assert exc.value.status_code == 404
    assert exc.value.detail == "Instruction not found"


def test_403_when_caller_is_not_owner():
    row = _Row(owner_id=7)  # owned by teacher 7
    with pytest.raises(HTTPException) as exc:
        get_owned_resource_or_403(
            _FakeDB(row), _Model, 1, 42,  # caller is 42
            not_found_detail="Instruction not found",
            forbidden_detail="Not your instruction",
        )
    assert exc.value.status_code == 403
    assert exc.value.detail == "Not your instruction"


def test_custom_owner_attr_is_respected():
    row = _Row(owner_id=5, other_field="created_by_id")
    result = get_owned_resource_or_403(
        _FakeDB(row), _Model, 1, 5, owner_attr="created_by_id",
    )
    assert result is row


def test_no_admin_bypass_only_owner_id_matters():
    """The helper must NOT consult roles — a non-owner is 403 regardless of who
    they are (the extracted guards had no system_admin bypass)."""
    row = _Row(owner_id=7)
    with pytest.raises(HTTPException) as exc:
        get_owned_resource_or_403(_FakeDB(row), _Model, 1, 999)
    assert exc.value.status_code == 403
