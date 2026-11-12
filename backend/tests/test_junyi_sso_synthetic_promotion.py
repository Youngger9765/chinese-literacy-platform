import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.user import User
from app.services.sso_login_service import resolve_junyi_user


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    Base.metadata.drop_all(engine)
    engine.dispose()


def _user(db, email, identity):
    user = User(email=email, password_hash="password", name="原名", junyi_identity_id=identity, email_verified=True)
    db.add(user)
    db.commit()
    return user


def _payload():
    return {"userId": "jid-promo-1", "userEmail": "real@example-junyi.invalid", "userDisplayName": "真名"}


def test_first_sso_login_promotes_synthetic_email_to_real_one(db):
    original = _user(db, "junyi-abc123@student.lingoleap.local", "jid-promo-1")
    user, is_new = resolve_junyi_user(db, _payload())
    assert user.id == original.id
    assert user.email == "real@example-junyi.invalid"
    assert user.name == "原名"
    assert is_new is False


class TestPromotionResetsEmailVerified:
    """find_01V63cq32bEPy1KsaqoRTp8v (high, CWE-345): the promoted email is
    Junyi's CLAIM, not proof of ownership (same root cause as #3891/#3892's
    finding). Leaving email_verified=True on the row after promotion let a
    later Google sign-in for that same address trust it and link onto the
    row — full account takeover, attacker keeps access via Junyi SSO.
    """

    def test_promotion_resets_email_verified_to_false(self, db):
        original = _user(db, "junyi-abc123@student.lingoleap.local", "jid-promo-1")
        assert original.email_verified is True  # the import's starting state

        user, _ = resolve_junyi_user(db, _payload())

        assert user.id == original.id
        assert user.email == "real@example-junyi.invalid"
        assert user.email_verified is False, (
            "a promoted-but-unproven email must not keep the row's prior "
            "email_verified=True — that flag was true for a different "
            "reason (synthetic-placeholder import), not for this address"
        )

    def test_a_later_google_login_for_the_promoted_email_does_not_silently_link(self, db):
        """The actual attack this closes: resolve_google_user's link gate
        checks the EXISTING row's email_verified before linking onto it.
        After promotion resets that flag, a real victim's later Google
        sign-in for the same address must be refused (409), not silently
        linked onto the attacker-controlled row."""
        from app.services.sso_login_service import resolve_google_user
        from fastapi import HTTPException

        _user(db, "junyi-abc123@student.lingoleap.local", "jid-promo-1")
        resolve_junyi_user(db, _payload())  # attacker promotes the email

        victim_id_info = {
            "sub": "google-sub-victim",
            "email": "real@example-junyi.invalid",
            "email_verified": True,  # Google itself verified it -- the LOCAL row is what's in question
            "name": "真正的本人",
        }
        with pytest.raises(HTTPException) as exc_info:
            resolve_google_user(db, victim_id_info)
        assert exc_info.value.status_code == 409


def test_promotion_skipped_if_real_email_already_taken_by_someone_else(db):
    original = _user(db, "junyi-abc123@student.lingoleap.local", "jid-promo-1")
    other = _user(db, "real@example-junyi.invalid", None)
    user, is_new = resolve_junyi_user(db, _payload())
    assert user.id == original.id
    assert user.email == "junyi-abc123@student.lingoleap.local"
    assert other.email == "real@example-junyi.invalid"
    assert is_new is False


def test_promotion_skipped_if_inactive_account_holds_real_email(db):
    original = _user(db, "junyi-abc123@student.lingoleap.local", "jid-promo-1")
    inactive = _user(db, "real@example-junyi.invalid", None)
    inactive.is_active = False
    db.commit()

    user, is_new = resolve_junyi_user(db, _payload())
    db.commit()

    assert user.id == original.id
    assert user.email == "junyi-abc123@student.lingoleap.local"
    assert inactive.email == "real@example-junyi.invalid"
    assert is_new is False


def test_non_synthetic_account_email_is_never_touched_by_sso_login(db):
    original = _user(db, "old@example-junyi.invalid", "jid-promo-1")
    user, is_new = resolve_junyi_user(db, _payload())
    assert user.id == original.id
    assert user.email == "old@example-junyi.invalid"
    assert is_new is False
