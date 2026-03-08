"""Password strength validation utilities."""

import re
from dataclasses import dataclass


@dataclass
class PasswordValidationResult:
    is_valid: bool
    errors: list[str]


def validate_password_strength(password: str) -> PasswordValidationResult:
    """Validate password meets minimum strength requirements.

    Rules:
    - At least 8 characters
    - At least 1 letter (a-z or A-Z)
    - At least 1 number (0-9)

    Returns a PasswordValidationResult with is_valid flag and list of error messages in Chinese.
    """
    errors: list[str] = []

    if len(password) < 8:
        errors.append("密碼至少需要 8 個字元")

    if not re.search(r"[a-zA-Z]", password):
        errors.append("密碼必須包含至少一個英文字母")

    if not re.search(r"\d", password):
        errors.append("密碼必須包含至少一個數字")

    return PasswordValidationResult(is_valid=len(errors) == 0, errors=errors)


def get_password_strength_level(password: str) -> str:
    """Return strength level: 'weak', 'medium', or 'strong'."""
    if not password:
        return "weak"

    score = 0

    if len(password) >= 8:
        score += 1
    if len(password) >= 12:
        score += 1

    if re.search(r"[a-z]", password):
        score += 1
    if re.search(r"[A-Z]", password):
        score += 1
    if re.search(r"\d", password):
        score += 1
    if re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]", password):
        score += 1

    if score <= 2:
        return "weak"
    elif score <= 4:
        return "medium"
    else:
        return "strong"
