"""三篇的進度分開存，互不覆蓋（#2916）。

一份學習單印三篇課文時，念順順出現三次。進度是以 **step id** 為 key 寫進
`step_progress.step_data` 的 JSONB 裡 —— 三篇共用一個 key 的話，
學生念完第 3 篇，前兩篇的成績就被蓋掉了，而且**存得進去、讀得回來、
不報錯**，只是三筆變一筆。

前端那一半（網址 `?p=` → `key-passage-reading#9a7x4`）鎖在
`frontend/src/hooks/useCurrentStepId.test.tsx`。這裡鎖後端這一半：
帶後綴的 key 真的能各自存取、而且不需要任何 migration
（`step_progress` 是 JSONB，key 是自由的 —— 這條就是那句話的證據）。
"""
from __future__ import annotations

import sys, os, uuid
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.text import Text
from app.models.user import Role

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _pragma(conn, _rec):
    c = conn.cursor(); c.execute("PRAGMA foreign_keys=ON"); c.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
SLUG = "1"

ROLES = [("system_admin", "platform"), ("org_admin", "organization"), ("principal", "school"),
         ("director", "school"), ("teacher", "school"), ("homeroom_teacher", "school"),
         ("student", "school"), ("parent", "school")]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    s = TestingSessionLocal()
    for name, scope in ROLES:
        s.add(Role(name=name, display_name=name, scope_level=scope))
    s.add(Text(title="多篇課", paragraphs=["第一段"], char_count=3, grade=6,
               grade_code="G6-L22", genre="說明文", text_type="單",
               category="Science", lesson_number=1))
    s.commit(); s.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def token(client):
    u = uuid.uuid4().hex[:8]
    email, pw = f"round_user_{u}@example.com", "SecurePass123!"
    # ⛔ 不指定 role：帶 `role: student` 會被擋（學生帳號由老師建立）。
    r = client.post("/api/auth/register", json={
        "email": email, "password": pw, "name": f"Round User {u}"})
    assert r.status_code in (200, 201), r.text
    vt = r.json().get("verification_token")
    if vt:
        client.get(f"/api/auth/verify-email?token={vt}")
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def session_id(client, token):
    r = client.post("/api/learning/sessions", json={"story_slug": SLUG},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# 三篇的念順順：key 是 `步驟#那一節自己的代號`
KEYS = ["key-passage-reading#yprak", "key-passage-reading#9a7x4", "key-passage-reading#ajy9w"]


def test_three_rounds_are_stored_under_three_keys(client, token, session_id):
    """依序念完三篇，三筆進度都要在，數值各自正確。

    ## 誰負責累積

    後端的 PUT 是**整批取代** `step_data`，累積在前端做：
    `useStepProgressPersistence` 把新的一筆併進 `{...prev.step_data}` 再整份送出
    （`prev` 是進頁時從 GET 載回來的）。所以這裡也照同樣的方式送 ——
    我第一版每次只送一筆，讀回來只剩最後一筆，差點把它當成「三篇會互相覆蓋」。
    那不是產品的行為，是我沒照客戶端的合約送。

    ⛔ 不要「修」後端改成合併：整批取代才刪得掉東西，
    合併語意下沒有辦法移除一筆已存在的進度。
    """
    h = {"Authorization": f"Bearer {token}"}
    acc: dict = {}
    for i, k in enumerate(KEYS):
        acc[k] = {"wpm": 100 + i}          # 前端就是這樣累積的
        r = client.put(f"/api/learning/sessions/{session_id}/progress",
                       json={"current_step": k, "steps_completed": KEYS[: i + 1],
                             "step_data": dict(acc)},
                       headers=h)
        assert r.status_code in (200, 201), r.text

    # ⛔ 讀回要走 progress 端點。`GET /sessions/{id}` 的回應**不含**
    #    `step_progress` —— 我第一版讀它，拿到 None 就以為沒存進去，
    #    而 PUT 的回應裡明明都在。空值先問「我是不是查錯地方」。
    r = client.get(f"/api/learning/sessions/{session_id}/progress", headers=h)
    assert r.status_code == 200, r.text
    data = ((r.json() or {}).get("step_progress") or {}).get("step_data") or {}
    assert set(KEYS) <= set(data), f"少了: {sorted(set(KEYS) - set(data))}  實得 {sorted(data)}"
    assert [data[k]["wpm"] for k in KEYS] == [100, 101, 102], data


def test_without_the_suffix_the_three_rounds_collapse(client, token, session_id):
    """反向對照：共用裸 key 的話三篇塌成一筆。

    這條不是測產品，是證明上一條真的在測東西 —— 後綴就是分隔的原因。
    """
    h = {"Authorization": f"Bearer {token}"}
    bare = "key-passage-reading"
    acc: dict = {}
    for i in range(3):
        acc[bare] = {"wpm": 200 + i}       # 同一個 key，後寫的蓋前面的
        client.put(f"/api/learning/sessions/{session_id}/progress",
                   json={"current_step": bare, "steps_completed": [bare],
                         "step_data": dict(acc)}, headers=h)
    data = ((client.get(f"/api/learning/sessions/{session_id}/progress", headers=h)
             .json() or {}).get("step_progress") or {}).get("step_data") or {}
    assert len([k for k in data if k.startswith(bare)]) == 1, sorted(data)
    assert data[bare]["wpm"] == 202, "裸 key 沒被覆蓋？那後綴就不是分隔的原因"


def test_no_migration_was_needed(client, token, session_id):
    """`step_progress` 是 JSONB，key 是自由的 —— 換 slug 不需要動 schema。

    這條是「零 migration」那句話的證據：一個從沒出現過的 key 直接寫得進去。
    """
    h = {"Authorization": f"Bearer {token}"}
    novel = "key-passage-reading#" + uuid.uuid4().hex[:5]
    r = client.put(f"/api/learning/sessions/{session_id}/progress",
                   json={"current_step": novel, "steps_completed": [novel],
                         "step_data": {novel: {"wpm": 999}}}, headers=h)
    assert r.status_code in (200, 201), r.text
    data = ((client.get(f"/api/learning/sessions/{session_id}/progress", headers=h)
             .json() or {}).get("step_progress") or {}).get("step_data") or {}
    assert data.get(novel, {}).get("wpm") == 999
