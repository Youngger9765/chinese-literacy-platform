from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    # min_length removed here so auth route can return a descriptive Chinese error
    password: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)
    # #3804 (Young 2026-11-01): every account defaults to student -- there is
    # no more "role=teacher" branch. The only role this field still acts on
    # is "parent" (opt-in, #3513, only while the parent portal is enabled).
    # Any other value (including "teacher" or "student", for backward
    # compatibility with old clients) is accepted but has no effect; the
    # account is a student either way, same as omitting role entirely.
    # Self-serve teacher activation is a separate step: see
    # POST /users/me/activate-teacher and PRD
    # docs/prd/2026-11-01-school-as-teacher-attribute-prd.md §10/§11.
    role: str | None = Field(None, max_length=50)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=254)
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    # min_length removed here so auth route can return a descriptive Chinese error
    new_password: str = Field(..., min_length=1, max_length=128)


class ClaimAccountRequest(BaseModel):
    """#3824 — a teacher-created ("child") account REQUESTING to become a
    regular, self-owned account. Operates only on the caller's own account
    (no student_id field): the caller must already be authenticated AS this
    account, which requires knowing its current username/password to begin
    with. current_password is required again as defense-in-depth for this
    high-impact action (same pattern as ChangePasswordRequest), even though
    the JWT already proves a recent login.

    This only files a request — see account_claim_service.request_claim()'s
    module docstring. The account is not transferred until the recorded
    creator (password teacher) approves it via a classroom-scoped endpoint
    (routes/classrooms/classroom_password.py), so knowing this account's
    password is never sufficient on its own to complete a handover."""

    current_password: str
    new_email: EmailStr
    # min_length removed here so the route can return a descriptive Chinese
    # error via enforce_password_strength, same as RegisterRequest/
    # ChangePasswordRequest.
    new_password: str = Field(..., min_length=1, max_length=128)


class ClaimAccountResponse(BaseModel):
    message: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False
    # Issue #457: True for teachers/admins and students enrolled in at least one classroom.
    # False only for students with no classroom enrollment — shows a waiting screen on frontend.
    has_classroom: bool = True


class RegisterResponse(BaseModel):
    message: str
    # Dev/staging mode: token returned directly so the flow can be tested without email.
    # In production this field would be omitted and the token sent via email only.
    verification_token: str | None = None
    # True when REQUIRE_EMAIL_VERIFICATION=false (staging/preview) — account is
    # auto-verified and user can log in immediately. Frontend uses this to skip
    # the "check your email" waiting screen (no email pipeline implemented yet).
    auto_verified: bool = False


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    """Accepts email or username to initiate a password reset."""
    identifier: str = Field(..., min_length=1, max_length=254)


class ForgotPasswordResponse(BaseModel):
    message: str
    # Token is gated on environment: present in dev/preview, null in production.
    # In production, the token would be sent via email only (not in response body).
    reset_token: str | None = None


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=64)
    new_password: str = Field(..., min_length=1, max_length=128)


class ResetPasswordResponse(BaseModel):
    message: str


class VerifyEmailRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=64)


class VerifyEmailResponse(BaseModel):
    message: str

class GoogleLoginRequest(BaseModel):
    """Credential from Google Sign-In for Web (id_token issued by Google)."""
    credential: str


class GoogleLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    is_new_user: bool = False


class JunyiLoginRequest(BaseModel):
    """One-time auth code from Junyi SSO callback (issue #1198).

    The frontend receives this code at /junyi-callback?code=<...> and immediately
    forwards it here. The backend exchanges it with Junyi's /api/v2/auth/code
    endpoint (code is single-use, TTL 600s).
    """
    code: str = Field(..., min_length=1, max_length=256)


class JunyiLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    is_new_user: bool = False


class LinkJunyiResponse(BaseModel):
    """find_01TR6DK93L6FNmgCd2aDRV3a: result of POST /auth/link-junyi --
    linking a Junyi identity onto the caller's OWN, already-authenticated
    account (not a login response; no new token is issued)."""
    message: str = "均一帳號已連結。"
