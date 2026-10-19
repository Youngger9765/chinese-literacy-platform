from datetime import datetime

from pydantic import BaseModel, Field


class ClassroomCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    school_id: int
    grade: int | None = Field(None, ge=1, le=12)
    teacher_id: int | None = None  # Admin-only: create classroom for another teacher


class ClassroomUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    grade: int | None = Field(None, ge=1, le=12)
    is_active: bool | None = None


class ClassroomFeatureSettingsRequest(BaseModel):
    """PATCH /classrooms/{id}/pk-settings body — issue #3586 §7.4, extended
    by issue #3607 to cover 跨班賽季 (league) and 課堂搶答 (live_quiz) on
    the same endpoint (route path kept as `/pk-settings` for backward
    compat with existing callers; it now covers three toggles, not one).

    Every field is Optional and the route only writes the ones actually
    present in the request body (`exclude_unset`) — so a single switch's
    PATCH call (e.g. `{"league": true}`) never touches the other two keys,
    the same merge-not-overwrite guarantee `validate_feature_settings_patch`
    + the route's merge-into-existing-dict logic already gave `pk_human`
    alone. Three typed fields (not a free-form dict) so the public API
    stays OpenAPI-typed, even though the underlying storage
    (`classrooms.feature_settings`) is a schemaless JSON column for
    forward-compat — see app/services/pk/classroom_features.py. There is
    deliberately no `pk_ai` field: Young 2026-10-16 "AI PK 跟班級無關" —
    挑戰文學家 is never gated by classroom settings, so there is nothing
    here to toggle for it.
    """

    pk_human: bool | None = None
    league: bool | None = None
    live_quiz: bool | None = None
    team_arena: bool | None = None


# Backward-compat alias — issue #3586 named this ClassroomPkSettingsRequest
# when it only had one field; issue #3607 generalized it to three. Nothing
# in this codebase imports the old name anymore, but keeping the alias
# costs nothing and avoids an import break for any out-of-tree caller.
ClassroomPkSettingsRequest = ClassroomFeatureSettingsRequest


class ClassroomFeatureSettingsResponse(BaseModel):
    pk_human: bool
    league: bool
    live_quiz: bool
    team_arena: bool


ClassroomPkSettingsResponse = ClassroomFeatureSettingsResponse


class ClassroomStudentAddRequest(BaseModel):
    student_id: int


class ClassroomJoinRequest(BaseModel):
    join_code: str = Field(..., min_length=1, max_length=8)


class ClassroomJoinPreviewResponse(BaseModel):
    """Read-only lookup by join code (#3081) -- no enrollment side effect.

    Lets a student confirm *which* classroom a scanned QR points at before
    they commit to joining it. The join endpoint itself can't serve this: it
    enrolls on success, so calling it "just to peek" would join the wrong
    class you were trying to rule out.
    """

    id: int
    name: str

    model_config = {"from_attributes": True}


class StudentInClassroomResponse(BaseModel):
    id: int
    name: str
    email: str
    enrolled_at: datetime

    model_config = {"from_attributes": True}


class ClassroomResponse(BaseModel):
    id: int
    name: str
    school_id: int
    teacher_id: int
    grade: int | None
    join_code: str | None = None
    is_active: bool
    created_at: datetime
    student_count: int
    # Issue #3586 §7.4 — 真人 PK 班級開關，teacher-visible, default False.
    # Populated via services/pk/classroom_features.get_classroom_feature(),
    # never read directly off the raw `feature_settings` column (that's the
    # whole point of the typed accessor: a brand-new class with
    # feature_settings == {} must report False here, not omit the field).
    pk_human: bool = False
    # Issue #3607 — 跨班賽季／課堂搶答班級開關，same accessor, same
    # default-False-until-set rule. Unlike pk_human, an absent key here can
    # resolve to True via the accessor's legacy-usage backward-compat rule
    # (a classroom that was already using the feature before the toggle
    # existed) — see services/pk/classroom_features.py.
    league: bool = False
    live_quiz: bool = False
    # Issue #3632 — 五人對抗賽班級開關, same accessor, same default-False rule
    # as pk_human (brand new, no legacy-usage fallback).
    team_arena: bool = False

    model_config = {"from_attributes": True}


class ClassroomDetailResponse(ClassroomResponse):
    students: list[StudentInClassroomResponse]


class ClassroomListResponse(BaseModel):
    items: list[ClassroomResponse]
    total: int


# ── Batch Student Creation ──────────────────────────────────────────────────


class BatchStudentItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    seat_number: str = Field(..., min_length=1, max_length=10)


class BatchStudentCreateRequest(BaseModel):
    students: list[BatchStudentItem] = Field(..., min_length=1)


class CreatedStudentInfo(BaseModel):
    name: str
    seat_number: str
    username: str
    password: str
    user_id: int


class BatchStudentError(BaseModel):
    name: str
    seat_number: str
    error: str


class BatchStudentCreateResponse(BaseModel):
    created: list[CreatedStudentInfo]
    errors: list[BatchStudentError]
    warnings: list[str] = []


class ResetPasswordResponse(BaseModel):
    username: str
    email: str
    password: str


# ── Student Search ──────────────────────────────────────────────────────────


class StudentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=100)


class StudentSearchResult(BaseModel):
    id: int
    name: str
    email: str

    model_config = {"from_attributes": True}


# ── CSV Upload ───────────────────────────────────────────────────────────────


class CsvUploadResponse(BaseModel):
    created_count: int
    skipped_count: int
    errors: list[BatchStudentError]
    created: list[CreatedStudentInfo]
    warnings: list[str] = []


# ── Student Enrolled Classrooms ───────────────────────────────────────────────


class StudentEnrolledClassroom(BaseModel):
    """Classroom info from the student's perspective, including teacher name."""

    id: int
    name: str
    grade: int | None
    teacher_id: int
    teacher_name: str
    is_active: bool
    enrolled_at: datetime
    # Issue #3586 §7.4 — whether THIS classroom has 真人 PK turned on. The
    # frontend's "show 找同學 PK or not" decision is "ANY enrolled classroom
    # has pk_human=True" (StudentPkEntry.tsx), computed client-side over the
    # list this field appears in — not a separate aggregate endpoint.
    pk_human: bool = False
    # Issue #3607 — same per-classroom-then-ANY pattern as pk_human above,
    # for 跨班賽季 (league) and 課堂搶答 (live_quiz): the sidebar entries for
    # those two features are hidden unless ANY enrolled classroom has the
    # corresponding flag on (see components/layout/StudentSidebar.tsx).
    league: bool = False
    live_quiz: bool = False
    # Issue #3632 — same per-classroom-then-ANY pattern, for 五人對抗賽.
    team_arena: bool = False

    model_config = {"from_attributes": True}


class StudentEnrolledClassroomsResponse(BaseModel):
    classrooms: list[StudentEnrolledClassroom]
    total: int
    # Issue #3602 B1: the student's own profile grade
    # (``StudentProfile.grade``, None if the user has no profile row at
    # all), independent of any classroom. AI PK (挑戰文學家) must work
    # "regardless of class" (Young 2026-10-16) — a classroom with no grade
    # set (or no classroom at all) must not block it, so the frontend needs
    # a grade signal that doesn't depend on classroom data quality. See
    # frontend/src/pages/pk/resolvePkGrade.ts for the full fallback order.
    student_grade: int | None = None


# ── Junyi Class/Student Import (issue #3380) ──────────────────────────────────


class JunyiImportableClass(BaseModel):
    junyi_class_id: str
    class_name: str
    class_code: str | None
    student_count: int
    already_imported: bool


class JunyiImportClassesResponse(BaseModel):
    linked: bool
    classes: list[JunyiImportableClass]


class JunyiImportRequest(BaseModel):
    school_id: int
    junyi_class_ids: list[str] = Field(..., min_length=1, max_length=50)


class JunyiImportResponse(BaseModel):
    added_students: int
    skipped_existing_students: int
    classes_created: int
    classes_reused: int
