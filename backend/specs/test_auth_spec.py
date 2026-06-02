"""
Spec: auth — password round-trip + JWT sign/verify contracts.

Canonical sources:
  backend/app/auth/password.py  (hash_password / verify_password)
  backend/app/auth/jwt.py       (create_access_token / decode_token)

Module spec: specs/modules/auth/INTENT.md

Complements (does NOT duplicate):
  backend/tests/test_characterization_auth_policies.py
    → classroom-level permission matrix (owner/co-teacher/admin/non-member)

These tests are pure-function, no DB required.
"""

import os
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# JWT module reads settings at import time via app.config.settings.
# Provide test-safe values so import does not fail in CI without a .env file.
os.environ.setdefault("JWT_SECRET_KEY", "test-spec-secret-key-wave3")
os.environ.setdefault("DATABASE_URL", "postgresql://dummy:dummy@localhost/dummy")

import jwt as pyjwt

from app.auth.password import hash_password, verify_password, _BCRYPT_MAX
from app.auth.jwt import create_access_token, decode_token


# ---------------------------------------------------------------------------
# I-1: Password round-trip — correct password verifies True, wrong one False
# ---------------------------------------------------------------------------

class TestPasswordRoundTrip:
    def test_correct_password_verifies_true(self):
        hashed = hash_password("secure-password-123")
        assert verify_password("secure-password-123", hashed) is True

    def test_wrong_password_verifies_false(self):
        hashed = hash_password("correct-password")
        assert verify_password("wrong-password", hashed) is False

    def test_empty_string_password_round_trips(self):
        """Empty string is a valid password (though inadvisable)."""
        hashed = hash_password("")
        assert verify_password("", hashed) is True
        assert verify_password("not-empty", hashed) is False

    def test_unicode_password_round_trips(self):
        pw = "密碼安全123！"
        hashed = hash_password(pw)
        assert verify_password(pw, hashed) is True
        assert verify_password("密碼安全123", hashed) is False  # missing ！


# ---------------------------------------------------------------------------
# I-2: bcrypt salt randomization — same plaintext → different hashes
# ---------------------------------------------------------------------------

class TestBcryptRandomness:
    def test_two_hashes_of_same_password_differ(self):
        h1 = hash_password("same-password")
        h2 = hash_password("same-password")
        assert h1 != h2

    def test_both_differing_hashes_verify_correctly(self):
        pw = "same-password"
        h1 = hash_password(pw)
        h2 = hash_password(pw)
        assert verify_password(pw, h1) is True
        assert verify_password(pw, h2) is True


# ---------------------------------------------------------------------------
# I-3: JWT round-trip — sub is str(user_id)
# ---------------------------------------------------------------------------

class TestJWTRoundTrip:
    def test_sub_matches_user_id_as_string(self):
        token = create_access_token(42)
        payload = decode_token(token)
        assert payload["sub"] == "42"

    def test_sub_is_string_not_int(self):
        token = create_access_token(99)
        payload = decode_token(token)
        assert isinstance(payload["sub"], str)

    def test_different_user_ids_produce_different_subs(self):
        p1 = decode_token(create_access_token(1))
        p2 = decode_token(create_access_token(2))
        assert p1["sub"] != p2["sub"]

    def test_payload_contains_exp_and_iat(self):
        payload = decode_token(create_access_token(10))
        assert "exp" in payload
        assert "iat" in payload

    def test_zero_user_id_round_trips(self):
        """Edge case: user_id=0 should round-trip (rare but not prohibited)."""
        token = create_access_token(0)
        payload = decode_token(token)
        assert payload["sub"] == "0"


# ---------------------------------------------------------------------------
# I-4: Invalid token raises jwt.InvalidTokenError
# ---------------------------------------------------------------------------

class TestInvalidToken:
    def test_tampered_token_raises(self):
        token = create_access_token(1)
        # Flip one character in the signature segment
        parts = token.split(".")
        if len(parts) == 3:
            sig = parts[2]
            # Replace first char with a different one
            tampered_sig = ("A" if sig[0] != "A" else "B") + sig[1:]
            tampered = ".".join(parts[:2] + [tampered_sig])
        else:
            tampered = token + "X"

        with pytest.raises(pyjwt.InvalidTokenError):
            decode_token(tampered)

    def test_gibberish_token_raises(self):
        with pytest.raises(pyjwt.InvalidTokenError):
            decode_token("not.a.valid.jwt.token")

    def test_empty_string_raises(self):
        with pytest.raises(pyjwt.InvalidTokenError):
            decode_token("")


# ---------------------------------------------------------------------------
# I-5: bcrypt 72-byte truncation is documented behavior
# ---------------------------------------------------------------------------

class TestBcryptTruncation:
    def test_passwords_differing_only_after_72_bytes_verify_interchangeably(self):
        """
        bcrypt silently truncates at 72 bytes (UTF-8).
        Two passwords that differ ONLY in byte 73+ will cross-verify as True.
        This is a documented bcrypt limitation, NOT a bug in our code.
        See: https://en.wikipedia.org/wiki/Bcrypt#Maximum_password_length

        We pin this behavior so that future changes to hash_password
        (e.g. adding a pre-hash step) are forced to reconsider this invariant.
        """
        # Construct two passwords identical for 72 bytes, differing at byte 73
        base = "a" * _BCRYPT_MAX  # exactly 72 bytes (ASCII)
        pw_a = base + "X"          # 73 bytes
        pw_b = base + "Y"          # 73 bytes, differs in last byte

        h = hash_password(pw_a)
        # Both verify True because bcrypt only sees the first 72 bytes
        assert verify_password(pw_a, h) is True
        assert verify_password(pw_b, h) is True  # known truncation behavior

    def test_passwords_differing_before_72_bytes_do_not_cross_verify(self):
        pw_a = "a" * 10 + "X" + "b" * 61  # 72 bytes, X at position 10
        pw_b = "a" * 10 + "Y" + "b" * 61  # same length, Y at position 10
        h = hash_password(pw_a)
        assert verify_password(pw_a, h) is True
        assert verify_password(pw_b, h) is False  # differ within 72 bytes


# Need pytest for raises
import pytest
