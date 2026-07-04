"""
黑白箱資安驗收 — 動態行為測試（in-process TestClient，全本機、免雲端、免 Vertex）。

補齊 tests/security/blackbox_acceptance.sh 靜態段標 [DEFER] 的動態項：
  - 安全標頭出現在真實回應          (A05 · WSTG-CONF-07)
  - 未授權 / 偽造 JWT 被拒           (A07 · WSTG-ATHN)
  - CORS 不反射未白名單 Origin       (A05 · WSTG-CONF-07)
  - 公開上傳偽造 MIME / 路徑注入被拒 (A03 · WSTG-INPV / BUSL)
  - IDOR：教師 B 不能讀教師 A 的班級 (A01 · WSTG-ATHZ-04)  ← 靜態段無法驗，這裡真打

Run:
    cd backend && python -m pytest tests/security/test_dynamic_security.py -v
"""
import base64
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.auth.jwt import create_access_token

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _pragma(dbapi_connection, connection_record):
    cur = dbapi_connection.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    from app.models.user import Role

    Base.metadata.create_all(bind=engine)
    s = TestingSessionLocal()
    for r in SEED_ROLES:
        s.add(Role(**r))
    s.commit()
    s.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _b64(d: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()


def _fake_token(alg: str) -> str:
    """Build a structurally-valid but unsigned/forged token at runtime.

    Constructed from parts so no literal JWT string sits in source (avoids
    secret-scanner false positives on obviously-fake test tokens).
    """
    header = _b64({"alg": alg, "typ": "JWT"})
    body = _b64({"sub": "1"})
    return f"{header}.{body}.forged"  # bogus signature segment


def _register_teacher(client) -> dict:
    u = uuid.uuid4().hex[:8]
    email, pw = f"t_{u}@example.com", "SecurePass123!"
    r = client.post("/api/auth/register", json={"email": email, "password": pw, "name": f"T{u}"})
    assert r.status_code == 201, r.text
    vt = r.json().get("verification_token")
    if vt:
        client.get(f"/api/auth/verify-email?token={vt}")
    tok = client.post("/api/auth/login", json={"email": email, "password": pw}).json()["access_token"]
    uid = client.get("/api/users/me", headers=_auth(tok)).json()["id"]
    return {"token": tok, "user_id": uid, "email": email}


def _first_school_id() -> int:
    from app.models.school import School

    db = TestingSessionLocal()
    try:
        s = db.query(School).first()
        return s.id if s else None
    finally:
        db.close()


# ── A05 · WSTG-CONF-07 安全標頭 ────────────────────────────────────────────
def test_security_headers_present(client):
    r = client.get("/api/health")
    h = {k.lower(): v for k, v in r.headers.items()}
    assert h.get("x-frame-options") == "DENY"
    assert h.get("x-content-type-options") == "nosniff"
    assert "content-security-policy" in h
    assert "strict-transport-security" in h
    assert "frame-ancestors 'none'" in h["content-security-policy"]


# ── A07 · WSTG-ATHN 未授權 / 偽造 token ────────────────────────────────────
def test_protected_endpoint_requires_auth(client):
    assert client.get("/api/users/me").status_code == 401


def test_forged_jwt_rejected(client):
    forged = _fake_token("HS256")  # 正確 alg 但簽章是假的
    assert client.get("/api/users/me", headers=_auth(forged)).status_code == 401


def test_alg_none_token_rejected(client):
    # alg=none token（無簽章）必須被拒 — 防 alg-confusion
    none_tok = _fake_token("none")
    assert client.get("/api/users/me", headers=_auth(none_tok)).status_code == 401


# ── A05 · WSTG-CONF-07 CORS 不反射惡意 Origin ──────────────────────────────
def test_cors_does_not_reflect_evil_origin(client):
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    acao = r.headers.get("access-control-allow-origin")
    assert acao != "https://evil.example"


# ── A03 · WSTG-INPV / BUSL 公開上傳硬化 ────────────────────────────────────
def test_upload_rejects_spoofed_mime(client):
    # 宣稱 audio/wav 但內容不是 RIFF/WAVE → magic-bytes 不符 → 400
    r = client.post(
        "/api/testset/upload",
        data={"contributor_name": "probe", "lesson_id": "G6-L22", "version": "correct"},
        files={"audio": ("x.wav", b"not-a-real-wav-file", "audio/wav")},
    )
    assert r.status_code in (400, 415), r.text


def test_upload_rejects_path_traversal_lesson_id(client):
    r = client.post(
        "/api/testset/upload",
        data={"contributor_name": "probe", "lesson_id": "../../etc/passwd", "version": "correct"},
        files={"audio": ("x.wav", b"RIFF....WAVE", "audio/wav")},
    )
    assert r.status_code == 400, r.text


def test_upload_rejects_unknown_mime(client):
    r = client.post(
        "/api/testset/upload",
        data={"contributor_name": "probe", "lesson_id": "G6-L22", "version": "correct"},
        files={"audio": ("x.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert r.status_code in (400, 415), r.text


# ── A01 · WSTG-ATHZ-04 IDOR：跨教師班級隔離 ────────────────────────────────
def test_idor_teacher_cannot_read_other_teachers_classroom(client):
    a = _register_teacher(client)
    b = _register_teacher(client)
    school_id = _first_school_id()
    assert school_id is not None, "註冊時應已建立預設 school"

    created = client.post(
        "/api/classrooms",
        json={"name": f"ClassA_{uuid.uuid4().hex[:6]}", "grade": 6, "school_id": school_id},
        headers=_auth(a["token"]),
    )
    assert created.status_code == 201, created.text
    cid = created.json()["id"]

    # 正向控制：擁有者 A 可讀自己的班級
    assert client.get(f"/api/classrooms/{cid}", headers=_auth(a["token"])).status_code == 200
    # IDOR：教師 B（非擁有者/非協同/非 admin）讀 A 的班級 → 403
    assert client.get(f"/api/classrooms/{cid}", headers=_auth(b["token"])).status_code == 403
    # 未授權讀 → 401
    assert client.get(f"/api/classrooms/{cid}").status_code == 401


# ── A01 · WSTG-ATHZ-04 IDOR：跨組織資料隔離（org_admin 不得跨 org 讀）─────────
# 直接建 User + org role + 簽 token，避開註冊時 school→org 綁定污染 org 判斷。
def _create_user(email: str) -> int:
    from app.models.user import User
    from app.auth.password import hash_password

    db = TestingSessionLocal()
    try:
        u = User(email=email, password_hash=hash_password("x"), name="X", is_active=True, email_verified=True)
        db.add(u)
        db.commit()
        db.refresh(u)
        return u.id
    finally:
        db.close()


def _create_org(name: str) -> str:
    from app.models.organization import Organization

    db = TestingSessionLocal()
    try:
        o = Organization(name=name)
        db.add(o)
        db.commit()
        db.refresh(o)
        return o.id
    finally:
        db.close()


def _grant_role(user_id: int, role_name: str, scope_type: str, scope_id):
    from app.models.user import Role, UserRole

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == role_name).first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type=scope_type,
                        scope_id=scope_id, is_active=True))
        db.commit()
    finally:
        db.close()


def test_idor_org_admin_cannot_read_cross_org_user(client):
    u = uuid.uuid4().hex[:6]
    org_a = _create_org(f"OrgA_{u}")
    org_b = _create_org(f"OrgB_{u}")

    admin_a = _create_user(f"orgadmin_a_{u}@example.com")
    same_org_user = _create_user(f"member_a_{u}@example.com")   # 同 org A → 正向控制
    cross_org_user = _create_user(f"member_b_{u}@example.com")  # org B → IDOR 標的
    sysadmin = _create_user(f"sys_{u}@example.com")

    _grant_role(admin_a, "org_admin", "organization", org_a)
    _grant_role(same_org_user, "org_admin", "organization", org_a)
    _grant_role(cross_org_user, "org_admin", "organization", org_b)
    _grant_role(sysadmin, "system_admin", "platform", None)

    tok_a = create_access_token(admin_a)
    tok_sys = create_access_token(sysadmin)

    # IDOR：org_admin A 讀 org B 使用者 → 403（個資法 §20）
    assert client.get(f"/api/users/{cross_org_user}", headers=_auth(tok_a)).status_code == 403
    # 正向控制：org_admin A 讀同 org A 使用者 → 200
    assert client.get(f"/api/users/{same_org_user}", headers=_auth(tok_a)).status_code == 200
    # system_admin 全域 bypass → 讀 org B 使用者 200（確認 bypass 只限 system_admin）
    assert client.get(f"/api/users/{cross_org_user}", headers=_auth(tok_sys)).status_code == 200


@pytest.mark.xfail(
    strict=True,
    reason="MED-1（對抗複審）：policies.require_classroom_member 用 is_admin（含 org_admin 無 org scope）"
    " → 跨 org org_admin 可讀別家班級。修 policies.py 改 is_system_admin + org scope 後此測應轉綠，"
    "屆時移除 xfail marker。",
)
def test_idor_org_admin_cannot_read_cross_org_classroom(client):
    # 教師在預設 school 建一個班級
    teacher = _register_teacher(client)
    school_id = _first_school_id()
    created = client.post(
        "/api/classrooms",
        json={"name": f"ClsB_{uuid.uuid4().hex[:6]}", "grade": 6, "school_id": school_id},
        headers=_auth(teacher["token"]),
    )
    assert created.status_code == 201, created.text
    cid = created.json()["id"]

    # 另一個 org 的 org_admin（與該班 school 的 org 無關）
    other_org = _create_org(f"OtherOrg_{uuid.uuid4().hex[:6]}")
    outsider = _create_user(f"orgadmin_x_{uuid.uuid4().hex[:6]}@example.com")
    _grant_role(outsider, "org_admin", "organization", other_org)
    tok = create_access_token(outsider)

    # 正確行為：跨 org 的 org_admin 不該讀到別家班級 → 應 403
    # 目前 is_admin bypass 會回 200（漏洞）→ 本測 xfail，修好後轉綠
    assert client.get(f"/api/classrooms/{cid}", headers=_auth(tok)).status_code == 403


@pytest.mark.xfail(
    strict=True,
    reason="NEW-1（Cursor 盲掃，已驗證）：schools.py list_school_members/classrooms 只有 get_current_user、"
    "無 org/school scope → 任何登入者猜 school_id 即可撈全校成員 name/email/role。"
    "加 org/school membership 檢查後此測轉綠，移除 xfail marker。",
)
def test_idor_any_user_cannot_enumerate_school_members(client):
    # 註冊教師會建立預設 school（含該教師為成員，帶 email）
    _register_teacher(client)
    sid = _first_school_id()
    assert sid is not None

    # 與該 school 完全無關的登入者（無任何 role）
    outsider = _create_user(f"outsider_{uuid.uuid4().hex[:8]}@example.com")
    tok = create_access_token(outsider)

    # 正確行為：無關使用者不該讀到全校成員名冊（PII）→ 應 403
    # 目前無授權檢查會回 200 + email（漏洞）→ 本測 xfail，修好後轉綠
    assert client.get(f"/api/schools/{sid}/members", headers=_auth(tok)).status_code == 403
