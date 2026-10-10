"""BigQuery access for the Junyi class/student import feature (issue #3380).

Two real-query shapes, deliberately kept separate (see PRD
docs/design/teacher-panel-redesign/PRD-junyi-class-import.md SS3, SS8):

- ``list_class_summaries_for_teacher`` -- cheap (~722MB), no join, used by the
  GET /classes listing. Names are never shown in that view, so there is no
  reason to pay for the extra ~2GB UserData join there.
- ``list_class_and_student_rows_for_import`` -- the POST /import query. LEFT
  JOINs ``datastore_backup.UserData`` to resolve a real display name
  (nickname -> username -> None, final "junyi-student-N" fallback happens in
  the service layer because it needs a running counter) and the student's
  real email (used to link an existing un-linked LingoLeap account instead of
  creating a duplicate -- see junyi_class_import_service.py).

ID mapping (VERIFIED 2026-10-11 against 398 real SSO logins, both URL-shaped
and email-shaped junyi_identity_id all resolved 1:1 against
datastore_backup.UserData.user_id): ``teacher_user_id`` /
``student_user_id`` in dim_teacher_student_joins are always
``"user_id_key_" + UserData.user_id``. There is no shape-based special case
needed or implemented -- any junyi_identity_id is used the same way. Fail-
closed is kept only for the still-genuinely-unverifiable case: a row whose
id does not even carry the ``user_id_key_`` prefix (schema drift) is skipped,
never guessed at.

Two clients share the same interface:

- ``FakeJunyiBigQueryClient`` -- in-memory test double, injected via FastAPI
  dependency override in every test.
- ``RealJunyiBigQueryClient`` -- talks to real BigQuery. google.cloud.bigquery
  is lazy-imported inside each method body (repo convention, see
  audio_upload_service.py). Uses settings.junyi_bigquery_service_account via
  google.auth.impersonated_credentials when set.

A BigQuery query that itself fails (permission error, outage, quota, schema
drift) raises ``JunyiBigQueryError`` -- it must NEVER be degraded to an empty
result (PRD R7). A query that succeeds and returns zero rows is a legitimate
empty result and must not raise.
"""

from dataclasses import dataclass
from functools import lru_cache

import logging

logger = logging.getLogger(__name__)

JUNYI_USER_ID_KEY_PREFIX = "user_id_key_"

SYNTHETIC_STUDENT_EMAIL_DOMAIN = "@student.lingoleap.local"


def teacher_user_id_key(junyi_identity_id: str) -> str:
    return f"{JUNYI_USER_ID_KEY_PREFIX}{junyi_identity_id}"


def student_identity_id_from_user_id_key(student_user_id: str) -> str | None:
    if not student_user_id or not student_user_id.startswith(JUNYI_USER_ID_KEY_PREFIX):
        return None
    return student_user_id[len(JUNYI_USER_ID_KEY_PREFIX):]


class JunyiBigQueryError(Exception):
    """Raised when the real BigQuery query itself fails."""


@dataclass
class JunyiClassSummaryRow:
    junyi_class_id: str
    class_name: str
    class_code: str | None
    student_count: int


@dataclass
class JunyiClassStudentImportRow:
    junyi_class_id: str
    class_name: str
    class_code: str | None
    student_user_id: str
    display_name: str | None
    student_email: str | None


class FakeJunyiBigQueryClient:
    def __init__(self, rows: list[dict], raise_error: bool = False):
        self.rows = rows
        self.raise_error = raise_error

    def list_class_summaries_for_teacher(self, teacher_user_id_key: str) -> list[JunyiClassSummaryRow]:
        if self.raise_error:
            raise JunyiBigQueryError("simulated BigQuery outage")
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

    def list_class_and_student_rows_for_import(
        self, teacher_user_id_key: str
    ) -> list[JunyiClassStudentImportRow]:
        if self.raise_error:
            raise JunyiBigQueryError("simulated BigQuery outage")
        out: list[JunyiClassStudentImportRow] = []
        for row in self.rows:
            if row.get("teacher_user_id") != teacher_user_id_key:
                continue
            nickname = row.get("student_nickname") or None
            user_data_nickname = row.get("user_data_nickname") or None
            user_data_username = row.get("user_data_username") or None
            display_name = nickname or user_data_nickname or user_data_username or None
            out.append(
                JunyiClassStudentImportRow(
                    junyi_class_id=row.get("class_id"),
                    class_name=row.get("class_name"),
                    class_code=row.get("class_code"),
                    student_user_id=row.get("student_user_id"),
                    display_name=display_name,
                    student_email=row.get("user_data_email") or None,
                )
            )
        return out


_DEMO_ANY_TEACHER_KEY = "__demo_any_teacher__"


def _demo_junyi_rows() -> list[dict]:
    """Small fixed demo dataset for JUNYI_BQ_MODE=fake on staging (#3380)."""
    return [
        {"teacher_user_id": _DEMO_ANY_TEACHER_KEY, "class_id": "demo-class-1",
         "class_name": "四年一班（示範）", "class_code": "DEMO1",
         "student_user_id": "user_id_key_demo-student-a", "student_nickname": "小明",
         "user_data_email": "demo-a@example-junyi.invalid"},
        {"teacher_user_id": _DEMO_ANY_TEACHER_KEY, "class_id": "demo-class-1",
         "class_name": "四年一班（示範）", "class_code": "DEMO1",
         "student_user_id": "user_id_key_demo-student-b", "student_nickname": "",
         "user_data_username": "demo_student_b", "user_data_email": "demo-b@example-junyi.invalid"},
        {"teacher_user_id": _DEMO_ANY_TEACHER_KEY, "class_id": "demo-class-1",
         "class_name": "四年一班（示範）", "class_code": "DEMO1",
         "student_user_id": "user_id_key_demo-student-c", "student_nickname": "",
         "user_data_email": "demo-c@example-junyi.invalid"},
        {"teacher_user_id": _DEMO_ANY_TEACHER_KEY, "class_id": "demo-class-2",
         "class_name": "四年二班（示範）", "class_code": "DEMO2",
         "student_user_id": "user_id_key_demo-student-a", "student_nickname": "小明",
         "user_data_email": "demo-a@example-junyi.invalid"},
        {"teacher_user_id": _DEMO_ANY_TEACHER_KEY, "class_id": "demo-class-2",
         "class_name": "四年二班（示範）", "class_code": "DEMO2",
         "student_user_id": "user_id_key_demo-student-d", "student_nickname": "小華",
         "user_data_email": "demo-d@example-junyi.invalid"},
    ]


class DemoJunyiBigQueryClient(FakeJunyiBigQueryClient):
    """JUNYI_BQ_MODE=fake -- used on staging until Junyi grants real BigQuery
    access (PRD SS6). Ignores the caller's teacher_user_id_key so whichever
    teacher account Young uses on staging sees the same small demo dataset."""

    def __init__(self):
        super().__init__(rows=_demo_junyi_rows())

    def list_class_summaries_for_teacher(self, teacher_user_id_key: str) -> list[JunyiClassSummaryRow]:
        return super().list_class_summaries_for_teacher(_DEMO_ANY_TEACHER_KEY)

    def list_class_and_student_rows_for_import(
        self, teacher_user_id_key: str
    ) -> list[JunyiClassStudentImportRow]:
        return super().list_class_and_student_rows_for_import(_DEMO_ANY_TEACHER_KEY)


@lru_cache(maxsize=1)
def _impersonated_credentials():
    from ..config import settings

    if not settings.junyi_bigquery_service_account:
        return None

    import google.auth
    from google.auth import impersonated_credentials

    source_credentials, _ = google.auth.default()
    return impersonated_credentials.Credentials(
        source_credentials=source_credentials,
        target_principal=settings.junyi_bigquery_service_account,
        target_scopes=["https://www.googleapis.com/auth/bigquery.readonly"],
        lifetime=300,
    )


class RealJunyiBigQueryClient:
    _JOINS_TABLE = "junyiacademy.data_mart.dim_teacher_student_joins"
    _USER_DATA_TABLE = "junyiacademy.datastore_backup.UserData"
    _LIST_MAX_BYTES_BILLED = 2 * 1024 * 1024 * 1024
    _IMPORT_MAX_BYTES_BILLED = 4 * 1024 * 1024 * 1024

    def _build_client(self):
        from google.cloud import bigquery  # noqa: PLC0415

        creds = _impersonated_credentials()
        if creds is not None:
            return bigquery.Client(credentials=creds, project="lingoleap-dev")
        return bigquery.Client()

    def list_class_summaries_for_teacher(self, teacher_user_id_key: str) -> list[JunyiClassSummaryRow]:
        try:
            from google.cloud import bigquery  # noqa: PLC0415

            client = self._build_client()
            query = (
                "SELECT class_id, "
                "ANY_VALUE(class_name) AS class_name, "
                "ANY_VALUE(class_code) AS class_code, "
                "COUNT(*) AS student_count "
                f"FROM `{self._JOINS_TABLE}` "
                "WHERE teacher_user_id = @teacher_user_id_key "
                "GROUP BY class_id"
            )
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("teacher_user_id_key", "STRING", teacher_user_id_key),
                ],
                maximum_bytes_billed=self._LIST_MAX_BYTES_BILLED,
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
        except JunyiBigQueryError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Junyi BigQuery list_class_summaries_for_teacher failed")
            raise JunyiBigQueryError("Junyi BigQuery list query failed") from exc

    def list_class_and_student_rows_for_import(
        self, teacher_user_id_key: str
    ) -> list[JunyiClassStudentImportRow]:
        try:
            from google.cloud import bigquery  # noqa: PLC0415

            client = self._build_client()
            query = (
                "SELECT m.class_id, m.class_name, m.class_code, m.student_user_id, "
                "COALESCE(NULLIF(m.student_nickname, ''), "
                "NULLIF(COALESCE(u.user_nickname.string, "
                "SAFE_CONVERT_BYTES_TO_STRING(u.user_nickname.short_blob)), ''), "
                "NULLIF(u.username, '')) AS display_name, "
                "u.user_email AS student_email "
                f"FROM `{self._JOINS_TABLE}` m "
                f"LEFT JOIN `{self._USER_DATA_TABLE}` u "
                "ON u.user_id = REGEXP_REPLACE(m.student_user_id, r'^user_id_key_', '') "
                "WHERE m.teacher_user_id = @teacher_user_id_key"
            )
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("teacher_user_id_key", "STRING", teacher_user_id_key),
                ],
                maximum_bytes_billed=self._IMPORT_MAX_BYTES_BILLED,
            )
            rows = client.query(query, job_config=job_config).result()
            return [
                JunyiClassStudentImportRow(
                    junyi_class_id=row["class_id"],
                    class_name=row["class_name"],
                    class_code=row["class_code"],
                    student_user_id=row["student_user_id"],
                    display_name=row["display_name"],
                    student_email=row["student_email"],
                )
                for row in rows
            ]
        except JunyiBigQueryError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Junyi BigQuery list_class_and_student_rows_for_import failed")
            raise JunyiBigQueryError("Junyi BigQuery import query failed") from exc
