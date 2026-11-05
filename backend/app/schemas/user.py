from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class UserRoleResponse(BaseModel):
    role_name: str
    role_display_name: str
    scope_type: str
    scope_id: str | None = None

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    phone: str | None = None
    avatar_url: str | None = None
    is_active: bool
    email_verified: bool
    onboarding_completed: bool = False
    last_login_at: datetime | None = None
    terms_accepted_at: datetime | None = None
    terms_version: str | None = None
    terms_accepted: bool = False
    created_at: datetime
    roles: list[UserRoleResponse] = []
    # Issue #457: classroom membership flag.
    # True for non-students and for students enrolled in at least one classroom.
    # False only for students with no classroom enrollment.
    has_classroom: bool = True
    # Issue #457: whether the teacher-gating feature is active (reads ENFORCE_TEACHER_GATING).
    # Frontend uses this to decide whether to redirect to the waiting screen.
    teacher_gating_enforced: bool = False
    # Issue #3438: server-computed, live on every GET /users/me call -- the
    # authoritative source AuthContext derives mustChangePassword from.
    must_change_password: bool = False

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def compute_terms_accepted(self) -> "UserResponse":
        self.terms_accepted = self.terms_accepted_at is not None
        return self


class ActivateTeacherSchoolInput(BaseModel):
    """One school selection in an activate-teacher request (#3812).

    Exactly one of the two must be set:
    - moe_school_code: the caller picked a result from the directory search
      (GET /api/schools/directory/search) — binds directly to that School
      row by its unique MOE code, no name matching at all. This is the
      primary path once the directory exists: name matching is how a single
      typo splits one real school into two rows.
    - name: the "找不到我的學校" manual fallback, for a school genuinely not
      in the MOE directory. Same match-by-exact-name-or-create behavior as
      before #3812, except a newly-created school from this path is flagged
      pending_review (see activate_teacher_for_schools) since it was never
      cross-checked against the official directory.
    """

    moe_school_code: str | None = Field(None, min_length=1, max_length=20)
    name: str | None = Field(None, max_length=200)

    @model_validator(mode="after")
    def _exactly_one_of_code_or_name(self) -> "ActivateTeacherSchoolInput":
        has_code = bool(self.moe_school_code and self.moe_school_code.strip())
        has_name = bool(self.name and self.name.strip())
        if has_code == has_name:  # both set, or neither set
            raise ValueError("每個學校欄位需要恰好提供 moe_school_code 或 name 其中一個")
        if self.name:
            self.name = self.name.strip()
        if self.moe_school_code:
            self.moe_school_code = self.moe_school_code.strip()
        return self


class ActivateTeacherRequest(BaseModel):
    """#3804 self-serve "activate teacher" — the user names (or picks from
    the directory) their own school(s).

    No approval. See PRD docs/prd/2026-11-01-school-as-teacher-attribute-prd.md
    §10/§11 (original design) and §4.4 (directory-code binding, #3812).

    `school_names` (#3804's original flat string list) is kept, NOT removed,
    for backward compatibility (#3812 CI finding 2026-11-02): a rolling
    deploy can briefly have an old frontend still sending it against a new
    backend, and several existing regression locks (tests/security/
    test_dynamic_security.py's IDOR tests, the Playwright game-feature E2E
    helpers) call this endpoint directly with that shape and are themselves
    the compatibility guarantee, not something to migrate. Both fields may
    be sent in the same request; the route combines them before calling
    activate_teacher_for_schools. At least one of the two must contain an
    entry.
    """

    schools: list[ActivateTeacherSchoolInput] = Field(default_factory=list, max_length=10)
    school_names: list[str] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def _at_least_one_school_total(self) -> "ActivateTeacherRequest":
        cleaned = [name.strip() for name in self.school_names]
        if any(not name for name in cleaned):
            raise ValueError("學校名稱不可空白")
        self.school_names = cleaned

        total = len(self.schools) + len(self.school_names)
        if total == 0:
            raise ValueError("至少需要一所學校")
        if total > 10:
            raise ValueError("一次最多開通 10 所學校")
        return self


class SchoolActivationBrief(BaseModel):
    id: int
    name: str
    is_new: bool
    # Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91 (high), 2026-11-05:
    # True exactly when is_new is True (a school this call just created)
    # -- a teacher role at a PRE-EXISTING school is granted inactive and
    # needs a system_admin to confirm it before it does anything. Surfaced
    # explicitly (not left for the frontend to infer from is_new) so a
    # future change to the activation policy can't silently desync the
    # two without this field visibly lying.
    role_active: bool

    model_config = {"from_attributes": True}


class ActivateTeacherResponse(BaseModel):
    schools: list[SchoolActivationBrief]
    roles: list[UserRoleResponse]


class StudentProfileResponse(BaseModel):
    school_id: int
    student_number: str | None = None
    grade: int | None = None
    password_changed: bool

    model_config = {"from_attributes": True}
