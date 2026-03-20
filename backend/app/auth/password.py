import bcrypt


_BCRYPT_MAX = 72  # bcrypt hard limit


def _encode(plain: str) -> bytes:
    """UTF-8 encode and truncate to bcrypt's 72-byte hard limit."""
    return plain.encode("utf-8")[:_BCRYPT_MAX]


def hash_password(plain: str) -> str:
    """Hash a password using bcrypt with cost factor 12."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(_encode(plain), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    return bcrypt.checkpw(_encode(plain), hashed.encode("utf-8"))
