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
) -> list[tuple[School, bool]]:
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
        A list of (School, is_new) in input order — is_new is True only for
        a brand-new manually-created school (a directory row picked by code
        is never "new" here; it was imported, not created by this call).
    """
    teacher_role = db.query(Role).filter(Role.name == "teacher").first()
    schools: list[tuple[School, bool]] = []

    for item in schools_input:
        if item.moe_school_code:
            school, is_new = _resolve_school_by_moe_code(db, item.moe_school_code)
        else:
            school, is_new = _resolve_school_by_manual_name(db, user, item.name)

        schools.append((school, is_new))

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
                db.add(
                    UserRole(
                        user_id=user.id,
                        role_id=teacher_role.id,
                        scope_type="school",
                        scope_id=str(school.id),
                    )
                )
            elif not existing_role.is_active:
                # (#3804 security review, 2026-11-01) A system_admin can
                # revoke this exact role via DELETE /roles/assignments/{id}
                # (soft delete, is_active=False -- routes/roles.py::
                # revoke_role). Silently flipping it back to True here would
                # let the teacher undo that revocation themselves just by
                # naming the same school again -- a real privilege
                # escalation around an admin action. Fail closed instead.
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"您在「{school.name}」的老師身分已被停用，"
                        "請聯繫管理員處理，無法自行重新開通。"
                    ),
                )

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
