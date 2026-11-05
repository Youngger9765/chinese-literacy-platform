"""
auth_registration_service.py — Registration flow for #1844, revised for #3804.

Extracted from routes/auth.py. Handles:
- Password strength enforcement
- User creation with email verification token
- Default-student role grant on registration/SSO (#3804)
- Self-serve "activate teacher" role grant by explicit school name (#3804)

#3804 (Young 2026-11-01): registration no longer branches on role="teacher".
Every new account defaults to `student`. Anyone can self-activate as a
teacher afterwards by naming the school(s) they teach at — no more guessing
a school from the registrant's email domain.

The router in routes/auth.py calls these functions and handles
HTTP request/response details.
"""

import logging
import secrets

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.password import hash_password
from ..config import settings
from ..models.user import User, UserRole, Role
from ..models.school import School
from ..schemas.user import ActivateTeacherSchoolInput
from ..services.input_sanitizer import sanitize_ai_input
from ..utils.password_validator import validate_password_strength

logger = logging.getLogger(__name__)

EMAIL_VERIFICATION_TOKEN_BYTES = 32


def enforce_password_strength(password: str) -> None:
    """Raise HTTP 422 with a Chinese error message if password is too weak."""
    result = validate_password_strength(password)
    if not result.is_valid:
        raise HTTPException(
            status_code=422,
            detail={"errors": result.errors},
        )


def grant_default_student_role(db: Session, user: User) -> None:
    """Grant a platform-scoped `student` role to a freshly created account.

    (#3804) Every account — email/password register, Google SSO, Junyi SSO —
    defaults to student. `scope_type="platform"` (scope_id=None) because at
    this point the user has not joined any classroom/school yet; joining a
    classroom later adds a school-scoped student role on top of this one
    (see classrooms/helpers.py::ensure_school_student_role), the same way a
    platform-scoped role and a school-scoped role for the same role name can
    coexist without conflict (scope_type differs).

    Idempotent: safe to call even if the role is already granted.
    """
    student_role = db.query(Role).filter(Role.name == "student").first()
    if student_role is None:
        logger.warning("grant_default_student_role: no 'student' role seeded, skipping")
        return

    existing = (
        db.query(UserRole)
        .filter(
            UserRole.user_id == user.id,
            UserRole.role_id == student_role.id,
            UserRole.scope_type == "platform",
            UserRole.is_active == True,  # noqa: E712
        )
        .first()
    )
    if existing is not None:
        return

    db.add(
        UserRole(
            user_id=user.id,
            role_id=student_role.id,
            scope_type="platform",
            scope_id=None,
        )
    )


def _resolve_school_by_moe_code(db: Session, moe_school_code: str) -> tuple[School, bool]:
    """#3812: bind directly to a directory row by its unique MOE code.

    No name comparison at all — this is the whole point. The frontend only
    ever sends a code the user picked from a real
    GET /api/schools/directory/search result, so an unknown code means the
    client sent something it shouldn't have (stale cache, tampered request);
    fail loudly (404) instead of silently creating a new school under that
    code, which would corrupt the directory's uniqueness guarantee.
    """
    school = db.query(School).filter(School.moe_school_code == moe_school_code).first()
    if school is None:
        raise HTTPException(status_code=404, detail=f"找不到代碼為「{moe_school_code}」的學校")
    return school, False  # a directory row is never "new" — it was imported, not created here


def _resolve_school_by_manual_name(db: Session, user: User, raw_name: str) -> tuple[School, bool]:
    """Manual "找不到我的學校" fallback (#3812) — same match-by-exact-name-
    or-create behavior that activate_teacher_for_schools always used before
    the directory existed. A newly-created school here is flagged
    `pending_review` (PRD §4.4): it was typed by one self-activating user
    and never cross-checked against the official MOE directory, so it must
    not be indistinguishable from a real imported school until someone
    reconciles it (out of scope this round, same as PRD §4.2 "Young 的問題
    2 答覆" — matching an EXISTING row, whether directory-origin or an older
    self-activated one, must NOT retroactively flag it; only a genuinely
    brand-new row gets the marker)."""
    name = raw_name.strip()
    safe_name, _ = sanitize_ai_input(name, user_id=user.email) if name else (name, False)

    school = (
        db.query(School)
        .filter(func.lower(School.name) == safe_name.lower())
        .first()
    )
    is_new = school is None
    if school is None:
        # (#3804 security review, 2026-11-01, finding 3) admin_user_id is
        # NOT a privilege grant — grep confirms zero authz callers read
        # this column anywhere in the app. It is purely a "who created
        # this record" breadcrumb, same convention the retired
        # assign_teacher_to_school used. A self-activating teacher who
        # happens to be the first to type a brand-new school name does
        # NOT thereby become that school's admin in any permission
        # sense; `can()`'s ("school","manage") policy is hardcoded False
        # for everyone except system_admin, independent of this field.
        #
        # (#3804 security review, 2026-11-02, finding 4) `settings`
        # records that this school was born via self-serve activation —
        # NOT domain=None alone, which is also how plenty of pre-#3804
        # schools (admin-created via POST /schools, test fixtures,
        # bulk-import setups) already represent a genuinely-shared
        # institutional school with no email-domain concept at all.
        # Narrowing classroom_students.py's _eligible_student_ids()
        # strictly by "domain is empty" would have also silently
        # narrowed those long-standing, intentionally-shared schools —
        # a real regression caught by test_classrooms_api.py /
        # test_classroom_join_and_batch.py (15 tests) when first tried.
        # This explicit marker scopes the new restriction to exactly
        # the new risk (self-activation lets strangers join by name)
        # without touching schools nobody self-activated into.
        #
        # (#3812, 2026-11-02) `pending_review: True` added on top of the
        # existing marker: a manually-typed name was never checked against
        # the MOE directory, so it needs to be distinguishable from one
        # that was (for future admin reconciliation tooling — out of scope
        # this round, same "no automatic merge" stance as PRD §4.2).
        school = School(
            name=safe_name,
            domain=None,
            admin_user_id=user.id,
            settings={"created_via": "self_activation", "pending_review": True},
        )
        db.add(school)
        db.flush()

    return school, is_new


def activate_teacher_for_schools(
    db: Session, user: User, schools_input: list[ActivateTeacherSchoolInput]
) -> list[tuple[School, bool, bool]]:
    """Self-serve teacher activation (#3804, extended #3812): grant
    `teacher` scoped to each selected school.

    Each item in `schools_input` (ActivateTeacherSchoolInput — see
    app/schemas/user.py) is either:
    - moe_school_code: binds directly to that directory row, no name
      matching (#3812 — name matching is how a typo splits one real school
      into two rows).
    - name: manual "找不到我的學校" fallback — match-by-exact-name-or-create,
      same as the original #3804 behavior; a newly-created row is flagged
      pending_review (see _resolve_school_by_manual_name).

    Idempotent per resolved school: calling it twice (by code or by a name
    that resolves to the same row) does not duplicate the role or the
    school.

    Returns:
        A list of (School, is_new, role_active) in input order.
        - is_new: True only for a brand-new manually-created school (a
          directory row picked by code is never "new" here; it was
          imported, not created by this call).
        - role_active: whether the caller's teacher role at this school
          is ACTUALLY active right now (find_01RzZ2bXyjs6SrNmD7KkKy91,
          high, 2026-11-05) -- reflects the real row state, not just
          whether THIS call would have created an active one, so a
          repeat/idempotent call on an already-active row (e.g. a real
          teacher an admin granted directly, re-declaring the same
          school) correctly reports True, not a guess re-derived from
          is_new alone.
    """
    teacher_role = db.query(Role).filter(Role.name == "teacher").first()
    schools: list[tuple[School, bool, bool]] = []

    for item in schools_input:
        if item.moe_school_code:
            school, is_new = _resolve_school_by_moe_code(db, item.moe_school_code)
        else:
            school, is_new = _resolve_school_by_manual_name(db, user, item.name)

        role_active = False  # overwritten below whenever teacher_role exists

        if teacher_role is not None:
            existing_role = (
                db.query(UserRole)
                .filter(
                    UserRole.user_id == user.id,
                    UserRole.role_id == teacher_role.id,
                    UserRole.scope_type == "school",
                    UserRole.scope_id == str(school.id),
                )
                .first()
            )
            if existing_role is None:
                # Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91 (high),
                # coordinator decision 2026-11-05 -- supersedes this
                # function's own 2026-11-02 PRD §4.2 stance (see
                # _resolve_school_by_manual_name's docstring) that matching
                # an existing row should never be treated differently from
                # creating one. It now is, specifically for how much trust
                # the resulting TEACHER ROLE gets (not for the school row
                # itself, which still isn't retroactively flagged):
                #
                # Trust immediately (is_active=True) when the school is
                # self-activation-born -- `is_new` (this call just created
                # it) OR an EARLIER self-activation already created it
                # (settings.created_via == "self_activation", the same
                # flag classroom_students.py::_eligible_student_ids already
                # keys on). Multiple teachers joining the same self-created
                # school shortly after each other is the normal multi-
                # teacher-per-school case, not the threat this finding
                # names -- that narrowing already lives downstream in
                # _eligible_student_ids (a self-activated colleague still
                # can't see another self-activated colleague's students).
                #
                # Require confirmation (is_active=False) only for a
                # GENUINELY pre-existing school -- MOE-directory-imported
                # or admin-created (settings is None / no created_via
                # marker) -- which is exactly what the finding's own threat
                # model names ("an existing school imported from the MOE
                # directory or created by an admin is an open target").
                # Those schools may already have real teachers and students
                # who trust "anyone with a school-scoped teacher role here
                # is a colleague" -- is_school_teacher()/create_classroom
                # and _eligible_student_ids/search+enrol all gate on
                # UserRole.is_active, so an inactive row here means the
                # caller is registered (idempotent re-calls, discoverable
                # by an admin) but cannot create a classroom, search for,
                # or enrol that school's students until a system_admin
                # activates it (no approval endpoint exists yet for this
                # specific pending state -- an admin can flip is_active via
                # direct DB access or a future dedicated endpoint; tracked
                # as follow-up product work, not blocking this security
                # fix).
                is_self_activation_school = bool(
                    school.settings
                    and school.settings.get("created_via") == "self_activation"
                )
                role_active = is_new or is_self_activation_school
                db.add(
                    UserRole(
                        user_id=user.id,
                        role_id=teacher_role.id,
                        scope_type="school",
                        scope_id=str(school.id),
                        is_active=role_active,
                    )
                )
            elif existing_role.is_active:
                # Idempotent re-declaration of a school where the caller
                # ALREADY holds an active role (however it was granted --
                # self-activation or a direct admin assign). Must report
                # the real, unchanged state, not re-derive a guess from
                # is_new/is_self_activation_school, which would wrongly
                # report False for a real admin-granted teacher at a
                # pre-existing school simply re-declaring it.
                role_active = True
            elif not existing_role.is_active:
                # An existing inactive row is ambiguous on its own -- it
                # could be #3804's original "admin revoked it" case, or
                # this fix's new "pending confirmation, never active"
                # case. Distinguish using the SAME signal the creation
                # branch above just used: a fresh grant at a self-
                # activation-type school is ALWAYS created active, so an
                # inactive row there could only have gotten that way by
                # being revoked after the fact -- fail closed, same as
                # #3804 always did (re-naming the school must not let the
                # teacher undo an admin's revocation). An inactive row at
                # a GENUINELY pre-existing (non-self-activation) school
                # is this fix's normal, expected pending state --
                # a repeat call must stay idempotent (200, still inactive,
                # still can't act on it) rather than erroring, since the
                # row's state does not change either way.
                is_self_activation_school = bool(
                    school.settings
                    and school.settings.get("created_via") == "self_activation"
                )
                if is_self_activation_school:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=(
                            f"您在「{school.name}」的老師身分已被停用，"
                            "請聯繫管理員處理，無法自行重新開通。"
                        ),
                    )
                # else: pending confirmation at a pre-existing school --
                # fall through, idempotent no-op, row stays inactive
                # (role_active stays at its False default).

        schools.append((school, is_new, role_active))

    return schools


def create_user_account(
    db: Session,
    email: str,
    password: str,
    name: str | None,
) -> tuple[User, str | None]:
    """Create a new user account and return (user, verification_token).

    (#3804) Renamed from create_teacher_user — this function has never been
    teacher-specific, it just creates a bare account; the caller decides what
    role to grant (grant_default_student_role as of #3804).

    Handles:
    - Name sanitization (AI injection prevention)
    - Password hashing
    - Email verification token generation (controlled by REQUIRE_EMAIL_VERIFICATION flag)
    - DB flush (without commit — caller commits after assigning the default role)

    Returns:
        (user, verification_token) where verification_token is None when
        REQUIRE_EMAIL_VERIFICATION=False (auto-verified).
    """
    safe_name, _ = sanitize_ai_input(name, user_id=email) if name else (name, False)

    require_verification = settings.require_email_verification

    if require_verification:
        verification_token: str | None = secrets.token_hex(EMAIL_VERIFICATION_TOKEN_BYTES)
        auto_verified = False
    else:
        verification_token = None
        auto_verified = True

    user = User(
        email=email,
        password_hash=hash_password(password),
        name=safe_name,
        email_verified=auto_verified,
        email_verification_token=verification_token,
    )
    db.add(user)
    db.flush()
    return user, verification_token
