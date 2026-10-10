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


def test_promotion_skipped_if_real_email_already_taken_by_someone_else(db):
    original = _user(db, "junyi-abc123@student.lingoleap.local", "jid-promo-1")
    other = _user(db, "real@example-junyi.invalid", None)
    user, is_new = resolve_junyi_user(db, _payload())
    assert user.id == original.id
    assert user.email == "junyi-abc123@student.lingoleap.local"
    assert other.email == "real@example-junyi.invalid"
    assert is_new is False


def test_non_synthetic_account_email_is_never_touched_by_sso_login(db):
    original = _user(db, "old@example-junyi.invalid", "jid-promo-1")
    user, is_new = resolve_junyi_user(db, _payload())
    assert user.id == original.id
    assert user.email == "old@example-junyi.invalid"
    assert is_new is False
