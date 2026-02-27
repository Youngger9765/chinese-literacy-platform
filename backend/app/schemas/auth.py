from pydantic import BaseModel, EmailStr, Field
from typing import Literal, Annotated, Union


class TeacherRegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)
    school_name: str = Field(min_length=1, max_length=200)


class TeacherLoginRequest(BaseModel):
    login_type: Literal["teacher"]
    email: EmailStr
    password: str


class StudentLoginRequest(BaseModel):
    login_type: Literal["student"]
    class_code: str = Field(min_length=6, max_length=8)
    seat_number: int = Field(ge=1)
    password: str


LoginRequest = Annotated[
    Union[TeacherLoginRequest, StudentLoginRequest], Field(discriminator="login_type")
]


class UserProfile(BaseModel):
    id: int
    name: str
    role: Literal["teacher", "student"]
    email: str | None = None
    seat_number: int | None = None
    class_code: str | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserProfile
