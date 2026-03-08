from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    # min_length removed here so auth route can return a descriptive Chinese error
    password: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=100)


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


class ForgotPasswordRequest(BaseModel):
    """Accepts email or username to initiate a password reset."""
    identifier: str = Field(..., min_length=1, max_length=254)


class ForgotPasswordResponse(BaseModel):
    message: str
    # P0: no email sending yet — token returned directly for testing.
    # In production this field would be omitted and the token sent via email only.
    reset_token: str


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=64)
    new_password: str = Field(..., min_length=1, max_length=128)


class ResetPasswordResponse(BaseModel):
    message: str


class VerifyEmailRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=64)


class VerifyEmailResponse(BaseModel):
    message: str
