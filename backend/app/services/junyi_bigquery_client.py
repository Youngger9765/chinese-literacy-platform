"""BigQuery access for the Junyi class/student import feature (issue #3380).

Two clients share the same interface:

- ``FakeJunyiBigQueryClient`` — in-memory test double, injected via FastAPI
  dependency override in every test. It mirrors the real BQ ``WHERE`` clauses
  so the IDOR / fail-closed tests exercise the same filtering logic the real
  query enforces.
- ``RealJunyiBigQueryClient`` — talks to real BigQuery. Only ever instantiated
  in a real (non-test) process when ``settings.junyi_class_import_enabled`` is
  True. ``google.cloud.bigquery`` is lazy-imported inside each method body
  (repo convention, see ``audio_upload_service.py`` which lazy-imports
  ``google.cloud.storage``) so the import never happens at module-load time —
  the autouse network guard in ``tests/conftest.py`` would otherwise flag it.

ID mapping (UNVERIFIED, see #3380) is centralised in ``teacher_user_id_key`` /
``student_identity_id_from_user_id_key`` so the "fail closed" rule lives in one
place: a row whose ``student_user_id`` lacks the expected prefix maps to None
and is skipped by callers, never guessed at.
"""

from dataclasses import dataclass

import logging

logger = logging.getLogger(__name__)

JUNYI_USER_ID_KEY_PREFIX = "user_id_key_"


def teacher_user_id_key(junyi_identity_id: str) -> str:
    """Build the (unverified, see #3380) BigQuery teacher_user_id from our junyi_identity_id."""
    return f"{JUNYI_USER_ID_KEY_PREFIX}{junyi_identity_id}"


def student_identity_id_from_user_id_key(student_user_id: str) -> str | None:
    """Reverse mapping. Fail closed: None if the row doesn't match the expected shape."""
    if not student_user_id.startswith(JUNYI_USER_ID_KEY_PREFIX):
        return None
    return student_user_id[len(JUNYI_USER_ID_KEY_PREFIX):]


@dataclass
class JunyiClassSummaryRow:
    junyi_class_id: str
    class_name: str
    class_code: str | None
    student_count: int


@dataclass
class JunyiStudentRow:
    student_user_id: str
    student_nickname: str


class FakeJunyiBigQueryClient:
    """Test double. rows = list of dicts shaped like a dim_teacher_student_joins row:
    {"teacher_user_id": ..., "class_id": ..., "class_name": ..., "class_code": ...,
     "student_user_id": ..., "student_nickname": ...}
    """

    def __init__(self, rows: list[dict]):
        self.rows = rows

    def list_classes_for_teacher(self, teacher_user_id_key: str) -> list[JunyiClassSummaryRow]:
        # Group self.rows by class_id, scoped to this teacher — mirrors the real
        # `WHERE teacher_user_id = @teacher_user_id_key GROUP BY class_id`.
        summaries: dict[str, JunyiClassSummaryRow] = {}
        order: list[str] = []
        for row in self.rows:
            if row.get("teacher_user_id") != teacher_user_id_key:
                continue
            class_id = row.get("class_id")
            if class_id is None:
                continue
            existing = summaries.get(class_id)
            if existing is None:
                summaries[class_id] = JunyiClassSummaryRow(
                    junyi_class_id=class_id,
                    class_name=row.get("class_name"),
                    class_code=row.get("class_code"),
                    student_count=1,
                )
                order.append(class_id)
            else:
                existing.student_count += 1
        return [summaries[cid] for cid in order]

    def list_students_for_class(self, junyi_class_id: str, teacher_user_id_key: str) -> list[JunyiStudentRow]:
        # IMPORTANT: filter by BOTH class_id == junyi_class_id AND
        # teacher_user_id == teacher_user_id_key (mirrors the real BQ WHERE
        # clause — this is what makes the IDOR test in the test file pass even
        # if the service layer's allowlist check had a bug).
        students: list[JunyiStudentRow] = []
        for row in self.rows:
            if row.get("teacher_user_id") != teacher_user_id_key:
                continue
            if row.get("class_id") != junyi_class_id:
                continue
            students.append(
                JunyiStudentRow(
                    student_user_id=row.get("student_user_id"),
                    student_nickname=row.get("student_nickname"),
                )
            )
        return students


class RealJunyiBigQueryClient:
    """Talks to real BigQuery. Only ever instantiated when
    settings.junyi_class_import_enabled is True in a real (non-test) process —
    tests always override the `get_junyi_bq_client` FastAPI dependency with
    FakeJunyiBigQueryClient, so this class's methods are never exercised by
    the test suite and must lazy-import google.cloud.bigquery inside each
    method body (repo convention, see audio_upload_service.py).

    Real measured scan sizes from issue #3380: ~480MiB per teacher query,
    ~377MiB per class query (table has no clustering yet). Cap
    maximum_bytes_billed generously above that so a future schema change
    fails loudly/cheaply instead of silently billing more than expected.

    Fail-safe: during the unverified-infra period (#3380), any BigQuery error
    (missing permission, outage, schema drift, unreachable endpoint) is logged
    and degraded to an empty result rather than a 500 — a teacher sees "no
    classes to import yet" instead of a crash. This keeps the fail-closed
    promise (never guess, never fabricate) and never surfaces another
    teacher's data on error.
    """

    _TABLE = "junyiacademy.data_mart.dim_teacher_student_joins"
    _MAX_BYTES_BILLED = 2 * 1024 * 1024 * 1024  # 2 GiB

    def list_classes_for_teacher(self, teacher_user_id_key: str) -> list[JunyiClassSummaryRow]:
        try:
            from google.cloud import bigquery  # noqa: PLC0415 — optional dep, lazy per repo convention

            client = bigquery.Client()
            query = (
                "SELECT class_id, "
                "ANY_VALUE(class_name) AS class_name, "
                "ANY_VALUE(class_code) AS class_code, "
                "COUNT(*) AS student_count "
                f"FROM `{self._TABLE}` "
                "WHERE teacher_user_id = @teacher_user_id_key "
                "GROUP BY class_id"
            )
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("teacher_user_id_key", "STRING", teacher_user_id_key),
                ],
                maximum_bytes_billed=self._MAX_BYTES_BILLED,
            )
            rows = client.query(query, job_config=job_config).result()
            return [
                JunyiClassSummaryRow(
                    junyi_class_id=row["class_id"],
                    class_name=row["class_name"],
                    class_code=row["class_code"],
                    student_count=row["student_count"],
                )
                for row in rows
            ]
        except Exception:  # noqa: BLE001 — fail-safe to empty, see class docstring
            logger.exception("Junyi BigQuery list_classes_for_teacher failed; returning empty")
            return []

    def list_students_for_class(self, junyi_class_id: str, teacher_user_id_key: str) -> list[JunyiStudentRow]:
        try:
            from google.cloud import bigquery  # noqa: PLC0415 — optional dep, lazy per repo convention

            client = bigquery.Client()
            query = (
                "SELECT student_user_id, student_nickname "
                f"FROM `{self._TABLE}` "
                "WHERE class_id = @junyi_class_id "
                "AND teacher_user_id = @teacher_user_id_key"
            )
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("junyi_class_id", "STRING", junyi_class_id),
                    bigquery.ScalarQueryParameter("teacher_user_id_key", "STRING", teacher_user_id_key),
                ],
                maximum_bytes_billed=self._MAX_BYTES_BILLED,
            )
            rows = client.query(query, job_config=job_config).result()
            return [
                JunyiStudentRow(
                    student_user_id=row["student_user_id"],
                    student_nickname=row["student_nickname"],
                )
                for row in rows
            ]
        except Exception:  # noqa: BLE001 — fail-safe to empty, see class docstring
            logger.exception("Junyi BigQuery list_students_for_class failed; returning empty")
            return []
