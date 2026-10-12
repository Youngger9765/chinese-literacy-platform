"""Read-only contract checks for the real Junyi BigQuery client.

Run with:
    cd backend && JUNYI_BQ_REAL_CONTRACT=1 python -m pytest tests/test_junyi_bigquery_real_contract.py -v

Requires gcloud ADC for an account allowed to impersonate lingoleap-junyi-bq.
These checks cover credentials, query execution, teacher filtering, and row mapping.
"""

import os

import pytest


if os.getenv("JUNYI_BQ_REAL_CONTRACT") != "1":
    pytest.skip(
        "Set JUNYI_BQ_REAL_CONTRACT=1 to run the real Junyi BigQuery contract tests",
        allow_module_level=True,
    )

from app.services.junyi_bigquery_client import (  # noqa: E402
    JunyiClassStudentImportRow,
    JunyiClassSummaryRow,
    RealJunyiBigQueryClient,
    student_identity_id_from_user_id_key,
    teacher_user_id_key,
)


@pytest.fixture(scope="module")
def client():
    return RealJunyiBigQueryClient()


@pytest.fixture(scope="module")
def teacher_key():
    identity_id = os.getenv(
        "JUNYI_BQ_CONTRACT_TEACHER_ID",
        "http://googleid.junyiacademy.org/107407156051367422051",
    )
    return teacher_user_id_key(identity_id)


@pytest.fixture(scope="module")
def class_summaries(client, teacher_key):
    return client.list_class_summaries_for_teacher(teacher_key)


@pytest.fixture(scope="module")
def smallest_class(class_summaries):
    assert class_summaries, "The contract teacher must have at least one class"
    non_empty = [row for row in class_summaries if row.student_count > 0]
    assert non_empty, "The contract teacher must have at least one class with students"
    return min(non_empty, key=lambda row: (row.student_count, row.junyi_class_id))


@pytest.fixture(scope="module")
def unknown_teacher_key():
    return teacher_user_id_key("http://googleid.junyiacademy.org/000000000000000000000")


@pytest.mark.allow_network
def test_real_list_returns_teachers_classes(class_summaries):
    assert class_summaries
    for row in class_summaries:
        assert isinstance(row, JunyiClassSummaryRow)
        assert row.junyi_class_id
        assert row.class_name
        assert row.student_count >= 0


@pytest.mark.allow_network
def test_real_list_unknown_teacher_returns_empty_not_error(client, unknown_teacher_key):
    assert client.list_class_summaries_for_teacher(unknown_teacher_key) == []


@pytest.mark.allow_network
def test_real_import_rows_match_listing(client, teacher_key, smallest_class):
    rows = client.list_class_and_student_rows_for_import(teacher_key)
    class_rows = [row for row in rows if row.junyi_class_id == smallest_class.junyi_class_id]

    assert class_rows
    assert all(isinstance(row, JunyiClassStudentImportRow) for row in class_rows)
    assert len({row.student_user_id for row in class_rows}) == smallest_class.student_count
    assert all(
        student_identity_id_from_user_id_key(row.student_user_id) is not None
        for row in class_rows
    )


@pytest.mark.allow_network
def test_real_import_rejects_other_teachers_class(client, unknown_teacher_key, smallest_class):
    rows = client.list_class_and_student_rows_for_import(unknown_teacher_key)
    assert not [row for row in rows if row.junyi_class_id == smallest_class.junyi_class_id]


@pytest.mark.allow_network
def test_real_listed_count_equals_importable_students(client, teacher_key, class_summaries):
    """Every class's listed count must equal the students an import would create
    (empty Junyi classes have a NULL-student join row and once showed as 1)."""
    rows = client.list_class_and_student_rows_for_import(teacher_key)
    for summary in class_summaries:
        importable = {
            row.student_user_id
            for row in rows
            if row.junyi_class_id == summary.junyi_class_id
            and student_identity_id_from_user_id_key(row.student_user_id) is not None
        }
        assert summary.student_count == len(importable), summary.junyi_class_id
