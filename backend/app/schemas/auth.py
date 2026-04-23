from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    # min_length removed here so auth route can return a descriptive Chinese error
    password: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)
    # Optional role hint. Only "teacher" (or omitted) is allowed for self-registration.
    # Students must be created by teachers via classroom management (issue #457).
    role: str | None = Field(None, max_length=50)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=254)
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    # min_length removed here so auth route can return a descriptive Chinese error
    new_password: str = Field(..., min_length=1, max_length=128)


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
